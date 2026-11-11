/**
 * The studio API & token server: the only place that holds the Gemini API key
 * and the credentials of the data connectors.
 *
 *   GET  /api/live/status        → { configured, auth }          (never the key itself)
 *   POST /api/live/token         { model, voice?, thinkingLevel? } → { token, expireTime, account? }
 *   POST /api/auth/google        { credential } → { account }    (see server/auth.ts)
 *   POST /api/auth/logout
 *   POST /api/auth/delete-account → { ok: true, deleted: true }
 *   GET  /api/data/sources       → { sources }                   (server/dataConnectors.ts)
 *   GET  /api/data/schema        ?source&table&search → { source, tables, totalTables }
 *   POST /api/data/query         { source, sql, params?, maxRows? } → ServerQueryResponse
 *   …    /api/data/bq/*          BigQuery catalog (server/bigqueryCatalog.ts)
 *
 * On a deployment (sign-in required) only the studio's owners may register
 * BigQuery projects, sync them or list the projects of the server's service
 * account; everyone else queries the sources the owners set up.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type * as LiveConfig from '../src/agent/liveConfig.ts';
import { AuthError, type Auth } from './auth.ts';
import { BqCatalogError, BqCatalogStore } from './bigqueryCatalog.ts';
import { executeServerConnectorQuery, listConfiguredConnectors, type DataConnectorEnv } from './dataConnectors.ts';
import type { SqlParamValue } from './sqlGuard.ts';
import type { Usage } from './usage.ts';

/** What the server needs from src/agent/liveConfig.ts. */
export type AgentConfig = Pick<typeof LiveConfig, 'LIVE_MODELS' | 'VOICES' | 'THINKING_LEVELS' | 'agentSetup'>;

const TOKENS_URL = 'https://generativelanguage.googleapis.com/v1alpha/auth_tokens';
export const TOKEN_TTL_MS = 30 * 60_000;
export const NEW_SESSION_MS = 60_000;
/** Setup fields a token is locked to; the rest (resumption handle, transcription, voice detection) stays with the page. */
const LOCKED_FIELDS = ['model', 'generationConfig', 'systemInstruction', 'tools'];
const MAX_BODY_BYTES = 2048;
/** A Google ID token is 1–2 KB. */
const MAX_SIGN_IN_BYTES = 8192;
const MAX_DATA_QUERY_BYTES = 32_768;
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

export class TokenError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

/** The field mask of the locked fields, one level deep, as the Google Gen AI SDK builds it. */
export function fieldMask(setup: Record<string, unknown>): string {
  return Object.entries(setup).flatMap(([field, value]) =>
    value != null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0
      ? Object.keys(value).map((sub) => `${field}.${sub}`)
      : [field]).join(',');
}

