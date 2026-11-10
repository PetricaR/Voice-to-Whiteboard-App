/**
 * Server-side read-only enterprise data connectors mounted at `/api/data/*`.
 *
 * Credentials (BigQuery ADC / service account, ClickHouse read-only URL,
 * Postgres HTTP query proxy, or configured REST JSON feeds) stay strictly on
 * the Node server and never reach the browser. Every query passes through
 * `validateReadOnlySql` before execution.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { bindSqlParams, validateReadOnlySql, type SqlParamValue } from './sqlGuard.ts';

export interface ServerConnectorInfo {
  id: string;
  label: string;
  kind: 'bigquery' | 'clickhouse' | 'postgres' | 'rest';
  status: 'connected' | 'available';
  description: string;
}

export interface ServerQueryResponse {
  ok: boolean;
  source: string;
  sql: string;
  boundSql: string;
  columns: string[];
  rows: (string | number | boolean | null)[][];
  rowCount: number;
  truncated: boolean;
  durationMs: number;
  executedAt: string;
  error?: string;
}

export interface DataConnectorEnv {
  BIGQUERY_PROJECT_ID?: string;
  BIGQUERY_ACCESS_TOKEN?: string;
  CLICKHOUSE_READONLY_URL?: string;
  POSTGRES_HTTP_QUERY_URL?: string;
  POSTGRES_HTTP_TOKEN?: string;
  /** Optional JSON map of named read-only JSON/CSV URLs: `{"crm_feed":"https://..."}` */
  STUDIO_REST_SOURCES?: string;
}

const QUERY_TIMEOUT_MS = 15_000;

function parseRestSources(raw: string | undefined): Record<string, string> {
  if (!raw?.trim()) return {};
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string' && /^https?:\/\//i.test(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function listConfiguredConnectors(env: DataConnectorEnv = process.env): ServerConnectorInfo[] {
  const out: ServerConnectorInfo[] = [];
  if (env.BIGQUERY_PROJECT_ID?.trim()) {
    out.push({
      id: 'bigquery',
      label: `Google BigQuery (${env.BIGQUERY_PROJECT_ID.trim()})`,
      kind: 'bigquery',
      status: 'connected',
      description: `Read-only Standard SQL queries against BigQuery project "${env.BIGQUERY_PROJECT_ID.trim()}".`,
    });
  }
  if (env.CLICKHOUSE_READONLY_URL?.trim()) {
    out.push({
      id: 'clickhouse',
      label: 'ClickHouse Analytics (Read-Only)',
      kind: 'clickhouse',
      status: 'connected',
      description: 'Read-only HTTP SQL queries (readonly=1, JSONCompact).',
    });
  }
  if (env.POSTGRES_HTTP_QUERY_URL?.trim()) {
    out.push({
      id: 'postgres',
      label: 'PostgreSQL / Redshift Warehouse (Read-Only)',
      kind: 'postgres',
      status: 'connected',
      description: 'Read-only SQL queries via server warehouse proxy.',
    });
  }
  for (const name of Object.keys(parseRestSources(env.STUDIO_REST_SOURCES))) {
    out.push({
      id: `rest:${name}`,
      label: `REST Feed: ${name}`,
      kind: 'rest',
      status: 'connected',
      description: `Live JSON feed "${name}" configured on the studio server.`,
    });
  }
  return out;
}

/** Obtains a short-lived Google OAuth access token from env, Cloud Run metadata server, or local ADC. */
async function getGoogleAccessToken(env: DataConnectorEnv, fetchImpl: typeof fetch): Promise<string> {
  if (env.BIGQUERY_ACCESS_TOKEN?.trim()) return env.BIGQUERY_ACCESS_TOKEN.trim();

  // 1. Cloud Run / GCE Metadata Server
  if (process.env.K_SERVICE) {
    const res = await fetchImpl(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(4000) },
    );
    if (res.ok) {
      const tok = (await res.json()) as { access_token?: string };
      if (tok.access_token) return tok.access_token;
    }
  }

  // 2. Local Application Default Credentials (`gcloud auth application-default login`)
  const adcPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
    || join(homedir(), '.config', 'gcloud', 'application_default_credentials.json');
  if (existsSync(adcPath)) {
    const creds = JSON.parse(readFileSync(adcPath, 'utf8')) as {
      client_id?: string;
      client_secret?: string;
      refresh_token?: string;
      type?: string;
    };
    if (creds.type === 'authorized_user' && creds.client_id && creds.client_secret && creds.refresh_token) {
      const res = await fetchImpl('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: creds.client_id,
          client_secret: creds.client_secret,
          refresh_token: creds.refresh_token,
          grant_type: 'refresh_token',
        }).toString(),
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        const tok = (await res.json()) as { access_token?: string };
        if (tok.access_token) return tok.access_token;
      }
    }
  }

  throw new Error('BigQuery credentials unavailable: set BIGQUERY_ACCESS_TOKEN or configure Application Default Credentials.');
}

