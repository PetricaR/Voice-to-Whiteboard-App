import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as liveConfig from '../src/agent/liveConfig';
import { executeSqlQuery, importDataFile, inspectDataSchema } from '../src/data/sqlEngine';
import { bindSqlParams, validateReadOnlySql } from '../src/data/sqlGuard';
import { liveTokenMiddleware } from '../server/liveToken';

describe('SQL read-only guardrail & parameter binder', () => {
  it('allows valid SELECT and WITH CTE queries and adds LIMIT when absent', () => {
    const simple = validateReadOnlySql('SELECT region, SUM(mrr_usd) AS mrr FROM monthly_revenue GROUP BY region;');
    expect(simple.ok).toBe(true);
    if (simple.ok) {
      expect(simple.sql).toContain('LIMIT 1000');
      expect(simple.displaySql).not.toContain(';');
    }

    const cte = validateReadOnlySql(
      "WITH q3 AS (SELECT * FROM monthly_revenue WHERE quarter = '2026-Q3') SELECT region, SUM(mrr_usd) FROM q3 GROUP BY 1 LIMIT 10",
    );
    expect(cte.ok).toBe(true);
    if (cte.ok) expect(cte.sql).toMatch(/LIMIT 10$/);
  });

  it('allows forbidden words inside string literals or comments', () => {
    const res = validateReadOnlySql(`
      -- Drop churned rows via filter, never mutate
      SELECT account_name, 'drop update delete' AS note
      FROM enterprise_accounts
      WHERE churn_risk = 'High'
    `);
    expect(res.ok).toBe(true);
  });

  it('blocks DDL, DML, PRAGMA, ATTACH, CTE mutations, and multi-statement SQL', () => {
    const blocked = [
      'DROP TABLE monthly_revenue',
      'DELETE FROM enterprise_accounts WHERE 1=1',
      'UPDATE monthly_revenue SET mrr_usd = 0',
      'INSERT INTO monthly_revenue VALUES (1)',
      'PRAGMA database_list',
      "ATTACH DATABASE ':memory:' AS aux",
      'WITH Sneaky AS (DELETE FROM monthly_revenue RETURNING *) SELECT * FROM Sneaky',
      'SELECT 1; DROP TABLE monthly_revenue;',
      'SELECT 1; SELECT 2',
    ];
    for (const q of blocked) {
      const res = validateReadOnlySql(q);
      expect(res.ok, `Expected blocked: ${q}`).toBe(false);
    }
  });

  it('safely binds scalar and array filter parameters while ignoring literals and ::type casts', () => {
    const bound = bindSqlParams(
      "SELECT :label::text, * FROM monthly_revenue WHERE region = :region AND plan IN :plans AND note = ':region'",
      {
        label: "O'Reilly",
        region: 'EMEA',
        plans: ['Enterprise', 'Pro'],
      },
    );
    expect(bound).toBe(
      "SELECT 'O''Reilly'::text, * FROM monthly_revenue WHERE region = 'EMEA' AND plan IN ('Enterprise', 'Pro') AND note = ':region'",
    );
  });
});

