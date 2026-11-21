/**
 * Where everything on a slide goes. `layoutSlide` turns a slide of the deck
 * into positioned elements (text boxes, shapes, a chart, a table) in inches on
 * a 13.333" × 7.5" (16:9) slide. The studio draws these elements
 * (ui/deck/SlideCanvas.tsx) and the PowerPoint export writes the same ones
 * (deck-export/pptx.ts), so what is seen is what is exported.
 *
 * Design rules (from professional deck practice): one message per slide in a
 * full-sentence title; dark title, section and closing slides around light
 * content slides; one dominant color with a sharp accent; numbered circles as
 * the single visual motif; left-aligned body text; 0.6" margins; no text
 * smaller than 11pt except footers.
 */
import type { DeckChart, DeckSpec, DeckThemeName, Slide, Trend } from './deck';

export const SLIDE_W = 13.333;
export const SLIDE_H = 7.5;
const M = 0.6;
const CONTENT_W = SLIDE_W - 2 * M;

export interface DeckTheme {
  name: DeckThemeName;
  label: string;
  /** Background of title, section and closing slides. */
  dark: string;
  onDark: string;
  onDarkMuted: string;
  /** Dominant color on light slides: kickers, circles, the highlighted bar. */
  primary: string;
  /** Supporting color: other bars, arrows. */
  secondary: string;
  /** Sharp accent: kickers and circles on dark slides. */
  pop: string;
  ink: string;
  muted: string;
  /** Card background on light slides. */
  soft: string;
  rule: string;
  positive: string;
  negative: string;
  palette: string[];
  headFont: string;
  bodyFont: string;
}

const T = (t: Omit<DeckTheme, 'onDark' | 'ink' | 'muted' | 'rule' | 'positive' | 'negative' | 'bodyFont'> & Partial<DeckTheme>): DeckTheme => ({
  onDark: 'FFFFFF',
  ink: '1F2430',
  muted: '5E6577',
  rule: 'DDE1E8',
  positive: '1E7F4F',
  negative: 'B3261E',
  bodyFont: 'Arial',
  ...t,
});

export const THEMES: Record<DeckThemeName, DeckTheme> = {
  midnight: T({
    name: 'midnight', label: 'Midnight', dark: '1E2761', onDarkMuted: 'C9D3F2',
    primary: '1E2761', secondary: '9FB3EC', pop: 'F2A541', soft: 'EEF2FC',
    palette: ['1E2761', 'F2A541', '5B7BD5', '9FB3EC', '2F8F83', 'B5577E'], headFont: 'Georgia',
  }),
  graphite: T({
    name: 'graphite', label: 'Graphite', dark: '262B31', onDarkMuted: 'C5CCD3',
    primary: '36454F', secondary: 'AEB8C0', pop: '14B8A6', soft: 'F1F3F5',
    palette: ['36454F', '14B8A6', '7C8B96', 'C2CBD2', 'D98E32', '5E7CE2'], headFont: 'Arial',
  }),
  forest: T({
    name: 'forest', label: 'Forest', dark: '1F3D20', onDarkMuted: 'CFE0C3',
    primary: '2C5F2D', secondary: '9DC06B', pop: 'E3B23C', soft: 'EEF5E7',
    palette: ['2C5F2D', 'E3B23C', '6E9F45', '9DC06B', '3B7EA1', 'B0683F'], headFont: 'Georgia',
  }),
  ocean: T({
    name: 'ocean', label: 'Ocean', dark: '0B2E4A', onDarkMuted: 'BFD9EA',
    primary: '065A82', secondary: '86BEDB', pop: '02C39A', soft: 'E8F3F9',
    palette: ['065A82', '02C39A', '1C7293', '86BEDB', 'F29E4C', '8E6CC9'], headFont: 'Arial',
  }),
  terracotta: T({
    name: 'terracotta', label: 'Terracotta', dark: '3B2924', onDarkMuted: 'E5D3CC',
    primary: 'B85042', secondary: 'DDB0A6', pop: 'A7C4B0', soft: 'F7EFEC',
    palette: ['B85042', '5F8A6E', 'DDB0A6', '3B2924', 'D9A441', '5B7BD5'], headFont: 'Georgia',
  }),
  berry: T({
    name: 'berry', label: 'Berry', dark: '3A1A27', onDarkMuted: 'E8CDD6',
    primary: '6D2E46', secondary: 'CFA3B0', pop: 'E9B872', soft: 'F7EEF1',
    palette: ['6D2E46', 'E9B872', 'A26769', '4A6FA5', '7D9D74', 'CFA3B0'], headFont: 'Georgia',
  }),
};

