/**
 * What the voice agent learns about a chart after it is built: the query is
 * run and the result is checked against the chart kind, so the model sees
 * what the user sees instead of guessing from the SQL text.
 *
 * - issues: the chart is empty, broken or misleading with this result (fix now)
 * - advice: storytelling improvements, each with the exact patch to apply
 * - facts:  the numbers the chart shows, for insight titles, annotations and
 *           the spoken summary
 */
import type { QueryExecutionResult } from '../data/sqlEngine';
import { adviseChartStorytelling, CHART_CATALOG, getChartMeta } from './chartCatalog';
import { formatMetricValue, type DashboardSpec, type DashboardWidget, type WidgetKind } from './dashboard';

export interface WidgetReview {
  id: string;
  kind: WidgetKind;
  /** Rows the query returns with the current filter values. */
  rows: number;
  columns: string[];
  issues: string[];
  advice: string[];
  facts: string[];
}

type Cell = string | number | boolean | null;

interface ColumnProfile {
  name: string;
  idx: number;
  numeric: boolean;
  temporal: boolean;
  distinct: number;
}

const PROFILE_ROWS = 500;
const MAX_FACTS = 3;
const MAX_ADVICE = 4;

const num = (v: Cell | undefined): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const TEMPORAL_NAME = /(^|_)(date|day|week|month|quarter|year|period|hour|time|ts|timestamp)(_|$)/i;
const TEMPORAL_VALUE = /^(\d{4}([-/]\d{1,2}){0,2}([ T]\d{2}.*)?|\d{4}-?Q[1-4]|\d{4}-?W\d{1,2}|Q[1-4]\b.*|(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b.*)$/i;
/** Labels whose text order is their time order ("2026-03", "2026-Q1", "2026-03-14"). */
const SORTABLE_TIME = /^\d{4}([-/]\d{2}){0,2}([ T]\d{2}.*)?$|^\d{4}-?Q[1-4]$/;

/** Metrics that cannot be summed across rows (rates, averages, scores). */
const NON_ADDITIVE_NAME = /(pct|percent|rate|ratio|share|avg|average|mean|median|score|index|p\d{2}|per_|_per|aov|arpu|margin|ndr|nps|latency|duration)/i;
const CURRENCY_NAME = /(usd|revenue|cost|spend|price|amount|mrr|arr|sales|gmv|budget|profit)/i;
const PERCENT_NAME = /(pct|percent|_rate$|^rate_|ratio|share)/i;

function profileColumns(columns: string[], rows: Cell[][]): ColumnProfile[] {
  const sample = rows.slice(0, PROFILE_ROWS);
  return columns.map((name, idx) => {
    const values = sample.map((r) => r[idx]).filter((v) => v !== null && v !== undefined && v !== '');
    const numeric = values.length > 0 && values.every((v) => num(v) !== null);
    const first = values[0];
    const temporal =
      (!numeric && typeof first === 'string' && TEMPORAL_VALUE.test(first.trim())) ||
      (TEMPORAL_NAME.test(name) && (!numeric || /year/i.test(name)));
    return { name, idx, numeric, temporal, distinct: new Set(values.map(String)).size };
  });
}

/** The same column resolution as the renderer, so the review matches the picture. */
function mapColumns(widget: DashboardWidget, columns: string[], profiles: ColumnProfile[]) {
  const xIdx = widget.xField && columns.includes(widget.xField) ? columns.indexOf(widget.xField) : 0;
  const seriesIdx = widget.seriesField ? columns.indexOf(widget.seriesField) : -1;
  const compIdx = widget.comparisonField ? columns.indexOf(widget.comparisonField) : -1;
  const sizeIdx = widget.sizeField ? columns.indexOf(widget.sizeField) : -1;
  let yIndices = (widget.yFields ?? []).map((f) => columns.indexOf(f)).filter((i) => i >= 0);
  if (yIndices.length === 0) {
    const keepsX = widget.kind === 'kpi' || widget.kind === 'histogram' || widget.kind === 'density';
    yIndices = profiles
      .filter((p) => p.numeric && p.idx !== seriesIdx && p.idx !== compIdx && p.idx !== sizeIdx &&
        (keepsX || p.idx !== xIdx || columns.length === 1))
      .map((p) => p.idx);
  }
  return { xIdx, seriesIdx, compIdx, sizeIdx, yIndices };
}

const NAMED_FIELDS: [keyof DashboardWidget, string][] = [
  ['xField', 'x_field'],
  ['seriesField', 'series_field'],
  ['comparisonField', 'comparison_field'],
  ['sizeField', 'size_field'],
  ['parentField', 'parent_field'],
  ['openField', 'open_field'],
  ['highField', 'high_field'],
  ['lowField', 'low_field'],
  ['closeField', 'close_field'],
  ['startField', 'start_field'],
  ['endField', 'end_field'],
  ['progressField', 'progress_field'],
  ['latField', 'lat_field'],
  ['lonField', 'lon_field'],
  ['destLatField', 'dest_lat_field'],
  ['destLonField', 'dest_lon_field'],
];

/** Fewest result columns a kind can draw from (2 unless listed). */
const MIN_COLUMNS: Partial<Record<WidgetKind, number>> = {
  kpi: 1,
  table: 1,
  histogram: 1,
  density: 1,
  gauge: 1,
  streamgraph: 3,
  trellis: 3,
  marimekko: 3,
  sankey: 3,
  chord: 3,
  sunburst: 3,
  parallel_sets: 3,
  org_chart: 3,
  bubble: 3,
  candlestick: 5,
};

/** Fewest numeric columns a kind needs (1 unless listed). */
const MIN_NUMERIC: Partial<Record<WidgetKind, number>> = {
  table: 0,
  org_chart: 0,
  network_chart: 0,
  arc_diagram: 0,
  connection_map: 0,
  parallel_sets: 0,
  dot_map: 0,
  scatter: 2,
  bubble: 3,
  gantt: 2,
  parallel_coordinates: 2,
  candlestick: 4,
};

const SINGLE_ROW_OK = new Set<WidgetKind>(['kpi', 'gauge', 'bullet', 'table']);
const RAW_ROW_KINDS = new Set<WidgetKind>(['histogram', 'density', 'box_plot', 'violin']);
/** Kinds drawn as one mark per x value: a repeated x means un-aggregated or un-split rows. */
const SPLITTABLE = new Set<WidgetKind>(['bar', 'column', 'horizontal_bar', 'grouped_bar', 'stacked_bar', 'line', 'area']);
const ONE_ROW_PER_X = new Set<WidgetKind>(['pie', 'donut', 'funnel', 'waterfall', 'nightingale_rose', 'square_area', 'proportional_area']);
const NEEDS_SERIES = new Set<WidgetKind>(['grouped_bar', 'stacked_bar']);
const BAR_FAMILY = new Set<WidgetKind>(['bar', 'column', 'horizontal_bar']);
/** Kinds whose first column is a category or period and whose first metric can be ranked or trended. */
const RANKED_OR_TRENDED = new Set<WidgetKind>([
  'bar', 'column', 'grouped_bar', 'stacked_bar', 'horizontal_bar', 'pie', 'donut', 'nightingale_rose', 'marimekko',
  'line', 'area', 'streamgraph', 'spiral_plot', 'trellis', 'heatmap', 'treemap', 'sunburst', 'sankey', 'chord',
  'choropleth_map', 'dot_map', 'geo_heatmap', 'bubble_map', 'proportional_area', 'square_area', 'gauge', 'bullet',
  'funnel', 'waterfall',
]);
const TREND_KINDS = new Set<WidgetKind>(['line', 'area']);

const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** A quick fix of the storytelling advisor as edit_dashboard arguments (snake_case, no nulls). */
function patchForModel(widgetId: string, patch: Record<string, unknown>): string {
  const convert = (o: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      if (v === null || v === undefined) continue;
      out[snake(k)] = v && typeof v === 'object' && !Array.isArray(v) ? convert(v as Record<string, unknown>) : v;
    }
    return out;
  };
  return `update_widgets ${JSON.stringify([{ id: widgetId, ...convert(patch) }])}`;
}

