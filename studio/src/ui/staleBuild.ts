/**
 * Recovers when part of the studio cannot be downloaded. The views load on
 * demand from files whose names change with every release, so a tab left open
 * across a deployment asks for files that no longer exist (or the network drops
 * for a moment). React keeps such a failure, so only a reload, which fetches the
 * current page and its current files, gets the studio working again.
 *
 * Vite dispatches `vite:preloadError` when a lazily loaded module fails. The open
 * project is saved first, then the page reloads, at most once in a while so a
 * file that is really missing shows the error screen instead of reloading forever.
 */

const KEY = 'studio.staleBuildReloadAt';
const MIN_INTERVAL_MS = 30_000;

let beforeReload: (() => Promise<void> | void) | null = null;

/** Runs before the reload (the open project registers its save); returns the unregister function. */
export function setBeforeStaleReload(fn: () => Promise<void> | void): () => void {
  beforeReload = fn;
  return () => {
    if (beforeReload === fn) beforeReload = null;
  };
}

/** The errors Vite reported as failed downloads; the same objects reach the error screen. */
const failedDownloads = new WeakSet<object>();

/** Whether an error is a failure to download part of the studio. */
export function isChunkLoadError(error: unknown): boolean {
  if (typeof error === 'object' && error != null && failedDownloads.has(error)) return true;
  // Each browser words it differently; these cover a failure Vite did not report
  const message = error instanceof Error ? error.message : String(error);
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(message);
}

function recentlyReloaded(now: number): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY));
    if (Number.isFinite(last) && now - last < MIN_INTERVAL_MS) return true;
    sessionStorage.setItem(KEY, String(now));
  } catch {
    // Without storage there is no loop guard, so do not reload on our own
    return true;
  }
  return false;
}

export function installStaleBuildReload(): void {
  let reloading = false;
  window.addEventListener('vite:preloadError', (event) => {
    const error = (event as Event & { payload?: unknown }).payload;
    if (typeof error === 'object' && error != null) failedDownloads.add(error);
    if (reloading || recentlyReloaded(Date.now())) return;
    reloading = true;
    // A save that fails or hangs must not keep the studio broken
    const saved = Promise.resolve().then(() => beforeReload?.()).catch(() => undefined);
    const timeout = new Promise((resolve) => setTimeout(resolve, 2000));
    void Promise.race([saved, timeout]).then(() => window.location.reload());
  });
}
