/**
 * Pure deterministic layout, statistical, scale, curve, and palette algorithms
 * powering all 48 chart types in ChartRenderer.
 */
import type {
  AxisScale,
  ChartElementConfig,
  ChartPalette,
  CurveType,
  LineStyle,
  MarkerShape,
} from '../../engine/dashboard';
import type { ColorName } from '../../engine/types';

export const PALETTE_SWATCHES: Record<ChartPalette, readonly string[]> = {
  studio: [
    'var(--c-blue-accent)',
    'var(--c-teal-accent)',
    'var(--c-purple-accent)',
    'var(--c-green-accent)',
    'var(--c-orange-accent)',
    'var(--c-pink-accent)',
    'var(--c-yellow-accent)',
    'var(--c-red-accent)',
  ],
  viridis: ['#440154', '#414487', '#2a788e', '#22a884', '#7ad151', '#fde725', '#95d840', '#35b779'],
  ocean: ['#0284c7', '#0ea5e9', '#06b6d4', '#14b8a6', '#38bdf8', '#2dd4bf', '#1d4ed8', '#0f766e'],
  sunset: ['#f97316', '#ef4444', '#ec4899', '#eab308', '#a855f7', '#fb7185', '#f59e0b', '#dc2626'],
  forest: ['#15803d', '#10b981', '#65a30d', '#0d9488', '#22c55e', '#84cc16', '#047857', '#14532d'],
  pastel: ['#60a5fa', '#5eead4', '#c084fc', '#86efac', '#fdba74', '#f9a8d4', '#fde047', '#fca5a5'],
  monochrome: ['#2563eb', '#3b82f6', '#60a5fa', '#93c5fd', '#1d4ed8', '#1e40af', '#bfdbfe', '#38bdf8'],
  diverging: ['#2563eb', '#0ea5e9', '#2dd4bf', '#a3e635', '#facc15', '#fb923c', '#f87171', '#dc2626'],
  neon: ['#38bdf8', '#2dd4bf', '#a855f7', '#4ade80', '#fb923c', '#f472b6', '#facc15', '#f87171'],
};

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function resolveSeriesColor(
  idx: number,
  cfg?: ChartElementConfig,
  widgetColor?: ColorName,
): string {
  if (cfg?.customColors && cfg.customColors.length > 0) {
    return cfg.customColors[idx % cfg.customColors.length];
  }
  if (idx === 0 && widgetColor && !cfg?.palette) {
    return `var(--c-${widgetColor}-accent)`;
  }
  const pal = PALETTE_SWATCHES[cfg?.palette ?? 'studio'] ?? PALETTE_SWATCHES.studio;
  return pal[idx % pal.length];
}

export function strokeDashForStyle(style: LineStyle | undefined): string | undefined {
  if (style === 'dashed') return '6 4';
  if (style === 'dotted') return '2 3';
  return undefined;
}

export function markerSvgPath(shape: MarkerShape | undefined, cx: number, cy: number, r: number): string {
  switch (shape) {
    case 'square':
      return `M ${cx - r} ${cy - r} H ${cx + r} V ${cy + r} H ${cx - r} Z`;
    case 'diamond':
      return `M ${cx} ${cy - r * 1.25} L ${cx + r * 1.15} ${cy} L ${cx} ${cy + r * 1.25} L ${cx - r * 1.15} ${cy} Z`;
    case 'triangle':
      return `M ${cx} ${cy - r * 1.25} L ${cx + r * 1.15} ${cy + r} L ${cx - r * 1.15} ${cy + r} Z`;
    case 'circle':
    default:
      return `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 -${r * 2} 0`;
  }
}

