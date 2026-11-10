/**
 * Where the studio server finds the Gemini API key, in this order:
 *   1. GEMINI_API_KEY in the process environment (CI; Cloud Run with Secret Manager; explicit shell override)
 *   2. GEMINI_API_KEY=... in .env (studio/.env or repo-root .env, then .env.local) — loaded by default
 *   3. the macOS Keychain fallback, saved by `./studio.sh key`
 *      (service "voice-whiteboard-studio", falling back to "voice-diagram-studio", account "GEMINI_API_KEY")
 * The key is only ever read here, on the server; it is never sent to the browser.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const KEYCHAIN_SERVICE = 'voice-whiteboard-studio';
export const LEGACY_KEYCHAIN_SERVICE = 'voice-diagram-studio';
export const KEYCHAIN_ACCOUNT = 'GEMINI_API_KEY';

const ENV_FILENAMES = ['.env', '.env.local'] as const;

export function candidateEnvFiles(root: string): string[] {
  const studioDir = resolve(root);
  const repoRoot = resolve(studioDir, '..');
  const dirs = repoRoot === studioDir ? [studioDir] : [studioDir, repoRoot];
  const files: string[] = [];
  for (const name of ENV_FILENAMES) {
    for (const dir of dirs) {
      files.push(join(dir, name));
    }
  }
  return files;
}

export function parseDotEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawVal] = match;
    let val = rawVal.trim();
    if ((val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
        (val.startsWith("'") && val.endsWith("'") && val.length >= 2)) {
      val = val.slice(1, -1);
    } else {
      const commentIdx = val.search(/\s+#/);
      if (commentIdx >= 0) val = val.slice(0, commentIdx).trim();
    }
    out[key] = val;
  }
  return out;
}

/**
 * Loads non-VITE server defaults (e.g. STUDIO_LIVE_MODELS, BIGQUERY_PROJECT_ID) from .env / .env.local
 * into `env` without overwriting existing variables or caching GEMINI_API_KEY in `process.env`
 * (so editing GEMINI_API_KEY in .env takes effect on the next session without restarting Vite).
 */
export function loadDotEnvDefaults(root: string, env: NodeJS.ProcessEnv = process.env): void {
  for (const file of candidateEnvFiles(root)) {
    if (!existsSync(file)) continue;
    let parsed: Record<string, string>;
    try {
      parsed = parseDotEnv(readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    for (const [k, v] of Object.entries(parsed)) {
      if (k === 'GEMINI_API_KEY' || k.startsWith('VITE_')) continue;
      if (env[k] === undefined && v !== '') {
        env[k] = v;
      }
    }
  }
}

function readKeychainService(service: string): string {
  if (process.platform !== 'darwin') return '';
  try {
    return execFileSync('/usr/bin/security', ['find-generic-password', '-s', service, '-a', KEYCHAIN_ACCOUNT, '-w'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim();
  } catch {
    return ''; // no such item, or the Keychain is locked
  }
}

function fromKeychain(): string {
  return readKeychainService(KEYCHAIN_SERVICE) || readKeychainService(LEGACY_KEYCHAIN_SERVICE);
}

export function fromEnvFiles(root: string): string {
  for (const file of candidateEnvFiles(root)) {
    if (!existsSync(file)) continue;
    try {
      const parsed = parseDotEnv(readFileSync(file, 'utf8'));
      const key = parsed.GEMINI_API_KEY?.trim();
      if (key) return key;
    } catch {
      // unreadable file; continue to next candidate
    }
  }
  return '';
}

export function readApiKey(
  root: string,
  _warn: (message: string) => void = console.warn,
  opts: { useKeychain?: boolean } = {},
): string {
  return (
    process.env.GEMINI_API_KEY?.trim() ||
    fromEnvFiles(root) ||
    ((opts.useKeychain ?? true) ? fromKeychain() : '')
  );
}