async function queryBigQuery(
  projectId: string,
  sql: string,
  maxRows: number,
  env: DataConnectorEnv,
  fetchImpl: typeof fetch,
): Promise<{ columns: string[]; rows: (string | number | boolean | null)[][]; truncated: boolean }> {
  const token = await getGoogleAccessToken(env, fetchImpl);
  const res = await fetchImpl(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/queries`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: sql,
        useLegacySql: false,
        maxResults: maxRows,
        timeoutMs: QUERY_TIMEOUT_MS,
      }),
      signal: AbortSignal.timeout(QUERY_TIMEOUT_MS + 2000),
    },
  );
  const payload = (await res.json()) as {
    error?: { message?: string };
    schema?: { fields?: { name: string; type: string }[] };
    rows?: { f: { v: unknown }[] }[];
    totalRows?: string;
  };
  if (!res.ok) {
    throw new Error(payload?.error?.message ?? `BigQuery returned HTTP ${res.status}.`);
  }
  const fields = payload.schema?.fields ?? [];
  const columns = fields.map((f) => f.name);
  const rows = (payload.rows ?? []).map((r) =>
    r.f.map((cell, idx) => {
      const v = cell.v;
      if (v === null || v === undefined) return null;
      const fType = fields[idx]?.type ?? 'STRING';
      if (fType === 'INTEGER' || fType === 'INT64' || fType === 'FLOAT' || fType === 'FLOAT64' || fType === 'NUMERIC' || fType === 'BIGNUMERIC') {
        const n = Number(v);
        return Number.isFinite(n) ? n : String(v);
      }
      if (fType === 'BOOLEAN' || fType === 'BOOL') return v === 'true' || v === true;
      return typeof v === 'object' ? JSON.stringify(v) : String(v);
    }),
  );
  const total = Number(payload.totalRows ?? rows.length);
  return { columns, rows, truncated: total > rows.length };
}

async function queryClickHouse(
  baseUrl: string,
  sql: string,
  maxRows: number,
  fetchImpl: typeof fetch,
): Promise<{ columns: string[]; rows: (string | number | boolean | null)[][]; truncated: boolean }> {
  const url = new URL(baseUrl);
  url.searchParams.set('readonly', '1');
  url.searchParams.set('default_format', 'JSONCompact');
  url.searchParams.set('max_result_rows', String(maxRows));
  const res = await fetchImpl(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body: sql,
    signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ClickHouse error (${res.status}): ${errText.slice(0, 240)}`);
  }
  const data = (await res.json()) as {
    meta?: { name: string }[];
    data?: (string | number | boolean | null)[][];
    rows_before_limit_at_least?: number;
  };
  const columns = (data.meta ?? []).map((m) => m.name);
  const rows = (data.data ?? []).slice(0, maxRows);
  return {
    columns,
    rows,
    truncated: (data.rows_before_limit_at_least ?? rows.length) > rows.length,
  };
}

async function queryPostgresHttp(
  endpoint: string,
  token: string | undefined,
  sql: string,
  maxRows: number,
  fetchImpl: typeof fetch,
): Promise<{ columns: string[]; rows: (string | number | boolean | null)[][]; truncated: boolean }> {
  const res = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ sql, maxRows, readOnly: true }),
    signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
  });
  const data = (await res.json()) as {
    columns?: string[];
    rows?: (string | number | boolean | null)[][];
    error?: string;
  };
  if (!res.ok) throw new Error(data?.error ?? `Warehouse proxy returned HTTP ${res.status}.`);
  const rows = (data.rows ?? []).slice(0, maxRows);
  return {
    columns: data.columns ?? [],
    rows,
    truncated: (data.rows?.length ?? 0) > maxRows,
  };
}

