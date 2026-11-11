/**
 * Production HTTP server (e.g. Google Cloud Run): serves the built app in
 * `dist/` with a Content-Security-Policy and mounts `liveTokenMiddleware` at
 * `/api/live/*` so the Gemini API key stays on the server.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import * as liveConfig from '../src/agent/liveConfig.ts';
import { accessFromEnv } from './access.ts';
import { loadDotEnvDefaults, readApiKey } from './apiKey.ts';
import { liveTokenMiddleware, type LiveTokenOptions } from './liveToken.ts';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** Google Identity Services ("Sign in with Google") needs its script, styles, frames and endpoints. */
const GSI = 'https://accounts.google.com/gsi/';

/** `local` also allows WebSockets to loopback, for a Live API mock or proxy during development and tests. */
export const contentSecurityPolicy = (local: boolean) => [
  "default-src 'self'",
  `script-src 'self' 'wasm-unsafe-eval' blob: ${GSI}client`,
  "worker-src 'self' blob:",
  `style-src 'self' 'unsafe-inline' ${GSI}style`,
  // Google account pictures + uploaded assets
  "img-src 'self' data: blob: https://*.googleusercontent.com",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' wss://generativelanguage.googleapis.com https://generativelanguage.googleapis.com ${GSI}${local ? ' ws://127.0.0.1:* ws://localhost:*' : ''}`,
  `frame-src ${GSI}`,
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join('; ');

export const CONTENT_SECURITY_POLICY = contentSecurityPolicy(true);

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.csv': 'text/csv; charset=utf-8',
  '.parquet': 'application/octet-stream',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8',
};

/** Text formats worth compressing (the app's scripts shrink to about a quarter). */
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.map', '.svg', '.txt', '.csv', '.wasm']);
const gzipAsync = promisify(gzip);
const MAX_GZIP_CACHE_BYTES = 64 * 1024 * 1024;
const gzipCache = new Map<string, Promise<Buffer>>();
let gzipCacheBytes = 0;

/** The gzipped file, compressed once per version of the file and kept in memory. */
function gzipped(filePath: string, mtimeMs: number): Promise<Buffer> {
  const key = `${filePath}:${mtimeMs}`;
  let entry = gzipCache.get(key);
  if (entry == null) {
    entry = readFile(filePath).then((raw) => gzipAsync(raw, { level: 9 }));
    if (gzipCacheBytes < MAX_GZIP_CACHE_BYTES) {
      gzipCache.set(key, entry);
      entry.then((buf) => { gzipCacheBytes += buf.length; }, () => gzipCache.delete(key));
    }
  }
  return entry;
}

const list = (value: string | undefined) => value?.split(',').map((s) => s.trim()).filter(Boolean);

export interface StudioServerOptions extends Partial<LiveTokenOptions> {
  root?: string;
  distDir?: string;
}

export function createStudioServer(opts: StudioServerOptions = {}): Server {
  const root = opts.root ?? ROOT;
  loadDotEnvDefaults(root);
  const distDir = resolve(opts.distDir ?? join(root, 'dist'));
  const onCloudRun = Boolean(process.env.K_SERVICE);
  const envHosts = list(process.env.STUDIO_ALLOWED_HOSTS);
  const csp = contentSecurityPolicy(!onCloudRun);
  let key = '';

  const tokenHandler = liveTokenMiddleware({
    getApiKey: opts.getApiKey ?? (() => key || (key = readApiKey(root))),
    onKeyRejected: opts.onKeyRejected ?? (() => { key = ''; }),
    loadConfig: opts.loadConfig ?? (async () => liveConfig),
    models: opts.models ?? list(process.env.STUDIO_LIVE_MODELS),
    allowedHosts: opts.allowedHosts ?? (envHosts?.length ? envHosts : onCloudRun ? ['.run.app'] : undefined),
    trustProxy: opts.trustProxy ?? trustProxyFromEnv(onCloudRun),
    rateLimit: opts.rateLimit,
    // Fail closed: a deployment without sign-in configured issues no tokens
    requireSignIn: opts.requireSignIn ?? onCloudRun,
    auth: opts.auth,
    usage: opts.usage,
    connectorEnv: opts.connectorEnv,
    bqCatalog: opts.bqCatalog,
    bqPersistPath: opts.bqPersistPath ?? (onCloudRun ? undefined : join(root, '.bq-catalog.local')),
    fetch: opts.fetch,
    log: opts.log,
    now: opts.now,
  });

  return createServer((req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    // Cloud Run terminates TLS in front of the server; never fall back to http there
    if (onCloudRun) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

    const rawPath = (req.url ?? '/').split('?')[0];
    if (rawPath === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    tokenHandler(req, res, () => {
      // An API path nobody handles is an error, not the app's page
      if (rawPath === '/api' || rawPath.startsWith('/api/')) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: 'not-found', message: 'Not found.' }));
        return;
      }
      serveStatic(req, res, distDir, rawPath);
    });
  });
}

/** Cloud Run's front end appends one X-Forwarded-For entry; TRUST_PROXY=n for n proxies (e.g. a load balancer in front: 2). */
function trustProxyFromEnv(onCloudRun: boolean): number {
  const v = process.env.TRUST_PROXY?.trim();
  if (v === 'true') return 1;
  if (v != null && v !== '' && Number.isInteger(Number(v))) return Number(v);
  return onCloudRun ? 1 : 0;
}

function serveStatic(req: IncomingMessage, res: ServerResponse, distDir: string, rawPath: string) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' });
    res.end('Method Not Allowed');
    return;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad Request');
    return;
  }
  const relPath = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const candidate = resolve(distDir, relPath);
  if (candidate !== distDir && !candidate.startsWith(distDir + sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  let filePath = candidate;
  if (!isRegularFile(filePath)) {
    // Serve static .html pages (e.g. /privacy -> privacy.html, /terms -> terms.html) or SPA fallback
    if (!extname(relPath)) {
      const htmlCandidate = `${candidate}.html`;
      filePath = isRegularFile(htmlCandidate) ? htmlCandidate : join(distDir, 'index.html');
    }
    if (!isRegularFile(filePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
  }

  const ext = extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
  const cacheControl = filePath.endsWith(`${sep}index.html`)
    ? 'no-cache'
    : relPath.startsWith('assets/')
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=3600';

  const stat = statSync(filePath);
  if (COMPRESSIBLE.has(ext) && stat.size > 1024 && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
    gzipped(filePath, stat.mtimeMs).then((body) => {
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Encoding': 'gzip',
        'Content-Length': body.length,
        'Cache-Control': cacheControl,
        Vary: 'Accept-Encoding',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    }, () => {
      if (!res.headersSent) res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end();
    });
    return;
  }
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': stat.size,
    'Cache-Control': cacheControl,
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = createReadStream(filePath);
  stream.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    res.end();
  });
  stream.pipe(res);
}

function isRegularFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 8080);
  const host = process.env.HOST ?? '0.0.0.0';
  const access = await accessFromEnv(process.env, { onCloudRun: Boolean(process.env.K_SERVICE) });
  const server = createStudioServer(access);
  server.listen(port, host, () => {
    console.log(`Voice Whiteboard Studio listening on http://${host}:${port}`);
  });
  // Cloud Run sends SIGTERM before it stops an instance: finish the requests in flight
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      server.close(() => process.exit(0));
      server.closeIdleConnections();
      setTimeout(() => process.exit(0), 8000).unref();
    });
  }
}
