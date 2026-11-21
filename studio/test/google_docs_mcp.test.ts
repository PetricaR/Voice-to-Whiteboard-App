/**
 * Tests for Official Google Developer Knowledge MCP integration:
 *   - server/googleDocsMcp.ts (real @modelcontextprotocol/sdk StreamableHTTPClientTransport over mocked JSON-RPC HTTP)
 *   - server/liveToken.ts (/api/docs/status, /api/docs/search, /api/docs/get, /api/docs/answer security & validation)
 *   - src/agent/dispatcher.ts (search_google_docs, get_google_docs, answer_google_docs tool calls)
 *   - src/engine/markdown.ts & book.ts (safe https:// official citation links)
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { handleToolCall } from '../src/agent/dispatcher';
import * as liveConfig from '../src/agent/liveConfig';
import { GoogleDocsClientError, type GoogleDocsClient } from '../src/data/googleDocsClient';
import { bookToStandaloneHtml } from '../src/engine/book';
import { parseInline, plainInline, safeHttpsUrl } from '../src/engine/markdown';
import { DiagramStore } from '../src/engine/store';
import {
  docNameToUri,
  GoogleDocsMcpError,
  GoogleDocsMcpService,
  normalizeDocName,
  OFFICIAL_DEVELOPER_KNOWLEDGE_MCP_URL,
} from '../server/googleDocsMcp';
import { liveTokenMiddleware, type LiveTokenOptions } from '../server/liveToken';

const SECRET_API_KEY = 'AIzaSy-DevKnowledge-Secret-999999';
const SECRET_TOKEN = 'ya29.test-oauth-bearer-token-secret';

/**
 * Builds a mock `fetch` implementing the Streamable HTTP MCP JSON-RPC protocol
 * (`initialize`, `notifications/initialized`, `tools/call`) so tests exercise the
 * real `@modelcontextprotocol/sdk` Client + StreamableHTTPClientTransport wire layer.
 */
