/**
 * Official Google Developer Knowledge MCP Client (`https://developerknowledge.googleapis.com/mcp`).
 *
 * Connects to Google's first-party Developer Knowledge MCP Server over Streamable HTTP
 * (JSON-RPC 2.0 via `@modelcontextprotocol/sdk`) to ground architecture documentation in
 * live, authoritative Google documentation across Cloud, AI/Vertex/Gemini, Firebase, ADK,
 * Genkit, Apigee, Android, Chrome, Flutter, Go, Web, and Workspace.
 *
 * Exposed official MCP tools:
 *   - `search_documents` — full-text search returning snippets + `documents/{uri}` resource names
 *   - `get_documents`    — batch retrieval (1–20 docs) of complete official Markdown pages
 *   - `answer_query`     — grounded conceptual answer + official reference URIs (auto-falls back
 *                          to `search_documents` on HTTP 429 quota limits per Google's guidance)
 *
 * Authentication (strictly server-side; credentials never reach the browser):
 *   1. `DEVELOPERKNOWLEDGE_API_KEY` (or `GOOGLE_DEVELOPER_KNOWLEDGE_API_KEY`) sent as
 *      `X-Goog-Api-Key` header (never a URL query parameter)
 *   2. Explicit bearer token (`DEVELOPERKNOWLEDGE_ACCESS_TOKEN` or per-request `X-GCP-Access-Token`)
 *      sent as `Authorization: Bearer` + `X-Goog-User-Project`
 *   3. Google Cloud ADC / Cloud Run metadata server / service account / `gcloud` CLI
 *      sent as `Authorization: Bearer` + `X-Goog-User-Project`
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import { readEnvVarFromFiles } from './apiKey.ts';
import { resolveGoogleCredentials } from './bigqueryCatalog.ts';

export const OFFICIAL_DEVELOPER_KNOWLEDGE_MCP_URL = 'https://developerknowledge.googleapis.com/mcp';
export const OFFICIAL_MCP_TOOLS = ['search_documents', 'get_documents', 'answer_query'] as const;

const API_KEY_ENV_NAMES = ['DEVELOPERKNOWLEDGE_API_KEY', 'GOOGLE_DEVELOPER_KNOWLEDGE_API_KEY'] as const;
const PROJECT_ENV_NAMES = [
  'DEVELOPERKNOWLEDGE_PROJECT_ID',
  'GOOGLE_CLOUD_PROJECT',
  'GCLOUD_PROJECT',
  'GCP_PROJECT_ID',
  'BIGQUERY_PROJECT_ID',
] as const;

const SEARCH_CACHE_TTL_MS = 15 * 60_000;
const DOC_CACHE_TTL_MS = 30 * 60_000;
const ANSWER_CACHE_TTL_MS = 15 * 60_000;
const MAX_CACHE_ENTRIES = 128;
const MCP_REQUEST_TIMEOUT_MS = 20_000;
const MAX_BATCH_DOCS = 20;

export type DocsAuthMode = 'api-key' | 'token' | 'adc' | 'none';
export type DocsErrorCode = 'auth-required' | 'api-disabled' | 'quota' | 'bad-request' | 'upstream';

export interface GoogleDocsSearchChunk {
  /** Official Developer Knowledge resource name, e.g. `documents/docs.cloud.google.com/run/docs/...` */
  parent: string;
  /** Canonical HTTPS URL for citation, e.g. `https://docs.cloud.google.com/run/docs/...` */
  uri: string;
  /** Chunk identifier within the document. */
  id: string;
  /** Markdown excerpt from the official documentation. */
  content: string;
}

export interface GoogleDocsSearchResult {
  query: string;
  results: GoogleDocsSearchChunk[];
  cached: boolean;
  source: 'google-developer-knowledge-mcp';
}

export interface GoogleDocsPage {
  name: string;
  uri: string;
  title: string;
  content: string;
  truncated?: boolean;
}

export interface GoogleDocsGetResult {
  documents: GoogleDocsPage[];
  cachedCount: number;
  fetchedCount: number;
  source: 'google-developer-knowledge-mcp';
}

export interface GoogleDocsReference {
  name: string;
  uri: string;
}

