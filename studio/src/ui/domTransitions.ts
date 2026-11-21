/**
 * Modern web platform UI primitives & progressive enhancement helpers:
 *
 * - Entry/exit transitions for discrete `display` and top-layer `overlay`
 *   using CSS `@starting-style` + `transition-behavior: allow-discrete`, with
 *   a `[data-closing]` + `Element.getAnimations()` fallback where discrete
 *   transitions snap immediately.
 * - Modal `<dialog>` light-dismiss fallback for browsers without native
 *   `closedby="any"`, testing pointerdown + pointerup bounding-box coordinates
 *   so clicks on dialog padding or text-selection drags never accidentally close.
 * - Top-layer `[popover="auto"]` menu controller with implicit CSS Anchor
 *   Positioning (`showPopover({ source })`) and a viewport-clamping JS fallback
 *   when `@supports (position-area: block-end)` is unavailable.
 */
import { useEffect, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';

let cachedDisplayTransitionSupport: boolean | undefined;

export const HAS_NATIVE_DIALOG_CLOSEDBY =
  typeof HTMLDialogElement !== 'undefined' && 'closedBy' in HTMLDialogElement.prototype;

export const HAS_NATIVE_SWITCH =
  typeof HTMLInputElement !== 'undefined' && 'switch' in HTMLInputElement.prototype;

export const HAS_NATIVE_POPOVER =
  typeof HTMLElement !== 'undefined' && Object.hasOwn(HTMLElement.prototype, 'popover');

export function supportsPositionArea(): boolean {
  if (typeof window === 'undefined' || !window.CSS?.supports) return false;
  return window.CSS.supports('position-area', 'block-end');
}

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

/**
 * Light-dismiss fallback for `<dialog closedby="any">` in browsers without
 * native `closedBy` support (e.g. Safari). Tests pointer coordinates against
 * the dialog's bounding box on BOTH `pointerdown` and `pointerup`, so clicks
 * on the dialog's own padding or text-selection drags ending on the backdrop
 * never close the dialog accidentally.
 */
export function useDialogLightDismiss(
  dialogRef: RefObject<HTMLDialogElement | null>,
  onDismiss: () => void,
  disabled = false,
): void {
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || disabled || HAS_NATIVE_DIALOG_CLOSEDBY) return;
    const isOutside = (e: PointerEvent) => {
      const r = dialog.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    let pressedOutside = false;
    const onPointerDown = (e: PointerEvent) => {
      pressedOutside = dialog.open && isOutside(e);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (pressedOutside && dialog.open && isOutside(e)) {
        pressedOutside = false;
        onDismiss();
      } else {
        pressedOutside = false;
      }
    };
    dialog.addEventListener('pointerdown', onPointerDown);
    dialog.addEventListener('pointerup', onPointerUp);
    return () => {
      dialog.removeEventListener('pointerdown', onPointerDown);
      dialog.removeEventListener('pointerup', onPointerUp);
    };
  }, [dialogRef, onDismiss, disabled]);
}

export type MenuPlacement = 'bottom-end' | 'bottom-start' | 'right-end';

function clampMenuToViewport(menu: HTMLElement, trigger: HTMLElement, placement: MenuPlacement): void {
  const t = trigger.getBoundingClientRect();
  const m = menu.getBoundingClientRect();
  const pad = 8;
  const gap = 6;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left: number;
  let top: number;

  if (placement === 'right-end') {
    const rightSpace = vw - t.right - gap - pad;
    left = rightSpace >= m.width ? t.right + gap : Math.max(pad, t.left - gap - m.width);
    top = Math.min(vh - pad - m.height, Math.max(pad, t.bottom - m.height));
  } else {
    const fitsBelow = t.bottom + gap + m.height <= vh - pad;
    const fitsAbove = t.top - gap - m.height >= pad;
    if (fitsBelow || !fitsAbove) {
      top = Math.min(vh - pad - m.height, Math.max(pad, t.bottom + gap));
    } else {
      top = Math.max(pad, t.top - gap - m.height);
    }
    const preferredLeft = placement === 'bottom-end' ? t.right - m.width : t.left;
    left = Math.max(pad, Math.min(preferredLeft, vw - pad - m.width));
  }

  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
}

/**
 * Coordinates a React-controlled top-layer `[popover="auto"]` menu with:
 * - Implicit anchor association via `showPopover({ source: trigger })` so CSS
 *   Anchor Positioning (`position-area` + `position-try-fallbacks`) handles
 *   edge flipping natively in supporting browsers.
 * - Viewport-clamping fallback positioning when `position-area` is unsupported.
 * - Native light-dismiss and `Escape` synced back to React via the `toggle`
 *   event, plus full ARIA `menu` arrow/Home/End/Tab keyboard navigation.
 */
export const HAS_IMPLICIT_POPOVER_ANCHOR =
  typeof ToggleEvent !== 'undefined' && 'source' in ToggleEvent.prototype;

let menuAnchorSeq = 0;

