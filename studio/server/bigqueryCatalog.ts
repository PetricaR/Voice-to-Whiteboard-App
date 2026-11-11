/**
 * BigQuery Data Catalog & Multi-Project Sync service for Voice Whiteboard Studio.
 *
 * Ported from DS Data Catalog (`catalog_app/backend/api/bq.py`,
 * `services/bq_sync.py`, `services/gcp_credentials.py`, `services/bq_preview.py`):
 *   - Discovers accessible GCP projects via Cloud Resource Manager REST API.
 *   - Manages multi-project BigQuery sources (`BqSource`) with optional dataset
 *     prefix filters and Secret Manager service-account credentials.
 *   - Resolves Google Cloud credentials across explicit OAuth tokens, Secret
 *     Manager SA keys (RS256 JWT via `jose`), Cloud Run metadata server, local
 *     ADC (`authorized_user` with `quota_project_id` billing header or
 *     `service_account`), and local `gcloud` CLI fallback.
 *   - Syncs BigQuery datasets, tables, row counts, byte sizes, and column
 *     schemas while preserving existing curated descriptions.
 *   - Estimates preview scan bytes & USD cost (`$6.25 / TiB` dry-run with
 *     `TABLESAMPLE SYSTEM (10 PERCENT)`) and fetches sample rows.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { importPKCS8, SignJWT } from 'jose';
import type { DataConnectorEnv } from './dataConnectors.ts';
import { validateReadOnlySql } from './sqlGuard.ts';

/** On-demand BigQuery pricing ($6.25 per TiB scanned), matching `bq_preview.py`. */
export const BQ_COST_PER_TB = 6.25;
const BYTES_PER_TIB = 1024 ** 4;
const BQ_TIMEOUT_MS = 15_000;
/** Default cap on what one query may scan (1 GiB ≈ $0.006 on demand); BIGQUERY_MAX_BYTES_BILLED overrides it. */
export const DEFAULT_MAX_BYTES_BILLED = 1024 ** 3;

/** The `maximumBytesBilled` of a query: BigQuery refuses to run a query that would scan more. */
export function maxBytesBilled(env: Record<string, string | undefined> = process.env): string {
  const n = Number(env.BIGQUERY_MAX_BYTES_BILLED);
  return String(Number.isFinite(n) && n >= 10 * 1024 ** 2 ? Math.floor(n) : DEFAULT_MAX_BYTES_BILLED);
}

/** Says how to raise the cap when BigQuery refused a query for scanning too much. */
export function explainBytesBilled(message: string): string {
  return /bytes ?billed/i.test(message)
    ? `${message} Narrow the query (select fewer columns, filter on the partition column) or raise BIGQUERY_MAX_BYTES_BILLED on the studio server.`
    : message;
}

const GCP_SCOPES = 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/bigquery';

export interface BqSource {
  id: string;
  project_id: string;
  display_name: string | null;
  dataset_filter: string | null;
  secret_name: string | null;
  is_active: boolean;
  last_synced_at: string | null;
  created_at: string;
}

export interface BqProjectInfo {
  project_id: string;
  display_name: string;
  already_added: boolean;
}

export interface BqColumnSchema {
  name: string;
  data_type: string;
  mode: string;
  description: string | null;
}

export interface BqTableRecord {
  id: string;
  project_id: string;
  dataset_id: string;
  table_id: string;
  full_name: string;
  table_type: string;
  description: string;
  row_count: number | null;
  size_bytes: number | null;
  created_at_bq: string | null;
  modified_at_bq: string | null;
  synced_at: string;
  columns: BqColumnSchema[];
}

export interface BqDatasetRecord {
  id: string;
  project_id: string;
  dataset_id: string;
  location: string | null;
  description: string;
  labels: Record<string, string>;
  table_count: number;
  synced_at: string;
  tables: BqTableRecord[];
}

export interface BqSyncResult {
  project_id: string;
  datasets_added: number;
  datasets_updated: number;
  tables_added: number;
  tables_updated: number;
  columns_synced: number;
  errors: string[];
}

export interface BqPreviewEstimate {
  query: string;
  estimated_bytes: number;
  estimated_cost_usd: number;
}

export interface BqPreviewResult {
  query: string;
  columns: string[];
  rows: (string | number | boolean | null)[][];
  row_count: number;
  truncated: boolean;
}

export interface BqSchemaTableMeta {
  name: string;
  fullName: string;
  projectId: string;
  datasetId: string;
  tableId: string;
  source: string;
  dataset: string;
  datasetLabel: string;
  description: string;
  rowCount: number;
  sizeBytes?: number | null;
  location?: string | null;
  tableType?: string;
  columns: { name: string; type: string; mode?: string; description?: string }[];
}

export interface ResolvedGoogleCredentials {
  accessToken: string;
  /** Set when using user ADC so Google APIs bill quota against an enabled project (`x-goog-user-project`). */
  quotaProject?: string;
}

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
  quotaProject?: string;
}

interface PersistedCatalogFile {
  version: 1;
  sources: BqSource[];
  datasets: BqDatasetRecord[];
}

interface BqRawField {
  name?: string;
  type?: string;
  mode?: string;
  description?: string;
  fields?: BqRawField[];
}

const tokenCache = new Map<string, CachedToken>();

export class BqCatalogError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function sanitizeBqPart(raw: string, label: string): string {
  const trimmed = raw.trim();
  if (!trimmed || !/^[A-Za-z0-9_.:-]+$/.test(trimmed)) {
    throw new BqCatalogError(400, `Invalid BigQuery ${label}: "${raw}".`);
  }
  return trimmed;
}

