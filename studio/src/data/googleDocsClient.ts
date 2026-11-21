/**
 * Browser client for the studio server's Official Google Developer Knowledge MCP proxy (`/api/docs/*`).
 *
 * Credentials (DEVELOPERKNOWLEDGE_API_KEY, ADC, service account) stay strictly on the server;
 * this client only calls same-origin `/api/docs/*` routes.
 */
import { getSessionGcpToken } from './bqCatalogClient';

export type DocsAuthMode = 'api-key' | 'token' | 'adc' | 'none';
export type DocsErrorCode = 'auth-required' | 'api-disabled' | 'quota' | 'bad-request' | 'upstream' | 'signed-out' | 'rate-limit' | 'network';

export interface GoogleDocsSearchChunk {
  parent: string;
  uri: string;
  id: string;
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

export class GoogleDocsClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: DocsErrorCode,
    message: string,
    readonly setupHint?: string,
    readonly enableUrl?: string,
  ) {
    super(message);
    this.name = 'GoogleDocsClientError';
  }
}

export interface GoogleDocsClient {
  status(opts?: { verify?: boolean }): Promise<GoogleDocsMcpStatus>;
  search(query: string, limit?: number): Promise<GoogleDocsSearchResult>;
  getDocuments(names: string[], maxCharsPerDoc?: number): Promise<GoogleDocsGetResult>;
  answer(query: string): Promise<GoogleDocsAnswerResult>;
}

function requestHeaders(hasBody: boolean): Record<string, string> {
  const headers: Record<string, string> = {};
  if (hasBody) headers['Content-Type'] = 'application/json';
  const gcpToken = getSessionGcpToken();
  if (gcpToken) headers['X-GCP-Access-Token'] = gcpToken;
  return headers;
}

async function callJson<T>(url: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      credentials: 'same-origin',
      ...init,
    });
  } catch (e) {
    throw new GoogleDocsClientError(
      0,
      'network',
      `Could not reach the studio server for official Google documentation (${e instanceof Error ? e.message : String(e)}).`,
    );
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const code = (typeof body?.error === 'string' ? body.error : 'upstream') as DocsErrorCode;
    const message = typeof body?.message === 'string'
      ? body.message
      : `Official Google documentation request failed (HTTP ${res.status}).`;
    const setupHint = typeof body?.setupHint === 'string' ? body.setupHint : undefined;
    const enableUrl = typeof body?.enableUrl === 'string' ? body.enableUrl : undefined;
    throw new GoogleDocsClientError(res.status, code, message, setupHint, enableUrl);
  }
  return body as T;
}

export const googleDocsApi: GoogleDocsClient = {
  status(opts: { verify?: boolean } = {}): Promise<GoogleDocsMcpStatus> {
    const qs = opts.verify ? '?verify=1' : '';
    return callJson<GoogleDocsMcpStatus>(`/api/docs/status${qs}`, {
      method: 'GET',
      headers: requestHeaders(false),
    });
  },

  search(query: string, limit?: number): Promise<GoogleDocsSearchResult> {
    return callJson<GoogleDocsSearchResult>('/api/docs/search', {
      method: 'POST',
      headers: requestHeaders(true),
      body: JSON.stringify({ query, ...(limit != null ? { limit } : {}) }),
    });
  },

  getDocuments(names: string[], maxCharsPerDoc?: number): Promise<GoogleDocsGetResult> {
    return callJson<GoogleDocsGetResult>('/api/docs/get', {
      method: 'POST',
      headers: requestHeaders(true),
      body: JSON.stringify({ names, ...(maxCharsPerDoc != null ? { maxCharsPerDoc } : {}) }),
    });
  },

  answer(query: string): Promise<GoogleDocsAnswerResult> {
    return callJson<GoogleDocsAnswerResult>('/api/docs/answer', {
      method: 'POST',
      headers: requestHeaders(true),
      body: JSON.stringify({ query }),
    });
  },
};