export function usePopoverMenu(options: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  menuRef: RefObject<HTMLDivElement | null>;
  triggerRef: RefObject<HTMLElement | null>;
  placement?: MenuPlacement;
  focusFirstOnOpen?: boolean;
}): void {
  const {
    open,
    onOpenChange,
    menuRef,
    triggerRef,
    placement = 'bottom-end',
    focusFirstOnOpen = false,
  } = options;

  // Prevent popover="auto" light-dismiss on trigger pointerdown from immediately re-opening on click
  useEffect(() => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu || !HAS_NATIVE_POPOVER) return;

    let suppressNextClick = false;
    const onPointerDown = () => {
      try {
        suppressNextClick = menu.matches(':popover-open');
      } catch {
        suppressNextClick = false;
      }
    };
    const onClick = (e: MouseEvent) => {
      if (suppressNextClick) {
        suppressNextClick = false;
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    trigger.addEventListener('pointerdown', onPointerDown, true);
    trigger.addEventListener('click', onClick, true);
    return () => {
      trigger.removeEventListener('pointerdown', onPointerDown, true);
      trigger.removeEventListener('click', onClick, true);
    };
  }, [triggerRef, menuRef]);

  // Open / close the native popover and apply anchor or viewport-clamping positioning
  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const pop = menu as HTMLDivElement & {
      showPopover?: (opts?: { source?: HTMLElement }) => void;
      hidePopover?: () => void;
    };

    const isOpenNow = () => {
      try {
        return menu.matches(':popover-open');
      } catch {
        return menu.hasAttribute('data-open');
      }
    };

    if (open) {
      const trigger = triggerRef.current;
      const useAnchor = supportsPositionArea();

      // Explicit anchor-name bridge for browsers with position-area before showPopover({ source })
      if (useAnchor && trigger && !HAS_IMPLICIT_POPOVER_ANCHOR) {
        const anchorName = trigger.style.getPropertyValue('anchor-name') || `--mwg-menu-${++menuAnchorSeq}`;
        trigger.style.setProperty('anchor-name', anchorName);
        menu.style.setProperty('position-anchor', anchorName);
      }

      if (HAS_NATIVE_POPOVER && typeof pop.showPopover === 'function') {
        if (!isOpenNow()) {
          try {
            pop.showPopover(trigger ? { source: trigger } : undefined);
          } catch {
            try {
              pop.showPopover();
            } catch {
              menu.setAttribute('data-open', '');
            }
          }
        }
      } else {
        menu.setAttribute('data-open', '');
      }

      const position = () => {
        if (trigger && !useAnchor) {
          clampMenuToViewport(menu, trigger, placement);
        }
      };
      position();

      if (focusFirstOnOpen) {
        menu.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled), [role="menuitemradio"]:not(:disabled)')?.focus();
      }

      const onResize = () => position();
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }

    if (HAS_NATIVE_POPOVER && typeof pop.hidePopover === 'function') {
      if (isOpenNow()) {
        try {
          pop.hidePopover();
        } catch {
          // already hidden
        }
      }
    } else {
      menu.removeAttribute('data-open');
    }
  }, [open, menuRef, triggerRef, placement, focusFirstOnOpen]);

  // Sync native light-dismiss / Escape toggle events back to React state
  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const onToggle = (e: Event) => {
      const ev = e as ToggleEvent;
      if (ev.newState === 'closed' && open) {
        onOpenChange(false);
      }
    };
    menu.addEventListener('toggle', onToggle);
    return () => menu.removeEventListener('toggle', onToggle);
  }, [menuRef, open, onOpenChange]);

  // Keyboard navigation (ArrowUp/Down/Home/End/Escape/Tab) and fallback outside click
  useEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    if (!menu) return;

    const getItems = () =>
      [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled), [role="menuitemradio"]:not(:disabled), [role="menuitemcheckbox"]:not(:disabled)')];

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onOpenChange(false);
        triggerRef.current?.focus();
        return;
      }
      if (e.key === 'Tab') {
        onOpenChange(false);
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
        const items = getItems();
        if (items.length === 0) return;
        e.preventDefault();
        const idx = items.indexOf(document.activeElement as HTMLButtonElement);
        let nextIdx: number;
        if (e.key === 'Home') nextIdx = 0;
        else if (e.key === 'End') nextIdx = items.length - 1;
        else if (e.key === 'ArrowDown') nextIdx = idx < 0 ? 0 : (idx + 1) % items.length;
        else nextIdx = idx <= 0 ? items.length - 1 : idx - 1;
        items[nextIdx].focus();
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      if (HAS_NATIVE_POPOVER) return;
      const t = e.target as Node;
      if (!menu.contains(t) && !triggerRef.current?.contains(t)) {
        onOpenChange(false);
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, menuRef, triggerRef, onOpenChange]);
}

/**
 * ArrowLeft / ArrowRight / Home / End keyboard navigation for horizontal
 * `role="tablist"` containers (supports RTL via computed writing direction).
 */
export function handleTabListKeyDown<T extends string>(
  e: ReactKeyboardEvent<HTMLElement>,
  ids: readonly T[],
  current: T,
  onSelect: (id: T) => void,
  focusById: (id: T) => void,
): void {
  if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
  const idx = ids.indexOf(current);
  if (idx < 0 || ids.length === 0) return;
  e.preventDefault();
  const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
  let nextIdx: number;
  if (e.key === 'Home') nextIdx = 0;
  else if (e.key === 'End') nextIdx = ids.length - 1;
  else {
    const step = (e.key === 'ArrowRight' ? 1 : -1) * (rtl ? -1 : 1);
    nextIdx = (idx + step + ids.length) % ids.length;
  }
  const next = ids[nextIdx];
  onSelect(next);
  requestAnimationFrame(() => focusById(next));
}