export interface GoogleDocsAnswerResult {
  query: string;
  answerText: string | null;
  references: GoogleDocsReference[];
  results?: GoogleDocsSearchChunk[];
  fallback?: 'search_documents';
  note?: string;
  cached: boolean;
  source: 'google-developer-knowledge-mcp';
}

export interface GoogleDocsMcpStatus {
  configured: boolean;
  verified: boolean;
  authMode: DocsAuthMode;
  endpoint: string;
  projectId?: string;
  tools: readonly string[];
  lastErrorCode?: DocsErrorCode;
  lastError?: string;
  setupHint?: string;
  enableUrl?: string;
}

export interface GoogleDocsMcpEnv {
  DEVELOPERKNOWLEDGE_API_KEY?: string;
  GOOGLE_DEVELOPER_KNOWLEDGE_API_KEY?: string;
  DEVELOPERKNOWLEDGE_ACCESS_TOKEN?: string;
  DEVELOPERKNOWLEDGE_PROJECT_ID?: string;
  DEVELOPERKNOWLEDGE_MCP_URL?: string;
  GOOGLE_CLOUD_PROJECT?: string;
  GCLOUD_PROJECT?: string;
  GCP_PROJECT_ID?: string;
  BIGQUERY_PROJECT_ID?: string;
  GOOGLE_APPLICATION_CREDENTIALS?: string;
  GCE_METADATA_HOST?: string;
  K_SERVICE?: string;
  [key: string]: string | undefined;
}

export interface GoogleDocsMcpOptions {
  /** Studio root directory for reading `.env` / `.env.local` dynamically. */
  root?: string;
  /** Override environment map (useful for tests). */
  env?: GoogleDocsMcpEnv;
  /** Override official MCP endpoint URL (defaults to `https://developerknowledge.googleapis.com/mcp`). */
  endpoint?: string;
  /** Custom fetch implementation (useful for deterministic unit tests). */
  fetch?: typeof fetch;
  /** Allow reading local ADC / `gcloud` CLI config (defaults to true unless `env` or `fetch` is mocked). */
  allowLocalAuth?: boolean;
  /** Clock function (defaults to `Date.now`). */
  now?: () => number;
  /** Sleep function for exponential backoff (defaults to `setTimeout`). */
  sleep?: (ms: number) => Promise<void>;
  /** Random number generator in [0, 1) for backoff jitter. */
  random?: () => number;
  /** Retry settings for HTTP 429 / 503. */
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  log?: (message: string) => void;
}

export class GoogleDocsMcpError extends Error {
  constructor(
    readonly status: number,
    readonly code: DocsErrorCode,
    message: string,
    readonly opts: { setupHint?: string; enableUrl?: string } = {},
  ) {
    super(message);
    this.name = 'GoogleDocsMcpError';
  }
}

/** Converts an official `documents/{uri_without_scheme}` resource name to an HTTPS citation URI. */
export function docNameToUri(name: string): string {
  const trimmed = name.trim();
  if (/^https:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('documents/')) {
    return `https://${trimmed.slice('documents/'.length)}`;
  }
  return `https://${trimmed.replace(/^\/+/, '')}`;
}

/**
 * Validates and normalizes a Developer Knowledge document resource name.
 * Accepts `documents/{host}/{path}` or canonical `https://{host}/{path}`, rejecting
 * unsafe schemes, whitespace, control characters, and `..` path traversal.
 */
export function normalizeDocName(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 512 || /[\s\0-\x1f\x7f\\]/.test(trimmed)) return null;

  if (/^https:\/\//i.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return null;
    }
    if (url.protocol !== 'https:' || !url.hostname || !url.hostname.includes('.')) return null;
    const rawPath = url.pathname.replace(/\/+$/, '');
    if (rawPath.split('/').includes('..')) return null;
    return `documents/${url.host}${rawPath}`;
  }

  if (!trimmed.startsWith('documents/')) return null;
  const rest = trimmed.slice('documents/'.length);
  if (!rest || /^https?:/i.test(rest) || rest.includes('?') || rest.includes('#')) return null;
  const segments = rest.split('/');
  const host = segments[0];
  if (!host || !host.includes('.') || segments.some((s) => s === '..')) return null;
  return `documents/${rest.replace(/\/+$/, '')}`;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class BoundedTtlCache<T> {
  private map = new Map<string, CacheEntry<T>>();

  constructor(private maxEntries: number, private now: () => number) {}

  get(key: string): T | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    // Refresh LRU order
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, ttlMs: number): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, expiresAt: this.now() + ttlMs });
    if (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }
}