const signedPct = (from: number, to: number): string | null => {
  if (from === 0 || !Number.isFinite(from) || !Number.isFinite(to)) return null;
  const p = ((to - from) / Math.abs(from)) * 100;
  return `${p >= 0 ? '+' : '−'}${Math.abs(p).toFixed(1)}%`;
};

const label = (v: Cell | undefined) => (v === null || v === undefined || v === '' ? '(blank)' : String(v));

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 4) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The numbers the chart shows, phrased so the model can quote them: leaders
 * and shares for categories, change and peak for trends, drop-offs for funnels.
 */
function factsOf(
  widget: DashboardWidget,
  columns: string[],
  rows: Cell[][],
  profiles: ColumnProfile[],
  map: ReturnType<typeof mapColumns>,
): string[] {
  const facts: string[] = [];
  const { xIdx, seriesIdx, compIdx, yIndices } = map;
  const yIdx = yIndices[0];
  if (yIdx === undefined || rows.length === 0) return facts;
  const yName = columns[yIdx];
  const fmt = (v: number) => formatMetricValue(v, widget.format ?? 'number', widget.unit);
  const additive = widget.format !== 'percent' && !NON_ADDITIVE_NAME.test(yName);
  const x = profiles[xIdx];

  if (widget.kind === 'kpi') {
    const v = num(rows[0][yIdx]);
    if (v === null) return facts;
    const deltaIdx = compIdx >= 0 ? compIdx : columns.length > 1 ? yIndices.find((i) => i !== yIdx) ?? -1 : -1;
    const delta = deltaIdx >= 0 ? num(rows[0][deltaIdx]) : null;
    facts.push(`${yName} = ${fmt(v)}` + (delta !== null ? `, ${columns[deltaIdx]} = ${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)}` : ''));
    return facts;
  }

  if (widget.kind === 'table') return facts;

  if (RAW_ROW_KINDS.has(widget.kind)) {
    const values = rows.map((r) => num(r[yIdx])).filter((v): v is number => v !== null).sort((a, b) => a - b);
    if (values.length >= 3) {
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      facts.push(`${yName} over ${values.length} rows: median ${fmt(median(values))}, mean ${fmt(mean)}, range ${fmt(values[0])} to ${fmt(values[values.length - 1])}`);
    }
    return facts;
  }

  if (widget.kind === 'scatter' || widget.kind === 'bubble') {
    const xNumeric = x?.numeric ? xIdx : yIndices[0];
    const yNumeric = yIndices.find((i) => i !== xNumeric);
    if (yNumeric === undefined) return facts;
    const pairs = rows
      .map((r) => [num(r[xNumeric]), num(r[yNumeric])] as const)
      .filter((p): p is readonly [number, number] => p[0] !== null && p[1] !== null);
    const r = pearson(pairs.map((p) => p[0]), pairs.map((p) => p[1]));
    if (r !== null) {
      const strength = Math.abs(r) >= 0.7 ? 'strong' : Math.abs(r) >= 0.4 ? 'moderate' : Math.abs(r) >= 0.2 ? 'weak' : 'no clear';
      facts.push(`${columns[xNumeric]} vs ${columns[yNumeric]}: r = ${r.toFixed(2)} (${strength}${Math.abs(r) >= 0.2 ? (r > 0 ? ' positive' : ' negative') : ''} correlation, ${pairs.length} points)`);
    }
    return facts;
  }

  if (widget.kind === 'candlestick') {
    const closeIdx = widget.closeField ? columns.indexOf(widget.closeField) : yIndices[3] ?? -1;
    const first = closeIdx >= 0 ? num(rows[0][closeIdx]) : null;
    const last = closeIdx >= 0 ? num(rows[rows.length - 1][closeIdx]) : null;
    if (first !== null && last !== null && rows.length >= 2) {
      const change = signedPct(first, last);
      facts.push(`${columns[closeIdx]}: ${fmt(first)} (${label(rows[0][xIdx])}) → ${fmt(last)} (${label(rows[rows.length - 1][xIdx])})${change ? `, ${change}` : ''}`);
    }
    return facts;
  }

  if (!RANKED_OR_TRENDED.has(widget.kind)) return facts;

  // One value per x: totals of the first metric (series are summed per x)
  const order: string[] = [];
  const byX = new Map<string, number>();
  const bySeries = new Map<string, number>();
  for (const r of rows) {
    const v = num(r[yIdx]);
    if (v === null) continue;
    const key = label(r[xIdx]);
    if (!byX.has(key)) order.push(key);
    byX.set(key, (byX.get(key) ?? 0) + v);
    if (seriesIdx >= 0) {
      const s = label(r[seriesIdx]);
      bySeries.set(s, (bySeries.get(s) ?? 0) + v);
    }
  }
  if (order.length < 2) return facts;
  const split = seriesIdx >= 0 && bySeries.size > 1;
  // Summing a rate across series is meaningless: describe such charts by series only
  const xTotalsValid = !split || additive;
  const what = split && additive ? `total ${yName}` : yName;

  if (widget.kind === 'funnel' && xTotalsValid) {
    const first = byX.get(order[0])!;
    const last = byX.get(order[order.length - 1])!;
    if (first > 0) facts.push(`${order[0]} → ${order[order.length - 1]}: ${((last / first) * 100).toFixed(1)}% overall conversion (${fmt(first)} → ${fmt(last)})`);
    let worst = -1;
    let worstRate = Infinity;
    for (let i = 1; i < order.length; i++) {
      const prev = byX.get(order[i - 1])!;
      if (prev <= 0) continue;
      const rate = byX.get(order[i])! / prev;
      if (rate < worstRate) {
        worstRate = rate;
        worst = i;
      }
    }
    if (worst > 0) facts.push(`largest drop-off: ${order[worst - 1]} → ${order[worst]} keeps ${(worstRate * 100).toFixed(1)}%`);
    return facts;
  }

  if (widget.kind === 'waterfall') {
    const net = [...byX.values()].reduce((a, b) => a + b, 0);
    const steps = order.map((k) => [k, byX.get(k)!] as const).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    facts.push(`net ${yName}: ${fmt(net)}; largest step ${steps[0][0]} (${steps[0][1] >= 0 ? '+' : '−'}${fmt(Math.abs(steps[0][1]))})`);
    return facts;
  }

  const temporal = x?.temporal === true;
  if (temporal && xTotalsValid && order.length >= 3) {
    const sorted = order.every((k) => SORTABLE_TIME.test(k)) ? [...order].sort() : order;
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const prev = sorted[sorted.length - 2];
    const vFirst = byX.get(first)!;
    const vLast = byX.get(last)!;
    const overall = signedPct(vFirst, vLast);
    const step = signedPct(byX.get(prev)!, vLast);
    facts.push(`${what}: ${fmt(vFirst)} (${first}) → ${fmt(vLast)} (${last})` + (overall ? `, ${overall} overall` : '') + (step ? `; ${step} vs ${prev}` : ''));
    const peak = sorted.reduce((a, b) => (byX.get(b)! > byX.get(a)! ? b : a));
    const low = sorted.reduce((a, b) => (byX.get(b)! < byX.get(a)! ? b : a));
    if (peak !== last || low !== first) facts.push(`peak ${fmt(byX.get(peak)!)} in ${peak}, low ${fmt(byX.get(low)!)} in ${low}`);
  } else if (!temporal && xTotalsValid) {
    const ranked = order.map((k) => [k, byX.get(k)!] as const).sort((a, b) => b[1] - a[1]);
    const total = ranked.reduce((a, b) => a + b[1], 0);
    const top = ranked[0];
    const bottom = ranked[ranked.length - 1];
    if (additive && total > 0 && ranked.every((r) => r[1] >= 0)) {
      facts.push(`${top[0]} leads ${what} with ${fmt(top[1])} (${((top[1] / total) * 100).toFixed(1)}% of ${fmt(total)}); lowest is ${bottom[0]} with ${fmt(bottom[1])}`);
      if (ranked.length >= 6) {
        const top3 = ranked.slice(0, 3).reduce((a, b) => a + b[1], 0);
        facts.push(`top 3 of ${ranked.length} (${ranked.slice(0, 3).map((r) => r[0]).join(', ')}) hold ${((top3 / total) * 100).toFixed(1)}%`);
      }
    } else {
      const mean = total / ranked.length;
      facts.push(`highest ${yName}: ${top[0]} (${fmt(top[1])}); lowest: ${bottom[0]} (${fmt(bottom[1])}); average ${fmt(mean)}`);
    }
  }

  if (split && additive) {
    const ranked = [...bySeries.entries()].sort((a, b) => b[1] - a[1]);
    const total = ranked.reduce((a, b) => a + b[1], 0);
    if (total > 0 && ranked.every((r) => r[1] >= 0)) {
      facts.push(`by ${columns[seriesIdx]}: ${ranked.slice(0, 3).map(([s, v]) => `${s} ${((v / total) * 100).toFixed(1)}%`).join(', ')}${ranked.length > 3 ? ` (+${ranked.length - 3} more)` : ''}`);
    }
  } else if (split) {
    // A rate per series: compare the series at their latest (or only) x value
    const lastX = temporal && order.every((k) => SORTABLE_TIME.test(k)) ? [...order].sort().pop()! : order[order.length - 1];
    const latest = rows
      .filter((r) => label(r[xIdx]) === lastX)
      .map((r) => [label(r[seriesIdx]), num(r[yIdx])] as const)
      .filter((p): p is readonly [string, number] => p[1] !== null)
      .sort((a, b) => b[1] - a[1]);
    if (latest.length >= 2) {
      const lo = latest[latest.length - 1];
      facts.push(`${yName} at ${lastX}: highest ${latest[0][0]} (${fmt(latest[0][1])}), lowest ${lo[0]} (${fmt(lo[1])})`);
    }
  }
  return facts.slice(0, MAX_FACTS);
}