export async function executeServerConnectorQuery(
  req: {
    source: string;
    sql: string;
    params?: Record<string, SqlParamValue>;
    maxRows?: number;
  },
  options: { env?: DataConnectorEnv; fetch?: typeof fetch } = {},
): Promise<ServerQueryResponse> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetch ?? fetch;
  const started = Date.now();
  const executedAt = new Date(started).toISOString();
  const maxRows = Math.max(1, Math.min(req.maxRows ?? 1000, 2000));

  const boundRaw = bindSqlParams(req.sql, req.params);
  const check = validateReadOnlySql(boundRaw, { maxRows });
  if (!check.ok) {
    return {
      ok: false,
      source: req.source,
      sql: req.sql.trim(),
      boundSql: boundRaw.trim(),
      columns: [],
      rows: [],
      rowCount: 0,
      truncated: false,
      durationMs: Date.now() - started,
      executedAt,
      error: check.error,
    };
  }

  try {
    let out: { columns: string[]; rows: (string | number | boolean | null)[][]; truncated: boolean };
    if (req.source === 'bigquery') {
      const projectId = env.BIGQUERY_PROJECT_ID?.trim();
      if (!projectId) throw new Error('BigQuery connector is not configured on this server (BIGQUERY_PROJECT_ID).');
      out = await queryBigQuery(projectId, check.sql, maxRows, env, fetchImpl);
    } else if (req.source === 'clickhouse') {
      const url = env.CLICKHOUSE_READONLY_URL?.trim();
      if (!url) throw new Error('ClickHouse connector is not configured on this server (CLICKHOUSE_READONLY_URL).');
      out = await queryClickHouse(url, check.sql, maxRows, fetchImpl);
    } else if (req.source === 'postgres') {
      const url = env.POSTGRES_HTTP_QUERY_URL?.trim();
      if (!url) throw new Error('PostgreSQL connector is not configured on this server (POSTGRES_HTTP_QUERY_URL).');
      out = await queryPostgresHttp(url, env.POSTGRES_HTTP_TOKEN, check.sql, maxRows, fetchImpl);
    } else if (req.source.startsWith('rest:')) {
      const feedName = req.source.slice('rest:'.length);
      const feeds = parseRestSources(env.STUDIO_REST_SOURCES);
      const feedUrl = feeds[feedName];
      if (!feedUrl) throw new Error(`Unknown REST data source "${req.source}".`);
      const res = await fetchImpl(feedUrl, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(QUERY_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`REST feed "${feedName}" returned HTTP ${res.status}.`);
      const json = await res.json();
      const arr: Record<string, unknown>[] = Array.isArray(json) ? json : (Object.values(json ?? {}).find(Array.isArray) as Record<string, unknown>[] ?? []);
      const columns = Array.from(new Set(arr.slice(0, 50).flatMap((r) => Object.keys(r ?? {}))));
      const sliced = arr.slice(0, maxRows);
      const rows = sliced.map((r) => columns.map((c) => {
        const v = r?.[c];
        if (v === null || v === undefined) return null;
        if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v;
        return JSON.stringify(v);
      }));
      out = { columns, rows, truncated: arr.length > maxRows };
    } else {
      throw new Error(`Unknown server data connector "${req.source}".`);
    }

    return {
      ok: true,
      source: req.source,
      sql: check.displaySql,
      boundSql: check.displaySql,
      columns: out.columns,
      rows: out.rows,
      rowCount: out.rows.length,
      truncated: out.truncated,
      durationMs: Date.now() - started,
      executedAt,
    };
  } catch (e) {
    return {
      ok: false,
      source: req.source,
      sql: check.displaySql,
      boundSql: check.displaySql,
      columns: [],
      rows: [],
      rowCount: 0,
      truncated: false,
      durationMs: Date.now() - started,
      executedAt,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