export function buildCurvePath(pts: { x: number; y: number }[], curve: CurveType = 'linear'): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  if (curve === 'step') {
    const parts = [`M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`];
    for (let i = 1; i < pts.length; i++) {
      parts.push(`H ${pts[i].x.toFixed(1)} V ${pts[i].y.toFixed(1)}`);
    }
    return parts.join(' ');
  }
  if (curve === 'monotone' && pts.length >= 2) {
    const parts = [`M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      parts.push(
        `C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`,
      );
    }
    return parts.join(' ');
  }
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
}

export interface NumericScale {
  min: number;
  max: number;
  ticks: number[];
  /** Maps a domain value onto 0..1 normalized position. */
  norm: (v: number) => number;
}

function transformScaleVal(v: number, mode: AxisScale): number {
  if (mode === 'log') {
    const sign = v < 0 ? -1 : 1;
    return sign * Math.log10(Math.max(1, Math.abs(v) + 1));
  }
  if (mode === 'sqrt') {
    const sign = v < 0 ? -1 : 1;
    return sign * Math.sqrt(Math.abs(v));
  }
  return v;
}

export function createNumericScale(
  values: number[],
  opts: {
    startFromZero?: boolean;
    minOverride?: number;
    maxOverride?: number;
    tickCount?: number;
    scale?: AxisScale;
  } = {},
): NumericScale {
  const finite = values.filter((v) => Number.isFinite(v));
  let rawMin = finite.length > 0 ? Math.min(...finite) : 0;
  let rawMax = finite.length > 0 ? Math.max(...finite) : 1;

  if (opts.startFromZero !== false) {
    if (rawMin > 0) rawMin = 0;
    if (rawMax < 0) rawMax = 0;
  }
  if (typeof opts.minOverride === 'number' && Number.isFinite(opts.minOverride)) {
    rawMin = opts.minOverride;
  }
  if (typeof opts.maxOverride === 'number' && Number.isFinite(opts.maxOverride)) {
    rawMax = opts.maxOverride;
  }
  if (rawMax <= rawMin) {
    rawMax = rawMin === 0 ? 1 : rawMin + Math.abs(rawMin) * 0.2 + 1;
  }

  const count = Math.max(2, Math.min(12, Math.round(opts.tickCount ?? 3)));
  const mode: AxisScale = opts.scale ?? 'linear';
  const tMin = transformScaleVal(rawMin, mode);
  const tMax = transformScaleVal(rawMax, mode);
  const span = Math.max(1e-9, tMax - tMin);

  const ticks: number[] = [];
  for (let i = 0; i < count; i++) {
    const ratio = i / (count - 1);
    if (mode === 'linear') {
      ticks.push(rawMin + (rawMax - rawMin) * ratio);
    } else if (mode === 'sqrt') {
      const tv = tMin + span * ratio;
      ticks.push((tv < 0 ? -1 : 1) * tv * tv);
    } else {
      const tv = tMin + span * ratio;
      ticks.push((tv < 0 ? -1 : 1) * (Math.pow(10, Math.abs(tv)) - 1));
    }
  }

  return {
    min: rawMin,
    max: rawMax,
    ticks,
    norm: (v: number) => {
      const tv = transformScaleVal(v, mode);
      return Math.max(0, Math.min(1, (tv - tMin) / span));
    },
  };
}

export interface CategoryDatum {
  label: string;
  value: number;
  secondValue?: number;
  raw: unknown;
  row: unknown[];
}

export function shapeCategoryItems(
  items: CategoryDatum[],
  cfg?: ChartElementConfig,
  defaultLimit = 24,
): CategoryDatum[] {
  let list = [...items];
  const sortBy = cfg?.sortBy ?? 'none';
  if (sortBy === 'value_desc') list.sort((a, b) => b.value - a.value);
  else if (sortBy === 'value_asc') list.sort((a, b) => a.value - b.value);
  else if (sortBy === 'label_asc') list.sort((a, b) => collator.compare(a.label, b.label));
  else if (sortBy === 'label_desc') list.sort((a, b) => collator.compare(b.label, a.label));

  const limit = cfg?.limitItems ?? defaultLimit;
  if (list.length > limit) {
    if (cfg?.groupTailAsOther && limit >= 1) {
      const head = list.slice(0, limit);
      const tail = list.slice(limit);
      const otherVal = tail.reduce((s, it) => s + it.value, 0);
      const otherSecond = tail.some((it) => it.secondValue !== undefined)
        ? tail.reduce((s, it) => s + (it.secondValue ?? 0), 0)
        : undefined;
      return [
        ...head,
        {
          label: `Other (${tail.length})`,
          value: otherVal,
          secondValue: otherSecond,
          raw: otherVal,
          row: tail[0]?.row ?? ['Other', otherVal],
        },
      ];
    }
    list = list.slice(0, limit);
  }
  return list;
}

export interface PivotedSeriesData {
  categories: string[];
  series: {
    name: string;
    values: number[];
    rows: (unknown[] | undefined)[];
  }[];
}

export function toFiniteNum(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const cleaned = v.replace(/[$,%€£\s,]/g, '');
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function pivotMultiSeries(
  rows: unknown[][],
  cols: string[],
  xIdx: number,
  seriesIdx: number,
  yIndices: number[],
  cfg?: ChartElementConfig,
): PivotedSeriesData {
  const limit = cfg?.limitItems ?? 36;
  if (seriesIdx >= 0 && seriesIdx < cols.length) {
    const catSet = new Set<string>();
    const serSet = new Set<string>();
    const valMap = new Map<string, { val: number; row: unknown[] }>();
    const yCol = yIndices[0] ?? Math.min(1, cols.length - 1);

    for (const r of rows) {
      const cat = String(r[xIdx] ?? '');
      const ser = String(r[seriesIdx] ?? 'Series');
      catSet.add(cat);
      serSet.add(ser);
      const key = `${cat}\u0000${ser}`;
      const prev = valMap.get(key);
      valMap.set(key, { val: (prev?.val ?? 0) + toFiniteNum(r[yCol]), row: r });
    }

    let categories = Array.from(catSet);
    if (cfg?.sortBy === 'label_asc') categories.sort((a, b) => collator.compare(a, b));
    else if (cfg?.sortBy === 'label_desc') categories.sort((a, b) => collator.compare(b, a));
    else if (cfg?.sortBy === 'value_desc' || cfg?.sortBy === 'value_asc') {
      const totals = new Map<string, number>();
      for (const cat of categories) {
        let sum = 0;
        for (const ser of serSet) sum += valMap.get(`${cat}\u0000${ser}`)?.val ?? 0;
        totals.set(cat, sum);
      }
      categories.sort((a, b) =>
        cfg.sortBy === 'value_desc'
          ? (totals.get(b) ?? 0) - (totals.get(a) ?? 0)
          : (totals.get(a) ?? 0) - (totals.get(b) ?? 0),
      );
    }
    categories = categories.slice(0, limit);

    const seriesNames = Array.from(serSet).slice(0, 12);
    return {
      categories,
      series: seriesNames.map((name) => ({
        name,
        values: categories.map((c) => valMap.get(`${c}\u0000${name}`)?.val ?? 0),
        rows: categories.map((c) => valMap.get(`${c}\u0000${name}`)?.row),
      })),
    };
  }

  // Multi-column Y fallback (or single series)
  let workingRows = [...rows];
  const primaryY = yIndices[0] ?? 0;
  if (cfg?.sortBy === 'value_desc') workingRows.sort((a, b) => toFiniteNum(b[primaryY]) - toFiniteNum(a[primaryY]));
  else if (cfg?.sortBy === 'value_asc') workingRows.sort((a, b) => toFiniteNum(a[primaryY]) - toFiniteNum(b[primaryY]));
  else if (cfg?.sortBy === 'label_asc') workingRows.sort((a, b) => collator.compare(String(a[xIdx] ?? ''), String(b[xIdx] ?? '')));
  else if (cfg?.sortBy === 'label_desc') workingRows.sort((a, b) => collator.compare(String(b[xIdx] ?? ''), String(a[xIdx] ?? '')));
  workingRows = workingRows.slice(0, limit);

  const categories = workingRows.map((r, i) => String(r[xIdx] ?? `#${i + 1}`));
  const activeY = yIndices.length > 0 ? yIndices : [Math.min(1, cols.length - 1)];
  return {
    categories,
    series: activeY.map((yIdx) => ({
      name: cols[yIdx] ?? 'Value',
      values: workingRows.map((r) => toFiniteNum(r[yIdx])),
      rows: workingRows,
    })),
  };
}

export interface HistogramBin {
  x0: number;
  x1: number;
  count: number;
  label: string;
  sampleRow: unknown[];
}

export function computeHistogramBins(
  rows: unknown[][],
  yIdx: number,
  binCount = 8,
  formatLabel?: (v: number) => string,
): HistogramBin[] {
  const pairs = rows
    .map((r) => ({ val: Number(r[yIdx]), row: r }))
    .filter((p) => Number.isFinite(p.val));
  if (pairs.length === 0) return [];
  const min = Math.min(...pairs.map((p) => p.val));
  const max = Math.max(...pairs.map((p) => p.val));
  const k = Math.max(2, Math.min(40, Math.round(binCount)));
  const span = max === min ? Math.max(1, Math.abs(min) * 0.2) : max - min;
  const start = max === min ? min - span / 2 : min;
  const step = span / k;

  const fmt = formatLabel ?? ((n: number) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n));
  const bins: HistogramBin[] = Array.from({ length: k }, (_, i) => {
    const x0 = start + i * step;
    const x1 = start + (i + 1) * step;
    return {
      x0,
      x1,
      count: 0,
      label: `${fmt(x0)}–${fmt(x1)}`,
      sampleRow: pairs[0].row,
    };
  });

  for (const p of pairs) {
    const idx = Math.min(k - 1, Math.max(0, Math.floor((p.val - start) / step)));
    bins[idx].count += 1;
    if (bins[idx].count === 1) bins[idx].sampleRow = p.row;
  }
  return bins;
}