/** Asks Google for a single-use token locked to `setup` (a BidiGenerateContentSetup). */
export async function createLiveToken(
  apiKey: string,
  setup: Record<string, unknown>,
  options: { fetch?: typeof fetch; now?: number } = {},
): Promise<{ token: string; expireTime: string }> {
  const now = options.now ?? Date.now();
  const locked = Object.fromEntries(LOCKED_FIELDS.filter((f) => setup[f] != null).map((f) => [f, setup[f]]));
  const expireTime = new Date(now + TOKEN_TTL_MS).toISOString();
  const body = {
    uses: 1,
    expireTime,
    newSessionExpireTime: new Date(now + NEW_SESSION_MS).toISOString(),
    bidiGenerateContentSetup: locked,
    fieldMask: fieldMask(locked),
  };
  let res: Response;
  try {
    res = await (options.fetch ?? fetch)(TOKENS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    throw new TokenError(502, 'upstream', `Google could not be reached for a Live API token (${e instanceof Error ? e.message : String(e)}).`);
  }
  const text = await res.text();
  let data: { name?: unknown; error?: { message?: unknown } } | null = null;
  try {
    data = JSON.parse(text);
  } catch {
    // not JSON
  }
  if (!res.ok) {
    const detail = String(data?.error?.message ?? text).slice(0, 300).replaceAll(apiKey, '[key]');
    if (res.status === 401 || res.status === 403 || /API_KEY_INVALID|API key not valid|API key expired/i.test(text)) {
      throw new TokenError(502, 'key-rejected', `Google refused the studio server's Gemini API key: ${detail} Check it, or replace it with ./studio.sh key.`);
    }
    if (res.status === 429) {
      throw new TokenError(429, 'quota', `The Gemini API quota of this key is used up for now; try again in a minute. (${detail})`);
    }
    throw new TokenError(502, 'upstream', `Google did not issue a Live API token (${res.status}: ${detail})`);
  }
  if (typeof data?.name !== 'string' || !data.name.startsWith('auth_tokens/')) {
    throw new TokenError(502, 'upstream', 'Google answered without a Live API token.');
  }
  return { token: data.name, expireTime };
}

export interface LiveTokenOptions {
  /** The Gemini API key, or '' when the server has none. */
  getApiKey: () => string;
  /** Called when Google refuses the key, so that a replaced key is read again. */
  onKeyRejected?: () => void;
  /** Loads src/agent/liveConfig.ts (through Vite, so that edits of the prompt apply at once). */
  loadConfig: () => Promise<AgentConfig>;
  /** Models tokens may be issued for (default: LIVE_MODELS). */
  models?: readonly string[];
  /** Host names allowed besides loopback, e.g. the domain of a deployment (or a ".run.app" suffix). */
  allowedHosts?: readonly string[];
  /**
   * Behind a reverse proxy (e.g. Cloud Run), rate limit by X-Forwarded-For: the
   * number of trusted proxies in front of the server (true = 1). Each proxy appends
   * the address it saw, so the client's own address is that many entries from the
   * end; anything before it was written by the client and is ignored.
   */
  trustProxy?: boolean | number;
  /** Tokens per client per minute (default 10). */
  rateLimit?: number;
  /** Only signed-in users get tokens (deployments). Without `auth` and `usage`, no one does. */
  requireSignIn?: boolean;
  auth?: Auth;
  usage?: Usage;
  connectorEnv?: DataConnectorEnv;
  bqCatalog?: BqCatalogStore;
  bqPersistPath?: string;
  fetch?: typeof fetch;
  log?: (message: string) => void;
  now?: () => number;
}

type Next = (error?: unknown) => void;

/** Connect-style middleware (Vite, Express or a plain node:http server) for /api/*. */
export function liveTokenMiddleware(o: LiveTokenOptions) {
  const hosts = new Set([...LOOPBACK_HOSTS, ...(o.allowedHosts ?? []).map((h) => h.toLowerCase())]);
  const now = o.now ?? Date.now;
  const limiter = new RateLimiter(o.rateLimit ?? 10, 60_000, now);
  const generalLimiter = new RateLimiter(60, 60_000, now);
  const log = o.log ?? ((m: string) => console.warn(m));
  const bqCatalog = o.bqCatalog ?? new BqCatalogStore({
    persistPath: o.bqPersistPath,
    env: (o.connectorEnv ?? process.env) as DataConnectorEnv & Record<string, string | undefined>,
    fetch: o.fetch,
    now,
  });

  const NOT_CONFIGURED = { error: 'auth-not-configured', message: 'Sign-in is not set up on this studio server yet, so voice is off.' };

  /** Rate limited (429 sent) when it returns false. */
  function admit(req: IncomingMessage, res: ServerResponse, bucket: string, message: string, useGeneral = false): boolean {
    const targetLimiter = useGeneral ? generalLimiter : limiter;
    const wait = targetLimiter.take(`${bucket}:${clientAddress(req, o.trustProxy)}`);
    if (wait <= 0) return true;
    send(res, 429, { error: 'rate-limit', message }, { 'Retry-After': String(Math.ceil(wait / 1000)) });
    return false;
  }

  async function authStatus(req: IncomingMessage) {
    if (!o.requireSignIn) return { required: false };
    if (!o.auth || !o.usage) return { required: true, configured: false };
    const user = await o.auth.userOf(req);
    return {
      required: true,
      configured: true,
      clientId: o.auth.clientId,
      freeDaily: o.usage.limits.free,
      account: user ? await o.usage.account(user) : null,
    };
  }

  async function signIn(req: IncomingMessage, res: ServerResponse) {
    if (req.method !== 'POST') return send(res, 405, { error: 'method', message: 'Use POST.' }, { Allow: 'POST' });
    if (!o.requireSignIn) return send(res, 404, { error: 'not-found', message: 'This studio server does not use sign-in.' });
    if (!o.auth || !o.usage) return send(res, 503, NOT_CONFIGURED);
    const body = await readJson(req, res, MAX_SIGN_IN_BYTES);
    if (body === undefined) return;
    if (!admit(req, res, 'sign-in', 'Too many sign-in attempts; wait a moment.')) return;
    const credential = (body as { credential?: unknown } | null)?.credential;
    try {
      const user = await o.auth.verifyGoogleCredential(credential as string);
      const account = await o.usage.signIn(user);
      return send(res, 200, { account }, { 'Set-Cookie': await o.auth.sessionCookie(user) });
    } catch (e) {
      if (!(e instanceof AuthError)) throw e;
      return send(res, e.status, { error: e.code, message: e.message });
    }
  }

  async function deleteAccount(req: IncomingMessage, res: ServerResponse) {
    if (req.method !== 'POST') return send(res, 405, { error: 'method', message: 'Use POST.' }, { Allow: 'POST' });
    if (!o.auth || !o.usage) return send(res, 503, NOT_CONFIGURED);
    const user = await o.auth.userOf(req);
    if (!user) return send(res, 401, { error: 'signed-out', message: 'Sign in first to delete your account.' });
    await o.usage.deleteUser(user.id);
    log(`[auth] Deleted the account of user ${user.id}`);
    return send(res, 200, { ok: true, deleted: true }, { 'Set-Cookie': o.auth.clearCookie() });
  }

  function gcpUserToken(req: IncomingMessage): string | null {
    const raw = req.headers['x-gcp-access-token'];
    const token = Array.isArray(raw) ? raw[0] : raw;
    return token?.trim() || null;
  }

  async function handleBigQueryCatalog(req: IncomingMessage, res: ServerResponse, path: string, canManage: boolean) {
    const queryStr = (req.url ?? '').split('?')[1] ?? '';
    const params = new URLSearchParams(queryStr);
    const userAccessToken = gcpUserToken(req);

    // Registering projects, syncing them and listing what the server's credentials can reach
    // administer the studio; the catalog is shared by every user
    const readOnly = req.method === 'GET' || req.method === 'HEAD';
    const manages = path === '/api/data/bq/projects' || path.startsWith('/api/data/bq/sync') ||
      (path.startsWith('/api/data/bq/sources') && !readOnly);
    if (manages && !canManage) {
      return send(res, 403, { error: 'owner-only', message: 'Only an owner of this studio can change its BigQuery sources.' });
    }
    const notASource = (projectId: string) => (bqCatalog.isQueryableProject(projectId)
      ? null
      : { error: 'bad-request', message: `BigQuery project "${projectId}" is not an active data source of this studio.` });

    try {
      if (path === '/api/data/bq/projects') {
        if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method', message: 'Use GET.' }, { Allow: 'GET, HEAD' });
        const projects = await bqCatalog.listAccessibleProjects({ userAccessToken, fetch: o.fetch });
        return send(res, 200, projects);
      }

      if (path === '/api/data/bq/sources') {
        if (req.method === 'GET' || req.method === 'HEAD') {
          return send(res, 200, bqCatalog.listSources());
        }
        if (req.method === 'POST') {
          if (!admit(req, res, 'bq-sources', 'Too many source changes; wait a moment.', true)) return;
          const body = await readJson(req, res, MAX_BODY_BYTES);
          if (body === undefined) return;
          if (!body || typeof body !== 'object' || Array.isArray(body)) {
            return send(res, 400, { error: 'bad-request', message: 'Expected a JSON object.' });
          }
          const raw = body as Record<string, unknown>;
          if (typeof raw.project_id !== 'string' || !raw.project_id.trim()) {
            return send(res, 400, { error: 'bad-request', message: 'project_id is required.' });
          }
          const created = bqCatalog.addSource({
            project_id: raw.project_id,
            display_name: typeof raw.display_name === 'string' ? raw.display_name : null,
            dataset_filter: typeof raw.dataset_filter === 'string' ? raw.dataset_filter : null,
            secret_name: typeof raw.secret_name === 'string' ? raw.secret_name : null,
          });
          return send(res, 201, created);
        }
        return send(res, 405, { error: 'method', message: 'Use GET or POST.' }, { Allow: 'GET, HEAD, POST' });
      }

      if (path.startsWith('/api/data/bq/sources/')) {
        const sourceId = decodeURIComponent(path.slice('/api/data/bq/sources/'.length)).trim();
        if (!sourceId) return send(res, 400, { error: 'bad-request', message: 'Missing source ID.' });
        if (req.method === 'PATCH') {
          if (!admit(req, res, 'bq-sources', 'Too many source changes; wait a moment.', true)) return;
          const body = await readJson(req, res, MAX_BODY_BYTES);
          if (body === undefined) return;
          if (!body || typeof body !== 'object' || Array.isArray(body)) {
            return send(res, 400, { error: 'bad-request', message: 'Expected a JSON object.' });
          }
          const raw = body as Record<string, unknown>;
          const updated = bqCatalog.updateSource(sourceId, {
            ...(raw.display_name !== undefined ? { display_name: typeof raw.display_name === 'string' ? raw.display_name : null } : {}),
            ...(raw.dataset_filter !== undefined ? { dataset_filter: typeof raw.dataset_filter === 'string' ? raw.dataset_filter : null } : {}),
            ...(raw.secret_name !== undefined ? { secret_name: typeof raw.secret_name === 'string' ? raw.secret_name : null } : {}),
            ...(typeof raw.is_active === 'boolean' ? { is_active: raw.is_active } : {}),
          });
          return send(res, 200, updated);
        }
        if (req.method === 'DELETE') {
          const purge = params.get('purge') === '1' || params.get('purge') === 'true';
          bqCatalog.deleteSource(sourceId, purge);
          return send(res, 200, { ok: true });
        }
        return send(res, 405, { error: 'method', message: 'Use PATCH or DELETE.' }, { Allow: 'PATCH, DELETE' });
      }

      if (path === '/api/data/bq/sync') {
        if (req.method !== 'POST') return send(res, 405, { error: 'method', message: 'Use POST.' }, { Allow: 'POST' });
        if (!admit(req, res, 'bq-sync', 'Too many BigQuery sync requests; wait a moment.', true)) return;
        const body = await readJson(req, res, MAX_BODY_BYTES);
        if (body === undefined) return;
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          return send(res, 400, { error: 'bad-request', message: 'Expected a JSON sync payload.' });
        }
        const raw = body as Record<string, unknown>;
        if (typeof raw.project_id !== 'string' || !raw.project_id.trim()) {
          return send(res, 400, { error: 'bad-request', message: 'project_id is required.' });
        }
        const result = await bqCatalog.syncProject({
          project_id: raw.project_id,
          secret_name: typeof raw.secret_name === 'string' ? raw.secret_name : null,
          secret_version: typeof raw.secret_version === 'string' ? raw.secret_version : 'latest',
          dataset_filter: typeof raw.dataset_filter === 'string' ? raw.dataset_filter : null,
          userAccessToken,
          fetch: o.fetch,
        });
        return send(res, 200, result);
      }

      if (path === '/api/data/bq/sync/all') {
        if (req.method !== 'POST') return send(res, 405, { error: 'method', message: 'Use POST.' }, { Allow: 'POST' });
        if (!admit(req, res, 'bq-sync', 'Too many BigQuery sync requests; wait a moment.', true)) return;
        const results = await bqCatalog.syncAll({ userAccessToken, fetch: o.fetch });
        return send(res, 200, results);
      }

      if (path.startsWith('/api/data/bq/sync/source/')) {
        if (req.method !== 'POST') return send(res, 405, { error: 'method', message: 'Use POST.' }, { Allow: 'POST' });
        if (!admit(req, res, 'bq-sync', 'Too many BigQuery sync requests; wait a moment.', true)) return;
        const sourceId = decodeURIComponent(path.slice('/api/data/bq/sync/source/'.length)).trim();
        if (!sourceId) return send(res, 400, { error: 'bad-request', message: 'Missing source ID.' });
        const result = await bqCatalog.syncSource(sourceId, { userAccessToken, fetch: o.fetch });
        return send(res, 200, result);
      }

      if (path === '/api/data/bq/datasets') {
        if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method', message: 'Use GET.' }, { Allow: 'GET, HEAD' });
        const projectId = params.get('project_id')?.trim() || undefined;
        const search = params.get('search')?.trim() || undefined;
        return send(res, 200, { datasets: bqCatalog.listDatasets({ project_id: projectId, search }) });
      }

      if (path === '/api/data/bq/preview') {
        if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method', message: 'Use GET.' }, { Allow: 'GET, HEAD' });
        const projectId = params.get('project_id')?.trim() ?? '';
        const datasetId = params.get('dataset_id')?.trim() ?? '';
        const tableId = params.get('table_id')?.trim() ?? '';
        const limit = params.get('limit') ? Number(params.get('limit')) : undefined;
        if (!projectId || !datasetId || !tableId) {
          return send(res, 400, { error: 'bad-request', message: 'project_id, dataset_id, and table_id query parameters are required.' });
        }
        const refused = notASource(projectId);
        if (refused) return send(res, 400, refused);
        const estimate = await bqCatalog.estimateTablePreview({
          project_id: projectId,
          dataset_id: datasetId,
          table_id: tableId,
          limit: Number.isFinite(limit) ? limit : undefined,
          userAccessToken,
          fetch: o.fetch,
        });
        return send(res, 200, estimate);
      }

      if (path === '/api/data/bq/preview/run') {
        if (req.method !== 'POST') return send(res, 405, { error: 'method', message: 'Use POST.' }, { Allow: 'POST' });
        if (!admit(req, res, 'data-query', 'Too many data preview queries; wait a moment.', true)) return;
        const body = await readJson(req, res, MAX_BODY_BYTES);
        if (body === undefined) return;
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          return send(res, 400, { error: 'bad-request', message: 'Expected a JSON preview payload.' });
        }
        const raw = body as Record<string, unknown>;
        const projectId = typeof raw.project_id === 'string' ? raw.project_id.trim() : '';
        const datasetId = typeof raw.dataset_id === 'string' ? raw.dataset_id.trim() : '';
        const tableId = typeof raw.table_id === 'string' ? raw.table_id.trim() : '';
        if (!projectId || !datasetId || !tableId) {
          return send(res, 400, { error: 'bad-request', message: 'project_id, dataset_id, and table_id are required.' });
        }
        const refused = notASource(projectId);
        if (refused) return send(res, 400, refused);
        const preview = await bqCatalog.runTablePreview({
          project_id: projectId,
          dataset_id: datasetId,
          table_id: tableId,
          limit: typeof raw.limit === 'number' ? raw.limit : undefined,
          sample: typeof raw.sample === 'boolean' ? raw.sample : undefined,
          userAccessToken,
          fetch: o.fetch,
        });
        return send(res, 200, preview);
      }

      return send(res, 404, { error: 'not-found', message: 'Not found.' });
    } catch (e) {
      if (e instanceof BqCatalogError) {
        return send(res, e.status, { error: 'bq-error', message: e.message });
      }
      return send(res, 502, { error: 'bq-error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  async function handleData(req: IncomingMessage, res: ServerResponse, path: string) {
    // Without sign-in the server is on loopback and its one user owns it
    let canManage = true;
    if (o.requireSignIn) {
      if (!o.auth || !o.usage) return send(res, 503, NOT_CONFIGURED);
      const user = await o.auth.userOf(req);
      if (!user) return send(res, 401, { error: 'signed-out', message: 'Sign in with Google to query server data connectors.' });
      canManage = o.usage.isOwner(user);
    }

    if (path.startsWith('/api/data/bq/')) {
      return handleBigQueryCatalog(req, res, path, canManage);
    }

    if (path === '/api/data/sources') {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method', message: 'Use GET.' }, { Allow: 'GET, HEAD' });
      return send(res, 200, { sources: listConfiguredConnectors(o.connectorEnv ?? process.env, bqCatalog) });
    }

    if (path === '/api/data/schema') {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method', message: 'Use GET.' }, { Allow: 'GET, HEAD' });
      const queryStr = (req.url ?? '').split('?')[1] ?? '';
      const params = new URLSearchParams(queryStr);
      const source = params.get('source')?.trim() ?? '';
      const table = params.get('table')?.trim() || undefined;
      if (!source) return send(res, 400, { error: 'bad-request', message: 'Missing source query parameter.' });
      if (source === 'bigquery' || source.startsWith('bigquery:')) {
        const resolved = bqCatalog.resolveSourceConnector(source, o.connectorEnv ?? process.env);
        if (!resolved?.source?.is_active) {
          return send(res, 400, { error: 'bad-request', message: `"${source}" is not an active BigQuery source of this studio.` });
        }
        // A registered source that was never synced (a new instance) is synced on first use
        if (resolved.source.last_synced_at == null && bqCatalog.countTablesForProject(resolved.projectId) === 0) {
          await bqCatalog.syncSourceOnce(resolved.source, { userAccessToken: gcpUserToken(req), fetch: o.fetch });
        }
        return send(res, 200, { source, tables: bqCatalog.getSchemaTables(source, table) });
      }
      return send(res, 200, { source, tables: [] });
    }

    if (path === '/api/data/query') {
      if (req.method !== 'POST') return send(res, 405, { error: 'method', message: 'Use POST.' }, { Allow: 'POST' });
      if (!admit(req, res, 'data-query', 'Too many data queries; wait a moment.', true)) return;
      const body = await readJson(req, res, MAX_DATA_QUERY_BYTES);
      if (body === undefined) return;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return send(res, 400, { error: 'bad-request', message: 'Expected a JSON query payload.' });
      }
      const raw = body as { source?: unknown; sql?: unknown; params?: unknown; maxRows?: unknown };
      if (typeof raw.source !== 'string' || !raw.source.trim() || typeof raw.sql !== 'string' || !raw.sql.trim()) {
        return send(res, 400, { error: 'bad-request', message: 'Payload requires non-empty "source" and "sql" strings.' });
      }
      const result = await executeServerConnectorQuery(
        {
          source: raw.source.trim(),
          sql: raw.sql,
          params: raw.params && typeof raw.params === 'object' && !Array.isArray(raw.params)
            ? (raw.params as Record<string, SqlParamValue>)
            : undefined,
          maxRows: typeof raw.maxRows === 'number' ? raw.maxRows : undefined,
        },
        {
          env: o.connectorEnv ?? process.env,
          fetch: o.fetch,
          bqCatalog,
          userAccessToken: gcpUserToken(req),
        },
      );
      return send(res, result.ok ? 200 : 400, result);
    }

    return send(res, 404, { error: 'not-found', message: 'Not found.' });
  }

  async function handle(req: IncomingMessage, res: ServerResponse, path: string) {
    const denied = checkRequestOrigin(req, hosts);
    if (denied) return send(res, 403, { error: 'forbidden', message: denied });

    if (path === '/api/live/status') {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method', message: 'Use GET.' }, { Allow: 'GET, HEAD' });
      return send(res, 200, { configured: o.getApiKey() !== '', auth: await authStatus(req) });
    }
    if (path === '/api/auth/google') return signIn(req, res);
    if (path === '/api/auth/logout') {
      if (req.method !== 'POST') return send(res, 405, { error: 'method', message: 'Use POST.' }, { Allow: 'POST' });
      return send(res, 200, { ok: true }, o.auth ? { 'Set-Cookie': o.auth.clearCookie() } : {});
    }
    if (path === '/api/auth/delete-account') return deleteAccount(req, res);
    if (path.startsWith('/api/data/')) return handleData(req, res, path);

    if (path !== '/api/live/token') return send(res, 404, { error: 'not-found', message: 'Not found.' });
    if (req.method !== 'POST') return send(res, 405, { error: 'method', message: 'Use POST.' }, { Allow: 'POST' });
    const request = await readJson(req, res, MAX_BODY_BYTES);
    if (request === undefined) return;
    const config = await o.loadConfig();
    const invalid = validate(request, config, o.models ?? config.LIVE_MODELS);
    if (invalid) return send(res, 400, { error: 'bad-request', message: invalid });

    if (!admit(req, res, 'token', 'Too many Live sessions were started; wait a moment.')) return;
    const apiKey = o.getApiKey();
    if (!apiKey) {
      return send(res, 503, { error: 'no-key', message: 'No Gemini API key on the studio server. Run ./studio.sh key in a terminal, then try again.' });
    }

    let reservation: Awaited<ReturnType<Usage['reserve']>> | null = null;
    if (o.requireSignIn) {
      if (!o.auth || !o.usage) return send(res, 503, NOT_CONFIGURED);
      const user = await o.auth.userOf(req);
      if (!user) return send(res, 401, { error: 'signed-out', message: 'Sign in with Google to talk to the studio.' });
      reservation = await o.usage.reserve(user);
      if (!reservation.ok) {
        if (reservation.reason === 'user') {
          return send(res, 429, {
            error: 'daily-limit',
            message: `You have used today's ${reservation.account.limit} voice sessions. They renew at midnight UTC.`,
            account: reservation.account,
          });
        }
        log('[live-token] the daily session limit of the whole studio was reached');
        return send(res, 503, { error: 'busy', message: 'The studio has reached its capacity for today; try again tomorrow.' });
      }
    }

    const { model, voice, thinkingLevel } = request as { model: string; voice?: string; thinkingLevel?: string };
    try {
      const token = await createLiveToken(apiKey, config.agentSetup({ model, voice, thinkingLevel }), { fetch: o.fetch, now: now() });
      return send(res, 200, reservation?.ok ? { ...token, account: reservation.account } : token);
    } catch (e) {
      if (reservation?.ok) await reservation.release().catch(() => undefined);
      if (!(e instanceof TokenError)) throw e;
      if (e.code === 'key-rejected') o.onKeyRejected?.();
      log(`[live-token] ${e.message}`);
      return send(res, e.status, { error: e.code, message: e.message });
    }
  }

  return (req: IncomingMessage, res: ServerResponse, next: Next) => {
    const path = (req.url ?? '').split('?')[0];
    if (
      !path.startsWith('/api/live/') &&
      !path.startsWith('/api/auth/') &&
      !path.startsWith('/api/data/')
    ) {
      next();
      return;
    }
    handle(req, res, path).catch((e: unknown) => {
      log(`[live-token] ${e instanceof Error ? e.message : String(e)}`);
      if (!res.headersSent) send(res, 500, { error: 'internal', message: 'The token server failed; see its log.' });
    });
  };
}

function isAllowedHost(hostname: string, hosts: Set<string>): boolean {
  if (hosts.has(hostname)) return true;
  for (const h of hosts) {
    if (h.startsWith('.') && h.length > 1 && hostname.endsWith(h)) return true;
  }
  return false;
}

/**
 * The client's address. Behind `trustProxy` proxies it is the entry that the
 * outermost trusted proxy appended to X-Forwarded-For; the entries before it
 * come from the client, which can write anything there.
 */
export function clientAddress(req: IncomingMessage, trustProxy?: boolean | number): string {
  const hops = trustProxy === true ? 1 : typeof trustProxy === 'number' ? trustProxy : 0;
  if (hops > 0) {
    const xff = req.headers['x-forwarded-for'];
    const entries = (Array.isArray(xff) ? xff.join(',') : xff ?? '').split(',').map((e) => e.trim()).filter(Boolean);
    const entry = entries[entries.length - hops];
    if (entry) return entry;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

/** Rejects requests from other sites and requests addressed to unknown host names. */
export function checkRequestOrigin(req: IncomingMessage, hosts: Set<string>): string | null {
  const host = (req.headers.host ?? '').toLowerCase();
  let hostname: string;
  try {
    hostname = new URL(`http://${host}`).hostname;
  } catch {
    return 'Bad Host header.';
  }
  // A page on another domain that resolves to this machine (DNS rebinding)
  if (!isAllowedHost(hostname, hosts)) return `Requests for ${hostname} are not allowed (see STUDIO_ALLOWED_HOSTS).`;
  const site = req.headers['sec-fetch-site'];
  if (site != null && site !== 'same-origin' && site !== 'none') return 'Cross-site requests are not allowed.';
  const origin = req.headers.origin;
  if (origin != null) {
    let o: URL;
    try {
      o = new URL(origin);
    } catch {
      return 'Bad Origin header.';
    }
    if (o.host !== host) return 'Cross-origin requests are not allowed.';
  }
  return null;
}

function validate(r: unknown, config: AgentConfig, models: readonly string[]): string | null {
  if (r == null || typeof r !== 'object' || Array.isArray(r)) return 'Expected a JSON object.';
  const { model, voice, thinkingLevel, ...rest } = r as Record<string, unknown>;
  const unknown = Object.keys(rest);
  if (unknown.length > 0) return `Unknown field ${JSON.stringify(unknown[0].slice(0, 40))}.`;
  if (typeof model !== 'string' || !models.includes(model)) {
    return `The model ${JSON.stringify(String(model).slice(0, 80))} is not enabled on the studio server (STUDIO_LIVE_MODELS).`;
  }
  if (voice !== undefined && (typeof voice !== 'string' || !config.VOICES.includes(voice))) return 'Unknown voice.';
  if (thinkingLevel !== undefined && (typeof thinkingLevel !== 'string' || !config.THINKING_LEVELS.includes(thinkingLevel))) {
    return 'Unknown thinking level.';
  }
  return null;
}

/** The parsed JSON body; undefined when an error response was sent instead. */
async function readJson(req: IncomingMessage, res: ServerResponse, limit: number): Promise<unknown> {
  if (!/^application\/json\s*(;|$)/i.test(req.headers['content-type'] ?? '')) {
    send(res, 415, { error: 'content-type', message: 'Send JSON (Content-Type: application/json).' });
    return undefined;
  }
  const raw = await readBody(req, limit);
  if (raw == null) {
    send(res, 413, { error: 'too-large', message: 'The request is too large.' });
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch {
    send(res, 400, { error: 'bad-request', message: 'The request is not valid JSON.' });
    return undefined;
  }
}

/** The body as text, or null when it is larger than `limit` bytes. */
function readBody(req: IncomingMessage, limit: number): Promise<string | null> {
  if (Number(req.headers['content-length'] ?? 0) > limit) {
    req.resume();
    return Promise.resolve(null);
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
    });
    req.on('end', () => resolve(size > limit ? null : Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

/** Sliding window: at most `limit` tokens per client in `windowMs`. */
class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(private limit: number, private windowMs: number, private now: () => number) {}

  /** 0 when allowed, otherwise the milliseconds to wait. */
  take(client: string): number {
    const t = this.now();
    const recent = (this.hits.get(client) ?? []).filter((h) => t - h < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(client, recent);
      return this.windowMs - (t - recent[0]);
    }
    recent.push(t);
    this.hits.set(client, recent);
    if (this.hits.size > 1000) {
      for (const [c, list] of this.hits) {
        if (list.every((h) => t - h >= this.windowMs)) this.hits.delete(c);
      }
    }
    return 0;
  }
}