export const themeOf = (d: Pick<DeckSpec, 'theme'>): DeckTheme => THEMES[d.theme] ?? THEMES.midnight;

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  size?: number;
}

export interface Para {
  runs: Run[];
  bullet?: boolean;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Shape name in PowerPoint (selection pane). */
  name: string;
}

export interface TextEl extends Box {
  kind: 'text';
  paras: Para[];
  /** Points. */
  size: number;
  color: string;
  font: 'head' | 'body';
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  /** Letter spacing in points. */
  charSpacing?: number;
  /** Line spacing as a multiple of single spacing. */
  lineSpacing?: number;
  /** Points after each paragraph. */
  paraSpaceAfter?: number;
  /** The slide title: a title placeholder in PowerPoint. */
  role?: 'title';
}

export interface ShapeEl extends Box {
  kind: 'shape';
  shape: 'rect' | 'roundRect' | 'ellipse' | 'chevron' | 'line';
  fill?: string;
  /** 0 (opaque) to 100. */
  transparency?: number;
  line?: string;
  lineWidth?: number;
  /** Corner radius in inches (roundRect). */
  radius?: number;
}

export interface ChartEl extends Box {
  kind: 'chart';
  chart: DeckChart;
  /** Color of each series, or of each category when `perPoint`. */
  colors: string[];
  perPoint: boolean;
}

export interface TableEl extends Box {
  kind: 'table';
  columns: string[];
  rows: string[][];
  colW: number[];
  rowH: number;
  numeric: boolean[];
  size: number;
}

export type El = TextEl | ShapeEl | ChartEl | TableEl;

export interface SlideFrame {
  background: string;
  dark: boolean;
  elements: El[];
  /** Footer slide number (drawn by the PowerPoint layout, by the studio here). */
  number?: { x: number; y: number; w: number; h: number; size: number; color: string; value: number };
}

// ---------------------------------------------------------------------------
// Text fitting (no DOM: the same estimate serves the studio and the export)
// ---------------------------------------------------------------------------

/** Average glyph width as a share of the font size. */
export function glyphWidth(font: 'head' | 'body', theme: DeckTheme, bold: boolean): number {
  const face = font === 'head' ? theme.headFont : theme.bodyFont;
  const base = face === 'Georgia' ? 0.53 : 0.5;
  return base * (bold ? 1.07 : 1);
}

/** Lines a paragraph wraps to in a box `w` inches wide. */
export function wrapLines(text: string, w: number, size: number, gw: number): number {
  const charW = (size / 72) * gw;
  const perLine = Math.max(1, Math.floor(w / charW));
  let lines = 0;
  for (const hard of text.split('\n')) {
    let line = 0;
    lines++;
    for (const word of hard.split(/\s+/).filter(Boolean)) {
      const len = word.length;
      if (line === 0) {
        line = len;
        while (line > perLine) {
          lines++;
          line -= perLine;
        }
      } else if (line + 1 + len <= perLine) {
        line += 1 + len;
      } else {
        lines++;
        line = len;
        while (line > perLine) {
          lines++;
          line -= perLine;
        }
      }
    }
  }
  return lines;
}

/** Height in inches of paragraphs at a size. */
export function textHeight(paras: string[], w: number, size: number, gw: number, lineSpacing = 1, spaceAfter = 0): number {
  const lineH = (size / 72) * 1.2 * lineSpacing;
  return paras.reduce((h, p, i) => h + wrapLines(p, w, size, gw) * lineH + (i < paras.length - 1 ? spaceAfter / 72 : 0), 0);
}