/**
 * Reviews one widget against the result of its query.
 * `result` undefined means the query could not be run here (not verified).
 */
export function reviewWidget(widget: DashboardWidget, result: QueryExecutionResult | undefined): WidgetReview {
  const review: WidgetReview = { id: widget.id, kind: widget.kind, rows: 0, columns: [], issues: [], advice: [], facts: [] };
  if (!result) return review;
  if (!result.ok) {
    review.issues.push(`The query fails: ${result.error ?? 'unknown SQL error'}. Fix the SQL.`);
    return review;
  }
  const columns = result.columns;
  const rows = result.rows as Cell[][];
  review.rows = rows.length;
  review.columns = columns;
  const meta = getChartMeta(widget.kind);
  const shape = `"${widget.kind}" expects: ${meta.sqlShapeHint}`;
  const { issues, advice } = review;

  // Field names that are not in the result are silently replaced by a guess
  for (const [key, arg] of NAMED_FIELDS) {
    const name = widget[key] as string | undefined;
    if (name && !columns.includes(name)) {
      issues.push(`${arg} "${name}" is not a column of the result (columns: ${columns.join(', ')}). Use an exact result column name or alias.`);
    }
  }
  for (const name of widget.yFields ?? []) {
    if (!columns.includes(name)) {
      issues.push(`y_fields "${name}" is not a column of the result (columns: ${columns.join(', ')}). Use an exact result column name or alias.`);
    }
  }

  if (rows.length === 0) {
    issues.push('The query returns 0 rows with the current filter values, so the chart is empty. Check the WHERE clause, the literal values (run_query a SELECT DISTINCT) and the filter bindings.');
    return review;
  }

  const profiles = profileColumns(columns, rows);
  const map = mapColumns(widget, columns, profiles);
  const { xIdx, seriesIdx, yIndices } = map;
  const numericCount = profiles.filter((p) => p.numeric).length;
  const x = profiles[xIdx];
  const usesFilter = /(^|[^:]):[a-zA-Z_]\w*/.test(widget.sql);

  const minColumns = MIN_COLUMNS[widget.kind] ?? 2;
  const minNumeric = MIN_NUMERIC[widget.kind] ?? 1;
  if (columns.length < minColumns) {
    issues.push(`The result has ${columns.length} ${columns.length === 1 ? 'column' : 'columns'} (${columns.join(', ')}) but ${shape}.`);
  } else if (numericCount < minNumeric) {
    issues.push(`The result has ${numericCount} numeric ${numericCount === 1 ? 'column' : 'columns'} but "${widget.kind}" needs ${minNumeric}; ${shape}.`);
  }

  if (widget.kind === 'kpi') {
    if (rows.length > 1) {
      issues.push(`A kpi card shows only the first of ${rows.length} rows. Aggregate to exactly one row (or ORDER BY the period DESC LIMIT 1 for the latest value).`);
    }
    const yIdx = yIndices[0];
    if (yIdx !== undefined && rows[0][yIdx] === null) {
      issues.push(`The kpi value "${columns[yIdx]}" is NULL. Check the WHERE clause and the aggregate.`);
    }
    if (rows.length === 1 && numericCount === 1 && widget.chartConfig?.targetValue === undefined) {
      advice.push('A number without context: add a second column with the change vs the previous period (e.g. mom_pct, computed in SQL) and set comparison_field, or set chart_config.target_value.');
    }
  } else if (rows.length === 1 && !SINGLE_ROW_OK.has(widget.kind) && !usesFilter) {
    issues.push(`The query returns a single row, so a ${widget.kind} has nothing to compare. Use kind "kpi" for one number, or GROUP BY a dimension.`);
  }

  if (RAW_ROW_KINDS.has(widget.kind) && rows.length > 1 && rows.length < 8) {
    issues.push(`A ${widget.kind} needs raw rows (one per observation) but the query returns ${rows.length}. Remove the GROUP BY / aggregate and select the raw numeric column.`);
  }

  // Long-format rows drawn without a series split, or rows that were never aggregated
  if (x && seriesIdx < 0 && x.distinct < rows.length && rows.length <= PROFILE_ROWS) {
    const candidate = profiles.find((p) => !p.numeric && p.idx !== xIdx && p.distinct >= 2 && p.distinct <= 12);
    if (SPLITTABLE.has(widget.kind)) {
      issues.push(
        `"${x.name}" repeats (${x.distinct} distinct values in ${rows.length} rows), so marks overlap. ` +
        (candidate ? `Set series_field: "${candidate.name}" to split the series, or aggregate` : 'Aggregate') +
        ` to one row per ${x.name}.`,
      );
    } else if (ONE_ROW_PER_X.has(widget.kind)) {
      issues.push(`"${x.name}" repeats (${x.distinct} distinct values in ${rows.length} rows). Aggregate to one row per ${x.name} (GROUP BY ${x.name}).`);
    }
  }

  if (NEEDS_SERIES.has(widget.kind) && seriesIdx < 0 && yIndices.length < 2 && columns.length >= 2) {
    issues.push(`A ${widget.kind} needs several series but the result has one metric and no series_field. Add a series column (category, series, metric) and set series_field, or use kind "bar".`);
  }

  if ((widget.kind === 'pie' || widget.kind === 'donut') && yIndices[0] !== undefined &&
      rows.some((r) => (num(r[yIndices[0]]) ?? 0) < 0)) {
    issues.push(`A ${widget.kind} cannot show negative values. Use kind "bar" (or "waterfall" for signed contributions).`);
  }

  // Trends must read left to right in time
  if (TREND_KINDS.has(widget.kind) && x) {
    const labels = [...new Set(rows.map((r) => label(r[xIdx])))];
    if (labels.length >= 3 && labels.every((l) => SORTABLE_TIME.test(l))) {
      const sorted = [...labels].sort();
      if (labels.some((l, i) => l !== sorted[i])) {
        issues.push(`The ${widget.kind} is not in time order: add ORDER BY ${x.name} ASC so the trend reads left to right.`);
      }
    } else if (!x.temporal && !x.numeric && labels.length >= 2) {
      advice.push(`"${x.name}" is a category, not time: a ${widget.kind} suggests a trend between unrelated items. ${patchForModel(widget.id, { kind: labels.length > 8 ? 'horizontal_bar' : 'bar', chartConfig: { sortBy: 'value_desc' } })}`);
    }
  }

  if (BAR_FAMILY.has(widget.kind) && x && seriesIdx < 0 && widget.chartConfig?.limitItems === undefined) {
    if (x.temporal && x.distinct > 24) {
      advice.push(`${x.distinct} periods as bars are hard to read: a line shows the trend. ${patchForModel(widget.id, { kind: 'line' })}`);
    } else if (!x.temporal && x.distinct > (widget.kind === 'horizontal_bar' ? 15 : 12)) {
      advice.push(`${x.distinct} categories crowd the chart: show the top 10. ${patchForModel(widget.id, { kind: 'horizontal_bar', chartConfig: { sortBy: 'value_desc', limitItems: 10 } })}`);
    }
  }

  if (seriesIdx >= 0) {
    const series = profiles[seriesIdx].distinct;
    const limit = widget.kind === 'grouped_bar' ? 4 : widget.kind === 'stacked_bar' || widget.kind === 'area' || widget.kind === 'streamgraph' ? 7 : 0;
    if (limit > 0 && series > limit) {
      advice.push(`${series} series are too many for a ${widget.kind} (keep at most ${limit}): keep the largest and group the rest as 'Other' in SQL (CASE WHEN … THEN … ELSE 'Other' END), or facet with kind "trellis".`);
    }
  }

  if (widget.kind === 'table' && rows.length > 50) {
    advice.push(`${rows.length} rows are a data dump, not a detail table: ORDER BY the key metric DESC and LIMIT 20–50.`);
  }

  if (result.truncated) {
    advice.push(`The result was cut at ${rows.length} rows: aggregate in SQL (GROUP BY) so the chart shows all the data.`);
  }

  if (widget.format === undefined && widget.kind !== 'table' && yIndices[0] !== undefined) {
    const yName = columns[yIndices[0]];
    const format = PERCENT_NAME.test(yName) ? 'percent' : CURRENCY_NAME.test(yName) ? 'currency_usd' : undefined;
    if (format) advice.push(`"${yName}" has no value format. ${patchForModel(widget.id, { format })}`);
  }

  for (const a of adviseChartStorytelling(widget, result)) {
    // A gauge the user asked for stays a gauge
    if (a.id === 'gauge_to_bullet') continue;
    const patch = a.id === 'bar_zero_baseline'
      ? { chartConfig: { startFromZero: true, yMin: 0 } }
      : (a.quickFix?.patch as Record<string, unknown> | undefined);
    advice.push(`${a.message}${patch ? ` ${patchForModel(widget.id, patch)}` : ''}`);
  }
  review.advice = advice.slice(0, MAX_ADVICE);

  if (issues.length === 0) review.facts = factsOf(widget, columns, rows, profiles, map);
  return review;
}