export interface BoxPlotGroupStats {
  group: string;
  count: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  mean: number;
  outliers: number[];
  sampleRow: unknown[];
}

function quantileSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * p;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[Math.min(sorted.length - 1, base + 1)];
  return sorted[base] + rest * (next - sorted[base]);
}

export function computeBoxPlotStats(
  rows: unknown[][],
  xIdx: number | null,
  yIdx: number,
): BoxPlotGroupStats[] {
  const byGroup = new Map<string, { vals: number[]; row: unknown[] }>();
  for (const r of rows) {
    const v = Number(r[yIdx]);
    if (!Number.isFinite(v)) continue;
    const g = xIdx !== null && xIdx >= 0 ? String(r[xIdx] ?? 'All') : 'Distribution';
    let entry = byGroup.get(g);
    if (!entry) {
      entry = { vals: [], row: r };
      byGroup.set(g, entry);
    }
    entry.vals.push(v);
  }

  const out: BoxPlotGroupStats[] = [];
  for (const [group, { vals, row }] of byGroup.entries()) {
    const sorted = [...vals].sort((a, b) => a - b);
    const q1 = quantileSorted(sorted, 0.25);
    const median = quantileSorted(sorted, 0.5);
    const q3 = quantileSorted(sorted, 0.75);
    const iqr = q3 - q1;
    const lowFence = q1 - 1.5 * iqr;
    const highFence = q3 + 1.5 * iqr;
    const inside = sorted.filter((v) => v >= lowFence && v <= highFence);
    const min = inside.length > 0 ? inside[0] : sorted[0];
    const max = inside.length > 0 ? inside[inside.length - 1] : sorted[sorted.length - 1];
    const outliers = sorted.filter((v) => v < lowFence || v > highFence);
    const mean = sorted.reduce((s, v) => s + v, 0) / sorted.length;
    out.push({ group, count: sorted.length, min, q1, median, q3, max, mean, outliers, sampleRow: row });
  }
  return out;
}

