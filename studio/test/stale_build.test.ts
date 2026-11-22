import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** A page with a window that dispatches events, sessionStorage and location.reload. */
function fakePage(storage: 'ok' | 'throws' = 'ok') {
  const target = new EventTarget();
  const store = new Map<string, string>();
  const reload = vi.fn();
  vi.stubGlobal('window', Object.assign(target, { location: { reload } }));
  vi.stubGlobal('sessionStorage', storage === 'ok'
    ? { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) }
    : { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } });
  const fail = (payload: unknown = new Error('Module http://x/assets/DocView-1.js returned HTTP 404')) =>
    window.dispatchEvent(Object.assign(new Event('vite:preloadError', { cancelable: true }), { payload }));
  return { reload, fail, store };
}

async function load() {
  vi.resetModules();
  return import('../src/ui/staleBuild');
}

describe('stale build recovery', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('recognises failed downloads of a view in each browser', async () => {
    const { isChunkLoadError } = await load();
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/DeckView-1.js'))).toBe(true);
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('Unable to preload CSS for /assets/App.css'))).toBe(true);
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
  });

  it('recognises an error Vite reported, whatever its wording', async () => {
    const page = fakePage();
    const { installStaleBuildReload, isChunkLoadError } = await load();
    installStaleBuildReload();
    const error = new Error('Module http://x/assets/DocView-1.js returned HTTP 404');
    expect(isChunkLoadError(error)).toBe(false);
    page.fail(error);
    expect(isChunkLoadError(error)).toBe(true);
    expect(isChunkLoadError(new Error('Module http://x/assets/DocView-1.js returned HTTP 404'))).toBe(false);
  });

  it('saves the project, then reloads', async () => {
    const page = fakePage();
    const { installStaleBuildReload, setBeforeStaleReload } = await load();
    const order: string[] = [];
    page.reload.mockImplementation(() => order.push('reload'));
    setBeforeStaleReload(async () => { order.push('save'); });
    installStaleBuildReload();
    page.fail();
    page.fail(); // several views failing at once reload once
    await vi.runAllTimersAsync();
    expect(order).toEqual(['save', 'reload']);
  });

  it('does not reload again soon after a reload, so a missing file cannot loop', async () => {
    const page = fakePage();
    page.store.set('studio.staleBuildReloadAt', String(Date.now() - 5_000));
    const { installStaleBuildReload } = await load();
    installStaleBuildReload();
    page.fail();
    await vi.runAllTimersAsync();
    expect(page.reload).not.toHaveBeenCalled();
  });

  it('reloads again once the guard interval has passed', async () => {
    const page = fakePage();
    page.store.set('studio.staleBuildReloadAt', String(Date.now() - 60_000));
    const { installStaleBuildReload } = await load();
    installStaleBuildReload();
    page.fail();
    await vi.runAllTimersAsync();
    expect(page.reload).toHaveBeenCalledOnce();
  });

  it('reloads even when the save hangs or fails', async () => {
    const page = fakePage();
    const { installStaleBuildReload, setBeforeStaleReload } = await load();
    setBeforeStaleReload(() => new Promise<void>(() => undefined));
    installStaleBuildReload();
    page.fail();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(page.reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(page.reload).toHaveBeenCalledOnce();
  });

  it('leaves the error screen to the person when storage is blocked (no loop guard)', async () => {
    const page = fakePage('throws');
    const { installStaleBuildReload } = await load();
    installStaleBuildReload();
    page.fail();
    await vi.runAllTimersAsync();
    expect(page.reload).not.toHaveBeenCalled();
  });

  it('forgets the save of a project that closed', async () => {
    const page = fakePage();
    const { installStaleBuildReload, setBeforeStaleReload } = await load();
    const save = vi.fn();
    const unregister = setBeforeStaleReload(save);
    unregister();
    installStaleBuildReload();
    page.fail();
    await vi.runAllTimersAsync();
    expect(save).not.toHaveBeenCalled();
    expect(page.reload).toHaveBeenCalledOnce();
  });
});