function parseEpochOrIso(raw: string | number | undefined | null): string | null {
  if (raw == null || raw === '') return null;
  const num = Number(raw);
  if (Number.isFinite(num) && num > 0) {
    return new Date(num).toISOString();
  }
  const parsed = Date.parse(String(raw));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function flattenBqFields(fields: BqRawField[] | undefined, prefix = ''): BqColumnSchema[] {
  if (!Array.isArray(fields)) return [];
  const out: BqColumnSchema[] = [];
  for (const f of fields) {
    if (!f?.name) continue;
    const colName = prefix ? `${prefix}.${f.name}` : f.name;
    out.push({
      name: colName,
      data_type: f.type || 'STRING',
      mode: f.mode || 'NULLABLE',
      description: f.description ?? null,
    });
    if (Array.isArray(f.fields) && f.fields.length > 0) {
      out.push(...flattenBqFields(f.fields, colName));
    }
  }
  return out;
}

async function mintServiceAccountAccessToken(
  sa: { client_email: string; private_key: string; token_uri?: string },
  fetchImpl: typeof fetch,
  cacheKey: string,
): Promise<string> {
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAtMs - Date.now() > 60_000) {
    return cached.accessToken;
  }

  const tokenUri = sa.token_uri || 'https://oauth2.googleapis.com/token';
  const nowSec = Math.floor(Date.now() / 1000);
  const key = await importPKCS8(sa.private_key, 'RS256');
  const assertion = await new SignJWT({ scope: GCP_SCOPES })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(sa.client_email)
    .setSubject(sa.client_email)
    .setAudience(tokenUri)
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + 3600)
    .sign(key);

  const res = await fetchImpl(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
    signal: AbortSignal.timeout(8000),
  });
  const payload = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !payload.access_token) {
    throw new Error(payload.error_description || `Service account token exchange failed (HTTP ${res.status}).`);
  }
  const ttlMs = Math.max(60, (payload.expires_in ?? 3600) - 60) * 1000;
  tokenCache.set(cacheKey, {
    accessToken: payload.access_token,
    expiresAtMs: Date.now() + ttlMs,
  });
  return payload.access_token;
}