export function computeKdeCurve(
  values: number[],
  domainMin?: number,
  domainMax?: number,
  steps = 36,
): { x: number; density: number }[] {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length === 0) return [];
  const min = domainMin ?? Math.min(...clean);
  const max = domainMax ?? Math.max(...clean);
  const span = max > min ? max - min : Math.max(1, Math.abs(min) * 0.2);
  const lo = max > min ? min - span * 0.08 : min - span / 2;
  const hi = max > min ? max + span * 0.08 : max + span / 2;

  const mean = clean.reduce((s, v) => s + v, 0) / clean.length;
  const variance = clean.reduce((s, v) => s + (v - mean) * (v - mean), 0) / Math.max(1, clean.length - 1);
  const std = Math.sqrt(variance) || span * 0.18 || 1;
  // Silverman's rule of thumb bandwidth
  const bw = Math.max(span * 0.06, 1.06 * std * Math.pow(clean.length, -0.2));
  const invSqrt2Pi = 0.3989422804;

  const pts: { x: number; density: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const x = lo + ((hi - lo) * i) / steps;
    let sum = 0;
    for (const v of clean) {
      const z = (x - v) / bw;
      sum += invSqrt2Pi * Math.exp(-0.5 * z * z);
    }
    pts.push({ x, density: sum / (clean.length * bw) });
  }
  return pts;
}