/** The largest size from `max` down to `min` at which the paragraphs fit the box. */
export function fitSize(paras: string[], w: number, h: number, max: number, min: number, gw: number, lineSpacing = 1, spaceAfter = 0): number {
  for (let s = max; s > min; s--) {
    if (textHeight(paras, w, s, gw, lineSpacing, spaceAfter) <= h) return s;
  }
  return min;
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

class Frame {
  readonly elements: El[] = [];
  constructor(readonly theme: DeckTheme) {}

  text(o: Omit<TextEl, 'kind' | 'paras' | 'size'> & { text: string | string[]; max: number; min?: number; bullets?: boolean }): TextEl {
    const paras = Array.isArray(o.text) ? o.text : [o.text];
    const gw = glyphWidth(o.font, this.theme, o.bold === true);
    const size = o.min != null ? fitSize(paras, o.w, o.h, o.max, o.min, gw, o.lineSpacing ?? 1, o.paraSpaceAfter ?? 0) : o.max;
    const { text: _t, max: _m, min: _n, bullets, ...rest } = o;
    const el: TextEl = { kind: 'text', ...rest, size, paras: paras.map((t) => ({ runs: [{ text: t }], ...(bullets ? { bullet: true } : {}) })) };
    this.elements.push(el);
    return el;
  }

  rich(o: Omit<TextEl, 'kind'>): TextEl {
    const el: TextEl = { kind: 'text', ...o };
    this.elements.push(el);
    return el;
  }

  shape(o: Omit<ShapeEl, 'kind'>): ShapeEl {
    const el: ShapeEl = { kind: 'shape', ...o };
    this.elements.push(el);
    return el;
  }

  /** A filled circle with a short centered label (the deck's motif). */
  badge(name: string, x: number, y: number, d: number, fill: string, label: string, color: string, size: number, font: 'head' | 'body' = 'body') {
    this.shape({ name: `${name} circle`, shape: 'ellipse', x, y, w: d, h: d, fill });
    if (label) {
      this.rich({
        name: `${name} label`, x, y, w: d, h: d, size, color, font, bold: true, align: 'center', valign: 'middle',
        paras: [{ runs: [{ text: label }] }],
      });
    }
  }
}

const two = (n: number) => String(n).padStart(2, '0');

function kicker(f: Frame, text: string | undefined, color: string, x = M, y = 0.5, w = CONTENT_W) {
  if (!text) return;
  f.text({ name: 'Kicker', text: text.toUpperCase(), x, y, w, h: 0.3, max: 12, font: 'body', bold: true, color, charSpacing: 2 });
}

function contentTitle(f: Frame, s: Slide) {
  const t = f.theme;
  kicker(f, s.kicker, t.primary);
  f.text({ name: 'Title', role: 'title', text: s.title, x: M, y: 0.84, w: CONTENT_W, h: 1.08, max: 30, min: 20, font: 'head', bold: t.headFont !== 'Georgia', color: t.ink, valign: 'top', lineSpacing: 0.95 });
}

function footer(f: Frame, s: Slide) {
  if (s.source) {
    f.text({ name: 'Source', text: s.source, x: M, y: 6.98, w: 10.4, h: 0.28, max: 10, font: 'body', color: f.theme.muted, valign: 'middle' });
  }
}

/** Large soft circles in a corner of dark slides. */
function darkDecor(f: Frame, variant: 'title' | 'section' | 'closing') {
  const t = f.theme;
  if (variant === 'title') {
    f.shape({ name: 'Decor large circle', shape: 'ellipse', x: 8.55, y: -1.55, w: 6.4, h: 6.4, fill: t.onDark, transparency: 93 });
    f.shape({ name: 'Decor circle', shape: 'ellipse', x: 10.75, y: 3.55, w: 3.6, h: 3.6, fill: t.secondary, transparency: 84 });
    f.shape({ name: 'Decor dot', shape: 'ellipse', x: 10.1, y: 2.95, w: 0.46, h: 0.46, fill: t.pop });
  } else if (variant === 'section') {
    f.shape({ name: 'Decor large circle', shape: 'ellipse', x: 9.4, y: 2.1, w: 6.2, h: 6.2, fill: t.onDark, transparency: 93 });
    f.shape({ name: 'Decor circle', shape: 'ellipse', x: 11.2, y: -0.9, w: 2.8, h: 2.8, fill: t.secondary, transparency: 84 });
  } else {
    f.shape({ name: 'Decor circle', shape: 'ellipse', x: 11.3, y: -1.2, w: 3.2, h: 3.2, fill: t.onDark, transparency: 93 });
  }
}

const TREND_GLYPH: Record<Trend, string> = { up: '▲', down: '▼', flat: '●' };

function layoutTitle(f: Frame, s: Slide, deck: DeckSpec) {
  const t = f.theme;
  darkDecor(f, 'title');
  kicker(f, s.kicker, t.pop, 0.9, 2.0, 7.8);
  const title = f.text({ name: 'Title', role: 'title', text: s.title, x: 0.9, y: 2.42, w: 8.1, h: 2.0, max: 44, min: 28, font: 'head', bold: t.headFont !== 'Georgia', color: t.onDark, valign: 'top', lineSpacing: 0.92 });
  const used = textHeight([s.title], title.w, title.size, glyphWidth('head', t, title.bold === true), 0.92);
  const sub = s.subtitle ?? deck.subtitle;
  if (sub) f.text({ name: 'Subtitle', text: sub, x: 0.9, y: Math.min(4.6, 2.42 + used + 0.35), w: 7.6, h: 1.0, max: 20, min: 14, font: 'body', color: t.onDarkMuted, valign: 'top' });
  const meta = [deck.date, deck.author].filter(Boolean).join('  ·  ');
  if (meta) f.text({ name: 'Date and presenter', text: meta, x: 0.9, y: 6.45, w: 7.6, h: 0.35, max: 12, font: 'body', color: t.onDarkMuted, valign: 'middle' });
}

function layoutSection(f: Frame, s: Slide, number: number) {
  const t = f.theme;
  darkDecor(f, 'section');
  f.badge('Section number', 0.9, 2.0, 1.0, t.pop, two(number), t.dark, 22);
  kicker(f, s.kicker, t.pop, 0.9, 3.3, 8.5);
  f.text({ name: 'Title', role: 'title', text: s.title, x: 0.9, y: 3.68, w: 8.6, h: 1.4, max: 40, min: 26, font: 'head', bold: t.headFont !== 'Georgia', color: t.onDark, valign: 'top', lineSpacing: 0.95 });
  if (s.subtitle) f.text({ name: 'Subtitle', text: s.subtitle, x: 0.9, y: 5.2, w: 8.0, h: 0.9, max: 18, min: 14, font: 'body', color: t.onDarkMuted });
}

function subtitleLine(f: Frame, s: Slide, y = 2.08): number {
  if (!s.subtitle) return y;
  f.text({ name: 'Subtitle', text: s.subtitle, x: M, y, w: CONTENT_W, h: 0.42, max: 16, min: 13, font: 'body', color: f.theme.muted, valign: 'top' });
  return y + 0.55;
}

function layoutKpis(f: Frame, s: Slide) {
  const t = f.theme;
  contentTitle(f, s);
  const top = subtitleLine(f, s) + 0.17;
  const metrics = (s.metrics ?? []).slice(0, 4);
  const n = Math.max(1, metrics.length);
  const gap = 0.3;
  const takeaways = (s.takeaways ?? []).slice(0, 2);
  const cardH = takeaways.length > 0 ? Math.min(3.3, 5.75 - top) : Math.min(3.6, 6.7 - top);
  const cardW = (CONTENT_W - gap * (n - 1)) / n;
  // The value size is shared by all cards, so the figures line up; figures
  // (digits, currency signs, K/M) run wider than average text
  const gwHead = glyphWidth('head', t, true) * 1.2;
  const valueSize = Math.min(...metrics.map((m) => fitSize([m.value], cardW - 0.6, 1.0, n <= 2 ? 60 : n === 3 ? 52 : 44, 24, gwHead)), 60);
  metrics.forEach((m, i) => {
    const x = M + i * (cardW + gap);
    const y = top;
    f.shape({ name: `Metric ${i + 1} card`, shape: 'roundRect', x, y, w: cardW, h: cardH, fill: t.soft, radius: 0.14 });
    f.badge(`Metric ${i + 1}`, x + 0.3, y + 0.3, 0.46, t.primary, two(i + 1), 'FFFFFF', 13);
    f.text({ name: `Metric ${i + 1} label`, text: m.label, x: x + 0.3, y: y + 0.92, w: cardW - 0.6, h: 0.56, max: 15, min: 12, font: 'body', bold: true, color: t.muted, valign: 'top' });
    f.rich({
      name: `Metric ${i + 1} value`, x: x + 0.3, y: y + 1.5, w: cardW - 0.6, h: 1.0, size: valueSize, color: t.ink, font: 'head', bold: true, valign: 'middle',
      paras: [{ runs: [{ text: m.value }] }],
    });
    let yy = y + 2.55;
    if (m.delta) {
      f.text({ name: `Metric ${i + 1} change`, text: m.trend && !/^[▲▼●]/.test(m.delta) ? `${TREND_GLYPH[m.trend]} ${m.delta}` : m.delta, x: x + 0.3, y: yy, w: cardW - 0.6, h: 0.32, max: 13, min: 11, font: 'body', bold: true, color: m.trend === 'up' ? t.positive : m.trend === 'down' ? t.negative : t.ink, valign: 'top' });
      yy += 0.36;
    }
    if (m.note && yy + 0.3 <= y + cardH - 0.1) {
      f.text({ name: `Metric ${i + 1} note`, text: m.note, x: x + 0.3, y: yy, w: cardW - 0.6, h: Math.min(0.5, y + cardH - 0.12 - yy), max: 12, min: 11, font: 'body', color: t.muted, valign: 'top' });
    }
  });
  if (takeaways.length > 0) {
    const ty = top + cardH + 0.32;
    const tw = (CONTENT_W - gap * (takeaways.length - 1)) / takeaways.length;
    takeaways.forEach((tk, i) => {
      const x = M + i * (tw + gap);
      f.shape({ name: `Takeaway ${i + 1} dot`, shape: 'ellipse', x, y: ty + 0.09, w: 0.16, h: 0.16, fill: t.primary });
      f.text({ name: `Takeaway ${i + 1}`, text: tk, x: x + 0.32, y: ty, w: tw - 0.32, h: 6.75 - ty, max: 15, min: 12, font: 'body', color: t.ink, valign: 'top' });
    });
  }
  footer(f, s);
}

function chartColors(t: DeckTheme, chart: DeckChart): { colors: string[]; perPoint: boolean } {
  const single = chart.series.length === 1;
  if (single && (chart.type === 'bar' || chart.type === 'column')) {
    if (chart.highlight != null && chart.categories.length > 1) {
      return { colors: chart.categories.map((_, i) => (i === chart.highlight ? t.primary : t.secondary)), perPoint: true };
    }
    return { colors: [t.primary], perPoint: false };
  }
  if (chart.type === 'donut') {
    return { colors: chart.categories.map((_, i) => t.palette[i % t.palette.length]), perPoint: true };
  }
  return { colors: chart.series.map((_, i) => t.palette[i % t.palette.length]), perPoint: false };
}

function layoutChart(f: Frame, s: Slide) {
  const t = f.theme;
  contentTitle(f, s);
  const top = subtitleLine(f, s) + 0.07;
  const takeaways = (s.takeaways ?? []).slice(0, 3);
  const bottom = 6.75;
  const chartW = takeaways.length > 0 ? 8.2 : CONTENT_W;
  if (s.chart) {
    const { colors, perPoint } = chartColors(t, s.chart);
    f.elements.push({ kind: 'chart', name: 'Chart', x: M, y: top, w: chartW, h: bottom - top, chart: s.chart, colors, perPoint });
  } else {
    f.shape({ name: 'Chart placeholder', shape: 'roundRect', x: M, y: top, w: chartW, h: bottom - top, fill: t.soft, radius: 0.14 });
    f.text({ name: 'Chart placeholder text', text: s.widgetId ? `Chart from widget ${s.widgetId}: sync the deck with the dashboard to fill it` : 'No chart data yet', x: M + 0.4, y: top, w: chartW - 0.8, h: bottom - top, max: 14, font: 'body', color: t.muted, align: 'center', valign: 'middle' });
  }
  if (takeaways.length > 0) {
    const px = M + chartW + 0.35;
    const pw = SLIDE_W - M - px;
    f.shape({ name: 'Takeaways panel', shape: 'roundRect', x: px, y: top, w: pw, h: bottom - top, fill: t.soft, radius: 0.14 });
    f.text({ name: 'Takeaways heading', text: 'KEY TAKEAWAYS', x: px + 0.3, y: top + 0.28, w: pw - 0.6, h: 0.3, max: 12, font: 'body', bold: true, color: t.primary, charSpacing: 2 });
    const slotMax = (bottom - top - 0.9) / takeaways.length;
    const gw = glyphWidth('body', t, false);
    const size = Math.min(...takeaways.map((tk) => fitSize([tk], pw - 1.05, slotMax - 0.3, 16, 12, gw)));
    let y = top + 0.8;
    takeaways.forEach((tk, i) => {
      const h = Math.max(0.4, textHeight([tk], pw - 1.05, size, gw));
      f.badge(`Takeaway ${i + 1}`, px + 0.3, y + 0.01, 0.36, t.primary, String(i + 1), 'FFFFFF', 11);
      f.rich({ name: `Takeaway ${i + 1}`, x: px + 0.8, y, w: pw - 1.05, h: h + 0.08, size, color: t.ink, font: 'body', valign: 'top', paras: [{ runs: [{ text: tk }] }] });
      y += h + 0.38;
    });
  }
  footer(f, s);
}

function layoutPoints(f: Frame, s: Slide) {
  const t = f.theme;
  contentTitle(f, s);
  const top = subtitleLine(f, s) + 0.17;
  const points = (s.points ?? []).slice(0, 4);
  const n = Math.max(1, points.length);
  const gap = 0.3;
  const bottom = 6.75;
  const gwHead = glyphWidth('head', t, true);
  const gwBody = glyphWidth('body', t, false);
  if (n === 4) {
    const cw = (CONTENT_W - gap) / 2;
    const ch = (bottom - top - gap) / 2;
    const titleSize = Math.min(...points.map((p) => fitSize([p.title], cw - 1.45, 0.62, 18, 14, gwHead)));
    const textSize = Math.min(...points.map((p) => (p.text ? fitSize([p.text], cw - 1.45, ch - 1.1, 16, 12, gwBody) : 16)));
    points.forEach((p, i) => {
      const x = M + (i % 2) * (cw + gap);
      const y = top + Math.floor(i / 2) * (ch + gap);
      f.shape({ name: `Point ${i + 1} card`, shape: 'roundRect', x, y, w: cw, h: ch, fill: t.soft, radius: 0.14 });
      f.badge(`Point ${i + 1}`, x + 0.3, y + 0.3, 0.6, t.primary, two(i + 1), 'FFFFFF', 14);
      f.rich({ name: `Point ${i + 1} title`, x: x + 1.15, y: y + 0.28, w: cw - 1.45, h: 0.62, size: titleSize, color: t.ink, font: 'head', bold: true, valign: 'middle', paras: [{ runs: [{ text: p.title }] }] });
      if (p.text) f.rich({ name: `Point ${i + 1} text`, x: x + 1.15, y: y + 0.98, w: cw - 1.45, h: ch - 1.1, size: textSize, color: t.muted, font: 'body', valign: 'top', paras: [{ runs: [{ text: p.text }] }] });
    });
  } else {
    const cw = (CONTENT_W - gap * (n - 1)) / n;
    const ch = bottom - top;
    const titleSize = Math.min(...points.map((p) => fitSize([p.title], cw - 0.7, 0.95, n === 1 ? 24 : 20, 15, gwHead)));
    const textSize = Math.min(...points.map((p) => (p.text ? fitSize([p.text], cw - 0.7, ch - 2.4, n === 1 ? 18 : 16, 12, gwBody) : 16)));
    points.forEach((p, i) => {
      const x = M + i * (cw + gap);
      f.shape({ name: `Point ${i + 1} card`, shape: 'roundRect', x, y: top, w: cw, h: ch, fill: t.soft, radius: 0.14 });
      f.badge(`Point ${i + 1}`, x + 0.35, top + 0.35, 0.62, t.primary, two(i + 1), 'FFFFFF', 14);
      f.rich({ name: `Point ${i + 1} title`, x: x + 0.35, y: top + 1.2, w: cw - 0.7, h: 0.95, size: titleSize, color: t.ink, font: 'head', bold: true, valign: 'top', paras: [{ runs: [{ text: p.title }] }] });
      if (p.text) f.rich({ name: `Point ${i + 1} text`, x: x + 0.35, y: top + 2.2, w: cw - 0.7, h: ch - 2.4, size: textSize, color: t.muted, font: 'body', valign: 'top', paras: [{ runs: [{ text: p.text }] }] });
    });
  }
  footer(f, s);
}

function layoutFlow(f: Frame, s: Slide) {
  const t = f.theme;
  contentTitle(f, s);
  const top = subtitleLine(f, s) + 0.45;
  const steps = (s.points ?? []).slice(0, 6);
  const n = Math.max(1, steps.length);
  const arrow = 0.5;
  const bw = (CONTENT_W - arrow * (n - 1)) / n;
  const bh = 1.45;
  const gwHead = glyphWidth('head', t, true);
  const gwBody = glyphWidth('body', t, false);
  const labelSize = Math.min(...steps.map((p) => fitSize([p.title], bw - 0.3, bh - 0.55, 17, 11, gwHead)));
  const detailMax = 6.75 - (top + 0.3 + bh + 0.25);
  const detailSize = Math.min(...steps.map((p) => (p.text ? fitSize([p.text], bw - 0.1, detailMax, 15, 11, gwBody) : 15)));
  const detailUsed = Math.max(0, ...steps.map((p) => (p.text ? textHeight([p.text], bw - 0.1, detailSize, gwBody) : 0)));
  const block = 0.3 + bh + (detailUsed > 0 ? 0.25 + detailUsed : 0);
  const by = top + 0.3 + Math.max(0, (6.75 - top - block) / 2 - 0.2);
  const detailH = Math.max(0.4, Math.min(detailMax, detailUsed + 0.1));
  steps.forEach((p, i) => {
    const x = M + i * (bw + arrow);
    f.shape({ name: `Step ${i + 1} box`, shape: 'roundRect', x, y: by, w: bw, h: bh, fill: t.soft, radius: 0.14 });
    f.badge(`Step ${i + 1}`, x + bw / 2 - 0.26, by - 0.26, 0.52, t.primary, String(i + 1), 'FFFFFF', 13);
    f.rich({ name: `Step ${i + 1} label`, x: x + 0.15, y: by + 0.35, w: bw - 0.3, h: bh - 0.5, size: labelSize, color: t.ink, font: 'head', bold: true, align: 'center', valign: 'middle', paras: [{ runs: [{ text: p.title }] }] });
    if (p.text) f.rich({ name: `Step ${i + 1} detail`, x: x + 0.05, y: by + bh + 0.25, w: bw - 0.1, h: detailH, size: detailSize, color: t.muted, font: 'body', valign: 'top', paras: [{ runs: [{ text: p.text }] }] });
    if (i < n - 1) {
      f.shape({ name: `Arrow ${i + 1}`, shape: 'chevron', x: x + bw + arrow / 2 - 0.11, y: by + bh / 2 - 0.2, w: 0.22, h: 0.4, fill: t.secondary });
    }
  });
  footer(f, s);
}

const NUMERIC = /^[\s(]*[-−+]?[$€£]?\s?[\d.,]+\s?(%|[KMB]|ms|GB|MB|KB|B)?\)?\s*$/;

function layoutTable(f: Frame, s: Slide) {
  contentTitle(f, s);
  const top = subtitleLine(f, s) + 0.12;
  const columns = s.columns ?? [];
  const rows = s.rows ?? [];
  if (columns.length === 0) {
    footer(f, s);
    return;
  }
  const numeric = columns.map((_, i) => rows.length > 0 && rows.every((r) => r[i] === '' || r[i] === '—' || NUMERIC.test(r[i] ?? '')));
  // Wider columns for longer text
  const weights = columns.map((c, i) => Math.max(c.length, ...rows.map((r) => (r[i] ?? '').length), 4) ** 0.8 * (numeric[i] ? 0.85 : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  const colW = weights.map((w) => Math.round((w / total) * CONTENT_W * 1000) / 1000);
  const rowH = Math.min(0.48, (6.75 - top) / (rows.length + 1));
  const size = rows.length > 6 || columns.length > 5 ? 12 : 13;
  f.elements.push({ kind: 'table', name: 'Table', x: M, y: top, w: CONTENT_W, h: rowH * (rows.length + 1), columns, rows, colW, rowH, numeric, size });
  footer(f, s);
}

function layoutStatement(f: Frame, s: Slide) {
  const t = f.theme;
  kicker(f, s.kicker, t.primary);
  f.badge('Quote mark', M, 1.35, 0.85, t.primary, '“', 'FFFFFF', 48, 'head');
  f.text({ name: 'Title', role: 'title', text: s.title, x: M, y: 2.5, w: 10.6, h: 2.7, max: 38, min: 24, font: 'head', bold: t.headFont !== 'Georgia', color: t.ink, valign: 'top', lineSpacing: 0.95 });
  if (s.subtitle) f.text({ name: 'Subtitle', text: s.subtitle, x: M, y: 5.45, w: 10.6, h: 0.9, max: 18, min: 14, font: 'body', color: t.muted, valign: 'top' });
  footer(f, s);
}

function layoutClosing(f: Frame, s: Slide) {
  const t = f.theme;
  darkDecor(f, 'closing');
  kicker(f, s.kicker, t.pop, 0.9, 0.6, 9);
  f.text({ name: 'Title', role: 'title', text: s.title, x: 0.9, y: 0.95, w: 10.2, h: 1.05, max: 36, min: 24, font: 'head', bold: t.headFont !== 'Georgia', color: t.onDark, valign: 'top' });
  const takeaways = (s.takeaways ?? []).slice(0, 4);
  const next = (s.points ?? []).slice(0, 4);
  const colW = next.length > 0 ? 6.3 : 11.3;
  const top = 2.35;
  const bottom = s.subtitle ? 6.25 : 6.8;
  const slot = Math.min(1.15, (bottom - top) / Math.max(1, takeaways.length));
  const gw = glyphWidth('body', t, false);
  const size = Math.min(...takeaways.map((tk) => fitSize([tk], colW - 0.75, slot - 0.2, 18, 13, gw)), 18);
  takeaways.forEach((tk, i) => {
    const y = top + i * slot;
    f.badge(`Takeaway ${i + 1}`, 0.9, y, 0.46, t.pop, String(i + 1), t.dark, 13);
    f.rich({ name: `Takeaway ${i + 1}`, x: 1.6, y: y + 0.02, w: colW - 0.75, h: slot - 0.2, size, color: t.onDark, font: 'body', valign: 'top', paras: [{ runs: [{ text: tk }] }] });
  });
  if (next.length > 0) {
    const px = 7.75;
    const pw = SLIDE_W - 0.9 - px;
    const tw = pw - 0.95;
    const items = next.map((p) => (p.text ? `${p.title}: ${p.text}` : p.title));
    const nsize = Math.min(...items.map((it) => fitSize([it], tw, (bottom - top - 0.9) / items.length - 0.2, 16, 12, gw)));
    const heights = items.map((it) => Math.max(0.3, textHeight([it], tw, nsize, gw)));
    const panelH = Math.min(bottom - top + 0.1, 0.85 + heights.reduce((a, h) => a + h + 0.22, 0) + 0.1);
    f.shape({ name: 'Next steps panel', shape: 'roundRect', x: px, y: top - 0.1, w: pw, h: panelH, fill: t.onDark, transparency: 90, radius: 0.14 });
    f.text({ name: 'Next steps heading', text: 'NEXT STEPS', x: px + 0.35, y: top + 0.18, w: pw - 0.7, h: 0.3, max: 12, font: 'body', bold: true, color: t.pop, charSpacing: 2 });
    let y = top + 0.68;
    next.forEach((p, i) => {
      f.shape({ name: `Next step ${i + 1} dot`, shape: 'ellipse', x: px + 0.37, y: y + (nsize / 72) * 0.6 - 0.07, w: 0.14, h: 0.14, fill: t.pop });
      f.rich({
        name: `Next step ${i + 1}`, x: px + 0.65, y, w: tw, h: heights[i] + 0.08, size: nsize, color: t.onDark, font: 'body', valign: 'top',
        paras: [{ runs: p.text ? [{ text: `${p.title}: `, bold: true }, { text: p.text }] : [{ text: p.title, bold: true }] }],
      });
      y += heights[i] + 0.22;
    });
  }
  if (s.subtitle) f.text({ name: 'Closing line', text: s.subtitle, x: 0.9, y: 6.5, w: 10, h: 0.4, max: 13, min: 11, font: 'body', color: t.onDarkMuted, valign: 'middle' });
}

const DARK_LAYOUTS = new Set(['title', 'section', 'closing']);

/** The positioned elements of slide `index` (0-based) of the deck. */
export function layoutSlide(deck: DeckSpec, index: number): SlideFrame {
  const theme = themeOf(deck);
  const s = deck.slides[index];
  const f = new Frame(theme);
  const dark = DARK_LAYOUTS.has(s.layout);
  switch (s.layout) {
    case 'title':
      layoutTitle(f, s, deck);
      break;
    case 'section':
      layoutSection(f, s, deck.slides.slice(0, index + 1).filter((x) => x.layout === 'section').length);
      break;
    case 'kpis':
      layoutKpis(f, s);
      break;
    case 'chart':
      layoutChart(f, s);
      break;
    case 'points':
      layoutPoints(f, s);
      break;
    case 'flow':
      layoutFlow(f, s);
      break;
    case 'table':
      layoutTable(f, s);
      break;
    case 'statement':
      layoutStatement(f, s);
      break;
    case 'closing':
      layoutClosing(f, s);
      break;
  }
  return {
    background: dark ? theme.dark : 'FFFFFF',
    dark,
    elements: f.elements,
    ...(dark ? {} : { number: { x: SLIDE_W - M - 1.0, y: 6.98, w: 1.0, h: 0.28, size: 10, color: theme.muted, value: index + 1 } }),
  };
}

// ---------------------------------------------------------------------------
// Value labels shared by the studio chart and the PowerPoint number format
// ---------------------------------------------------------------------------

/** PowerPoint number format for chart labels of this chart. */
export function chartNumberFormat(chart: Pick<DeckChart, 'format' | 'series'>): string {
  const max = Math.max(0, ...chart.series.flatMap((s) => s.values.map((v) => Math.abs(v))));
  const all = chart.series.flatMap((s) => s.values);
  const integers = all.every((v) => Number.isInteger(v));
  const scaled = (prefix: string) =>
    max >= 1e6 ? `${prefix}#,##0.0,,"M"` : max >= 1e4 ? `${prefix}#,##0.0,"K"` : integers ? `${prefix}#,##0` : `${prefix}#,##0.0`;
  switch (chart.format) {
    case 'currency_usd':
      return scaled('$');
    case 'currency_eur':
      return scaled('"€"');
    case 'currency_gbp':
      return scaled('"£"');
    case 'percent':
      return '0.0"%"';
    case 'ms':
      return '#,##0" ms"';
    default:
      return scaled('');
  }
}

/** A chart value as the PowerPoint number format above shows it. */
export function formatChartValue(v: number, chart: Pick<DeckChart, 'format' | 'series'>): string {
  const code = chartNumberFormat(chart);
  if (code === '0.0"%"') return `${v.toFixed(1)}%`;
  if (code === '#,##0" ms"') return `${Math.round(v).toLocaleString('en-US')} ms`;
  const prefix = code.startsWith('$') ? '$' : code.startsWith('"€"') ? '€' : code.startsWith('"£"') ? '£' : '';
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (code.endsWith(',,"M"')) return `${sign}${prefix}${(a / 1e6).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}M`;
  if (code.endsWith(',"K"')) return `${sign}${prefix}${(a / 1e3).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}K`;
  if (code.endsWith('#,##0.0')) return `${sign}${prefix}${a.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
  return `${sign}${prefix}${Math.round(a).toLocaleString('en-US')}`;
}