function createMockMcpFetch(
  onToolCall: (name: string, args: Record<string, unknown>, req: { url: string; headers: Headers }) =>
    Promise<Response | { structuredContent?: unknown; content?: unknown; isError?: boolean }> |
    Response |
    { structuredContent?: unknown; content?: unknown; isError?: boolean },
) {
  const seenRequests: { url: string; method: string; headers: Headers; rpcMethod?: string }[] = [];

  const mockFetch = vi.fn<typeof fetch>(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers);

    if (method === 'DELETE') {
      seenRequests.push({ url, method, headers });
      return new Response(null, { status: 204 });
    }

    const bodyText = typeof init?.body === 'string' ? init.body : '';
    const rpc = bodyText ? (JSON.parse(bodyText) as { id?: number; method?: string; params?: any }) : {};
    seenRequests.push({ url, method, headers, rpcMethod: rpc.method });

    if (rpc.method === 'initialize') {
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: rpc.id,
        result: {
          protocolVersion: '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: { name: 'developer-knowledge-mcp', version: '1.0.0' },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'mcp-session-id': 'mock-session-1' },
      });
    }

    if (rpc.method === 'notifications/initialized') {
      return new Response(null, { status: 202 });
    }

    if (rpc.method === 'tools/call') {
      const toolName = String(rpc.params?.name ?? '');
      const toolArgs = (rpc.params?.arguments ?? {}) as Record<string, unknown>;
      const outcome = await onToolCall(toolName, toolArgs, { url, headers });
      if (outcome instanceof Response) return outcome;
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: rpc.id,
        result: {
          content: outcome.content ?? [{ type: 'text', text: JSON.stringify(outcome.structuredContent ?? {}) }],
          ...(outcome.structuredContent !== undefined ? { structuredContent: outcome.structuredContent } : {}),
          ...(outcome.isError ? { isError: true } : {}),
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, error: { code: -32601, message: 'Method not found' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  return { mockFetch, seenRequests };
}

describe('Google Developer Knowledge MCP helpers', () => {
  it('converts document names to canonical HTTPS URIs and validates resource names safely', () => {
    expect(docNameToUri('documents/docs.cloud.google.com/run/docs/configuring/concurrency'))
      .toBe('https://docs.cloud.google.com/run/docs/configuring/concurrency');

    expect(normalizeDocName('documents/docs.cloud.google.com/alloydb/docs/ai/perform-vector-search/'))
      .toBe('documents/docs.cloud.google.com/alloydb/docs/ai/perform-vector-search');
    expect(normalizeDocName('https://ai.google.dev/gemini-api/docs/function-calling/'))
      .toBe('documents/ai.google.dev/gemini-api/docs/function-calling');

    // Rejects traversal, unsafe schemes, query strings, whitespace, and malformed names
    expect(normalizeDocName('documents/docs.cloud.google.com/../../etc/passwd')).toBeNull();
    expect(normalizeDocName('http://docs.cloud.google.com/run')).toBeNull();
    expect(normalizeDocName('javascript:alert(1)')).toBeNull();
    expect(normalizeDocName('documents/localhost/secret')).toBeNull();
    expect(normalizeDocName('documents/docs.cloud.google.com/run?key=123')).toBeNull();
    expect(normalizeDocName('')).toBeNull();
  });
});

describe('GoogleDocsMcpService (official Streamable HTTP MCP protocol)', () => {
  it('sends X-Goog-Api-Key header (never in URL query) and caches search_documents results', async () => {
    let toolCalls = 0;
    const { mockFetch, seenRequests } = createMockMcpFetch((name, args) => {
      toolCalls++;
      expect(name).toBe('search_documents');
      expect(args).toEqual({ query: 'Cloud Run concurrency' });
      return {
        structuredContent: {
          results: [
            {
              parent: 'documents/docs.cloud.google.com/run/docs/configuring/concurrency',
              id: 'chunk-1',
              content: 'By default, each Cloud Run container instance can receive up to 80 concurrent requests.',
            },
          ],
        },
      };
    });

    const svc = new GoogleDocsMcpService({
      env: { DEVELOPERKNOWLEDGE_API_KEY: SECRET_API_KEY },
      fetch: mockFetch,
      allowLocalAuth: false,
      sleep: async () => undefined,
    });

    const st = await svc.status();
    expect(st.configured).toBe(true);
    expect(st.authMode).toBe('api-key');
    expect(st.endpoint).toBe(OFFICIAL_DEVELOPER_KNOWLEDGE_MCP_URL);

    const first = await svc.searchDocuments('Cloud Run concurrency');
    expect(first.cached).toBe(false);
    expect(first.results).toHaveLength(1);
    expect(first.results[0].uri).toBe('https://docs.cloud.google.com/run/docs/configuring/concurrency');
    expect(toolCalls).toBe(1);

    // Every outbound request sends X-Goog-Api-Key header and NEVER puts the key in the URL
    for (const req of seenRequests) {
      expect(req.url).toBe(OFFICIAL_DEVELOPER_KNOWLEDGE_MCP_URL);
      expect(req.url).not.toContain(SECRET_API_KEY);
      expect(req.headers.get('x-goog-api-key')).toBe(SECRET_API_KEY);
    }

    // Second identical search hits in-memory TTL cache without calling MCP again
    const second = await svc.searchDocuments('  cloud run concurrency  ');
    expect(second.cached).toBe(true);
    expect(second.results).toEqual(first.results);
    expect(toolCalls).toBe(1);
  });

  it('dynamically picks up DEVELOPERKNOWLEDGE_API_KEY from studio/.env without restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'studio-docs-env-'));
    try {
      const { mockFetch } = createMockMcpFetch(() => ({
        structuredContent: {
          results: [{ parent: 'documents/firebase.google.com/docs/firestore', id: '1', content: 'Firestore guide.' }],
        },
      }));

      const svc = new GoogleDocsMcpService({
        root: dir,
        env: {},
        fetch: mockFetch,
        allowLocalAuth: false,
        sleep: async () => undefined,
      });

      expect((await svc.status()).configured).toBe(false);

      // User adds DEVELOPERKNOWLEDGE_API_KEY to .env while server is running
      writeFileSync(join(dir, '.env'), `DEVELOPERKNOWLEDGE_API_KEY=${SECRET_API_KEY}\n`);
      expect((await svc.status()).configured).toBe(true);

      const res = await svc.searchDocuments('Firestore transactions');
      expect(res.results[0].uri).toBe('https://firebase.google.com/docs/firestore');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sends Authorization Bearer + X-Goog-User-Project for token auth, batches & caches get_documents', async () => {
    const requestedBatches: string[][] = [];
    const { mockFetch, seenRequests } = createMockMcpFetch((name, args) => {
      expect(name).toBe('get_documents');
      const names = args.names as string[];
      requestedBatches.push(names);
      return {
        structuredContent: {
          documents: names.map((n) => ({
            name: n,
            uri: docNameToUri(n),
            title: `Title for ${n.split('/').pop()}`,
            content: 'Official Markdown content '.repeat(30),
          })),
        },
      };
    });

    const svc = new GoogleDocsMcpService({
      env: {
        DEVELOPERKNOWLEDGE_ACCESS_TOKEN: SECRET_TOKEN,
        DEVELOPERKNOWLEDGE_PROJECT_ID: 'my-gcp-project',
      },
      fetch: mockFetch,
      allowLocalAuth: false,
      sleep: async () => undefined,
    });

    // First call fetches 2 docs (normalizing https:// URL and deduplicating)
    const r1 = await svc.getDocuments([
      'documents/docs.cloud.google.com/run/docs/configuring/concurrency',
      'https://docs.cloud.google.com/alloydb/docs/ai/perform-vector-search',
      'documents/docs.cloud.google.com/run/docs/configuring/concurrency',
    ], { maxCharsPerDoc: 120 });

    expect(r1.fetchedCount).toBe(2);
    expect(r1.cachedCount).toBe(0);
    expect(r1.documents).toHaveLength(2);
    expect(r1.documents[0].truncated).toBe(true);
    expect(r1.documents[0].content).toContain('truncated at 120 chars');
    expect(requestedBatches).toEqual([[
      'documents/docs.cloud.google.com/run/docs/configuring/concurrency',
      'documents/docs.cloud.google.com/alloydb/docs/ai/perform-vector-search',
    ]]);

    const toolReq = seenRequests.find((r) => r.rpcMethod === 'tools/call');
    expect(toolReq?.headers.get('authorization')).toBe(`Bearer ${SECRET_TOKEN}`);
    expect(toolReq?.headers.get('x-goog-user-project')).toBe('my-gcp-project');

    // Second call requests 1 cached doc + 1 new doc → only fetches the new doc!
    const r2 = await svc.getDocuments([
      'documents/docs.cloud.google.com/run/docs/configuring/concurrency',
      'documents/docs.cloud.google.com/pubsub/docs/handling-failures',
    ]);
    expect(r2.cachedCount).toBe(1);
    expect(r2.fetchedCount).toBe(1);
    expect(requestedBatches[1]).toEqual(['documents/docs.cloud.google.com/pubsub/docs/handling-failures']);
  });

  it('automatically falls back from answer_query to search_documents on HTTP 429 quota limit', async () => {
    const calls: string[] = [];
    const { mockFetch } = createMockMcpFetch((name) => {
      calls.push(name);
      if (name === 'answer_query') {
        return new Response(JSON.stringify({ error: { message: 'Quota exceeded (RESOURCE_EXHAUSTED)' } }), { status: 429 });
      }
      return {
        structuredContent: {
          results: [
            {
              parent: 'documents/docs.cloud.google.com/tasks/docs/creating-http-target-tasks',
              id: 'c1',
              content: 'Cloud Tasks attaches an OIDC token signed by Google to HTTP target requests.',
            },
          ],
        },
      };
    });

    const svc = new GoogleDocsMcpService({
      env: { DEVELOPERKNOWLEDGE_API_KEY: SECRET_API_KEY },
      fetch: mockFetch,
      allowLocalAuth: false,
      sleep: async () => undefined,
      random: () => 0,
    });

    const res = await svc.answerQuery('How does Cloud Tasks verify OIDC tokens?');
    expect(res.fallback).toBe('search_documents');
    expect(res.answerText).toBeNull();
    expect(res.results).toHaveLength(1);
    expect(res.references).toEqual([{
      name: 'documents/docs.cloud.google.com/tasks/docs/creating-http-target-tasks',
      uri: 'https://docs.cloud.google.com/tasks/docs/creating-http-target-tasks',
    }]);
    expect(calls).toContain('answer_query');
    expect(calls).toContain('search_documents');
  });

  it('retries HTTP 503 with exponential backoff and does NOT retry HTTP 401 or disabled-API errors', async () => {
    const sleeps: number[] = [];
    let attempt = 0;
    const { mockFetch } = createMockMcpFetch(() => {
      attempt++;
      if (attempt < 3) {
        return new Response('Service Unavailable', { status: 503 });
      }
      return {
        structuredContent: {
          results: [{ parent: 'documents/docs.cloud.google.com/spanner/docs/overview', id: '1', content: 'Spanner.' }],
        },
      };
    });

    const svc = new GoogleDocsMcpService({
      env: { DEVELOPERKNOWLEDGE_API_KEY: SECRET_API_KEY },
      fetch: mockFetch,
      allowLocalAuth: false,
      sleep: async (ms) => { sleeps.push(ms); },
      random: () => 0.5,
      initialDelayMs: 200,
    });

    const ok = await svc.searchDocuments('Cloud Spanner overview');
    expect(ok.results).toHaveLength(1);
    expect(attempt).toBe(3);
    expect(sleeps).toEqual([200 + 125, 400 + 125]);

    // Now test disabled-API JSON-RPC error: must NOT retry and must surface enableUrl + gcloud hint + redact secrets
    let disabledCalls = 0;
    const { mockFetch: disabledFetch } = createMockMcpFetch(() => {
      disabledCalls++;
      return new Response(JSON.stringify({
        id: 1,
        jsonrpc: '2.0',
        result: {
          isError: true,
          content: [{
            type: 'text',
            text: `Developer Knowledge API has not been used in project demo-proj before or it is disabled (key ${SECRET_API_KEY}). Enable it by visiting https://console.developers.google.com/apis/api/developerknowledge.googleapis.com/overview?project=demo-proj then retry.`,
          }],
        },
      }), { status: 403, headers: { 'content-type': 'application/json' } });
    });

    const svc2 = new GoogleDocsMcpService({
      env: { DEVELOPERKNOWLEDGE_API_KEY: SECRET_API_KEY, DEVELOPERKNOWLEDGE_PROJECT_ID: 'demo-proj' },
      fetch: disabledFetch,
      allowLocalAuth: false,
      sleep: async () => undefined,
      log: () => undefined,
    });

    let caught: unknown;
    try {
      await svc2.searchDocuments('Cloud Run');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GoogleDocsMcpError);
    const err = caught as GoogleDocsMcpError;
    expect(err.code).toBe('api-disabled');
    expect(err.message).not.toContain(SECRET_API_KEY);
    expect(err.opts.enableUrl).toBe('https://console.developers.google.com/apis/api/developerknowledge.googleapis.com/overview?project=demo-proj');
    expect(err.opts.setupHint).toContain('gcloud services enable developerknowledge.googleapis.com --project=demo-proj');
    expect(disabledCalls).toBe(1);
  });
});

describe('/api/docs/* HTTP endpoints (security & routing)', () => {
  let server: Server;
  let port = 0;
  let handler: ReturnType<typeof liveTokenMiddleware>;

  function mount(opts: Partial<LiveTokenOptions> = {}) {
    handler = liveTokenMiddleware({
      getApiKey: () => 'AIzaSy-live-key',
      loadConfig: async () => liveConfig,
      log: () => undefined,
      ...opts,
    });
  }

  function call(method: string, path: string, opts: { headers?: Record<string, string>; body?: string } = {}): Promise<{ status: number; body: any; text: string }> {
    return new Promise((resolve, reject) => {
      const req = request({
        host: '127.0.0.1', port, method, path,
        headers: { host: `127.0.0.1:${port}`, ...opts.headers },
      }, (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { text += c; });
        res.on('end', () => {
          let body: any = null;
          try { body = JSON.parse(text); } catch { /* not JSON */ }
          resolve({ status: res.statusCode ?? 0, body, text });
        });
      });
      req.on('error', reject);
      req.end(opts.body);
    });
  }

  beforeAll(async () => {
    mount();
    server = createServer((req, res) => handler(req, res, () => {
      res.statusCode = 404;
      res.end('next');
    }));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('serves /api/docs/status, /search, /get, /answer and never leaks the API key', async () => {
    const { mockFetch } = createMockMcpFetch((name, args) => {
      if (name === 'search_documents') {
        return {
          structuredContent: {
            results: [{ parent: 'documents/docs.cloud.google.com/run/docs/overview', id: '1', content: 'Cloud Run is a managed compute platform.' }],
          },
        };
      }
      if (name === 'get_documents') {
        return {
          structuredContent: {
            documents: [{ name: (args.names as string[])[0], uri: 'https://docs.cloud.google.com/run/docs/overview', title: 'Cloud Run overview', content: '# Cloud Run\nServerless containers.' }],
          },
        };
      }
      return {
        structuredContent: {
          answerText: 'Cloud Run scales container instances automatically.',
          references: ['documents/docs.cloud.google.com/run/docs/overview'],
        },
      };
    });

    const docsMcp = new GoogleDocsMcpService({
      env: { DEVELOPERKNOWLEDGE_API_KEY: SECRET_API_KEY, DEVELOPERKNOWLEDGE_PROJECT_ID: 'proj-1' },
      fetch: mockFetch,
      allowLocalAuth: false,
      sleep: async () => undefined,
    });
    mount({ docsMcp });

    const st = await call('GET', '/api/docs/status');
    expect(st.status).toBe(200);
    expect(st.body.configured).toBe(true);
    expect(st.body.authMode).toBe('api-key');
    expect(st.text).not.toContain(SECRET_API_KEY);

    const headers = {
      'content-type': 'application/json',
      origin: `http://127.0.0.1:${port}`,
      'sec-fetch-site': 'same-origin',
    };

    const searchRes = await call('POST', '/api/docs/search', { headers, body: JSON.stringify({ query: 'Cloud Run' }) });
    expect(searchRes.status).toBe(200);
    expect(searchRes.body.results[0].uri).toBe('https://docs.cloud.google.com/run/docs/overview');

    const getRes = await call('POST', '/api/docs/get', {
      headers,
      body: JSON.stringify({ names: ['documents/docs.cloud.google.com/run/docs/overview'] }),
    });
    expect(getRes.status).toBe(200);
    expect(getRes.body.documents[0].title).toBe('Cloud Run overview');

    const ansRes = await call('POST', '/api/docs/answer', { headers, body: JSON.stringify({ query: 'How does Cloud Run scale?' }) });
    expect(ansRes.status).toBe(200);
    expect(ansRes.body.answerText).toContain('Cloud Run');
    expect(ansRes.body.references[0].uri).toBe('https://docs.cloud.google.com/run/docs/overview');

    // Cross-origin request is rejected
    const evil = await call('POST', '/api/docs/search', {
      headers: { 'content-type': 'application/json', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
      body: JSON.stringify({ query: 'Cloud Run' }),
    });
    expect(evil.status).toBe(403);
  });

  it('enforces sign-in on deployments (requireSignIn: true) and hides internal projectId when signed out', async () => {
    const docsMcp = new GoogleDocsMcpService({
      env: { DEVELOPERKNOWLEDGE_API_KEY: SECRET_API_KEY, DEVELOPERKNOWLEDGE_PROJECT_ID: 'internal-secret-proj' },
      fetch: createMockMcpFetch(() => ({ structuredContent: { results: [] } })).mockFetch,
      allowLocalAuth: false,
    });
    mount({
      docsMcp,
      requireSignIn: true,
      auth: { userOf: async () => null } as any,
      usage: {} as any,
    });

    const st = await call('GET', '/api/docs/status');
    expect(st.status).toBe(200);
    expect(st.body.configured).toBe(true);
    expect(st.body.projectId).toBeUndefined();
    expect(st.text).not.toContain('internal-secret-proj');

    const verify = await call('GET', '/api/docs/status?verify=1');
    expect(verify.status).toBe(401);

    const search = await call('POST', '/api/docs/search', {
      headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}`, 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({ query: 'Cloud Run' }),
    });
    expect(search.status).toBe(401);
  });
});

describe('Agent dispatcher official Google Docs MCP tools', () => {
  it('routes search_google_docs, get_google_docs, and answer_google_docs and reports actionable setup errors honestly', async () => {
    const store = new DiagramStore();
    const mockClient: GoogleDocsClient = {
      status: async () => ({
        configured: true, verified: true, authMode: 'api-key', endpoint: OFFICIAL_DEVELOPER_KNOWLEDGE_MCP_URL, tools: ['search_documents', 'get_documents', 'answer_query'],
      }),
      search: async (query) => ({
        query,
        cached: false,
        source: 'google-developer-knowledge-mcp',
        results: [{
          parent: 'documents/docs.cloud.google.com/alloydb/docs/ai/perform-vector-search',
          uri: 'https://docs.cloud.google.com/alloydb/docs/ai/perform-vector-search',
          id: 'c1',
          content: 'Use ScaNN indexes with alloydb_scann for filtered vector search.',
        }],
      }),
      getDocuments: async (names) => ({
        cachedCount: 0,
        fetchedCount: names.length,
        source: 'google-developer-knowledge-mcp',
        documents: [{
          name: names[0],
          uri: docNameToUri(names[0]),
          title: 'Perform vector search in AlloyDB',
          content: 'CREATE INDEX ON items USING scann (embedding cosine) WITH (num_leaves=50);',
        }],
      }),
      answer: async () => {
        throw new GoogleDocsClientError(
          503,
          'api-disabled',
          'Google Developer Knowledge API is disabled in project demo.',
          'Run `gcloud services enable developerknowledge.googleapis.com --project=demo`.',
          'https://console.developers.google.com/apis/api/developerknowledge.googleapis.com/overview?project=demo',
        );
      },
    };

    const s = await handleToolCall('search_google_docs', { query: 'AlloyDB ScaNN index' }, {
      store, source: 'voice', googleDocs: mockClient,
    });
    expect(s.ok).toBe(true);
    expect((s.results as any[])[0].uri).toBe('https://docs.cloud.google.com/alloydb/docs/ai/perform-vector-search');

    const g = await handleToolCall('get_google_docs', {
      names: ['documents/docs.cloud.google.com/alloydb/docs/ai/perform-vector-search'],
    }, { store, source: 'voice', googleDocs: mockClient });
    expect(g.ok).toBe(true);
    expect((g.documents as any[])[0].content).toContain('USING scann');

    const a = await handleToolCall('answer_google_docs', { query: 'AlloyDB ScaNN tuning' }, {
      store, source: 'voice', googleDocs: mockClient,
    });
    expect(a.ok).toBe(false);
    expect(a.errorCode).toBe('api-disabled');
    expect(String(a.setupHint)).toContain('gcloud services enable developerknowledge.googleapis.com');
    expect(String(a.note)).toContain('Do NOT fabricate');
  });
});

describe('Safe clickable HTTPS citation links in Markdown & HTML export', () => {
  it('parses official https:// links, preserves URL underscores, and blocks javascript:/data:/http:', () => {
    expect(safeHttpsUrl('https://docs.cloud.google.com/run/docs/configuring/concurrency'))
      .toBe('https://docs.cloud.google.com/run/docs/configuring/concurrency');
    expect(safeHttpsUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpsUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(safeHttpsUrl('http://example.com')).toBeNull();

    const spans = parseInline(
      'See [Cloud Run Concurrency](https://docs.cloud.google.com/run/docs/configuring/concurrency) and https://docs.cloud.google.com/sql/docs/row_level_security.',
    );
    expect(spans).toEqual([
      { text: 'See ' },
      { text: 'Cloud Run Concurrency', href: 'https://docs.cloud.google.com/run/docs/configuring/concurrency' },
      { text: ' and ' },
      { text: 'https://docs.cloud.google.com/sql/docs/row_level_security', href: 'https://docs.cloud.google.com/sql/docs/row_level_security' },
      { text: '.' },
    ]);
    expect(plainInline('[Cloud Run Concurrency](https://docs.cloud.google.com/run/docs/configuring/concurrency)'))
      .toBe('Cloud Run Concurrency');

    const unsafe = parseInline('[Click me](javascript:alert(1))');
    expect(unsafe).toEqual([{ text: 'Click me' }]);
    expect(unsafe[0].href).toBeUndefined();

    const store = new DiagramStore();
    store.edit({
      write_blocks: [{
        id: 'references',
        kind: 'table',
        title: 'Official Google Documentation References',
        columns: ['Topic', 'Official Source'],
        rows: [['Cloud Run', '[Cloud Run Concurrency](https://docs.cloud.google.com/run/docs/configuring/concurrency)']],
      }],
    }, { source: 'manual' });
    const html = bookToStandaloneHtml(store.scene);
    expect(html).toContain('<a href="https://docs.cloud.google.com/run/docs/configuring/concurrency" target="_blank" rel="noopener noreferrer">Cloud Run Concurrency</a>');
  });
});