export function computeLinearRegression(points: { x: number; y: number }[]): {
  slope: number;
  intercept: number;
  r2: number;
  predict: (x: number) => number;
} | null {
  if (points.length < 2) return null;
  const n = points.length;
  let sumX = 0;
  let sumY = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (const p of points) {
    const dx = p.x - meanX;
    const dy = p.y - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  if (denX < 1e-12) return null;
  const slope = num / denX;
  const intercept = meanY - slope * meanX;
  const r2 = denY < 1e-12 ? 1 : (num * num) / (denX * denY);
  return {
    slope,
    intercept,
    r2,
    predict: (x: number) => slope * x + intercept,
  };
}

export interface TreemapRect<T = unknown> {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  group?: string;
  value: number;
  data: T;
}

/** Deterministic slice-and-dice / binary-balanced squarified treemap tiler. */
export function layoutSquarifiedTreemap<T>(
  items: { label: string; group?: string; value: number; data: T }[],
  x: number,
  y: number,
  w: number,
  h: number,
): TreemapRect<T>[] {
  const positive = items
    .filter((it) => it.value > 0)
    .sort((a, b) => b.value - a.value);
  if (positive.length === 0 || w <= 0 || h <= 0) return [];

  const out: TreemapRect<T>[] = [];
  function partition(list: typeof positive, rx: number, ry: number, rw: number, rh: number) {
    if (list.length === 0 || rw <= 0 || rh <= 0) return;
    if (list.length === 1) {
      out.push({ x: rx, y: ry, w: rw, h: rh, ...list[0] });
      return;
    }
    const total = list.reduce((s, it) => s + it.value, 0);
    let acc = 0;
    let splitIdx = 0;
    for (let i = 0; i < list.length - 1; i++) {
      acc += list[i].value;
      splitIdx = i + 1;
      if (acc >= total * 0.5) break;
    }
    const leftSum = list.slice(0, splitIdx).reduce((s, it) => s + it.value, 0);
    const ratio = total > 0 ? leftSum / total : 0.5;
    if (rw >= rh) {
      const lw = rw * ratio;
      partition(list.slice(0, splitIdx), rx, ry, lw, rh);
      partition(list.slice(splitIdx), rx + lw, ry, rw - lw, rh);
    } else {
      const lh = rh * ratio;
      partition(list.slice(0, splitIdx), rx, ry, rw, lh);
      partition(list.slice(splitIdx), rx, ry + lh, rw, rh - lh);
    }
  }

  partition(positive, x, y, w, h);
  return out;
}

export interface OrgNodeLayout {
  id: string;
  label: string;
  group?: string;
  value: number;
  parentId: string | null;
  depth: number;
  x: number;
  y: number;
  w: number;
  h: number;
  row: unknown[];
}

export function layoutOrgTree(
  rows: unknown[][],
  _cols: string[],
  xIdx: number,
  parentIdx: number,
  yIdx: number,
  seriesIdx: number,
  width: number,
  height: number,
): { nodes: OrgNodeLayout[]; edges: { from: OrgNodeLayout; to: OrgNodeLayout }[] } {
  if (rows.length === 0) return { nodes: [], edges: [] };

  // Detect if col 0 is an id column distinct from xIdx (e.g. node_id, role_title, parent_id)
  const idColIdx = xIdx !== 0 && parentIdx !== 0 ? 0 : xIdx;
  interface RawNode {
    id: string;
    label: string;
    parentId: string | null;
    group?: string;
    value: number;
    row: unknown[];
    children: RawNode[];
  }

  const byId = new Map<string, RawNode>();
  const list: RawNode[] = [];
  rows.slice(0, 32).forEach((r, idx) => {
    const id = String(r[idColIdx] ?? `node_${idx}`);
    const label = String(r[xIdx] ?? id);
    const rawParent = parentIdx >= 0 ? r[parentIdx] : null;
    const parentId =
      rawParent === null || rawParent === undefined || String(rawParent).trim() === '' || String(rawParent) === id
        ? null
        : String(rawParent);
    const group = seriesIdx >= 0 ? String(r[seriesIdx] ?? '') : undefined;
    const value = yIdx >= 0 ? toFiniteNum(r[yIdx]) : 0;
    const node: RawNode = { id, label, parentId, group, value, row: r, children: [] };
    byId.set(id, node);
    list.push(node);
  });

  // If parentId references group names that don't exist as rows (e.g. region -> account), synthesize group roots!
  const missingParents = new Set<string>();
  for (const n of list) {
    if (n.parentId && !byId.has(n.parentId)) missingParents.add(n.parentId);
  }
  if (missingParents.size > 0 && missingParents.size <= 12) {
    const virtualRoot: RawNode = {
      id: '__root__',
      label: 'Organization',
      parentId: null,
      value: list.reduce((s, n) => s + n.value, 0),
      row: rows[0],
      children: [],
    };
    byId.set(virtualRoot.id, virtualRoot);
    list.unshift(virtualRoot);
    for (const mp of missingParents) {
      const pNode: RawNode = {
        id: mp,
        label: mp,
        parentId: '__root__',
        group: mp,
        value: list.filter((x) => x.parentId === mp).reduce((s, x) => s + x.value, 0),
        row: rows[0],
        children: [],
      };
      byId.set(mp, pNode);
      list.push(pNode);
    }
  }

  const roots: RawNode[] = [];
  for (const n of list) {
    if (n.parentId && byId.has(n.parentId)) {
      byId.get(n.parentId)!.children.push(n);
    } else {
      roots.push(n);
    }
  }

  // Assign leaf slots and depths
  let leafCursor = 0;
  let maxDepth = 0;
  const posMap = new Map<string, { cx: number; depth: number }>();

  function walk(n: RawNode, depth: number): number {
    maxDepth = Math.max(maxDepth, depth);
    if (n.children.length === 0) {
      const cx = leafCursor + 0.5;
      leafCursor += 1;
      posMap.set(n.id, { cx, depth });
      return cx;
    }
    const childXs = n.children.map((c) => walk(c, depth + 1));
    const cx = (childXs[0] + childXs[childXs.length - 1]) / 2;
    posMap.set(n.id, { cx, depth });
    return cx;
  }
  roots.forEach((r) => walk(r, 0));

  const totalLeaves = Math.max(1, leafCursor);
  const levelCount = maxDepth + 1;
  const padX = 16;
  const padY = 16;
  const usableW = Math.max(200, width - padX * 2);
  const usableH = Math.max(120, height - padY * 2);
  const slotW = usableW / totalLeaves;
  const cardW = Math.max(66, Math.min(148, slotW - 8));
  const cardH = Math.max(34, Math.min(46, usableH / Math.max(2, levelCount * 1.65)));
  const rowStep = levelCount > 1 ? (usableH - cardH) / (levelCount - 1) : 0;

  const layoutById = new Map<string, OrgNodeLayout>();
  const nodes: OrgNodeLayout[] = list.map((n) => {
    const p = posMap.get(n.id) ?? { cx: 0.5, depth: 0 };
    const x = padX + p.cx * slotW - cardW / 2;
    const y = levelCount === 1 ? padY + (usableH - cardH) / 2 : padY + p.depth * rowStep;
    const laid: OrgNodeLayout = {
      id: n.id,
      label: n.label,
      group: n.group,
      value: n.value,
      parentId: n.parentId,
      depth: p.depth,
      x,
      y,
      w: cardW,
      h: cardH,
      row: n.row,
    };
    layoutById.set(n.id, laid);
    return laid;
  });

  const edges: { from: OrgNodeLayout; to: OrgNodeLayout }[] = [];
  for (const n of nodes) {
    if (n.parentId && layoutById.has(n.parentId)) {
      edges.push({ from: layoutById.get(n.parentId)!, to: n });
    }
  }
  return { nodes, edges };
}

export interface SankeyNodeLayout {
  id: string;
  label: string;
  stage: number;
  total: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SankeyLinkLayout {
  source: SankeyNodeLayout;
  target: SankeyNodeLayout;
  value: number;
  path: string;
  strokeWidth: number;
  row: unknown[];
}

export function layoutSankeyDiagram(
  linksInput: { source: string; target: string; value: number; row: unknown[] }[],
  width: number,
  height: number,
  nodeWidth = 14,
  curvature = 0.5,
): { nodes: SankeyNodeLayout[]; links: SankeyLinkLayout[] } {
  const valid = linksInput.filter((l) => l.value > 0 && l.source !== l.target).slice(0, 40);
  if (valid.length === 0) return { nodes: [], links: [] };

  const nodeStage = new Map<string, number>();
  for (const l of valid) {
    if (!nodeStage.has(l.source)) nodeStage.set(l.source, 0);
    if (!nodeStage.has(l.target)) nodeStage.set(l.target, 1);
  }
  // Propagate multi-stage depths (up to 4 stages)
  for (let pass = 0; pass < 3; pass++) {
    for (const l of valid) {
      const sStage = nodeStage.get(l.source) ?? 0;
      const tStage = nodeStage.get(l.target) ?? 0;
      if (tStage <= sStage) nodeStage.set(l.target, Math.min(4, sStage + 1));
    }
  }

  const maxStage = Math.max(1, ...Array.from(nodeStage.values()));
  const outSum = new Map<string, number>();
  const inSum = new Map<string, number>();
  for (const l of valid) {
    outSum.set(l.source, (outSum.get(l.source) ?? 0) + l.value);
    inSum.set(l.target, (inSum.get(l.target) ?? 0) + l.value);
  }

  const byStage = new Map<number, string[]>();
  for (const [id, st] of nodeStage.entries()) {
    const arr = byStage.get(st) ?? [];
    arr.push(id);
    byStage.set(st, arr);
  }

  const padX = 16;
  const padY = 14;
  const usableW = Math.max(160, width - padX * 2 - nodeWidth);
  const usableH = Math.max(110, height - padY * 2);
  const nodeGap = 10;

  // Compute global vertical scale so conserved flows fit comfortably
  let globalScale = Infinity;
  for (const ids of byStage.values()) {
    const sum = ids.reduce((s, id) => s + Math.max(outSum.get(id) ?? 0, inSum.get(id) ?? 0), 0);
    const avail = Math.max(40, usableH - nodeGap * Math.max(0, ids.length - 1));
    if (sum > 0) globalScale = Math.min(globalScale, avail / sum);
  }
  if (!Number.isFinite(globalScale) || globalScale <= 0) globalScale = 1;

  const nodeMap = new Map<string, SankeyNodeLayout>();
  const nodes: SankeyNodeLayout[] = [];

  for (let st = 0; st <= maxStage; st++) {
    const ids = (byStage.get(st) ?? []).sort(
      (a, b) => Math.max(outSum.get(b) ?? 0, inSum.get(b) ?? 0) - Math.max(outSum.get(a) ?? 0, inSum.get(a) ?? 0),
    );
    const totalH =
      ids.reduce((s, id) => s + Math.max(8, Math.max(outSum.get(id) ?? 0, inSum.get(id) ?? 0) * globalScale), 0) +
      nodeGap * Math.max(0, ids.length - 1);
    let curY = padY + Math.max(0, (usableH - totalH) / 2);
    const nx = padX + (st / maxStage) * usableW;

    for (const id of ids) {
      const tot = Math.max(outSum.get(id) ?? 0, inSum.get(id) ?? 0);
      const nh = Math.max(8, tot * globalScale);
      const nLayout: SankeyNodeLayout = {
        id,
        label: id,
        stage: st,
        total: tot,
        x: nx,
        y: curY,
        w: nodeWidth,
        h: nh,
      };
      nodeMap.set(id, nLayout);
      nodes.push(nLayout);
      curY += nh + nodeGap;
    }
  }

  const srcOffset = new Map<string, number>();
  const tgtOffset = new Map<string, number>();
  const links: SankeyLinkLayout[] = [];

  for (const l of valid) {
    const sNode = nodeMap.get(l.source);
    const tNode = nodeMap.get(l.target);
    if (!sNode || !tNode) continue;
    const sw = Math.max(2, l.value * globalScale);
    const syOff = srcOffset.get(sNode.id) ?? 0;
    const tyOff = tgtOffset.get(tNode.id) ?? 0;
    const y0 = Math.min(sNode.y + sNode.h - sw / 2, sNode.y + syOff + sw / 2);
    const y1 = Math.min(tNode.y + tNode.h - sw / 2, tNode.y + tyOff + sw / 2);
    srcOffset.set(sNode.id, syOff + sw);
    tgtOffset.set(tNode.id, tyOff + sw);

    const x0 = sNode.x + sNode.w;
    const x1 = tNode.x;
    const bend = (x1 - x0) * Math.max(0.15, Math.min(0.85, curvature));
    const path = `M ${x0.toFixed(1)} ${y0.toFixed(1)} C ${(x0 + bend).toFixed(1)} ${y0.toFixed(1)}, ${(x1 - bend).toFixed(1)} ${y1.toFixed(1)}, ${x1.toFixed(1)} ${y1.toFixed(1)}`;
    links.push({
      source: sNode,
      target: tNode,
      value: l.value,
      path,
      strokeWidth: sw,
      row: l.row,
    });
  }

  return { nodes, links };
}

export interface NetworkNodeLayout {
  id: string;
  label: string;
  weight: number;
  degree: number;
  x: number;
  y: number;
  r: number;
}

export interface NetworkEdgeLayout {
  source: NetworkNodeLayout;
  target: NetworkNodeLayout;
  weight: number;
  row: unknown[];
}

/** Deterministic force-relaxed graph layout for Network Charts. */
export function layoutNetworkGraph(
  edgesInput: { source: string; target: string; weight: number; row: unknown[] }[],
  width: number,
  height: number,
  baseNodeSize = 8,
): { nodes: NetworkNodeLayout[]; edges: NetworkEdgeLayout[] } {
  const clean = edgesInput.filter((e) => e.source && e.target).slice(0, 48);
  if (clean.length === 0) return { nodes: [], edges: [] };

  const nodeWeights = new Map<string, { w: number; deg: number }>();
  for (const e of clean) {
    const s = nodeWeights.get(e.source) ?? { w: 0, deg: 0 };
    s.w += Math.max(1, e.weight);
    s.deg += 1;
    nodeWeights.set(e.source, s);

    const t = nodeWeights.get(e.target) ?? { w: 0, deg: 0 };
    t.w += Math.max(1, e.weight);
    t.deg += 1;
    nodeWeights.set(e.target, t);
  }

  const ids = Array.from(nodeWeights.keys());
  const maxW = Math.max(1, ...Array.from(nodeWeights.values()).map((v) => v.w));
  const cx = width / 2;
  const cy = height / 2;
  const initR = Math.min(width, height) * 0.34;

  const pos = ids.map((id, i) => {
    const a = (i / ids.length) * Math.PI * 2 - Math.PI / 2;
    const stats = nodeWeights.get(id)!;
    return {
      id,
      label: id,
      weight: stats.w,
      degree: stats.deg,
      x: cx + Math.cos(a) * initR,
      y: cy + Math.sin(a) * initR * 0.85,
      r: baseNodeSize * (0.7 + 0.9 * Math.sqrt(stats.w / maxW)),
    };
  });
  const byId = new Map(pos.map((p) => [p.id, p]));

  // 36 deterministic force relaxation steps
  const kIdeal = Math.sqrt((width * height) / Math.max(2, pos.length)) * 0.55;
  for (let iter = 0; iter < 36; iter++) {
    const disp = pos.map(() => ({ dx: 0, dy: 0 }));
    for (let i = 0; i < pos.length; i++) {
      for (let j = i + 1; j < pos.length; j++) {
        const vx = pos[i].x - pos[j].x;
        const vy = pos[i].y - pos[j].y;
        const dist = Math.max(12, Math.hypot(vx, vy));
        const rep = (kIdeal * kIdeal) / dist;
        const rx = (vx / dist) * rep;
        const ry = (vy / dist) * rep;
        disp[i].dx += rx;
        disp[i].dy += ry;
        disp[j].dx -= rx;
        disp[j].dy -= ry;
      }
    }
    for (const e of clean) {
      const si = ids.indexOf(e.source);
      const ti = ids.indexOf(e.target);
      if (si < 0 || ti < 0 || si === ti) continue;
      const vx = pos[si].x - pos[ti].x;
      const vy = pos[si].y - pos[ti].y;
      const dist = Math.max(8, Math.hypot(vx, vy));
      const att = (dist * dist) / Math.max(20, kIdeal);
      const ax = (vx / dist) * att * 0.35;
      const ay = (vy / dist) * att * 0.35;
      disp[si].dx -= ax;
      disp[si].dy -= ay;
      disp[ti].dx += ax;
      disp[ti].dy += ay;
    }
    const temp = Math.max(2, 18 * (1 - iter / 36));
    for (let i = 0; i < pos.length; i++) {
      // Gentle gravity toward center
      disp[i].dx += (cx - pos[i].x) * 0.08;
      disp[i].dy += (cy - pos[i].y) * 0.1;
      const len = Math.max(1, Math.hypot(disp[i].dx, disp[i].dy));
      pos[i].x += (disp[i].dx / len) * Math.min(len, temp);
      pos[i].y += (disp[i].dy / len) * Math.min(len, temp);
      const pad = pos[i].r + 22;
      pos[i].x = Math.max(pad + 18, Math.min(width - pad - 18, pos[i].x));
      pos[i].y = Math.max(pad, Math.min(height - pad - 6, pos[i].y));
    }
  }

  return {
    nodes: pos,
    edges: clean
      .map((e) => ({
        source: byId.get(e.source)!,
        target: byId.get(e.target)!,
        weight: e.weight,
        row: e.row,
      }))
      .filter((e) => e.source && e.target),
  };
}
