import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { schemaForModel } from '../src/agent/dispatcher';
import * as liveConfig from '../src/agent/liveConfig';
import { executeSqlQuery, type TableSchemaInfo } from '../src/data/sqlEngine';
import { bindSqlParams, dialectOfSource, validateReadOnlySql } from '../src/data/sqlGuard';
import { createAuth } from '../server/auth';
import { DEFAULT_MAX_BYTES_BILLED } from '../server/bigqueryCatalog';
import { liveTokenMiddleware } from '../server/liveToken';
import { MemoryUsageStore, Usage } from '../server/usage';

describe('SQL guard reads a query the way the target database does', () => {
  it('maps data sources to dialects', () => {
    expect(dialectOfSource(undefined)).toBe('sqlite');
    expect(dialectOfSource('local')).toBe('sqlite');
    expect(dialectOfSource('bigquery:analytics-prod')).toBe('bigquery');
    expect(dialectOfSource('clickhouse')).toBe('clickhouse');
    expect(dialectOfSource('postgres')).toBe('postgres');
    expect(dialectOfSource('rest:crm')).toBe('sqlite');
  });

  it('refuses a second statement hidden behind a quote the database reads differently', () => {
    const hidden: [string, Parameters<typeof validateReadOnlySql>[1]][] = [
      // SQLite: a backslash does not escape, so the string ends at the second quote
      [`SELECT '\\' ; DROP TABLE monthly_revenue; --'`, { dialect: 'sqlite' }],
      // BigQuery: a backslash escapes inside double quotes too
      [`SELECT "\\"" ; DROP TABLE ds.t; -- "`, { dialect: 'bigquery' }],
      // BigQuery: # starts a comment
      [`SELECT 1 # '\n; DROP TABLE ds.t; -- '`, { dialect: 'bigquery' }],
      // BigQuery: triple-quoted strings
      [`SELECT ''' ' '''; DROP TABLE ds.t; -- '`, { dialect: 'bigquery' }],
      // PostgreSQL: E'' strings and dollar quoting
      [`SELECT E'\\'' ; DROP TABLE t; --'`, { dialect: 'postgres' }],
      [`SELECT $$ ' $$; DROP TABLE t; --'`, { dialect: 'postgres' }],
      [`SELECT $tag$ ' $tag$; DROP TABLE t; --'`, { dialect: 'postgres' }],
      // ClickHouse: heredocs
      [`SELECT $$ ' $$; DROP TABLE t; --'`, { dialect: 'clickhouse' }],
    ];
    for (const [sql, options] of hidden) {
      expect(validateReadOnlySql(sql, options).ok, `Expected blocked (${options?.dialect}): ${sql}`).toBe(false);
    }
  });

  it('refuses statements and functions that write, read files or reach other hosts from a SELECT', () => {
    const blocked: [string, Parameters<typeof validateReadOnlySql>[1]][] = [
      ['SELECT * INTO copy_of_users FROM users', { dialect: 'postgres' }],
      ["SELECT pg_read_file('/etc/passwd')", { dialect: 'postgres' }],
      ["SELECT pg_catalog.pg_sleep(600)", { dialect: 'postgres' }],
      ["SELECT * FROM dblink('host=10.0.0.1', 'select 1') AS t(x int)", { dialect: 'postgres' }],
      ["SELECT * FROM url('http://metadata.google.internal/', 'RawBLOB')", { dialect: 'clickhouse' }],
      ["SELECT * FROM file('/etc/passwd', 'LineAsString')", { dialect: 'clickhouse' }],
      ["SELECT * FROM EXTERNAL_QUERY('conn', 'DELETE FROM t')", { dialect: 'bigquery' }],
    ];
    for (const [sql, options] of blocked) {
      expect(validateReadOnlySql(sql, options).ok, `Expected blocked: ${sql}`).toBe(false);
    }
  });

  it('still allows ordinary analytics SQL in each dialect', () => {
    const allowed: [string, Parameters<typeof validateReadOnlySql>[1]][] = [
      ["SELECT REPLACE(region, 'EMEA', 'Europe') AS region, url, file FROM monthly_revenue", { dialect: 'sqlite' }],
      ["SELECT * FROM monthly_revenue WHERE note LIKE '%\\%' ESCAPE '\\'", { dialect: 'sqlite' }],
      ['SELECT [region] FROM monthly_revenue', { dialect: 'sqlite' }],
      ["SELECT REGEXP_EXTRACT(path, r'^/(\\w+)/') AS section, COUNT(*) AS n FROM `p.ds.hits` GROUP BY 1", { dialect: 'bigquery' }],
      ["SELECT arr[OFFSET(0)], 'it\\'s' FROM `p.ds.t` -- trailing; comment", { dialect: 'bigquery' }],
      ["SELECT created_at::date AS day, count(*) FROM orders WHERE status = 'paid' GROUP BY 1", { dialect: 'postgres' }],
      ['(SELECT 1) UNION ALL (SELECT 2)', { dialect: 'postgres' }],
      ["SELECT toStartOfMonth(ts) AS m, sum(amount) FROM events WHERE name = 'a\\'b' GROUP BY m", { dialect: 'clickhouse' }],
    ];
    for (const [sql, options] of allowed) {
      const res = validateReadOnlySql(sql, options);
      expect(res.ok, `Expected allowed: ${sql} (${res.ok ? '' : res.error})`).toBe(true);
    }
  });

  it('binds parameters with the escaping of the dialect, and the result is still one statement', () => {
    const hostile = `\\'; DROP TABLE t; --`;
    for (const dialect of ['sqlite', 'bigquery', 'clickhouse', 'postgres'] as const) {
      const bound = bindSqlParams('SELECT * FROM t WHERE a = :a', { a: hostile }, dialect);
      const check = validateReadOnlySql(bound, { dialect });
      // Either refused outright (PostgreSQL: backslashes are ambiguous) or read as a single string
      if (check.ok) expect(check.sql.startsWith('SELECT * FROM t WHERE a = ')).toBe(true);
      expect(bound).not.toMatch(/'\s*;\s*DROP TABLE t;\s*--\s*$/);
    }
    expect(bindSqlParams('SELECT :a', { a: 'x\\' }, 'bigquery')).toBe("SELECT 'x\\\\'");
    expect(bindSqlParams('SELECT :a', { a: "O'Reilly" }, 'bigquery')).toBe("SELECT 'O\\'Reilly'");
    expect(bindSqlParams('SELECT :a', { a: "O'Reilly" }, 'sqlite')).toBe("SELECT 'O''Reilly'");
  });

  it('never changes local tables, whatever the query', async () => {
    const before = await executeSqlQuery('SELECT COUNT(*) FROM monthly_revenue');
    expect(before.ok).toBe(true);
    const attack = await executeSqlQuery(`SELECT '\\' ; DROP TABLE monthly_revenue; --'`);
    expect(attack.ok).toBe(false);
    const after = await executeSqlQuery('SELECT COUNT(*) FROM monthly_revenue');
    expect(after.ok).toBe(true);
    expect(after.rows).toEqual(before.rows);
  });

  it('stops reading local rows at maxRows and says the result was truncated', async () => {
    const res = await executeSqlQuery('SELECT * FROM monthly_revenue LIMIT 50', { maxRows: 5 });
    expect(res.ok).toBe(true);
    expect(res.rows).toHaveLength(5);
    expect(res.truncated).toBe(true);
  });
});

describe('schema answers for the model stay small', () => {
  const table = (i: number): TableSchemaInfo => ({
    name: `sales.orders_${i}`,
    source: 'bigquery',
    dataset: 'p.sales',
    datasetLabel: 'p.sales',
    description: i === 7 ? 'Refunds issued per order' : 'x'.repeat(400),
    rowCount: 1000 + i,
    columns: Array.from({ length: 90 }, (_, c) => ({ name: `col_${c}`, type: 'STRING', description: 'y'.repeat(300) })),
  });

  it('describes a few tables in full, with long catalogs cut down', () => {
    const out = schemaForModel([table(1), table(2)]) as { tables: { columns: unknown[]; moreColumns?: number; description: string }[] };
    expect(out.tables).toHaveLength(2);
    expect(out.tables[0].columns).toHaveLength(60);
    expect(out.tables[0].moreColumns).toBe(30);
    expect(out.tables[0].description.length).toBeLessThanOrEqual(240);
  });

  it('answers a large catalog with an index, and narrows it with search', () => {
    const all = Array.from({ length: 400 }, (_, i) => table(i));
    const index = schemaForModel(all) as { tableCount: number; tableIndex: unknown[]; tables?: unknown };
    expect(index.tableCount).toBe(400);
    expect(index.tableIndex).toHaveLength(150);
    expect(index.tables).toBeUndefined();
    expect(JSON.stringify(index).length).toBeLessThan(40_000);

    const found = schemaForModel(all, 'refunds') as { tables: { name: string }[] };
    expect(found.tables.map((t) => t.name)).toEqual(['sales.orders_7']);
  });
});

describe('BigQuery on a deployment with sign-in', () => {
  let server: Server;
  let base = '';
  let ownerCookie = '';
  let memberCookie = '';
  const upstream = vi.fn<typeof fetch>();
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  beforeAll(async () => {
    const auth = createAuth({ clientIds: ['client-1'], sessionSecret: 's'.repeat(40) });
    const usage = new Usage(new MemoryUsageStore(), undefined, ['owner@example.com']);
    const cookieOf = async (id: string, email: string) => (await auth.sessionCookie({ id, email })).split(';')[0];
    ownerCookie = await cookieOf('u-owner', 'owner@example.com');
    memberCookie = await cookieOf('u-member', 'member@example.com');
    const mw = liveTokenMiddleware({
      getApiKey: () => 'AIzaSy-test-key',
      loadConfig: async () => liveConfig,
      requireSignIn: true,
      auth,
      usage,
      connectorEnv: {
        BIGQUERY_PROJECT_ID: 'analytics-prod-123',
        STUDIO_BIGQUERY_PROJECTS: 'marketing-prod-9',
        BIGQUERY_ACCESS_TOKEN: 'ya29.mock-bq-token',
      },
      fetch: upstream,
      log: () => undefined,
    });
    server = createServer((req, res) => mw(req, res, () => {
      res.statusCode = 404;
      res.end();
    }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const call = (path: string, cookie: string | null, init: { method?: string; body?: unknown } = {}) => fetch(`${base}${path}`, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

  it('needs a session for every data request', async () => {
    expect((await call('/api/data/sources', null)).status).toBe(401);
    expect((await call('/api/data/bq/sources', null)).status).toBe(401);
  });

  it('offers the projects from the environment as sources', async () => {
    const res = await call('/api/data/sources', memberCookie);
    const { sources } = await res.json() as { sources: { id: string }[] };
    expect(sources.map((s) => s.id)).toEqual(['bigquery', 'bigquery:marketing-prod-9']);
  });

  it('lets only an owner register, change, sync or list projects', async () => {
    const attempts: [string, { method?: string; body?: unknown }][] = [
      ['/api/data/bq/sources', { body: { project_id: 'someone-elses-project', secret_name: 'prod-db-password' } }],
      ['/api/data/bq/sources/src_env_default', { method: 'PATCH', body: { secret_name: 'prod-db-password' } }],
      ['/api/data/bq/sources/src_env_default', { method: 'DELETE' }],
      ['/api/data/bq/sync', { body: { project_id: 'someone-elses-project' } }],
      ['/api/data/bq/sync/all', { method: 'POST', body: {} }],
      ['/api/data/bq/projects', {}],
    ];
    upstream.mockClear();
    for (const [path, init] of attempts) {
      const res = await call(path, memberCookie, init);
      expect(res.status, `${init.method ?? 'GET/POST'} ${path}`).toBe(403);
    }
    expect(upstream).not.toHaveBeenCalled();
    // Reading the shared catalog stays open to signed-in users
    expect((await call('/api/data/bq/sources', memberCookie)).status).toBe(200);

    const added = await call('/api/data/bq/sources', ownerCookie, { body: { project_id: 'finance-prod-7' } });
    expect(added.status).toBe(201);
  });

  it('runs queries only against registered projects, with a cap on the bytes billed', async () => {
    upstream.mockClear();
    const refused = await call('/api/data/query', memberCookie, { body: { source: 'bigquery:someone-elses-project', sql: 'SELECT 1' } });
    expect(refused.status).toBe(400);
    expect((await refused.json() as { error: string }).error).toMatch(/not an active data source/);
    const preview = await call('/api/data/bq/preview/run', memberCookie, {
      body: { project_id: 'someone-elses-project', dataset_id: 'ds', table_id: 't' },
    });
    expect(preview.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();

    upstream.mockImplementation(async () => json({
      schema: { fields: [{ name: 'n', type: 'INT64' }] },
      rows: [{ f: [{ v: '1' }] }],
      totalRows: '1',
    }));
    const ok = await call('/api/data/query', memberCookie, { body: { source: 'bigquery', sql: 'SELECT 1 AS n' } });
    expect(ok.status).toBe(200);
    const [url, init] = upstream.mock.calls[0];
    expect(String(url)).toContain('/projects/analytics-prod-123/queries');
    const sent = JSON.parse(String((init as RequestInit).body)) as { maximumBytesBilled: string };
    expect(sent.maximumBytesBilled).toBe(String(DEFAULT_MAX_BYTES_BILLED));
  });

  it('no longer serves the billing, share, cloud workspace or telemetry endpoints', async () => {
    for (const path of ['/api/billing/status', '/api/workspace', '/api/shares/abcd1234', '/api/telemetry/summary']) {
      expect((await call(path, ownerCookie)).status, path).toBe(404);
    }
  });
});
