/**
 * Category labels under a bar or column chart. Labels are fitted to the room
 * each one has by their drawn width, not a character count, and when cutting
 * them would make them unreadable (two labels cut to the same text, as
 * "2025-Q4" and "2026-Q1" both becoming "2026-…", or most of a label cut away)
 * they are tilted instead, which gives each label far more room.
 */

/** Width in px of a label as the axis draws it. */
export type MeasureText = (text: string) => number;

/** The tilt used when labels do not fit flat. */
export const AUTO_TICK_ROTATION = -35;

/** Characters a tilted label keeps; longer ones are cut. */
const TILTED_MAX_CHARS = 16;

export interface XTickLayout {
  /** Degrees to rotate each label (0: flat). */
  rotation: number;
  /** Extra bottom padding the tilted labels need. */
  extraBottomPad: number;
  /** The text drawn for a category. */
  label: (category: string) => string;
}

/** The longest start of `text`, with an ellipsis, whose width fits `maxPx` (at least one character). */
export function fitToWidth(text: string, maxPx: number, measure: MeasureText): string {
  if (measure(text) <= maxPx) return text;
  let lo = 1;
  let hi = text.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(`${text.slice(0, mid)}…`) <= maxPx) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo)}…`;
}

function cutToChars(text: string, maxChars: number): string {
  if (maxChars <= 0 || text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(1, maxChars - 1))}…`;
}

/**
 * How to draw the labels of `shown` (the categories that get a label) when each
 * has `room` px. `rotation` and `truncateChars` are the chart's own settings,
 * which always win.
 */
export function layoutXTicks(
  shown: string[],
  room: number,
  measure: MeasureText,
  { rotation, truncateChars }: { rotation?: number; truncateChars?: number } = {},
): XTickLayout {
  const tiltedPad = (rot: number, label: (c: string) => string) => {
    if (rot === 0) return 0;
    const longest = Math.max(0, ...shown.map((c) => measure(label(c))));
    // The label hangs below its anchor by width × sin(angle); the axis already leaves about 12px
    return Math.round(Math.min(64, Math.max(18, longest * Math.abs(Math.sin((rot * Math.PI) / 180)) - 12)));
  };

  if (truncateChars != null) {
    const label = (c: string) => cutToChars(c, truncateChars);
    const rot = rotation ?? 0;
    return { rotation: rot, extraBottomPad: tiltedPad(rot, label), label };
  }
  if (rotation != null && rotation !== 0) {
    const label = (c: string) => cutToChars(c, TILTED_MAX_CHARS);
    return { rotation, extraBottomPad: tiltedPad(rotation, label), label };
  }

  const flat = (c: string) => fitToWidth(c, room, measure);
  const cut = shown.filter((c) => flat(c) !== c);
  const collide = new Set(shown.map(flat)).size < new Set(shown).size;
  // Less than half a label left reads as noise ("No…" for "North America")
  const mostlyCut = cut.some((c) => flat(c).length - 1 < c.length / 2);
  if (rotation == null && cut.length > 0 && (collide || mostlyCut)) {
    const label = (c: string) => cutToChars(c, TILTED_MAX_CHARS);
    return { rotation: AUTO_TICK_ROTATION, extraBottomPad: tiltedPad(AUTO_TICK_ROTATION, label), label };
  }
  return { rotation: 0, extraBottomPad: 0, label: flat };
}

let canvasContext: CanvasRenderingContext2D | null | undefined;

/**
 * Measures a label in the axis font (`.axis-tick`: 11px, weight 450); a
 * per-character estimate where no canvas exists (tests, server rendering).
 */
export const measureAxisTick: MeasureText = (text) => {
  if (canvasContext === undefined) {
    try {
      canvasContext = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
    } catch {
      canvasContext = null;
    }
    if (canvasContext) canvasContext.font = '450 11px Roboto, system-ui, -apple-system, "Segoe UI", sans-serif';
  }
  return canvasContext ? canvasContext.measureText(text).width : text.length * 6.3;
};