/** Layout rules of the 12-column grid: KPIs first, full rows, variety. */
export function reviewDashboardLayout(d: DashboardSpec): string[] {
  const notes: string[] = [];
  const widgets = d.widgets;
  if (widgets.length === 0) return notes;
  const kpis = widgets.filter((w) => w.kind === 'kpi');
  const charts = widgets.filter((w) => w.kind !== 'kpi' && w.kind !== 'table');

  if (kpis.length === 0 && widgets.length >= 3) {
    notes.push('No headline KPI: lead with 2–4 kpi cards (col_span 3 or 4) that answer "how are we doing?" before the charts.');
  }
  const firstOther = widgets.findIndex((w) => w.kind !== 'kpi');
  if (firstOther >= 0 && widgets.slice(firstOther).some((w) => w.kind === 'kpi')) {
    notes.push('KPI cards are mixed in between charts: put them first with reorder_widgets (KPIs, then trends and breakdowns, then tables).');
  }
  const tableIdx = widgets.findIndex((w) => w.kind === 'table');
  if (tableIdx >= 0 && widgets.slice(tableIdx).some((w) => w.kind !== 'table')) {
    notes.push('Detail tables belong at the bottom: move them after the charts with reorder_widgets.');
  }

  // Rows of the grid: a widget that does not fit wraps and leaves a hole
  let used = 0;
  let row: string[] = [];
  const gaps: string[] = [];
  const closeRow = () => {
    if (used > 0 && used < 12) gaps.push(`${row.join(' + ')} = ${used}/12`);
    used = 0;
    row = [];
  };
  for (const w of widgets) {
    if (used + w.colSpan > 12) closeRow();
    used += w.colSpan;
    row.push(`${w.id} (${w.colSpan})`);
    if (used === 12) closeRow();
  }
  closeRow();
  if (gaps.length > 0) {
    notes.push(`Rows that do not fill the 12 columns leave holes: ${gaps.join('; ')}. Change col_span so every row sums to 12 (e.g. 3+3+3+3, 4+4+4, 8+4, 6+6, 12).`);
  }

  if (charts.length >= 3 && charts.every((w) => w.kind === charts[0].kind)) {
    notes.push(`All ${charts.length} charts are "${charts[0].kind}": each chart should answer a different question (trend → line/area, ranking → horizontal_bar, share → donut/treemap, relationship → scatter).`);
  }
  if (widgets.length > 12) {
    notes.push(`${widgets.length} widgets on one dashboard dilute the message: keep the 6–10 that answer the question and move the rest to a new page.`);
  }
  return notes;
}

/** Only the fields that say something, so the tool response stays small. */
export function reviewForModel(r: WidgetReview): Record<string, unknown> {
  return {
    id: r.id,
    kind: r.kind,
    rows: r.rows,
    ...(r.columns.length > 0 ? { columns: r.columns.slice(0, 16) } : {}),
    ...(r.issues.length > 0 ? { issues: r.issues } : {}),
    ...(r.advice.length > 0 ? { advice: r.advice } : {}),
    ...(r.facts.length > 0 ? { facts: r.facts } : {}),
  };
}

/** "kind: result columns it expects", one line per chart kind, for the system instruction. */
export const CHART_SHAPE_GUIDE: string = CHART_CATALOG.map((c) => `${c.kind}: ${c.sqlShapeHint}`).join('\n');
