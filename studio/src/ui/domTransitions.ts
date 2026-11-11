/**
 * Feature-detected discrete display & top-layer exit animation helpers.
 *
 * Entry animations use pure CSS `@starting-style`. Exit animations use native
 * `transition-behavior: allow-discrete` + `overlay` where supported, and fall
 * back to `[data-closing]` + `Element.getAnimations()` in browsers where
 * discrete `display` or `overlay` transitions snap immediately (e.g. Firefox
 * bug 1882408 or Safari `overlay`).
 */

let cachedDisplayTransitionSupport: boolean | undefined;

export function canTransitionDisplay(): boolean {
  if (cachedDisplayTransitionSupport !== undefined) return cachedDisplayTransitionSupport;
  if (
    typeof window === 'undefined' ||
    typeof document === 'undefined' ||
    !window.CSS?.supports?.('transition-behavior', 'allow-discrete') ||
    !document.body
  ) {
    return false;
  }
  const probe = document.createElement('div');
  probe.style.cssText = 'transition: display 1s allow-discrete !important; display: block;';
  document.body.appendChild(probe);
  getComputedStyle(probe).display;
  probe.style.display = 'none';
  cachedDisplayTransitionSupport = getComputedStyle(probe).display === 'block';
  probe.remove();
  return cachedDisplayTransitionSupport;
}

export function supportsTopLayerExit(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(window.CSS?.supports?.('overlay', 'auto')) && canTransitionDisplay();
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export async function waitForAnimations(
  el: HTMLElement | null,
  options: { subtree?: boolean; timeoutMs?: number } = {},
): Promise<void> {
  if (!el || typeof el.getAnimations !== 'function') return;
  const animations = el.getAnimations({ subtree: options.subtree ?? false });
  if (animations.length === 0) return;
  const timeoutMs = options.timeoutMs ?? 450;
  await Promise.race([
    Promise.allSettled(animations.map((a) => a.finished)),
    new Promise<void>((resolve) => window.setTimeout(resolve, timeoutMs)),
  ]);
}

export async function closeTopLayerElement(
  el: HTMLElement | null,
  performClose: () => void,
  timeoutMs = 360,
): Promise<void> {
  if (!el) {
    performClose();
    return;
  }
  if (!supportsTopLayerExit()) {
    el.setAttribute('data-closing', '');
    // Force style recalc so newly triggered CSS transitions appear in getAnimations()
    void el.offsetWidth;
    await waitForAnimations(el, { subtree: true, timeoutMs });
    if (!el.hasAttribute('data-closing')) return;
    el.removeAttribute('data-closing');
  }
  performClose();
}