async function resolveBaseGoogleCredentials(options: {
  projectId?: string;
  userAccessToken?: string | null;
  env?: DataConnectorEnv & Record<string, string | undefined>;
  fetch?: typeof fetch;
}): Promise<ResolvedGoogleCredentials> {
  const env = options.env ?? (process.env as DataConnectorEnv & Record<string, string | undefined>);
  const fetchImpl = options.fetch ?? fetch;

  // 1. Per-request user OAuth token (`X-GCP-Access-Token`) or explicit `BIGQUERY_ACCESS_TOKEN`
  if (options.userAccessToken?.trim()) {
    return { accessToken: options.userAccessToken.trim() };
  }
  if (env.BIGQUERY_ACCESS_TOKEN?.trim()) {
    return { accessToken: env.BIGQUERY_ACCESS_TOKEN.trim() };
  }

  // 2. Cloud Run / GCE Metadata server
  const metadataHost = env.GCE_METADATA_HOST?.trim() || (env.K_SERVICE || process.env.K_SERVICE ? 'metadata.google.internal' : '');
  if (metadataHost) {
    const res = await fetchImpl(
      `http://${metadataHost}/computeMetadata/v1/instance/service-accounts/default/token`,
      { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(4000) },
    );
    if (res.ok) {
      const tok = (await res.json()) as { access_token?: string };
      if (tok.access_token) return { accessToken: tok.access_token };
    }
  }

  // 3. Local Application Default Credentials (`authorized_user` or `service_account`)
  const adcPath = env.GOOGLE_APPLICATION_CREDENTIALS
    || process.env.GOOGLE_APPLICATION_CREDENTIALS
    || join(homedir(), '.config', 'gcloud', 'application_default_credentials.json');
  if (existsSync(adcPath)) {
    const raw = JSON.parse(readFileSync(adcPath, 'utf8')) as {
      type?: string;
      client_id?: string;
      client_secret?: string;
      refresh_token?: string;
      quota_project_id?: string;
      client_email?: string;
      private_key?: string;
      token_uri?: string;
    };

    if (raw.type === 'authorized_user' && raw.client_id && raw.client_secret && raw.refresh_token) {
      const quotaProject = raw.quota_project_id?.trim()
        || options.projectId?.trim()
        || env.BIGQUERY_PROJECT_ID?.trim()
        || env.GCP_PROJECT_ID?.trim()
        || undefined;
      const cacheKey = `adc_user:${adcPath}`;
      const cached = tokenCache.get(cacheKey);
      if (cached && cached.expiresAtMs - Date.now() > 60_000) {
        return { accessToken: cached.accessToken, quotaProject };
      }

      const res = await fetchImpl('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: raw.client_id,
          client_secret: raw.client_secret,
          refresh_token: raw.refresh_token,
          grant_type: 'refresh_token',
        }).toString(),
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        const tok = (await res.json()) as { access_token?: string; expires_in?: number };
        if (tok.access_token) {
          if (fetchImpl === fetch) {
            tokenCache.set(cacheKey, {
              accessToken: tok.access_token,
              expiresAtMs: Date.now() + Math.max(60, (tok.expires_in ?? 3600) - 60) * 1000,
              quotaProject,
            });
          }
          return { accessToken: tok.access_token, quotaProject };
        }
      }
    }

    if (raw.type === 'service_account' && raw.client_email && raw.private_key) {
      const accessToken = await mintServiceAccountAccessToken(
        { client_email: raw.client_email, private_key: raw.private_key, token_uri: raw.token_uri },
        fetchImpl,
        `adc_sa:${raw.client_email}`,
      );
      return { accessToken };
    }
  }

  // 4. Local `gcloud` CLI fallback (only when using real global `fetch`, never in unit test mocks)
  if (fetchImpl === fetch) {
    try {
      const cliToken = execFileSync('gcloud', ['auth', 'print-access-token'], {
        encoding: 'utf8',
        timeout: 4000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (cliToken) {
        const quotaProject = options.projectId?.trim()
          || env.BIGQUERY_PROJECT_ID?.trim()
          || env.GCP_PROJECT_ID?.trim()
          || undefined;
        return { accessToken: cliToken, quotaProject };
      }
    } catch {
      // gcloud not installed or not signed in
    }
  }

  throw new BqCatalogError(
    401,
    'Google Cloud credentials unavailable: run `gcloud auth application-default login` or set BIGQUERY_ACCESS_TOKEN.',
  );
}

/**
 * Resolves BigQuery credentials following DS Data Catalog's chain:
 *   1. Per-request `userAccessToken` (`X-GCP-Access-Token`)
 *   2. Secret Manager service-account JSON key (`projects/{projectId}/secrets/{secretName}/versions/{version}`)
 *   3. `BIGQUERY_ACCESS_TOKEN` / Cloud Run metadata / local ADC (`authorized_user` or `service_account`) / `gcloud` CLI
 */
export async function resolveGoogleCredentials(options: {
  projectId?: string;
  secretName?: string | null;
  secretVersion?: string;
  userAccessToken?: string | null;
  env?: DataConnectorEnv & Record<string, string | undefined>;
  fetch?: typeof fetch;
}): Promise<ResolvedGoogleCredentials> {
  const fetchImpl = options.fetch ?? fetch;
  if (options.userAccessToken?.trim()) {
    return { accessToken: options.userAccessToken.trim() };
  }

  if (options.secretName?.trim() && options.projectId?.trim()) {
    const secretProject = options.projectId.trim();
    const secretName = options.secretName.trim();
    const secretVersion = options.secretVersion?.trim() || 'latest';
    const smCacheKey = `sm:${secretProject}/${secretName}@${secretVersion}`;
    const cached = tokenCache.get(smCacheKey);
    if (cached && cached.expiresAtMs - Date.now() > 60_000 && fetchImpl === fetch) {
      return { accessToken: cached.accessToken };
    }

    const bootstrap = await resolveBaseGoogleCredentials({
      projectId: secretProject,
      env: options.env,
      fetch: fetchImpl,
    });
    const smHeaders: Record<string, string> = {
      Authorization: `Bearer ${bootstrap.accessToken}`,
      Accept: 'application/json',
    };
    if (bootstrap.quotaProject) smHeaders['x-goog-user-project'] = bootstrap.quotaProject;

    const smUrl = `https://secretmanager.googleapis.com/v1/projects/${encodeURIComponent(secretProject)}/secrets/${encodeURIComponent(secretName)}/versions/${encodeURIComponent(secretVersion)}:access`;
    const smRes = await fetchImpl(smUrl, {
      headers: smHeaders,
      signal: AbortSignal.timeout(8000),
    });
    const smBody = (await smRes.json().catch(() => ({}))) as {
      payload?: { data?: string };
      error?: { message?: string };
    };
    if (!smRes.ok || !smBody.payload?.data) {
      throw new BqCatalogError(
        smRes.status === 404 ? 404 : 502,
        `Secret Manager failed for "${secretName}": ${smBody.error?.message ?? `HTTP ${smRes.status}`}`,
      );
    }
    const decoded = Buffer.from(smBody.payload.data, 'base64').toString('utf8');
    const saKey = JSON.parse(decoded) as { client_email?: string; private_key?: string; token_uri?: string };
    if (!saKey.client_email || !saKey.private_key) {
      throw new BqCatalogError(400, `Secret "${secretName}" does not contain a valid GCP service-account JSON key.`);
    }
    const saToken = await mintServiceAccountAccessToken(
      { client_email: saKey.client_email, private_key: saKey.private_key, token_uri: saKey.token_uri },
      fetchImpl,
      smCacheKey,
    );
    return { accessToken: saToken };
  }

  return resolveBaseGoogleCredentials(options);
}

export function buildGcpAuthHeaders(creds: ResolvedGoogleCredentials, extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${creds.accessToken}`,
    ...extra,
  };
  if (creds.quotaProject) {
    headers['x-goog-user-project'] = creds.quotaProject;
  }
  return headers;
}

export function parseBigQueryRows(
  fields: { name: string; type: string }[],
  rawRows: { f: { v: unknown }[] }[] | undefined,
): (string | number | boolean | null)[][] {
  return (rawRows ?? []).map((r) =>
    r.f.map((cell, idx) => {
      const v = cell?.v;
      if (v === null || v === undefined) return null;
      const fType = (fields[idx]?.type ?? 'STRING').toUpperCase();
      if (
        fType === 'INTEGER' ||
        fType === 'INT64' ||
        fType === 'FLOAT' ||
        fType === 'FLOAT64' ||
        fType === 'NUMERIC' ||
        fType === 'BIGNUMERIC'
      ) {
        const n = Number(v);
        return Number.isFinite(n) ? n : String(v);
      }
      if (fType === 'BOOLEAN' || fType === 'BOOL') return v === 'true' || v === true;
      return typeof v === 'object' ? JSON.stringify(v) : String(v);
    }),
  );
}

async function runWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await worker(items[idx]);
    }
  });
  await Promise.all(runners);
  return results;
}

export interface BqCatalogStoreOptions {
  persistPath?: string;
  env?: DataConnectorEnv & Record<string, string | undefined>;
  fetch?: typeof fetch;
  now?: () => number;
}

export class BqCatalogStore {
  private sources = new Map<string, BqSource>();
  private datasets = new Map<string, BqDatasetRecord>();
  private readonly persistPath?: string;
  private readonly env: DataConnectorEnv & Record<string, string | undefined>;
  private readonly defaultFetch?: typeof fetch;
  private readonly now: () => number;

  constructor(opts: BqCatalogStoreOptions = {}) {
    this.persistPath = opts.persistPath;
    this.env = opts.env ?? (process.env as DataConnectorEnv & Record<string, string | undefined>);
    this.defaultFetch = opts.fetch;
    this.now = opts.now ?? Date.now;
    this.loadFromDisk();
    this.seedEnvProject();
  }

  private loadFromDisk() {
    if (!this.persistPath || !existsSync(this.persistPath)) return;
    try {
      const raw = JSON.parse(readFileSync(this.persistPath, 'utf8')) as Partial<PersistedCatalogFile>;
      for (const s of raw.sources ?? []) {
        if (s?.id && s?.project_id) this.sources.set(s.id, s);
      }
      for (const d of raw.datasets ?? []) {
        if (d?.id && d?.project_id && d?.dataset_id) this.datasets.set(d.id, d);
      }
    } catch {
      // Corrupt or outdated cache file — start fresh
    }
  }

  private saveToDisk() {
    if (!this.persistPath) return;
    try {
      mkdirSync(dirname(this.persistPath), { recursive: true });
      const payload: PersistedCatalogFile = {
        version: 1,
        sources: this.listSources(),
        datasets: Array.from(this.datasets.values()),
      };
      writeFileSync(this.persistPath, JSON.stringify(payload), 'utf8');
    } catch {
      // Best-effort local persistence
    }
  }

  /**
   * Sources from the environment: BIGQUERY_PROJECT_ID (the default) and
   * STUDIO_BIGQUERY_PROJECTS (comma-separated). On Cloud Run the catalog lives
   * in memory, so this is how a deployment keeps its sources across instances.
   */
  private seedEnvProject() {
    const primary = this.env.BIGQUERY_PROJECT_ID?.trim() || this.env.GCP_PROJECT_ID?.trim();
    const more = (this.env.STUDIO_BIGQUERY_PROJECTS ?? '').split(',').map((p) => p.trim()).filter(Boolean);
    const created = new Date(this.now()).toISOString();
    [...(primary ? [primary] : []), ...more].forEach((projectId, i) => {
      if (!/^[A-Za-z0-9_.:-]+$/.test(projectId) || this.findSourceByProject(projectId)) return;
      const id = i === 0 && primary ? 'src_env_default' : `src_env_${projectId}`;
      this.sources.set(id, {
        id,
        project_id: projectId,
        display_name: null,
        dataset_filter: null,
        secret_name: null,
        is_active: true,
        last_synced_at: null,
        created_at: created,
      });
    });
  }

  /** Ordered list of configured BigQuery sources (created_at ascending, matching `bq.py`). */
  listSources(): BqSource[] {
    return Array.from(this.sources.values()).sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  getSource(id: string): BqSource | undefined {
    return this.sources.get(id);
  }

  findSourceByProject(projectId: string): BqSource | undefined {
    return Array.from(this.sources.values()).find((s) => s.project_id === projectId);
  }

  /** Queries only run against projects registered as an active source, never an arbitrary project id. */
  isQueryableProject(projectId: string): boolean {
    return this.findSourceByProject(projectId.trim())?.is_active === true;
  }

  private syncsInFlight = new Map<string, Promise<BqSyncResult>>();

  /** Syncs a registered source once, however many requests ask for it at the same time. */
  syncSourceOnce(source: BqSource, opts: { userAccessToken?: string | null; fetch?: typeof fetch } = {}): Promise<BqSyncResult> {
    const running = this.syncsInFlight.get(source.id);
    if (running) return running;
    const started = this.syncSource(source.id, opts).finally(() => this.syncsInFlight.delete(source.id));
    this.syncsInFlight.set(source.id, started);
    return started;
  }

  /** Resolves a studio connector id (`"bigquery"` or `"bigquery:<project_id>"`) to its target GCP project & source. */
  resolveSourceConnector(
    connectorId: string,
    envOverride?: DataConnectorEnv,
  ): { projectId: string; source?: BqSource } | null {
    const env = envOverride ?? this.env;
    if (connectorId.startsWith('bigquery:')) {
      const projectId = connectorId.slice('bigquery:'.length).trim();
      if (!projectId) return null;
      const src = this.findSourceByProject(projectId);
      return { projectId, source: src };
    }
    if (connectorId === 'bigquery') {
      const envProject = env.BIGQUERY_PROJECT_ID?.trim();
      if (envProject) {
        return { projectId: envProject, source: this.findSourceByProject(envProject) };
      }
      const firstActive = this.listSources().find((s) => s.is_active);
      if (firstActive) {
        return { projectId: firstActive.project_id, source: firstActive };
      }
    }
    return null;
  }

  addSource(body: {
    project_id: string;
    display_name?: string | null;
    dataset_filter?: string | null;
    secret_name?: string | null;
  }): BqSource {
    const projectId = sanitizeBqPart(body.project_id ?? '', 'project_id');
    if (this.findSourceByProject(projectId)) {
      throw new BqCatalogError(409, `Project '${projectId}' is already registered.`);
    }
    const source: BqSource = {
      id: randomUUID(),
      project_id: projectId,
      display_name: body.display_name?.trim() || null,
      dataset_filter: body.dataset_filter?.trim() || null,
      secret_name: body.secret_name?.trim() || null,
      is_active: true,
      last_synced_at: null,
      created_at: new Date(this.now()).toISOString(),
    };
    this.sources.set(source.id, source);
    this.saveToDisk();
    return source;
  }

  updateSource(
    sourceId: string,
    patch: {
      display_name?: string | null;
      dataset_filter?: string | null;
      secret_name?: string | null;
      is_active?: boolean;
    },
  ): BqSource {
    const existing = this.sources.get(sourceId);
    if (!existing) throw new BqCatalogError(404, 'Source not found.');
    const updated: BqSource = {
      ...existing,
      ...(patch.display_name !== undefined ? { display_name: patch.display_name?.trim() || null } : {}),
      ...(patch.dataset_filter !== undefined ? { dataset_filter: patch.dataset_filter?.trim() || null } : {}),
      ...(patch.secret_name !== undefined ? { secret_name: patch.secret_name?.trim() || null } : {}),
      ...(patch.is_active !== undefined ? { is_active: Boolean(patch.is_active) } : {}),
    };
    this.sources.set(sourceId, updated);
    this.saveToDisk();
    return updated;
  }

  deleteSource(sourceId: string, purgeMetadata = false): void {
    const existing = this.sources.get(sourceId);
    if (!existing) throw new BqCatalogError(404, 'Source not found.');
    this.sources.delete(sourceId);
    if (purgeMetadata) {
      for (const [k, ds] of this.datasets) {
        if (ds.project_id === existing.project_id) this.datasets.delete(k);
      }
    }
    this.saveToDisk();
  }

  /** Lists all synced datasets (optionally filtered by `project_id` or search query). */
  listDatasets(opts: { project_id?: string; search?: string } = {}): BqDatasetRecord[] {
    let list = Array.from(this.datasets.values());
    if (opts.project_id?.trim()) {
      const p = opts.project_id.trim();
      list = list.filter((d) => d.project_id === p);
    }
    if (opts.search?.trim()) {
      const q = opts.search.trim().toLowerCase();
      list = list
        .map((ds) => {
          const dsMatches =
            ds.dataset_id.toLowerCase().includes(q) ||
            ds.project_id.toLowerCase().includes(q) ||
            ds.description.toLowerCase().includes(q);
          if (dsMatches) return ds;
          const matchingTables = ds.tables.filter(
            (t) =>
              t.table_id.toLowerCase().includes(q) ||
              t.description.toLowerCase().includes(q) ||
              t.columns.some((c) => c.name.toLowerCase().includes(q) || (c.description ?? '').toLowerCase().includes(q)),
          );
          if (matchingTables.length === 0) return null;
          return { ...ds, tables: matchingTables, table_count: matchingTables.length };
        })
        .filter((d): d is BqDatasetRecord => d !== null);
    }
    return list.sort((a, b) => a.id.localeCompare(b.id));
  }

  countTablesForProject(projectId: string): number {
    let total = 0;
    for (const ds of this.datasets.values()) {
      if (ds.project_id === projectId) total += ds.tables.length;
    }
    return total;
  }

  /** Returns Studio `inspect_schema`-compatible table definitions for `/api/data/schema`. */
  getSchemaTables(sourceId: string, tableFilter?: string): BqSchemaTableMeta[] {
    const resolved = this.resolveSourceConnector(sourceId);
    const targetProject = resolved?.projectId;
    const datasets = this.listDatasets(targetProject ? { project_id: targetProject } : {});
    const filter = tableFilter?.trim().toLowerCase();
    const out: BqSchemaTableMeta[] = [];

    for (const ds of datasets) {
      for (const tbl of ds.tables) {
        const qualifiedInProject = `${ds.dataset_id}.${tbl.table_id}`;
        if (
          filter &&
          tbl.table_id.toLowerCase() !== filter &&
          qualifiedInProject.toLowerCase() !== filter &&
          tbl.full_name.toLowerCase() !== filter &&
          ds.dataset_id.toLowerCase() !== filter
        ) {
          continue;
        }
        out.push({
          name: qualifiedInProject,
          fullName: tbl.full_name,
          projectId: tbl.project_id,
          datasetId: ds.dataset_id,
          tableId: tbl.table_id,
          source: sourceId,
          dataset: `${ds.project_id}.${ds.dataset_id}`,
          datasetLabel: ds.location ? `${ds.project_id}.${ds.dataset_id} (${ds.location})` : `${ds.project_id}.${ds.dataset_id}`,
          description: tbl.description || ds.description || `${tbl.table_type} in ${tbl.full_name}`,
          rowCount: tbl.row_count ?? 0,
          sizeBytes: tbl.size_bytes,
          location: ds.location,
          tableType: tbl.table_type,
          columns: tbl.columns.map((c) => ({
            name: c.name,
            type: c.data_type,
            mode: c.mode,
            description: c.description ?? undefined,
          })),
        });
      }
    }
    return out;
  }

  /**
   * Lists GCP projects accessible to the caller's credentials via Cloud Resource Manager API,
   * marking projects already registered in `BqCatalogStore` (ported from `GET /bq/projects`).
   */
  async listAccessibleProjects(opts: {
    userAccessToken?: string | null;
    fetch?: typeof fetch;
  } = {}): Promise<BqProjectInfo[]> {
    const fetchImpl = opts.fetch ?? this.defaultFetch ?? fetch;
    const creds = await resolveGoogleCredentials({
      userAccessToken: opts.userAccessToken,
      env: this.env,
      fetch: fetchImpl,
    });
    const addedIds = new Set(Array.from(this.sources.values()).map((s) => s.project_id));
    const projects: BqProjectInfo[] = [];
    let pageToken = '';

    do {
      const url = new URL('https://cloudresourcemanager.googleapis.com/v1/projects');
      url.searchParams.set('filter', 'lifecycleState:ACTIVE');
      url.searchParams.set('pageSize', '200');
      if (pageToken) url.searchParams.set('pageToken', pageToken);

      const res = await fetchImpl(url.toString(), {
        headers: buildGcpAuthHeaders(creds, { Accept: 'application/json' }),
        signal: AbortSignal.timeout(BQ_TIMEOUT_MS),
      });
      const body = (await res.json().catch(() => ({}))) as {
        projects?: { projectId?: string; name?: string; lifecycleState?: string }[];
        nextPageToken?: string;
        error?: { message?: string };
      };
      if (!res.ok) {
        throw new BqCatalogError(
          res.status === 401 || res.status === 403 ? res.status : 502,
          `Could not list GCP projects: ${body.error?.message ?? `HTTP ${res.status}`}`,
        );
      }
      for (const p of body.projects ?? []) {
        if (!p.projectId) continue;
        projects.push({
          project_id: p.projectId,
          display_name: p.name || p.projectId,
          already_added: addedIds.has(p.projectId),
        });
      }
      pageToken = body.nextPageToken ?? '';
    } while (pageToken);

    projects.sort((a, b) => {
      if (a.already_added !== b.already_added) return a.already_added ? 1 : -1;
      return a.display_name.toLowerCase().localeCompare(b.display_name.toLowerCase());
    });
    return projects;
  }

  /**
   * Syncs all datasets, tables, and column schemas for a single GCP project,
   * preserving non-empty curated descriptions (ported from `sync_project` in `bq_sync.py`).
   */
  async syncProject(opts: {
    project_id: string;
    secret_name?: string | null;
    secret_version?: string;
    dataset_filter?: string | null;
    userAccessToken?: string | null;
    fetch?: typeof fetch;
  }): Promise<BqSyncResult> {
    const projectId = sanitizeBqPart(opts.project_id, 'project_id');
    const fetchImpl = opts.fetch ?? this.defaultFetch ?? fetch;
    const result: BqSyncResult = {
      project_id: projectId,
      datasets_added: 0,
      datasets_updated: 0,
      tables_added: 0,
      tables_updated: 0,
      columns_synced: 0,
      errors: [],
    };

    let creds: ResolvedGoogleCredentials;
    try {
      creds = await resolveGoogleCredentials({
        projectId,
        secretName: opts.secret_name,
        secretVersion: opts.secret_version,
        userAccessToken: opts.userAccessToken,
        env: this.env,
        fetch: fetchImpl,
      });
    } catch (e) {
      result.errors.push(`Failed to connect to BigQuery project ${projectId}: ${e instanceof Error ? e.message : String(e)}`);
      return result;
    }

    const headers = buildGcpAuthHeaders(creds, { Accept: 'application/json' });
    const rawDatasets: { datasetId: string; location?: string; labels?: Record<string, string> }[] = [];

    try {
      let pageToken = '';
      do {
        const url = new URL(`https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/datasets`);
        url.searchParams.set('maxResults', '500');
        if (pageToken) url.searchParams.set('pageToken', pageToken);
        const res = await fetchImpl(url.toString(), { headers, signal: AbortSignal.timeout(BQ_TIMEOUT_MS) });
        const body = (await res.json().catch(() => ({}))) as {
          datasets?: { datasetReference?: { datasetId?: string }; location?: string; labels?: Record<string, string> }[];
          nextPageToken?: string;
          error?: { message?: string };
        };
        if (!res.ok) {
          result.errors.push(`Failed to list datasets in ${projectId}: ${body.error?.message ?? `HTTP ${res.status}`}`);
          return result;
        }
        for (const d of body.datasets ?? []) {
          const dsId = d.datasetReference?.datasetId;
          if (!dsId) continue;
          if (opts.dataset_filter && !dsId.startsWith(opts.dataset_filter)) continue;
          rawDatasets.push({ datasetId: dsId, location: d.location, labels: d.labels });
        }
        pageToken = body.nextPageToken ?? '';
      } while (pageToken);
    } catch (e) {
      result.errors.push(`Failed to list datasets in ${projectId}: ${e instanceof Error ? e.message : String(e)}`);
      return result;
    }

    const syncedAt = new Date(this.now()).toISOString();

    for (const dsItem of rawDatasets) {
      const dsKey = `${projectId}.${dsItem.datasetId}`;
      const existingDs = this.datasets.get(dsKey);
      let location = dsItem.location ?? existingDs?.location ?? null;
      let dsDescription = '';
      let labels: Record<string, string> = dsItem.labels ?? existingDs?.labels ?? {};

      try {
        const dsRes = await fetchImpl(
          `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/datasets/${encodeURIComponent(dsItem.datasetId)}`,
          { headers, signal: AbortSignal.timeout(BQ_TIMEOUT_MS) },
        );
        if (dsRes.ok) {
          const dsFull = (await dsRes.json()) as {
            location?: string;
            description?: string;
            labels?: Record<string, string>;
          };
          location = dsFull.location ?? location;
          dsDescription = dsFull.description ?? '';
          labels = dsFull.labels ?? labels;
        }
      } catch (e) {
        result.errors.push(`Dataset ${dsItem.datasetId}: ${e instanceof Error ? e.message : String(e)}`);
      }

      const existingTablesById = new Map<string, BqTableRecord>(
        (existingDs?.tables ?? []).map((t) => [t.table_id, t]),
      );

      // List tables in dataset
      const tableRefs: { tableId: string; type?: string }[] = [];
      let listTablesFailed = false;
      try {
        let pageToken = '';
        do {
          const tUrl = new URL(
            `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/datasets/${encodeURIComponent(dsItem.datasetId)}/tables`,
          );
          tUrl.searchParams.set('maxResults', '500');
          if (pageToken) tUrl.searchParams.set('pageToken', pageToken);
          const tRes = await fetchImpl(tUrl.toString(), { headers, signal: AbortSignal.timeout(BQ_TIMEOUT_MS) });
          const tBody = (await tRes.json().catch(() => ({}))) as {
            tables?: { tableReference?: { tableId?: string }; type?: string }[];
            nextPageToken?: string;
            error?: { message?: string };
          };
          if (!tRes.ok) {
            result.errors.push(`Dataset ${dsItem.datasetId} tables: ${tBody.error?.message ?? `HTTP ${tRes.status}`}`);
            listTablesFailed = true;
            break;
          }
          for (const tr of tBody.tables ?? []) {
            if (tr.tableReference?.tableId) {
              tableRefs.push({ tableId: tr.tableReference.tableId, type: tr.type });
            }
          }
          pageToken = tBody.nextPageToken ?? '';
        } while (pageToken);
      } catch (e) {
        result.errors.push(`Dataset ${dsItem.datasetId} tables: ${e instanceof Error ? e.message : String(e)}`);
        listTablesFailed = true;
      }

      if (listTablesFailed) continue;

      const syncedTables: BqTableRecord[] = [];
      await runWithConcurrency(tableRefs, 6, async (tRef) => {
        try {
          const tblRes = await fetchImpl(
            `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/datasets/${encodeURIComponent(dsItem.datasetId)}/tables/${encodeURIComponent(tRef.tableId)}`,
            { headers, signal: AbortSignal.timeout(BQ_TIMEOUT_MS) },
          );
          const tblFull = (await tblRes.json().catch(() => ({}))) as {
            type?: string;
            description?: string;
            numRows?: string;
            numBytes?: string;
            creationTime?: string;
            lastModifiedTime?: string;
            schema?: { fields?: BqRawField[] };
            error?: { message?: string };
          };
          if (!tblRes.ok) {
            result.errors.push(`Table ${dsItem.datasetId}.${tRef.tableId}: ${tblFull.error?.message ?? `HTTP ${tblRes.status}`}`);
            return;
          }

          const prevTbl = existingTablesById.get(tRef.tableId);
          const prevCols = new Map<string, BqColumnSchema>(
            (prevTbl?.columns ?? []).map((c) => [c.name, c]),
          );
          const rawCols = flattenBqFields(tblFull.schema?.fields);
          const mergedCols: BqColumnSchema[] = rawCols.map((c) => ({
            ...c,
            description: c.description || prevCols.get(c.name)?.description || null,
          }));

          const fullName = `${projectId}.${dsItem.datasetId}.${tRef.tableId}`;
          const rowCount = tblFull.numRows != null ? Number(tblFull.numRows) : null;
          const sizeBytes = tblFull.numBytes != null ? Number(tblFull.numBytes) : null;

          const record: BqTableRecord = {
            id: fullName,
            project_id: projectId,
            dataset_id: dsItem.datasetId,
            table_id: tRef.tableId,
            full_name: fullName,
            table_type: tblFull.type || tRef.type || 'TABLE',
            description: tblFull.description || prevTbl?.description || '',
            row_count: rowCount != null && Number.isFinite(rowCount) ? rowCount : null,
            size_bytes: sizeBytes != null && Number.isFinite(sizeBytes) ? sizeBytes : null,
            created_at_bq: parseEpochOrIso(tblFull.creationTime),
            modified_at_bq: parseEpochOrIso(tblFull.lastModifiedTime),
            synced_at: syncedAt,
            columns: mergedCols,
          };
          syncedTables.push(record);
          if (prevTbl) result.tables_updated += 1;
          else result.tables_added += 1;
          result.columns_synced += mergedCols.length;
        } catch (e) {
          result.errors.push(`Table ${dsItem.datasetId}.${tRef.tableId}: ${e instanceof Error ? e.message : String(e)}`);
        }
      });

      syncedTables.sort((a, b) => a.table_id.localeCompare(b.table_id));

      const nextDs: BqDatasetRecord = {
        id: dsKey,
        project_id: projectId,
        dataset_id: dsItem.datasetId,
        location,
        description: dsDescription || existingDs?.description || '',
        labels,
        table_count: syncedTables.length,
        synced_at: syncedAt,
        tables: syncedTables,
      };
      this.datasets.set(dsKey, nextDs);
      if (existingDs) result.datasets_updated += 1;
      else result.datasets_added += 1;
    }

    const matchingSource = this.findSourceByProject(projectId);
    if (matchingSource) {
      this.sources.set(matchingSource.id, { ...matchingSource, last_synced_at: syncedAt });
    }
    this.saveToDisk();
    return result;
  }

  async syncSource(
    sourceId: string,
    opts: { userAccessToken?: string | null; fetch?: typeof fetch } = {},
  ): Promise<BqSyncResult> {
    const source = this.sources.get(sourceId);
    if (!source) throw new BqCatalogError(404, 'Source not found.');
    return this.syncProject({
      project_id: source.project_id,
      secret_name: source.secret_name,
      dataset_filter: source.dataset_filter,
      userAccessToken: opts.userAccessToken,
      fetch: opts.fetch,
    });
  }

  async syncAll(opts: { userAccessToken?: string | null; fetch?: typeof fetch } = {}): Promise<BqSyncResult[]> {
    const active = this.listSources().filter((s) => s.is_active);
    const results: BqSyncResult[] = [];
    for (const src of active) {
      results.push(await this.syncSource(src.id, opts));
    }
    return results;
  }

  private buildPreviewSql(projectId: string, datasetId: string, tableId: string, limit: number, useSample: boolean): string {
    const fq = `\`${projectId}.${datasetId}.${tableId}\``;
    const safeLimit = Math.max(1, Math.min(Math.floor(limit), 2000));
    if (!useSample) {
      return `SELECT * FROM ${fq} LIMIT ${safeLimit}`;
    }
    return `SELECT * FROM ${fq} TABLESAMPLE SYSTEM (10 PERCENT) LIMIT ${safeLimit}`;
  }

  private shouldSampleTable(projectId: string, datasetId: string, tableId: string): boolean {
    const ds = this.datasets.get(`${projectId}.${datasetId}`);
    const tbl = ds?.tables.find((t) => t.table_id === tableId);
    if (!tbl) return true;
    const tType = tbl.table_type.toUpperCase();
    if (tType !== 'TABLE') return false;
    if (tbl.row_count != null && tbl.row_count < 500) return false;
    return true;
  }

  /**
   * Dry-runs a sample query (`TABLESAMPLE SYSTEM (10 PERCENT) LIMIT 100`) to estimate
   * bytes scanned and USD cost at `$6.25 / TiB` (ported from `bq_preview.py`).
   */
  async estimateTablePreview(opts: {
    project_id: string;
    dataset_id: string;
    table_id: string;
    limit?: number;
    userAccessToken?: string | null;
    fetch?: typeof fetch;
  }): Promise<BqPreviewEstimate> {
    const projectId = sanitizeBqPart(opts.project_id, 'project_id');
    const datasetId = sanitizeBqPart(opts.dataset_id, 'dataset_id');
    const tableId = sanitizeBqPart(opts.table_id, 'table_id');
    const fetchImpl = opts.fetch ?? this.defaultFetch ?? fetch;
    const src = this.findSourceByProject(projectId);

    const creds = await resolveGoogleCredentials({
      projectId,
      secretName: src?.secret_name,
      userAccessToken: opts.userAccessToken,
      env: this.env,
      fetch: fetchImpl,
    });
    const headers = buildGcpAuthHeaders(creds, { 'Content-Type': 'application/json' });
    const limit = opts.limit ?? 100;
    const trySample = this.shouldSampleTable(projectId, datasetId, tableId);
    let query = this.buildPreviewSql(projectId, datasetId, tableId, limit, trySample);

    const runDry = async (sql: string) => {
      const res = await fetchImpl(
        `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/queries`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            query: sql,
            useLegacySql: false,
            dryRun: true,
            useQueryCache: false,
          }),
          signal: AbortSignal.timeout(BQ_TIMEOUT_MS),
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        totalBytesProcessed?: string;
        statistics?: { totalBytesProcessed?: string };
        error?: { message?: string };
      };
      return { ok: res.ok, status: res.status, body };
    };

    let dry = await runDry(query);
    if (!dry.ok && trySample && /TABLESAMPLE/i.test(dry.body.error?.message ?? '')) {
      query = this.buildPreviewSql(projectId, datasetId, tableId, limit, false);
      dry = await runDry(query);
    }
    if (!dry.ok) {
      throw new BqCatalogError(502, `Preview dry-run failed: ${dry.body.error?.message ?? `HTTP ${dry.status}`}`);
    }

    const estimatedBytes = Number(dry.body.totalBytesProcessed ?? dry.body.statistics?.totalBytesProcessed ?? 0) || 0;
    const costUsd = Math.round(((estimatedBytes / BYTES_PER_TIB) * BQ_COST_PER_TB) * 1e6) / 1e6;
    return {
      query,
      estimated_bytes: estimatedBytes,
      estimated_cost_usd: costUsd,
    };
  }

  /**
   * Executes a read-only preview/load query against BigQuery and returns typed columns & rows
   * (used both for table preview and for loading BigQuery tables into Studio's SQLite-Wasm).
   */
  async runTablePreview(opts: {
    project_id: string;
    dataset_id: string;
    table_id: string;
    limit?: number;
    sample?: boolean;
    userAccessToken?: string | null;
    fetch?: typeof fetch;
  }): Promise<BqPreviewResult> {
    const projectId = sanitizeBqPart(opts.project_id, 'project_id');
    const datasetId = sanitizeBqPart(opts.dataset_id, 'dataset_id');
    const tableId = sanitizeBqPart(opts.table_id, 'table_id');
    const fetchImpl = opts.fetch ?? this.defaultFetch ?? fetch;
    const src = this.findSourceByProject(projectId);

    const creds = await resolveGoogleCredentials({
      projectId,
      secretName: src?.secret_name,
      userAccessToken: opts.userAccessToken,
      env: this.env,
      fetch: fetchImpl,
    });
    const headers = buildGcpAuthHeaders(creds, { 'Content-Type': 'application/json' });
    const maxRows = Math.max(1, Math.min(opts.limit ?? 100, 2000));
    const trySample = opts.sample !== false && this.shouldSampleTable(projectId, datasetId, tableId) && maxRows <= 200;
    let query = this.buildPreviewSql(projectId, datasetId, tableId, maxRows, trySample);

    const check = validateReadOnlySql(query, { maxRows, dialect: 'bigquery' });
    if (!check.ok) throw new BqCatalogError(400, check.error ?? 'Invalid preview SQL.');

    const execQuery = async (sql: string) => {
      const res = await fetchImpl(
        `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/queries`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            query: sql,
            useLegacySql: false,
            maxResults: maxRows,
            timeoutMs: BQ_TIMEOUT_MS,
            maximumBytesBilled: maxBytesBilled(this.env),
          }),
          signal: AbortSignal.timeout(BQ_TIMEOUT_MS + 2000),
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        schema?: { fields?: { name: string; type: string }[] };
        rows?: { f: { v: unknown }[] }[];
        totalRows?: string;
        error?: { message?: string };
      };
      return { ok: res.ok, status: res.status, body };
    };

    let run = await execQuery(query);
    if (!run.ok && trySample && /TABLESAMPLE/i.test(run.body.error?.message ?? '')) {
      query = this.buildPreviewSql(projectId, datasetId, tableId, maxRows, false);
      run = await execQuery(query);
    }
    if (!run.ok) {
      throw new BqCatalogError(502, `Preview query failed: ${explainBytesBilled(run.body.error?.message ?? `HTTP ${run.status}`)}`);
    }

    const fields = run.body.schema?.fields ?? [];
    const columns = fields.map((f) => f.name);
    const rows = parseBigQueryRows(fields, run.body.rows);
    const total = Number(run.body.totalRows ?? rows.length);
    return {
      query,
      columns,
      rows,
      row_count: rows.length,
      truncated: total > rows.length,
    };
  }
}