describe('Local SQLite-Wasm engine & sample datasets', () => {
  it('queries seeded multi-table SaaS, E-Commerce, FinOps, and CRM sample datasets', async () => {
    const schema = await inspectDataSchema();
    expect(schema.source).toBe('local');
    expect(schema.tables.map((t) => t.name)).toEqual(
      expect.arrayContaining(['monthly_revenue', 'enterprise_accounts', 'daily_orders', 'conversion_funnel', 'service_spend', 'deals_pipeline']),
    );

    const rev = await executeSqlQuery(
      `SELECT region, SUM(mrr_usd) AS total_mrr
       FROM monthly_revenue
       WHERE (:quarter = 'ALL' OR quarter = :quarter)
       GROUP BY region
       ORDER BY total_mrr DESC`,
      { params: { quarter: '2026-Q3' } },
    );
    expect(rev.ok).toBe(true);
    expect(rev.columns).toEqual(['region', 'total_mrr']);
    expect(rev.rows.length).toBe(4);
    expect(rev.rows[0][0]).toBe('North America');
    expect(Number(rev.rows[0][1])).toBeGreaterThan(Number(rev.rows[1][1]));
  });

  it('imports CSV and JSON files into queryable SQL tables', async () => {
    const csvMeta = await importDataFile({
      name: 'Customer Cohort Metrics.csv',
      text: 'Cohort Month,Signups,Retention %\n2026-08,420,91.5\n2026-09,510,93.2\n',
    });
    expect(csvMeta.name).toBe('customer_cohort_metrics');
    expect(csvMeta.rowCount).toBe(2);

    const q = await executeSqlQuery('SELECT cohort_month, signups, retention FROM customer_cohort_metrics ORDER BY signups DESC');
    expect(q.ok).toBe(true);
    expect(q.rows[0]).toEqual(['2026-09', 510, 93.2]);

    const jsonMeta = await importDataFile({
      name: 'incidents.json',
      text: JSON.stringify([
        { id: 'INC-1', severity: 'P1', mttr_min: 18 },
        { id: 'INC-2', severity: 'P2', mttr_min: 42 },
      ]),
    });
    expect(jsonMeta.name).toBe('incidents');
    const q2 = await executeSqlQuery('SELECT AVG(mttr_min) AS avg_mttr FROM incidents');
    expect(q2.ok).toBe(true);
    expect(q2.rows[0][0]).toBe(30);
  });
});

describe('Server /api/data/* read-only connectors', () => {
  let server: Server;
  let port = 0;
  const upstream = vi.fn<typeof fetch>();

  beforeAll(async () => {
    const mw = liveTokenMiddleware({
      getApiKey: () => 'AIzaSy-test-key',
      loadConfig: async () => liveConfig,
      connectorEnv: {
        BIGQUERY_PROJECT_ID: 'analytics-prod-123',
        BIGQUERY_ACCESS_TOKEN: 'ya29.mock-bq-token',
        CLICKHOUSE_READONLY_URL: 'https://clickhouse.internal:8443/',
      },
      fetch: upstream,
      log: () => undefined,
    });
    server = createServer((req, res) => mw(req, res, () => {
      res.statusCode = 404;
      res.end();
    }));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('lists configured connectors without leaking tokens or URLs', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/data/sources`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sources.map((s: any) => s.id)).toEqual(['bigquery', 'clickhouse']);
    expect(JSON.stringify(body)).not.toContain('ya29.mock-bq-token');
    expect(JSON.stringify(body)).not.toContain('clickhouse.internal');
  });

  it('executes BigQuery Standard SQL and blocks mutation queries on the server', async () => {
    upstream.mockResolvedValueOnce(new Response(JSON.stringify({
      schema: { fields: [{ name: 'country', type: 'STRING' }, { name: 'revenue', type: 'FLOAT64' }] },
      rows: [{ f: [{ v: 'US' }, { v: '125000.5' }] }, { f: [{ v: 'DE' }, { v: '84200' }] }],
      totalRows: '2',
    }), { status: 200 }));

    const okRes = await fetch(`http://127.0.0.1:${port}/api/data/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: `http://127.0.0.1:${port}`,
      },
      body: JSON.stringify({
        source: 'bigquery',
        sql: 'SELECT country, SUM(amount) AS revenue FROM `analytics.sales` WHERE region = :region GROUP BY 1',
        params: { region: 'Global' },
      }),
    });
    expect(okRes.status).toBe(200);
    const data = await okRes.json();
    expect(data.ok).toBe(true);
    expect(data.rows).toEqual([['US', 125000.5], ['DE', 84200]]);

    const badRes = await fetch(`http://127.0.0.1:${port}/api/data/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: `http://127.0.0.1:${port}`,
      },
      body: JSON.stringify({
        source: 'bigquery',
        sql: 'DELETE FROM `analytics.sales` WHERE true',
      }),
    });
    expect(badRes.status).toBe(400);
    const badJson = await badRes.json();
    expect(badJson.ok).toBe(false);
    expect(badJson.error).toMatch(/Only read-only SELECT/i);
  });
});