interface ResolvedAuth {
  mode: DocsAuthMode;
  headers: Record<string, string>;
  secrets: string[];
  projectId?: string;
}

interface RawMcpCallResult {
  content?: Array<{ type?: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/** Extracts clean text from a Google Developer Knowledge MCP error or StreamableHTTPError. */
function extractMcpErrorText(err: unknown): { status?: number; text: string } {
  const status = err instanceof StreamableHTTPError ? err.code : undefined;
  const raw = err instanceof Error ? err.message : String(err);

  // Google's MCP endpoint often embeds JSON-RPC `result.content[0].text` inside StreamableHTTPError
  const jsonStart = raw.indexOf('{');
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(raw.slice(jsonStart)) as {
        error?: { message?: string; code?: number };
        result?: { content?: Array<{ text?: string }>; isError?: boolean };
      };
      const contentText = parsed.result?.content?.map((c) => c.text).filter(Boolean).join(' ').trim();
      if (contentText) return { status, text: contentText };
      if (parsed.error?.message) return { status, text: parsed.error.message };
    } catch {
      // Not valid JSON; keep raw message
    }
  }
  return { status, text: raw };
}

function redactSecrets(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length >= 6) out = out.replaceAll(s, '[redacted]');
  }
  return out.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]');
}

function parseStructuredPayload(res: RawMcpCallResult): Record<string, unknown> {
  if (res.structuredContent && typeof res.structuredContent === 'object') {
    return res.structuredContent;
  }
  const textPart = res.content?.find((c) => c.type === 'text' && typeof c.text === 'string')?.text;
  if (textPart) {
    try {
      const parsed = JSON.parse(textPart);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Not JSON text
    }
  }
  return {};
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class GoogleDocsMcpService {
  readonly endpoint: string;
  private readonly root?: string;
  private readonly envOverride?: GoogleDocsMcpEnv;
  private readonly fetchImpl: typeof fetch;
  private readonly allowLocalAuth: boolean;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly maxRetries: number;
  private readonly initialDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly log: (message: string) => void;

  private readonly searchCache: BoundedTtlCache<GoogleDocsSearchChunk[]>;
  private readonly docCache: BoundedTtlCache<GoogleDocsPage>;
  private readonly answerCache: BoundedTtlCache<GoogleDocsAnswerResult>;

  private cachedGcloudProject: string | null | undefined;
  private lastVerifiedAt: number | null = null;
  private lastHealthError: { code: DocsErrorCode; message: string; setupHint?: string; enableUrl?: string } | null = null;

  constructor(opts: GoogleDocsMcpOptions = {}) {
    this.root = opts.root;
    this.envOverride = opts.env;
    const env = opts.env ?? (process.env as GoogleDocsMcpEnv);
    this.endpoint = (opts.endpoint ?? env.DEVELOPERKNOWLEDGE_MCP_URL ?? OFFICIAL_DEVELOPER_KNOWLEDGE_MCP_URL).trim();
    this.fetchImpl = opts.fetch ?? fetch;
    this.allowLocalAuth = opts.allowLocalAuth ?? (opts.fetch === undefined && opts.env === undefined);
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? defaultSleep;
    this.random = opts.random ?? Math.random;
    this.maxRetries = opts.maxRetries ?? 2;
    this.initialDelayMs = opts.initialDelayMs ?? 400;
    this.maxDelayMs = opts.maxDelayMs ?? 3000;
    this.log = opts.log ?? ((m: string) => console.warn(m));

    this.searchCache = new BoundedTtlCache(MAX_CACHE_ENTRIES, this.now);
    this.docCache = new BoundedTtlCache(MAX_CACHE_ENTRIES, this.now);
    this.answerCache = new BoundedTtlCache(64, this.now);
  }

  private get env(): GoogleDocsMcpEnv {
    return this.envOverride ?? (process.env as GoogleDocsMcpEnv);
  }

  private readApiKey(): string {
    for (const k of API_KEY_ENV_NAMES) {
      const v = this.env[k]?.trim();
      if (v) return v;
    }
    if (this.root) {
      return readEnvVarFromFiles(this.root, API_KEY_ENV_NAMES);
    }
    return '';
  }

  private readExplicitProjectId(): string | undefined {
    for (const k of PROJECT_ENV_NAMES) {
      const v = this.env[k]?.trim();
      if (v) return v;
    }
    if (this.root) {
      const fromFile = readEnvVarFromFiles(this.root, PROJECT_ENV_NAMES);
      if (fromFile) return fromFile;
    }
    return undefined;
  }

  private readAdcQuotaProject(): string | undefined {
    if (!this.allowLocalAuth) return undefined;
    const adcPath = this.env.GOOGLE_APPLICATION_CREDENTIALS
      || join(homedir(), '.config', 'gcloud', 'application_default_credentials.json');
    if (!existsSync(adcPath)) return undefined;
    try {
      const raw = JSON.parse(readFileSync(adcPath, 'utf8')) as { quota_project_id?: string };
      return raw.quota_project_id?.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  private readGcloudProject(): string | undefined {
    if (!this.allowLocalAuth) return undefined;
    if (this.cachedGcloudProject !== undefined) return this.cachedGcloudProject ?? undefined;
    try {
      const project = execFileSync('gcloud', ['config', 'get-value', 'project'], {
        encoding: 'utf8',
        timeout: 2500,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      this.cachedGcloudProject = project && project !== '(unset)' ? project : null;
    } catch {
      this.cachedGcloudProject = null;
    }
    return this.cachedGcloudProject ?? undefined;
  }

  private resolveProjectId(): string | undefined {
    return this.readExplicitProjectId() || this.readAdcQuotaProject() || this.readGcloudProject();
  }

  private hasLocalAdcCandidate(): boolean {
    if (this.env.GCE_METADATA_HOST?.trim() || this.env.K_SERVICE?.trim()) return true;
    if (!this.allowLocalAuth) return false;
    const adcPath = this.env.GOOGLE_APPLICATION_CREDENTIALS
      || join(homedir(), '.config', 'gcloud', 'application_default_credentials.json');
    if (existsSync(adcPath)) return true;
    return this.readGcloudProject() != null;
  }

  private setupHint(projectId?: string): string {
    const projectFlag = projectId ? ` --project=${projectId}` : ' --project=<PROJECT_ID>';
    return `Enable the official API (\`gcloud services enable developerknowledge.googleapis.com${projectFlag}\`), then set \`DEVELOPERKNOWLEDGE_API_KEY\` in \`studio/.env\` or sign in via \`gcloud auth application-default login${projectFlag}\`.`;
  }

  /**
   * Returns current credential & health status without leaking secrets.
   * When `opts.verify` is true, performs a live MCP probe against `search_documents`.
   */
  async status(opts: { verify?: boolean; userAccessToken?: string | null } = {}): Promise<GoogleDocsMcpStatus> {
    const apiKey = this.readApiKey();
    const explicitToken = opts.userAccessToken?.trim() || this.env.DEVELOPERKNOWLEDGE_ACCESS_TOKEN?.trim() || '';
    const projectId = this.resolveProjectId();

    let authMode: DocsAuthMode = 'none';
    if (apiKey) authMode = 'api-key';
    else if (explicitToken) authMode = 'token';
    else if (this.hasLocalAdcCandidate()) authMode = 'adc';

    if (opts.verify) {
      try {
        await this.searchDocuments('Google Cloud Run documentation', {
          limit: 1,
          bypassCache: true,
          userAccessToken: opts.userAccessToken,
        });
      } catch {
        // Error recorded in lastHealthError
      }
    }

    const configured = authMode !== 'none';
    const verified = this.lastVerifiedAt != null && this.lastHealthError == null;
    return {
      configured,
      verified,
      authMode,
      endpoint: this.endpoint,
      ...(projectId ? { projectId } : {}),
      tools: OFFICIAL_MCP_TOOLS,
      ...(this.lastHealthError
        ? {
            lastErrorCode: this.lastHealthError.code,
            lastError: this.lastHealthError.message,
            ...(this.lastHealthError.setupHint ? { setupHint: this.lastHealthError.setupHint } : {}),
            ...(this.lastHealthError.enableUrl ? { enableUrl: this.lastHealthError.enableUrl } : {}),
          }
        : !configured
          ? { setupHint: this.setupHint(projectId) }
          : {}),
    };
  }

  private async resolveAuth(userAccessToken?: string | null): Promise<ResolvedAuth> {
    const projectId = this.resolveProjectId();

    // 1. Official API Key header (never query param)
    const apiKey = this.readApiKey();
    if (apiKey) {
      return {
        mode: 'api-key',
        headers: { 'X-Goog-Api-Key': apiKey },
        secrets: [apiKey],
        projectId,
      };
    }

    // 2. Explicit OAuth2 bearer token
    const explicitToken = userAccessToken?.trim() || this.env.DEVELOPERKNOWLEDGE_ACCESS_TOKEN?.trim();
    if (explicitToken) {
      return {
        mode: 'token',
        headers: {
          Authorization: `Bearer ${explicitToken}`,
          ...(projectId ? { 'X-Goog-User-Project': projectId } : {}),
        },
        secrets: [explicitToken],
        projectId,
      };
    }

    // 3. Google Cloud ADC / Cloud Run metadata / Service Account / gcloud CLI
    if (this.hasLocalAdcCandidate()) {
      try {
        const creds = await resolveGoogleCredentials({
          projectId,
          env: this.env,
          fetch: this.fetchImpl,
        });
        const quotaProject = projectId || creds.quotaProject;
        return {
          mode: 'adc',
          headers: {
            Authorization: `Bearer ${creds.accessToken}`,
            ...(quotaProject ? { 'X-Goog-User-Project': quotaProject } : {}),
          },
          secrets: [creds.accessToken],
          projectId: quotaProject,
        };
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        const hint = this.setupHint(projectId);
        const err = new GoogleDocsMcpError(
          401,
          'auth-required',
          `Google Developer Knowledge MCP authentication failed (${detail}). ${hint}`,
          { setupHint: hint },
        );
        this.recordError(err);
        throw err;
      }
    }

    const hint = this.setupHint(projectId);
    const err = new GoogleDocsMcpError(
      401,
      'auth-required',
      `Official Google Developer Knowledge MCP (${this.endpoint}) is not configured yet. ${hint}`,
      { setupHint: hint },
    );
    this.recordError(err);
    throw err;
  }

  private recordSuccess(): void {
    this.lastVerifiedAt = this.now();
    this.lastHealthError = null;
  }

  private recordError(err: GoogleDocsMcpError): void {
    this.lastHealthError = {
      code: err.code,
      message: err.message,
      setupHint: err.opts.setupHint,
      enableUrl: err.opts.enableUrl,
    };
  }

  private classifyError(rawText: string, status: number | undefined, auth: ResolvedAuth): GoogleDocsMcpError {
    const clean = redactSecrets(rawText, auth.secrets).slice(0, 600);
    const project = auth.projectId;
    const enableUrlMatch = /https:\/\/console\.developers\.google\.com\/apis\/api\/developerknowledge\.googleapis\.com[^\s"']*/i.exec(clean);
    const enableUrl = enableUrlMatch?.[0];

    if (/has not been used in project|SERVICE_DISABLED|API has not been enabled|disabled\./i.test(clean) &&
        /developerknowledge|Developer Knowledge/i.test(clean)) {
      const projectFlag = project ? ` --project=${project}` : '';
      const setupHint = `Run \`gcloud services enable developerknowledge.googleapis.com${projectFlag}\`${enableUrl ? ` or open ${enableUrl}` : ''}, then retry.`;
      return new GoogleDocsMcpError(
        503,
        'api-disabled',
        `Google Developer Knowledge API is disabled${project ? ` in project ${project}` : ''}. ${setupHint}`,
        { setupHint, enableUrl },
      );
    }

    if (status === 401 || /UNAUTHENTICATED|API keys are not supported|invalid_rapt|invalid_grant|Invalid Credentials|API key not valid/i.test(clean)) {
      const setupHint = this.setupHint(project);
      return new GoogleDocsMcpError(
        401,
        'auth-required',
        `Google Developer Knowledge MCP rejected credentials: ${clean} ${setupHint}`,
        { setupHint },
      );
    }

    if (status === 403 || /PERMISSION_DENIED/i.test(clean)) {
      const setupHint = this.setupHint(project);
      return new GoogleDocsMcpError(
        403,
        'api-disabled',
        `Google Developer Knowledge MCP permission denied: ${clean} ${setupHint}`,
        { setupHint, enableUrl },
      );
    }

    if (status === 429 || /RESOURCE_EXHAUSTED|quota|rate limit|too many requests/i.test(clean)) {
      return new GoogleDocsMcpError(
        429,
        'quota',
        `Google Developer Knowledge MCP quota exceeded: ${clean}`,
      );
    }

    if (status === 400 || /INVALID_ARGUMENT/i.test(clean)) {
      return new GoogleDocsMcpError(
        400,
        'bad-request',
        `Invalid Google Developer Knowledge MCP request: ${clean}`,
      );
    }

    if (status === 503 || /UNAVAILABLE|temporarily unavailable/i.test(clean)) {
      return new GoogleDocsMcpError(
        503,
        'upstream',
        `Google Developer Knowledge MCP is temporarily unavailable: ${clean}`,
      );
    }

    return new GoogleDocsMcpError(
      status && status >= 400 && status < 600 ? status : 502,
      'upstream',
      `Google Developer Knowledge MCP error${status ? ` (${status})` : ''}: ${clean}`,
    );
  }

  /**
   * Calls an official MCP tool via `@modelcontextprotocol/sdk` `Client` +
   * `StreamableHTTPClientTransport`, with truncated exponential backoff + jitter
   * on retryable HTTP 429 / 503 errors (never retrying 400/401/403/404).
   */
  private async callMcpTool(
    toolName: (typeof OFFICIAL_MCP_TOOLS)[number],
    args: Record<string, unknown>,
    opts: { userAccessToken?: string | null; maxRetries?: number } = {},
  ): Promise<Record<string, unknown>> {
    const auth = await this.resolveAuth(opts.userAccessToken);
    const retries = opts.maxRetries ?? this.maxRetries;

    const customFetch: FetchLike = async (url, init) => {
      const mergedHeaders = new Headers(init?.headers);
      for (const [k, v] of Object.entries(auth.headers)) {
        mergedHeaders.set(k, v);
      }
      const timeoutSignal = AbortSignal.timeout(MCP_REQUEST_TIMEOUT_MS);
      const signal = init?.signal
        ? AbortSignal.any([init.signal, timeoutSignal])
        : timeoutSignal;
      return this.fetchImpl(url.toString(), {
        ...init,
        headers: mergedHeaders,
        signal,
      });
    };

    let lastErr: GoogleDocsMcpError | null = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const transport = new StreamableHTTPClientTransport(new URL(this.endpoint), {
        requestInit: { headers: auth.headers },
        fetch: customFetch,
      });
      const client = new Client(
        { name: 'voice-whiteboard-studio', version: '0.1.0' },
        { capabilities: {} },
      );

      try {
        await client.connect(transport);
        const raw = (await client.callTool({
          name: toolName,
          arguments: args,
        })) as RawMcpCallResult;

        if (raw.isError) {
          const text = raw.content?.map((c) => c.text).filter(Boolean).join(' ').trim() || 'MCP tool returned an error.';
          throw this.classifyError(text, undefined, auth);
        }

        this.recordSuccess();
        return parseStructuredPayload(raw);
      } catch (e) {
        const classified = e instanceof GoogleDocsMcpError
          ? e
          : (() => {
              const extracted = extractMcpErrorText(e);
              return this.classifyError(extracted.text, extracted.status, auth);
            })();
        lastErr = classified;

        const retryable = classified.status === 429 || (classified.status === 503 && classified.code === 'upstream');
        if (!retryable || attempt >= retries) {
          this.recordError(classified);
          this.log(`[google-docs-mcp] ${toolName} failed (${classified.code}): ${classified.message}`);
          throw classified;
        }

        const baseDelay = Math.min(this.maxDelayMs, this.initialDelayMs * Math.pow(2, attempt));
        const jitter = Math.floor(this.random() * 250);
        await this.sleep(baseDelay + jitter);
      } finally {
        await client.close().catch(() => undefined);
      }
    }

    throw lastErr ?? new GoogleDocsMcpError(502, 'upstream', 'Google Developer Knowledge MCP call failed.');
  }

  /**
   * Calls the official `search_documents` MCP tool.
   * Returns relevant snippets + authoritative `documents/...` names and `https://...` URIs.
   */
  async searchDocuments(
    query: string,
    opts: { limit?: number; bypassCache?: boolean; userAccessToken?: string | null } = {},
  ): Promise<GoogleDocsSearchResult> {
    const cleaned = query.trim();
    if (!cleaned) {
      throw new GoogleDocsMcpError(400, 'bad-request', 'Query must be a non-empty string.');
    }
    const limit = Math.max(1, Math.min(20, Math.floor(opts.limit ?? 10)));
    const cacheKey = cleaned.toLowerCase();

    if (!opts.bypassCache) {
      const hit = this.searchCache.get(cacheKey);
      if (hit) {
        return {
          query: cleaned,
          results: hit.slice(0, limit),
          cached: true,
          source: 'google-developer-knowledge-mcp',
        };
      }
    }

    const payload = await this.callMcpTool('search_documents', { query: cleaned }, { userAccessToken: opts.userAccessToken });
    const rawList = Array.isArray(payload.results) ? payload.results : [];
    const results: GoogleDocsSearchChunk[] = [];
    for (const item of rawList) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const parent = typeof rec.parent === 'string' ? rec.parent.trim() : '';
      const content = typeof rec.content === 'string' ? rec.content : '';
      if (!parent || !content) continue;
      results.push({
        parent,
        uri: docNameToUri(parent),
        id: typeof rec.id === 'string' ? rec.id : '',
        content,
      });
    }

    if (results.length > 0) {
      this.searchCache.set(cacheKey, results, SEARCH_CACHE_TTL_MS);
    }

    return {
      query: cleaned,
      results: results.slice(0, limit),
      cached: false,
      source: 'google-developer-knowledge-mcp',
    };
  }

  /**
   * Calls the official `get_documents` MCP tool (1–20 resource names per batch).
   * Serves cached documents immediately and fetches only uncached ones from Google.
   */
  async getDocuments(
    rawNames: readonly string[],
    opts: { maxCharsPerDoc?: number; userAccessToken?: string | null } = {},
  ): Promise<GoogleDocsGetResult> {
    if (!Array.isArray(rawNames) || rawNames.length === 0) {
      throw new GoogleDocsMcpError(400, 'bad-request', 'Provide at least one official Google document name (e.g. "documents/docs.cloud.google.com/...").');
    }
    if (rawNames.length > MAX_BATCH_DOCS) {
      throw new GoogleDocsMcpError(400, 'bad-request', `At most ${MAX_BATCH_DOCS} documents may be requested at once.`);
    }

    const normalized: string[] = [];
    const seen = new Set<string>();
    for (const raw of rawNames) {
      const name = normalizeDocName(raw);
      if (!name) {
        throw new GoogleDocsMcpError(
          400,
          'bad-request',
          `Invalid document resource name "${String(raw).slice(0, 120)}". Use a "documents/..." name returned by search_documents or answer_query.`,
        );
      }
      if (!seen.has(name)) {
        seen.add(name);
        normalized.push(name);
      }
    }

    const cachedPages = new Map<string, GoogleDocsPage>();
    const missing: string[] = [];
    for (const name of normalized) {
      const hit = this.docCache.get(name);
      if (hit) cachedPages.set(name, hit);
      else missing.push(name);
    }

    let fetchedCount = 0;
    if (missing.length > 0) {
      const payload = await this.callMcpTool('get_documents', { names: missing }, { userAccessToken: opts.userAccessToken });
      const rawDocs = Array.isArray(payload.documents) ? payload.documents : [];
      for (const item of rawDocs) {
        if (!item || typeof item !== 'object') continue;
        const rec = item as Record<string, unknown>;
        const name = typeof rec.name === 'string' ? rec.name.trim() : '';
        if (!name) continue;
        const page: GoogleDocsPage = {
          name,
          uri: typeof rec.uri === 'string' && rec.uri.trim() ? rec.uri.trim() : docNameToUri(name),
          title: typeof rec.title === 'string' && rec.title.trim() ? rec.title.trim() : name.split('/').pop() || name,
          content: typeof rec.content === 'string' ? rec.content : '',
        };
        this.docCache.set(name, page, DOC_CACHE_TTL_MS);
        cachedPages.set(name, page);
        fetchedCount++;
      }
    }

    const maxChars = opts.maxCharsPerDoc && opts.maxCharsPerDoc > 0 ? Math.floor(opts.maxCharsPerDoc) : undefined;
    const documents: GoogleDocsPage[] = normalized
      .map((name) => cachedPages.get(name))
      .filter((p): p is GoogleDocsPage => p != null)
      .map((p) => {
        if (maxChars && p.content.length > maxChars) {
          return {
            ...p,
            content: `${p.content.slice(0, maxChars)}\n\n…[truncated at ${maxChars} chars; full page at ${p.uri}]`,
            truncated: true,
          };
        }
        return p;
      });

    return {
      documents,
      cachedCount: normalized.length - missing.length,
      fetchedCount,
      source: 'google-developer-knowledge-mcp',
    };
  }

  /**
   * Calls the official `answer_query` MCP tool.
   * Per Google's error-handling guide, automatically falls back to `search_documents`
   * if `answer_query` hits HTTP 429 quota limits.
   */
  async answerQuery(
    query: string,
    opts: { userAccessToken?: string | null } = {},
  ): Promise<GoogleDocsAnswerResult> {
    const cleaned = query.trim();
    if (!cleaned) {
      throw new GoogleDocsMcpError(400, 'bad-request', 'Query must be a non-empty string.');
    }
    const cacheKey = cleaned.toLowerCase();
    const hit = this.answerCache.get(cacheKey);
    if (hit) {
      return { ...hit, cached: true };
    }

    try {
      const payload = await this.callMcpTool(
        'answer_query',
        { query: cleaned },
        { userAccessToken: opts.userAccessToken, maxRetries: 1 },
      );
      const answerText = typeof payload.answerText === 'string' ? payload.answerText : '';
      const rawRefs = Array.isArray(payload.references) ? payload.references : [];
      const references: GoogleDocsReference[] = [];
      const seen = new Set<string>();
      for (const r of rawRefs) {
        if (typeof r !== 'string' || !r.trim()) continue;
        const name = r.trim();
        if (seen.has(name)) continue;
        seen.add(name);
        references.push({ name, uri: docNameToUri(name) });
      }

      const result: GoogleDocsAnswerResult = {
        query: cleaned,
        answerText: answerText || null,
        references,
        cached: false,
        source: 'google-developer-knowledge-mcp',
      };
      if (answerText) {
        this.answerCache.set(cacheKey, result, ANSWER_CACHE_TTL_MS);
      }
      return result;
    } catch (e) {
      if (e instanceof GoogleDocsMcpError && e.code === 'quota') {
        // Official Google Developer Knowledge guidance: fall back to search_documents on 429
        const search = await this.searchDocuments(cleaned, { limit: 8, userAccessToken: opts.userAccessToken });
        const seen = new Set<string>();
        const references: GoogleDocsReference[] = [];
        for (const chunk of search.results) {
          if (seen.has(chunk.parent)) continue;
          seen.add(chunk.parent);
          references.push({ name: chunk.parent, uri: chunk.uri });
        }
        return {
          query: cleaned,
          answerText: null,
          references,
          results: search.results,
          fallback: 'search_documents',
          note: 'answer_query quota reached; fell back to official search_documents excerpts. Call get_google_docs on relevant parents for full pages.',
          cached: search.cached,
          source: 'google-developer-knowledge-mcp',
        };
      }
      throw e;
    }
  }
}
