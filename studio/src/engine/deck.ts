/**
 * The Deck of a page: a professional slide presentation built from the page's
 * live dashboard, diagram and documentation, or written slide by slide.
 *
 * A deck is structured data, not pictures: every slide has a layout (title,
 * section, kpis, chart, points, flow, table, statement, closing) and the
 * fields that layout shows. The same model renders in the studio
 * (ui/deck/), presents full screen, and exports to an editable PowerPoint
 * file with native charts and speaker notes (deck-export/pptx.ts), which
 * Google Slides opens as well (deck-export/googleSlides.ts).
 *
 * Chart slides can be bound to a dashboard widget (`widgetId`): building from
 * the page fills them from that widget's SQL result, and "Sync data" refreshes
 * the numbers without touching the words the user wrote.
 *
 * Chart, table and kpis slides can also carry their own read-only SQL query
 * (`query`, and `query` on a metric): the caller runs it (agent/deckQueries.ts)
 * and passes the results in; the slide is filled from them and "Sync data"
 * runs it again. This is how a voice request puts live data straight on a slide
 * without a dashboard widget.
 */
import type { QueryExecutionResult } from '../data/sqlEngine';
import { VALUE_FORMATS, formatMetricValue, type DashboardWidget, type ValueFormat, type WidgetKind } from './dashboard';
import { resolveRef } from './resolve';
import type { Scene } from './types';

export const DECK_THEMES = ['midnight', 'graphite', 'forest', 'ocean', 'terracotta', 'berry'] as const;
export type DeckThemeName = (typeof DECK_THEMES)[number];

export const SLIDE_LAYOUTS = ['title', 'section', 'kpis', 'chart', 'points', 'flow', 'table', 'statement', 'closing'] as const;
export type SlideLayout = (typeof SLIDE_LAYOUTS)[number];

export const DECK_CHART_TYPES = ['column', 'bar', 'stacked_column', 'line', 'area', 'donut'] as const;
export type DeckChartType = (typeof DECK_CHART_TYPES)[number];

export type Trend = 'up' | 'down' | 'flat';

/** A read-only SQL query whose result fills a slide (chart, table) or a metric. */
export interface SlideQuery {
  sql: string;
  /** Data source id: "local", "bigquery", "clickhouse", "postgres", "rest:<name>". */
  source: string;
  /** How the values are shown, e.g. currency_usd, percent. */
  format?: ValueFormat;
  unit?: string;
}

/** Results of slide queries, by queryKey(). */
export type QueryResults = Map<string, QueryExecutionResult>;

export const queryKey = (q: Pick<SlideQuery, 'sql' | 'source'>): string => `${q.source.trim()}\0${q.sql.trim()}`;

export interface DeckMetric {
  label: string;
  /** The figure as shown, already formatted ("$266.5K", "116.7%"). */
  value: string;
  /** Change shown under the figure, e.g. "+34.6% vs H2". */
  delta?: string;
  trend?: Trend;
  note?: string;
  /** Dashboard KPI widget the figure comes from (refreshed by "Sync data"). */
  widgetId?: string;
  /** The figure's own SQL query (first row), refreshed by "Sync data". */
  query?: SlideQuery;
}

/** A card of a points slide, a step of a flow, or a next step of the closing slide. */
export interface DeckPoint {
  title: string;
  text?: string;
}

export interface DeckSeries {
  name: string;
  values: number[];
}

export interface DeckChart {
  type: DeckChartType;
  categories: string[];
  series: DeckSeries[];
  format?: ValueFormat;
  unit?: string;
  /** 0-based category drawn in the accent color (single-series bar and column charts). */
  highlight?: number;
}

export interface Slide {
  id: string;
  layout: SlideLayout;
  /** The message of the slide: a full-sentence headline on content slides. */
  title: string;
  subtitle?: string;
  /** Small label above the title, e.g. "REVENUE" or "AT A GLANCE". */
  kicker?: string;
  /** Speaker notes (exported as PowerPoint notes). */
  notes?: string;
  /** Source line in the footer, e.g. "Source: monthly_revenue (SQL)". */
  source?: string;
  metrics?: DeckMetric[];
  chart?: DeckChart;
  /** Dashboard widget whose live result fills `chart`. */
  widgetId?: string;
  /** The slide's own SQL query that fills `chart` (chart slides) or `columns`/`rows` (table slides). */
  query?: SlideQuery;
  points?: DeckPoint[];
  columns?: string[];
  rows?: string[][];
  takeaways?: string[];
}

export interface DeckSpec {
  title: string;
  subtitle?: string;
  theme: DeckThemeName;
  /** Presenter or team, shown on the title slide. */
  author?: string;
  /** Shown on the title slide, e.g. "November 2026". */
  date?: string;
  slides: Slide[];
}

export const LIMITS = {
  slides: 30,
  metrics: 4,
  points: 4,
  flowSteps: 6,
  nextSteps: 4,
  takeaways: 3,
  closingTakeaways: 4,
  tableColumns: 6,
  tableRows: 8,
  series: 4,
  categories: 12,
  lineCategories: 24,
  donutCategories: 6,
} as const;

const TEXT = { title: 120, subtitle: 200, kicker: 40, notes: 3000, source: 140, label: 60, value: 24, delta: 40, note: 80, pointTitle: 70, pointText: 220, takeaway: 160, cell: 60, category: 40 };

// ---------------------------------------------------------------------------
// Input (tool arguments: snake_case or camelCase)
// ---------------------------------------------------------------------------

export interface DeckChartInput {
  type?: DeckChartType;
  categories?: unknown[];
  series?: { name?: string; values?: unknown[] }[];
  format?: ValueFormat;
  unit?: string;
  highlight_index?: number;
  highlight?: number;
}

/** A query given with a slide or metric: `sql` + `data_source` (tool arguments) or a stored `query`. */
export interface QueryInput {
  /** Read-only SQL; "" or null removes the query (the data stays as it is). */
  sql?: string | null;
  data_source?: string;
  dataSource?: string;
  /** Value format of a metric's figure. */
  format?: ValueFormat;
  unit?: string;
  query?: SlideQuery | null;
}

export interface SlideInput extends QueryInput {
  id?: string;
  layout?: SlideLayout;
  title?: string;
  subtitle?: string;
  kicker?: string;
  notes?: string;
  source?: string;
  metrics?: (QueryInput & { label?: string; value?: unknown; delta?: string; trend?: Trend; note?: string; widget_id?: string; widgetId?: string })[];
  /** null removes the chart's own data (e.g. when a widget gives it). */
  chart?: DeckChartInput | null;
  widget_id?: string;
  widgetId?: string;
  points?: { title?: string; text?: string }[];
  /** Alias of points for flow slides. */
  steps?: { title?: string; label?: string; text?: string; detail?: string }[];
  next_steps?: { title?: string; text?: string }[];
  columns?: unknown[];
  rows?: unknown[][];
  takeaways?: unknown[];
}

export interface CreateDeckRequest {
  title?: string;
  subtitle?: string;
  theme?: DeckThemeName;
  author?: string;
  /** Without slides: build the deck from the page's dashboard, diagram and documentation. */
  from_current_page?: boolean;
  slides?: SlideInput[];
  new_page?: boolean;
  replace?: boolean;
}

export interface EditDeckRequest {
  summary?: string;
  title?: string;
  subtitle?: string;
  theme?: DeckThemeName;
  author?: string;
  add_slides?: (SlideInput & { after?: string })[];
  update_slides?: (SlideInput & { id: string })[];
  remove_slides?: string[];
  reorder_slides?: string[];
}

export interface DeckOpResult {
  ok: boolean;
  deck: DeckSpec;
  addedSlides: string[];
  updatedSlides: string[];
  removedSlides: string[];
  errors: string[];
  warnings: string[];
  notes: string[];
}

type Results = Record<string, QueryExecutionResult | undefined>;

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

const clip = (v: unknown, max: number): string => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
};
const opt = (v: unknown, max: number): string | undefined => {
  if (v === undefined || v === null) return undefined;
  const s = clip(v, max);
  return s === '' ? undefined : s;
};
const toNum = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

function slideSlug(raw: string, fallback: string): string {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 36);
  return s && !/^\d/.test(s) ? s : fallback;
}

function uniqueSlideId(base: string, used: Set<string>): string {
  let id = base;
  let n = 2;
  while (used.has(id)) id = `${base}_${n++}`;
  used.add(id);
  return id;
}

function normalizeChart(input: DeckChartInput | null | undefined, warnings: string[]): DeckChart | undefined {
  if (input == null || typeof input !== 'object') return undefined;
  const type: DeckChartType = DECK_CHART_TYPES.includes(input.type as DeckChartType) ? (input.type as DeckChartType) : 'column';
  const max = type === 'line' || type === 'area' ? LIMITS.lineCategories : type === 'donut' ? LIMITS.donutCategories : LIMITS.categories;
  let categories = (Array.isArray(input.categories) ? input.categories : []).map((c) => clip(c, TEXT.category));
  const rawSeries = (Array.isArray(input.series) ? input.series : []).filter((s) => s != null && typeof s === 'object');
  let series: DeckSeries[] = rawSeries.slice(0, type === 'donut' ? 1 : LIMITS.series).map((s, i) => ({
    name: clip(s.name ?? (rawSeries.length === 1 ? 'Value' : `Series ${i + 1}`), TEXT.label) || `Series ${i + 1}`,
    values: (Array.isArray(s.values) ? s.values : []).map(toNum),
  }));
  if (series.length === 0 || categories.length === 0) {
    warnings.push('A chart needs categories and at least one series with values; the chart was left out.');
    return undefined;
  }
  if (categories.length > max) {
    warnings.push(`A ${type} chart shows at most ${max} categories; kept the first ${max}.`);
    categories = categories.slice(0, max);
  }
  series = series.map((s) => ({ ...s, values: categories.map((_, i) => s.values[i] ?? 0) }));
  const format = VALUE_FORMATS.includes(input.format as ValueFormat) ? input.format : undefined;
  const hi = input.highlight_index ?? input.highlight;
  return {
    type,
    categories,
    series,
    ...(format ? { format } : {}),
    ...(opt(input.unit, 16) ? { unit: opt(input.unit, 16) } : {}),
    ...(typeof hi === 'number' && hi >= 0 && hi < categories.length ? { highlight: Math.round(hi) } : {}),
  };
}

function normalizePoints(raw: unknown, max: number): DeckPoint[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const points = raw
    .filter((p) => p != null)
    .map((p) => (typeof p === 'string' ? { title: p } : (p as Record<string, unknown>)))
    .map((p) => ({
      title: clip(p.title ?? p.label ?? '', TEXT.pointTitle),
      ...(opt(p.text ?? p.detail, TEXT.pointText) ? { text: opt(p.text ?? p.detail, TEXT.pointText) } : {}),
    }))
    .filter((p) => p.title !== '' || p.text != null)
    .map((p) => (p.title === '' ? { title: p.text!.slice(0, TEXT.pointTitle) } : p))
    .slice(0, max);
  return points;
}

/**
 * The query given with a slide or metric: a SlideQuery, null to remove it, or
 * undefined when none is given. A query without a data source uses "local";
 * callers fill `data_source` with the page's default first (deckQueries.ts).
 */
export function queryOfInput(input: QueryInput): SlideQuery | null | undefined {
  const stored = input.query;
  if (stored === null) return null;
  const raw = input.sql !== undefined ? input.sql : stored?.sql;
  if (raw === undefined) return undefined;
  if (raw === null || String(raw).trim() === '') return null;
  const src = String(input.data_source ?? input.dataSource ?? stored?.source ?? 'local').trim() || 'local';
  const format = VALUE_FORMATS.includes(input.format as ValueFormat) ? input.format : VALUE_FORMATS.includes(stored?.format as ValueFormat) ? stored?.format : undefined;
  const unit = opt(input.unit ?? stored?.unit, 16);
  return { sql: String(raw).trim().slice(0, 8000), source: src.slice(0, 80), ...(format ? { format } : {}), ...(unit ? { unit } : {}) };
}

const CHART_KIND: Record<DeckChartType, WidgetKind> = {
  column: 'column', bar: 'horizontal_bar', stacked_column: 'stacked_bar', line: 'line', area: 'area', donut: 'donut',
};

/** A slide query seen as a dashboard widget, so the dashboard's result readers apply. */
function queryWidget(id: string, title: string, q: SlideQuery, kind: WidgetKind): DashboardWidget {
  return { id, title, kind, source: q.source, sql: q.sql, colSpan: 6, ...(q.format ? { format: q.format } : {}), ...(q.unit ? { unit: q.unit } : {}) };
}

/** Short preview of what a query gave, told to the agent so it can write the title. */
function chartPreview(c: DeckChart): string {
  const s = c.series[0];
  const pairs = c.categories.slice(0, 6).map((cat, i) => `${cat} ${formatMetricValue(s.values[i] ?? 0, c.format ?? 'number', c.unit)}`);
  return `${c.type}, ${c.categories.length} categories × ${c.series.length} series (${c.series.map((x) => x.name).join(', ')}): ${pairs.join('; ')}${c.categories.length > 6 ? '; …' : ''}`;
}

/**
 * Fills a slide (and its metrics) from the results of its queries. `chartType`
 * is the type asked for now; otherwise a chart keeps the type it had.
 * Returns what it filled, for the agent.
 */
function fillFromQueries(slide: Slide, results: QueryResults, warnings: string[], chartType?: DeckChartType): string[] {
  const filled: string[] = [];
  const q = slide.query;
  if (q) {
    const res = results.get(queryKey(q));
    if (res && slide.layout === 'chart') {
      const type = chartType ?? slide.chart?.type;
      const chart = chartFromWidget(queryWidget(slide.id, slide.title, q, type ? CHART_KIND[type] : 'column'), res);
      if (chart) {
        const fixed = type && !(type === 'donut' && (chart.series.length > 1 || chart.categories.length > LIMITS.donutCategories)) ? type : chart.type;
        slide.chart = { ...chart, type: fixed, ...(fixed !== 'bar' && fixed !== 'column' ? { highlight: undefined } : {}) };
        if (slide.chart.highlight === undefined) delete slide.chart.highlight;
        delete slide.widgetId;
        filled.push(`slide ${slide.id}: ${chartPreview(slide.chart)}`);
      } else {
        warnings.push(`Slide ${slide.id}: the query returned nothing that can be charted (it needs a label column and a numeric column).`);
      }
    } else if (res && slide.layout === 'table') {
      const t = tableFromWidget(queryWidget(slide.id, slide.title, q, 'table'), res);
      if (t) {
        slide.columns = t.columns;
        slide.rows = t.rows;
        delete slide.widgetId;
        filled.push(`slide ${slide.id}: table ${t.columns.join(' | ')} (${t.rows.length} rows${res.rows.length > t.rows.length ? ` of ${res.rows.length}` : ''})`);
      } else {
        warnings.push(`Slide ${slide.id}: the query returned no rows.`);
      }
    }
  }
  slide.metrics?.forEach((m, i) => {
    if (!m.query) return;
    const res = results.get(queryKey(m.query));
    if (!res) return;
    const fresh = metricFromWidget(queryWidget(`${slide.id}_m${i + 1}`, m.label, m.query, 'kpi'), res);
    if (!fresh) {
      warnings.push(`Slide ${slide.id}: the query of "${m.label}" returned no rows.`);
      return;
    }
    m.value = fresh.value;
    if (fresh.delta) m.delta = fresh.delta;
    if (fresh.trend) m.trend = fresh.trend;
    delete m.widgetId;
    filled.push(`slide ${slide.id}: ${m.label} = ${m.value}${m.delta ? ` (${m.delta})` : ''}`);
  });
  return filled;
}

/** Every query of a deck (slides and metrics), once each. */
export function deckQueries(deck: DeckSpec): SlideQuery[] {
  const out = new Map<string, SlideQuery>();
  for (const s of deck.slides) {
    if (s.query) out.set(queryKey(s.query), s.query);
    for (const m of s.metrics ?? []) if (m.query) out.set(queryKey(m.query), m.query);
  }
  return [...out.values()];
}

/** Applies the fields given in `input` onto `slide` (missing fields stay). */
function applySlideFields(slide: Slide, input: SlideInput, warnings: string[], results?: QueryResults, filled?: string[]) {
  if (input.layout !== undefined && SLIDE_LAYOUTS.includes(input.layout)) slide.layout = input.layout;
  if (input.title !== undefined && clip(input.title, TEXT.title) !== '') slide.title = clip(input.title, TEXT.title);
  const strField = (key: 'subtitle' | 'kicker' | 'notes' | 'source', max: number) => {
    const v = input[key];
    if (v === undefined) return;
    const s = opt(v, max);
    if (s == null) delete slide[key];
    else slide[key] = key === 'kicker' ? s.toUpperCase() : s;
  };
  strField('subtitle', TEXT.subtitle);
  strField('kicker', TEXT.kicker);
  strField('notes', TEXT.notes);
  strField('source', TEXT.source);

  if (Array.isArray(input.metrics)) {
    if (input.metrics.length > LIMITS.metrics) warnings.push(`A kpis slide shows at most ${LIMITS.metrics} metrics; kept the first ${LIMITS.metrics}.`);
    slide.metrics = input.metrics
      .filter((m) => m != null && (m.label != null || m.value != null))
      .slice(0, LIMITS.metrics)
      .map((m) => {
        const trend: Trend | undefined = m.trend === 'up' || m.trend === 'down' || m.trend === 'flat'
          ? m.trend
          : typeof m.delta === 'string' && /^\s*[+▲↑]/.test(m.delta) ? 'up'
            : typeof m.delta === 'string' && /^\s*[-−▼↓]/.test(m.delta) ? 'down' : undefined;
        const widgetId = m.widgetId ?? m.widget_id;
        const query = queryOfInput(m);
        return {
          label: clip(m.label ?? 'Metric', TEXT.label),
          value: clip(m.value ?? '—', TEXT.value),
          ...(opt(m.delta, TEXT.delta) ? { delta: opt(m.delta, TEXT.delta) } : {}),
          ...(trend ? { trend } : {}),
          ...(opt(m.note, TEXT.note) ? { note: opt(m.note, TEXT.note) } : {}),
          ...(widgetId && !query ? { widgetId: String(widgetId) } : {}),
          ...(query ? { query } : {}),
        };
      });
  }
  const query = queryOfInput(input);
  const chartIn = input.chart;
  const hasData = chartIn != null && typeof chartIn === 'object' && Array.isArray(chartIn.categories) && chartIn.categories.length > 0;
  // A live slide keeps its query's numbers: chart data typed alongside (often copied back by the agent) only gives the look
  const keepsLive = hasData && slide.query != null && slide.chart != null && input.sql === undefined && input.query === undefined;
  if (keepsLive) warnings.push(`Slide ${slide.id}: the chart data comes from its SQL; kept the live data and applied only the type, format and highlight. Pass sql: "" to type the data yourself.`);
  const typeOnly = chartIn != null && typeof chartIn === 'object' && (!hasData || keepsLive);
  const askedType = chartIn != null && DECK_CHART_TYPES.includes(chartIn.type as DeckChartType) ? (chartIn.type as DeckChartType) : undefined;
  if (chartIn !== undefined) {
    if (typeOnly && slide.chart) {
      // A new type, format or highlight for the data the chart already has
      const format = VALUE_FORMATS.includes(chartIn.format as ValueFormat) ? chartIn.format : slide.chart.format;
      slide.chart = { ...slide.chart, ...(askedType ? { type: askedType } : {}), ...(format ? { format } : {}) };
      const hi = chartIn.highlight_index ?? chartIn.highlight;
      if (typeof hi === 'number' && hi >= 0 && hi < slide.chart.categories.length) slide.chart.highlight = Math.round(hi);
    } else if (!(typeOnly && (query || slide.query))) {
      const chart = normalizeChart(chartIn, warnings);
      if (chart) slide.chart = chart;
      else if (chartIn === null) delete slide.chart;
    }
  }
  const widgetId = input.widgetId ?? input.widget_id;
  if (widgetId !== undefined) {
    if (widgetId === '' || widgetId === null) delete slide.widgetId;
    else {
      slide.widgetId = String(widgetId);
      delete slide.query;
    }
  }
  if (query === null) delete slide.query;
  else if (query) {
    slide.query = query;
    if (!query.format && chartIn && VALUE_FORMATS.includes(chartIn.format as ValueFormat)) slide.query.format = chartIn.format;
    delete slide.widgetId;
  }
  const pointsRaw = input.points ?? input.steps ?? input.next_steps;
  if (pointsRaw !== undefined) {
    const layout = slide.layout;
    const max = layout === 'flow' ? LIMITS.flowSteps : layout === 'closing' ? LIMITS.nextSteps : LIMITS.points;
    if (Array.isArray(pointsRaw) && pointsRaw.length > max) {
      warnings.push(`A ${layout} slide shows at most ${max} ${layout === 'flow' ? 'steps' : 'points'}; kept the first ${max}.`);
    }
    const points = normalizePoints(pointsRaw, max);
    if (points && points.length > 0) slide.points = points;
    else delete slide.points;
  }
  if (Array.isArray(input.columns)) {
    if (input.columns.length > LIMITS.tableColumns) warnings.push(`A table slide shows at most ${LIMITS.tableColumns} columns.`);
    slide.columns = input.columns.slice(0, LIMITS.tableColumns).map((c) => clip(c, TEXT.cell));
  }
  if (Array.isArray(input.rows)) {
    if (input.rows.length > LIMITS.tableRows) warnings.push(`A table slide shows at most ${LIMITS.tableRows} rows; put the rest in the notes or split the table.`);
    const width = slide.columns?.length ?? Math.min(LIMITS.tableColumns, Math.max(0, ...input.rows.map((r) => (Array.isArray(r) ? r.length : 0))));
    slide.rows = input.rows
      .filter((r) => Array.isArray(r))
      .slice(0, LIMITS.tableRows)
      .map((r) => Array.from({ length: width }, (_, i) => clip(r[i] ?? '', TEXT.cell)));
  }
  if (input.takeaways !== undefined) {
    const max = slide.layout === 'closing' ? LIMITS.closingTakeaways : LIMITS.takeaways;
    const list = (Array.isArray(input.takeaways) ? input.takeaways : [])
      .map((t) => clip(t, TEXT.takeaway))
      .filter((t) => t !== '');
    if (list.length > max) warnings.push(`A ${slide.layout} slide shows at most ${max} takeaways; kept the first ${max}.`);
    if (list.length > 0) slide.takeaways = list.slice(0, max);
    else delete slide.takeaways;
  }
  if (results && results.size > 0) {
    const out = fillFromQueries(slide, results, warnings, askedType);
    filled?.push(...out);
  }
}

/** Says what a slide is missing for its layout (shown to the agent as a warning). */
function layoutGaps(s: Slide): string | null {
  switch (s.layout) {
    case 'kpis':
      return (s.metrics?.length ?? 0) === 0 ? `Slide ${s.id} (kpis) has no metrics yet.` : null;
    case 'chart':
      return s.chart == null && s.widgetId == null ? `Slide ${s.id} (chart) has no chart data${s.query ? ' (its query gave none)' : ' and no widget_id or sql'}.` : null;
    case 'points':
      return (s.points?.length ?? 0) === 0 ? `Slide ${s.id} (points) has no points yet.` : null;
    case 'flow':
      return (s.points?.length ?? 0) < 2 ? `Slide ${s.id} (flow) needs at least 2 steps.` : null;
    case 'table':
      return (s.rows?.length ?? 0) === 0 || (s.columns?.length ?? 0) === 0 ? `Slide ${s.id} (table) needs columns and rows.` : null;
    default:
      return null;
  }
}

function newSlide(input: SlideInput, used: Set<string>, index: number, warnings: string[], results?: QueryResults, filled?: string[]): Slide {
  const layout: SlideLayout = SLIDE_LAYOUTS.includes(input.layout as SlideLayout) ? (input.layout as SlideLayout) : 'points';
  const title = clip(input.title ?? '', TEXT.title) || (layout === 'title' ? 'Untitled presentation' : `Slide ${index + 1}`);
  const id = uniqueSlideId(slideSlug(input.id ?? title, `slide_${index + 1}`), used);
  const slide: Slide = { id, layout, title };
  applySlideFields(slide, { ...input, layout, title }, warnings, results, filled);
  return slide;
}

export function cloneDeck(d: DeckSpec): DeckSpec {
  return {
    ...d,
    slides: d.slides.map((s) => ({
      ...s,
      ...(s.metrics ? { metrics: s.metrics.map((m) => ({ ...m, ...(m.query ? { query: { ...m.query } } : {}) })) } : {}),
      ...(s.query ? { query: { ...s.query } } : {}),
      ...(s.chart ? { chart: { ...s.chart, categories: [...s.chart.categories], series: s.chart.series.map((x) => ({ ...x, values: [...x.values] })) } } : {}),
      ...(s.points ? { points: s.points.map((p) => ({ ...p })) } : {}),
      ...(s.columns ? { columns: [...s.columns] } : {}),
      ...(s.rows ? { rows: s.rows.map((r) => [...r]) } : {}),
      ...(s.takeaways ? { takeaways: [...s.takeaways] } : {}),
    })),
  };
}

/** Checks and completes a deck read from storage or a file; undefined if it is not one. */
export function normalizeDeck(raw: any): DeckSpec | undefined {
  if (raw == null || typeof raw !== 'object' || !Array.isArray(raw.slides)) return undefined;
  const used = new Set<string>();
  const warnings: string[] = [];
  const slides = raw.slides
    .filter((s: unknown) => s != null && typeof s === 'object')
    .slice(0, LIMITS.slides)
    .map((s: any, i: number) => newSlide(s as SlideInput, used, i, warnings));
  if (slides.length === 0) return undefined;
  return {
    title: clip(raw.title, TEXT.title) || 'Presentation',
    ...(opt(raw.subtitle, TEXT.subtitle) ? { subtitle: opt(raw.subtitle, TEXT.subtitle) } : {}),
    theme: DECK_THEMES.includes(raw.theme) ? raw.theme : 'midnight',
    ...(opt(raw.author, 80) ? { author: opt(raw.author, 80) } : {}),
    ...(opt(raw.date, 40) ? { date: opt(raw.date, 40) } : {}),
    slides,
  };
}

// ---------------------------------------------------------------------------
// From dashboard results to slides
// ---------------------------------------------------------------------------

type Cell = string | number | boolean | null;

const numOrNull = (v: Cell | undefined): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

/** "mrr_usd" → "MRR USD"-ish readable label. */
export function humanize(col: string): string {
  const words = (col.replace(/[_-]+/g, ' ').replace(/\b(pct|percent)\b/gi, ' ').replace(/\s+/g, ' ').trim() || col)
    .replace(/([a-z])([A-Z])/g, '$1 $2').trim().split(/\s+/);
  const ACRONYMS = /^(mrr|arr|nrr|ndr|usd|eur|gbp|kpi|sql|gmv|aov|arpu|cac|ltv|roi|sla|slo|api|id|qa|p\d{2})$/i;
  return words
    .map((w, i) => (ACRONYMS.test(w) ? w.toUpperCase() : i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w.toLowerCase()))
    .join(' ');
}

const NON_ADDITIVE = /(pct|percent|rate|ratio|share|avg|average|mean|median|score|index|p\d{2}|per_|_per|aov|arpu|margin|ndr|nrr|nps|latency|duration)/i;

function columnsOf(widget: DashboardWidget, res: QueryExecutionResult) {
  const cols = res.columns;
  const rows = res.rows as Cell[][];
  const xIdx = widget.xField && cols.includes(widget.xField) ? cols.indexOf(widget.xField) : 0;
  const seriesIdx = widget.seriesField ? cols.indexOf(widget.seriesField) : -1;
  const compIdx = widget.comparisonField ? cols.indexOf(widget.comparisonField) : -1;
  let yIdx = (widget.yFields ?? []).map((f) => cols.indexOf(f)).filter((i) => i >= 0);
  if (yIdx.length === 0) {
    const keepsX = widget.kind === 'kpi';
    yIdx = cols
      .map((_, i) => i)
      .filter((i) => (keepsX || i !== xIdx || cols.length === 1) && i !== seriesIdx && i !== compIdx &&
        rows.length > 0 && rows.slice(0, 50).every((r) => r[i] == null || numOrNull(r[i]) !== null) &&
        rows.some((r) => numOrNull(r[i]) !== null));
  }
  return { cols, rows, xIdx, seriesIdx, compIdx, yIdx };
}

const SHARE_KINDS = new Set(['pie', 'donut', 'nightingale_rose', 'sunburst', 'treemap', 'proportional_area', 'square_area', 'circle_packing', 'marimekko']);
const LINE_KINDS = new Set(['line', 'combo', 'candlestick', 'spiral_plot', 'density']);
const AREA_KINDS = new Set(['area', 'streamgraph']);
const BAR_KINDS = new Set(['bar', 'horizontal_bar', 'funnel', 'bullet']);

/** The chart a dashboard widget shows, as slide data; null when it cannot be drawn as a slide chart. */
export function chartFromWidget(widget: DashboardWidget, res: QueryExecutionResult | undefined): DeckChart | null {
  if (res == null || !res.ok || res.rows.length === 0 || widget.kind === 'kpi' || widget.kind === 'table') return null;
  const { cols, rows, xIdx, seriesIdx, yIdx } = columnsOf(widget, res);
  if (yIdx.length === 0 || cols.length < 2) return null;
  const label = (v: Cell) => clip(v ?? '—', TEXT.category);

  let categories: string[] = [];
  let series: DeckSeries[] = [];
  if (seriesIdx >= 0 && seriesIdx !== xIdx) {
    const y = yIdx[0];
    const cats: string[] = [];
    const byName = new Map<string, Map<string, number>>();
    for (const r of rows) {
      const c = label(r[xIdx]);
      if (!cats.includes(c)) cats.push(c);
      const name = label(r[seriesIdx]);
      if (!byName.has(name)) byName.set(name, new Map());
      const m = byName.get(name)!;
      m.set(c, (m.get(c) ?? 0) + (numOrNull(r[y]) ?? 0));
    }
    // The largest series first; the rest are summed as "Other" past the limit
    const ranked = [...byName.entries()]
      .map(([name, m]) => ({ name, total: [...m.values()].reduce((a, b) => a + b, 0), m }))
      .sort((a, b) => b.total - a.total);
    const kept = ranked.slice(0, LIMITS.series);
    categories = cats;
    series = kept.map((s) => ({ name: s.name, values: cats.map((c) => s.m.get(c) ?? 0) }));
  } else {
    categories = rows.map((r) => label(r[xIdx]));
    series = yIdx.slice(0, LIMITS.series).map((i) => ({
      name: humanize(cols[i]),
      values: rows.map((r) => numOrNull(r[i]) ?? 0),
    }));
    // One value axis per slide chart: a combo's second measure, or measures of
    // very different size (revenue next to a rate), keep only the first
    const peak = (s: DeckSeries) => Math.max(...s.values.map(Math.abs), 1e-9);
    if (widget.kind === 'combo' || series.some((s) => peak(series[0]) / peak(s) > 20 || peak(s) / peak(series[0]) > 20)) {
      series = series.slice(0, 1);
    }
  }

  const kind = widget.kind;
  let type: DeckChartType;
  if (LINE_KINDS.has(kind)) type = 'line';
  else if (AREA_KINDS.has(kind)) type = 'area';
  else if (kind === 'stacked_bar') type = 'stacked_column';
  else if (SHARE_KINDS.has(kind)) {
    const positive = series[0].values.every((v) => v >= 0);
    type = series.length === 1 && positive && categories.length <= LIMITS.donutCategories ? 'donut' : 'bar';
  } else if (BAR_KINDS.has(kind)) type = 'bar';
  else type = 'column';
  // Long or many labels read better as horizontal bars
  if (type === 'column' && series.length === 1) {
    const avg = categories.reduce((a, c) => a + c.length, 0) / Math.max(1, categories.length);
    if (avg > 12 || categories.length > 8) type = 'bar';
  }

  const max = type === 'line' || type === 'area' ? LIMITS.lineCategories : type === 'donut' ? LIMITS.donutCategories : LIMITS.categories;
  if (categories.length > max) {
    if (type === 'line' || type === 'area') {
      // A trend keeps its latest points
      categories = categories.slice(-max);
      series = series.map((s) => ({ ...s, values: s.values.slice(-max) }));
    } else if (series.length === 1) {
      // A ranking keeps its largest items
      const order = series[0].values.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v).slice(0, max).map((o) => o.i).sort((a, b) => a - b);
      categories = order.map((i) => categories[i]);
      series = [{ ...series[0], values: order.map((i) => series[0].values[i]) }];
    } else {
      categories = categories.slice(0, max);
      series = series.map((s) => ({ ...s, values: s.values.slice(0, max) }));
    }
  }

  const chart: DeckChart = {
    type,
    categories,
    series,
    ...(widget.format ? { format: widget.format } : {}),
    ...(widget.unit ? { unit: widget.unit } : {}),
  };
  if ((type === 'bar' || type === 'column') && series.length === 1 && categories.length > 1) {
    const vals = series[0].values;
    chart.highlight = vals.indexOf(Math.max(...vals));
  }
  return chart;
}

const fmt = (v: number, chart: Pick<DeckChart, 'format' | 'unit'>) => formatMetricValue(v, chart.format ?? 'number', chart.unit);
const pct = (v: number) => `${Math.abs(v) >= 10 ? Math.round(v) : Math.round(v * 10) / 10}%`;

/** A headline (the slide title) and up to three takeaways that say what a chart shows. */
export function chartInsight(title: string, chart: DeckChart): { headline: string; takeaways: string[] } {
  const { categories: cats, series } = chart;
  const s = series[0];
  const vals = s.values;
  const n = cats.length;
  const takeaways: string[] = [];
  const subject = title.trim() || s.name;

  if (n === 0) return { headline: subject, takeaways };

  if (chart.type === 'line' || chart.type === 'area') {
    if (series.length > 1) {
      const lasts = series.map((x) => ({ name: x.name, v: x.values[n - 1] ?? 0 })).sort((a, b) => b.v - a.v);
      const headline = `${lasts[0].name} ends highest on ${subject} at ${fmt(lasts[0].v, chart)} in ${cats[n - 1]}`;
      takeaways.push(`${lasts[1].name} follows at ${fmt(lasts[1].v, chart)}`);
      const lead = lasts[0].v - lasts[1].v;
      if (lead > 0) takeaways.push(`The gap between them is ${fmt(lead, chart)} in the latest period`);
      return { headline: clip(headline, TEXT.title), takeaways };
    }
    const first = vals[0];
    const last = vals[n - 1];
    const peakIdx = vals.indexOf(Math.max(...vals));
    const lowIdx = vals.indexOf(Math.min(...vals));
    let headline: string;
    if (n > 1 && first !== 0 && chart.format !== 'percent') {
      const change = ((last - first) / Math.abs(first)) * 100;
      headline = Math.abs(change) < 0.5
        ? `${subject} held steady at ${fmt(last, chart)} from ${cats[0]} to ${cats[n - 1]}`
        : `${subject} ${change > 0 ? 'rose' : 'fell'} ${pct(change)} from ${cats[0]} to ${cats[n - 1]}`;
    } else if (n > 1 && chart.format === 'percent') {
      const diff = last - first;
      headline = `${subject} ${diff >= 0 ? 'rose' : 'fell'} ${Math.abs(Math.round(diff * 10) / 10)} points to ${fmt(last, chart)}`;
    } else {
      headline = `${subject} reached ${fmt(last, chart)} in ${cats[n - 1]}`;
    }
    takeaways.push(`Latest: ${fmt(last, chart)} in ${cats[n - 1]}`);
    if (peakIdx !== n - 1) takeaways.push(`Peak: ${fmt(vals[peakIdx], chart)} in ${cats[peakIdx]}`);
    else if (n > 2) takeaways.push(`The latest period is also the highest of the ${n} shown`);
    if (lowIdx !== 0 && lowIdx !== peakIdx) takeaways.push(`Low point: ${fmt(vals[lowIdx], chart)} in ${cats[lowIdx]}`);
    return { headline: clip(headline, TEXT.title), takeaways: takeaways.slice(0, LIMITS.takeaways) };
  }

  if (series.length > 1) {
    const totals = series.map((x) => ({ name: x.name, v: x.values.reduce((a, b) => a + b, 0) })).sort((a, b) => b.v - a.v);
    const catTotals = cats.map((c, i) => ({ c, v: series.reduce((a, x) => a + (x.values[i] ?? 0), 0) })).sort((a, b) => b.v - a.v);
    const headline = `${catTotals[0].c} leads ${subject} across ${series.length} series`;
    takeaways.push(`${totals[0].name} is the largest series at ${fmt(totals[0].v, chart)} in total`);
    if (catTotals.length > 1) takeaways.push(`${catTotals[catTotals.length - 1].c} is smallest at ${fmt(catTotals[catTotals.length - 1].v, chart)}`);
    return { headline: clip(headline, TEXT.title), takeaways };
  }

  const order = vals.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
  const top = order[0];
  const total = vals.reduce((a, b) => a + b, 0);
  const additive = chart.format !== 'percent' && !NON_ADDITIVE.test(`${s.name} ${subject}`) && vals.every((v) => v >= 0) && total > 0;
  const share = additive ? (top.v / total) * 100 : null;
  const headline = `${cats[top.i]} leads ${subject} at ${fmt(top.v, chart)}` + (share != null && n > 1 ? `, ${pct(share)} of the total` : '');
  if (n > 1) {
    const second = order[1];
    takeaways.push(`${cats[second.i]} follows at ${fmt(second.v, chart)}`);
  }
  if (additive && n >= 4) {
    const top3 = order.slice(0, 3).reduce((a, o) => a + o.v, 0);
    takeaways.push(`The top 3 make up ${pct((top3 / total) * 100)} of the total`);
  }
  if (n > 2) {
    const low = order[order.length - 1];
    takeaways.push(
      low.v > 0 && top.v / low.v >= 2
        ? `${cats[top.i]} is ${Math.round((top.v / low.v) * 10) / 10}× ${cats[low.i]}, the smallest at ${fmt(low.v, chart)}`
        : `${cats[low.i]} is the smallest at ${fmt(low.v, chart)}`,
    );
  }
  return { headline: clip(headline, TEXT.title), takeaways: takeaways.slice(0, LIMITS.takeaways) };
}

/** The figure a KPI widget shows, as a slide metric; null without a result. */
export function metricFromWidget(widget: DashboardWidget, res: QueryExecutionResult | undefined): DeckMetric | null {
  if (res == null || !res.ok || res.rows.length === 0) return null;
  const { cols, rows, compIdx, yIdx } = columnsOf(widget, res);
  const valIdx = yIdx[0] ?? Math.max(0, cols.length - 1);
  const row = rows[0];
  const value = formatMetricValue(row[valIdx], widget.format, widget.unit);
  const deltaCol = compIdx >= 0
    ? compIdx
    : cols.length > 1 && valIdx === 0 ? 1 : valIdx > 0 && cols.length > valIdx + 1 ? valIdx + 1 : -1;
  const rawDelta = deltaCol >= 0 ? row[deltaCol] : undefined;
  const d = rawDelta === undefined ? null : numOrNull(rawDelta);
  const metric: DeckMetric = { label: clip(widget.title, TEXT.label), value: clip(value, TEXT.value), widgetId: widget.id };
  if (d !== null) {
    metric.delta = clip(`${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}% ${humanize(cols[deltaCol]).toLowerCase()}`, TEXT.delta);
    metric.trend = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
  } else if (typeof rawDelta === 'string' && rawDelta.trim() !== '') {
    metric.delta = clip(rawDelta, TEXT.delta);
  }
  const note = widget.subtitle ?? (cols[valIdx] ? humanize(cols[valIdx]) : undefined);
  if (note && note !== metric.label) metric.note = clip(note, TEXT.note);
  return metric;
}

/** A widget subtitle worth a slide: not an instruction for the dashboard ("click any header…"). */
function slideSubtitle(widget: DashboardWidget): string | undefined {
  const s = widget.subtitle?.trim();
  return s && !/\b(click|hover|tap|drag|scroll|toggle|select a|use the filter)\b/i.test(s) ? s : undefined;
}

function sourceLine(widget: DashboardWidget): string {
  const src = widget.source === 'local' ? 'studio SQL' : widget.source.replace(/^rest:/, '');
  return clip(`Source: ${widget.title} · ${src} query`, TEXT.source);
}

function tableFromWidget(widget: DashboardWidget, res: QueryExecutionResult | undefined): { columns: string[]; rows: string[][] } | null {
  if (res == null || !res.ok || res.rows.length === 0) return null;
  const cols = res.columns.slice(0, LIMITS.tableColumns);
  const numeric = cols.map((_, i) => res.rows.slice(0, 20).every((r) => r[i] == null || numOrNull(r[i] as Cell) !== null));
  const rows = (res.rows as Cell[][]).slice(0, LIMITS.tableRows).map((r) =>
    cols.map((c, i) => {
      const v = r[i];
      if (v == null) return '—';
      if (numeric[i] && typeof v !== 'boolean') {
        const n = Number(v);
        const money = /(usd|revenue|cost|spend|price|amount|mrr|arr|sales|gmv|budget|profit)/i.test(c);
        return clip(money && widget.format?.startsWith('currency') ? formatMetricValue(n, widget.format) : formatMetricValue(n, /pct|percent|rate|share/i.test(c) ? 'percent' : 'number'), TEXT.cell);
      }
      return clip(v, TEXT.cell);
    }));
  return { columns: cols.map(humanize), rows };
}

/** Nodes in the order data flows (sources first), at most `max`. */
function flowOrder(scene: Scene, max: number) {
  const incoming = new Map(scene.nodes.map((n) => [n.id, 0]));
  for (const e of scene.edges) incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);
  const queue = scene.nodes.filter((n) => (incoming.get(n.id) ?? 0) === 0).map((n) => n.id);
  const seen = new Set<string>();
  const order: string[] = [];
  while (queue.length > 0 && order.length < max) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
    for (const e of scene.edges) if (e.from === id && !seen.has(e.to)) queue.push(e.to);
  }
  for (const n of scene.nodes) {
    if (order.length >= max) break;
    if (!seen.has(n.id)) order.push(n.id);
  }
  return order.map((id) => scene.nodes.find((n) => n.id === id)!).filter(Boolean);
}

function firstSentence(text: string): string | undefined {
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l !== '' && !l.startsWith('#') && !l.startsWith('{{') && !l.startsWith('[[') && !l.startsWith('|') && !l.startsWith('```') && !l.startsWith('>'));
  if (!line) return undefined;
  const plain = line.replace(/^[-*]\s+/, '').replace(/[*_`]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  const m = /^(.{20,200}?[.!?])(\s|$)/.exec(plain);
  return clip(m ? m[1] : plain, TEXT.pointText);
}

export interface FromPageOptions {
  title?: string;
  subtitle?: string;
  theme?: DeckThemeName;
  author?: string;
  /** Shown on the title slide; defaults to the current month. */
  date?: string;
}

export function monthYear(d = new Date()): string {
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/**
 * Builds a deck from what the page has, as a pyramid: the title, an executive
 * summary of the findings, the headline metrics, one slide per chart whose
 * title says what the chart shows, tables, the system flow, documentation
 * highlights, and a closing slide with the takeaways.
 */
export function generateDeckFromPage(scene: Scene, results: Results = {}, o: FromPageOptions = {}): DeckSpec | null {
  const dash = scene.dashboard;
  const title = clip(o.title?.trim() || dash?.title || scene.title || 'Briefing', TEXT.title);
  const inputs: SlideInput[] = [];
  const findings: { title: string; text: string }[] = [];

  // Headline metrics
  const kpiWidgets = (dash?.widgets ?? []).filter((w) => w.kind === 'kpi');
  const metrics = kpiWidgets.map((w) => metricFromWidget(w, results[w.id])).filter((m): m is DeckMetric => m != null).slice(0, LIMITS.metrics);
  if (metrics.length > 0) {
    const [a, b] = metrics;
    const headline = metrics.length === 1
      ? `${a.label} stands at ${a.value}${a.delta ? `, ${a.delta}` : ''}`
      : `${a.label} at ${a.value}, ${b.label} at ${b.value}`;
    inputs.push({
      id: 'headline_metrics',
      layout: 'kpis',
      kicker: 'Headline metrics',
      title: headline,
      metrics: metrics.map((m) => ({ ...m, widget_id: m.widgetId })),
      notes: `The headline figures, each computed live by a SQL query: ${metrics.map((m) => `${m.label} ${m.value}${m.delta ? ` (${m.delta})` : ''}`).join('; ')}.`,
      source: kpiWidgets.length > 0 ? clip(`Source: ${kpiWidgets.length} KPI ${kpiWidgets.length === 1 ? 'query' : 'queries'} on the dashboard`, TEXT.source) : undefined,
    });
    findings.push({ title: a.label, text: `${a.label} is ${a.value}${a.delta ? ` (${a.delta})` : ''}${b ? `; ${b.label} is ${b.value}` : ''}` });
  }

  // One slide per chart
  const chartWidgets = (dash?.widgets ?? []).filter((w) => w.kind !== 'kpi' && w.kind !== 'table');
  for (const w of chartWidgets) {
    if (inputs.filter((s) => s.layout === 'chart').length >= 6) break;
    const chart = chartFromWidget(w, results[w.id]);
    if (chart == null) continue;
    const { headline, takeaways } = chartInsight(w.title, chart);
    inputs.push({
      id: `chart_${w.id}`,
      layout: 'chart',
      kicker: w.title,
      title: headline,
      ...(slideSubtitle(w) ? { subtitle: slideSubtitle(w) } : {}),
      chart: { ...chart, highlight_index: chart.highlight },
      widget_id: w.id,
      takeaways,
      source: sourceLine(w),
      notes: [w.explanation, `Talking points: ${headline}. ${takeaways.join('. ')}.`].filter(Boolean).join('\n\n'),
    });
    findings.push({ title: w.title, text: headline });
  }

  // Tables
  for (const w of (dash?.widgets ?? []).filter((x) => x.kind === 'table').slice(0, 2)) {
    const t = tableFromWidget(w, results[w.id]);
    if (t == null) continue;
    inputs.push({
      id: `table_${w.id}`,
      layout: 'table',
      kicker: 'Detail',
      title: w.title,
      ...(slideSubtitle(w) ? { subtitle: slideSubtitle(w) } : {}),
      columns: t.columns,
      rows: t.rows,
      widget_id: w.id,
      source: sourceLine(w),
      notes: w.explanation ?? `The first ${t.rows.length} rows of ${w.title}.`,
    });
  }

  // System flow from the diagram
  if (scene.nodes.length >= 2) {
    const nodes = flowOrder(scene, LIMITS.flowSteps);
    inputs.push({
      id: 'system_flow',
      layout: 'flow',
      kicker: 'How it works',
      title: clip(`${scene.title || 'The system'}: how it works end to end`, TEXT.title),
      points: nodes.map((n) => ({ title: n.label, text: n.description ?? n.tech ?? undefined })),
      notes: `The flow across ${nodes.map((n) => n.label).join(', ')}${scene.nodes.length > nodes.length ? `, simplified from ${scene.nodes.length} components on the diagram` : ''}.`,
      source: `Source: architecture diagram “${clip(scene.title || 'Diagram', 60)}”`,
    });
    findings.push({ title: 'Architecture', text: `${nodes.length} building blocks from ${nodes[0].label} to ${nodes[nodes.length - 1].label}` });
  }

  // Documentation highlights
  const chapters = scene.blocks.filter((b) => b.kind === 'text' && typeof b.text === 'string');
  if (chapters.length > 0) {
    const points = chapters
      .map((b) => ({ title: clip(b.title || b.text!.split('\n').find((l) => l.startsWith('#'))?.replace(/^#+\s*/, '') || 'Chapter', TEXT.pointTitle), text: firstSentence(b.text!) }))
      .filter((p) => p.text != null)
      .slice(0, LIMITS.points);
    if (points.length > 0) {
      inputs.push({
        id: 'documentation_highlights',
        layout: 'points',
        kicker: 'From the documentation',
        title: points.length === 1 ? points[0].title : `${points.length} things to know from the documentation`,
        points,
        notes: 'Highlights of the documentation chapters on this page.',
      });
    }
  }

  if (inputs.length === 0) return null;

  // Executive summary up front (pyramid), when there is more than one finding
  const summary: SlideInput[] = findings.length >= 2
    ? [{
        id: 'executive_summary',
        layout: 'points',
        kicker: 'Executive summary',
        title: clip(`${['', 'One', 'Two', 'Three', 'Four'][Math.min(findings.length, LIMITS.points)]} findings from ${title}`, TEXT.title),
        points: findings.slice(0, LIMITS.points).map((f) => ({ title: f.title, text: f.text })),
        notes: `The short version: ${findings.slice(0, LIMITS.points).map((f) => f.text).join('. ')}.`,
      }]
    : [];

  const takeaways = findings.slice(0, LIMITS.closingTakeaways).map((f) => f.text);
  const slides: SlideInput[] = [
    {
      id: 'title',
      layout: 'title',
      kicker: dash ? 'Executive briefing' : scene.nodes.length > 0 ? 'Architecture briefing' : 'Briefing',
      title,
      subtitle: o.subtitle ?? dash?.subtitle ?? scene.subtitle ??
        (dash ? `${dash.widgets.length} live metrics, every figure backed by a SQL query` : undefined),
      notes: `Introduce ${title}: what we looked at and why it matters now.`,
    },
    ...summary,
    ...inputs,
    {
      id: 'closing',
      layout: 'closing',
      kicker: 'Key takeaways',
      title: 'What this means',
      takeaways: takeaways.length > 0 ? takeaways : [`${title} is ready to discuss`],
      subtitle: dash ? 'Every figure traces back to a SQL query you can inspect in the studio.' : undefined,
      notes: 'Recap the takeaways, then open the discussion: what do we decide, and who owns the next step?',
    },
  ];

  const used = new Set<string>();
  const warnings: string[] = [];
  return {
    title,
    ...(o.subtitle ?? dash?.subtitle ? { subtitle: clip(o.subtitle ?? dash?.subtitle, TEXT.subtitle) } : {}),
    theme: o.theme ?? 'midnight',
    ...(o.author ? { author: clip(o.author, 80) } : {}),
    date: o.date ?? monthYear(),
    slides: slides.map((s, i) => newSlide(s, used, i, warnings)),
  };
}

/**
 * Refreshes the numbers of slides bound to dashboard widgets (charts, KPI
 * figures, tables) from the latest results; titles and notes stay as written.
 */
export function syncDeckData(deck: DeckSpec, scene: Scene, results: Results, queryResults?: QueryResults): { deck: DeckSpec; updated: string[] } {
  const next = cloneDeck(deck);
  const updated: string[] = [];
  const widgets = new Map((scene.dashboard?.widgets ?? []).map((w) => [w.id, w]));
  for (const s of next.slides) {
    let changed = false;
    if (queryResults && queryResults.size > 0 && (s.query || s.metrics?.some((m) => m.query))) {
      const before = JSON.stringify(s);
      fillFromQueries(s, queryResults, []);
      if (JSON.stringify(s) !== before) changed = true;
    }
    const w = s.widgetId ? widgets.get(s.widgetId) : undefined;
    if (w && s.layout === 'chart') {
      const chart = chartFromWidget(w, results[w.id]);
      if (chart) {
        // Keep the chart type the user chose
        s.chart = { ...chart, type: s.chart?.type ?? chart.type };
        changed = true;
      }
    }
    if (w && s.layout === 'table') {
      const t = tableFromWidget(w, results[w.id]);
      if (t) {
        s.columns = t.columns;
        s.rows = t.rows;
        changed = true;
      }
    }
    if (s.metrics) {
      s.metrics = s.metrics.map((m) => {
        const mw = m.widgetId ? widgets.get(m.widgetId) : undefined;
        const fresh = mw ? metricFromWidget(mw, results[mw.id]) : null;
        if (!fresh) return m;
        changed = true;
        return { ...m, value: fresh.value, ...(fresh.delta ? { delta: fresh.delta } : {}), ...(fresh.trend ? { trend: fresh.trend } : {}) };
      });
    }
    if (changed) updated.push(s.id);
  }
  return { deck: next, updated };
}

/** Fills chart slides that name a widget but carry no data yet. */
function fillBoundCharts(deck: DeckSpec, scene: Scene | undefined, results: Results | undefined, warnings: string[]) {
  if (scene?.dashboard == null) return;
  for (const s of deck.slides) {
    if (s.layout !== 'chart' || s.chart != null || s.widgetId == null) continue;
    const w = scene.dashboard.widgets.find((x) => x.id === s.widgetId || x.title === s.widgetId);
    if (w == null) {
      warnings.push(`Slide ${s.id}: no dashboard widget "${s.widgetId}".`);
      continue;
    }
    s.widgetId = w.id;
    const chart = chartFromWidget(w, results?.[w.id]);
    if (chart) {
      s.chart = chart;
      if (!s.source) s.source = sourceLine(w);
    } else {
      warnings.push(`Slide ${s.id}: widget ${w.id} has no chartable result yet.`);
    }
  }
}

// ---------------------------------------------------------------------------
// Create & edit
// ---------------------------------------------------------------------------

const EMPTY: DeckSpec = { title: '', theme: 'midnight', slides: [] };

function fail(errors: string[], deck: DeckSpec = EMPTY, warnings: string[] = []): DeckOpResult {
  return { ok: false, deck, addedSlides: [], updatedSlides: [], removedSlides: [], errors, warnings, notes: [] };
}

export function buildDeck(
  req: CreateDeckRequest,
  context: { pageScene?: Scene; dashboardResults?: Results; queryResults?: QueryResults; date?: string } = {},
): DeckOpResult {
  const theme = DECK_THEMES.includes(req.theme as DeckThemeName) ? req.theme : undefined;
  if ((!Array.isArray(req.slides) || req.slides.length === 0) && context.pageScene) {
    const deck = generateDeckFromPage(context.pageScene, context.dashboardResults, {
      title: req.title, subtitle: req.subtitle, theme, author: req.author, date: context.date,
    });
    if (deck == null) {
      return fail(['This page has no dashboard, diagram or documentation to build a deck from yet. Build a dashboard first, or pass slides.']);
    }
    return {
      ok: true,
      deck,
      addedSlides: deck.slides.map((s) => s.id),
      updatedSlides: [],
      removedSlides: [],
      errors: [],
      warnings: [],
      notes: [`Built ${deck.slides.length} slides from the page.`],
    };
  }
  if (!Array.isArray(req.slides) || req.slides.length === 0) {
    return fail(['create_deck needs slides (or from_current_page: true).']);
  }
  const warnings: string[] = [];
  if (req.slides.length > LIMITS.slides) warnings.push(`A deck holds at most ${LIMITS.slides} slides; kept the first ${LIMITS.slides}.`);
  const used = new Set<string>();
  const filled: string[] = [];
  const slides = req.slides.slice(0, LIMITS.slides).map((s, i) => newSlide(s ?? {}, used, i, warnings, context.queryResults, filled));
  const deck: DeckSpec = {
    title: clip(req.title ?? '', TEXT.title) || slides.find((s) => s.layout === 'title')?.title || slides[0].title,
    ...(opt(req.subtitle, TEXT.subtitle) ? { subtitle: opt(req.subtitle, TEXT.subtitle) } : {}),
    theme: theme ?? 'midnight',
    ...(opt(req.author, 80) ? { author: opt(req.author, 80) } : {}),
    date: context.date ?? monthYear(),
    slides,
  };
  fillBoundCharts(deck, context.pageScene, context.dashboardResults, warnings);
  for (const s of deck.slides) {
    const gap = layoutGaps(s);
    if (gap) warnings.push(gap);
  }
  return { ok: true, deck, addedSlides: slides.map((s) => s.id), updatedSlides: [], removedSlides: [], errors: [], warnings, notes: filled.map((f) => `From SQL: ${f}`) };
}

function resolveSlide(ref: unknown, slides: Slide[]): { item?: Slide; note?: string; error?: string } {
  const r = typeof ref === 'string' ? ref : String(ref ?? '');
  const m = /^(?:slide\s*)?(\d+)$/i.exec(r.trim());
  if (m) {
    const idx = Number(m[1]) - 1;
    if (idx >= 0 && idx < slides.length) return { item: slides[idx], note: `"${r}" → ${slides[idx].id}` };
    return { error: `There is no slide ${m[1]} (the deck has ${slides.length}).` };
  }
  if (/^(last|the last slide)$/i.test(r.trim()) && slides.length > 0) return { item: slides[slides.length - 1] };
  const res = resolveRef(r, slides.map((s) => ({ id: s.id, label: s.title, slide: s })), 'slide');
  return { item: res.item?.slide, note: res.note, error: res.error };
}

export function applyDeckEdit(
  prev: DeckSpec,
  req: EditDeckRequest,
  context: { pageScene?: Scene; dashboardResults?: Results; queryResults?: QueryResults } = {},
): DeckOpResult {
  const next = cloneDeck(prev);
  const filled: string[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];
  const added: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];
  const touch = (id: string) => { if (!updated.includes(id) && !added.includes(id)) updated.push(id); };

  if (typeof req.title === 'string' && req.title.trim()) next.title = clip(req.title, TEXT.title);
  if (typeof req.subtitle === 'string') {
    if (req.subtitle.trim() === '') delete next.subtitle;
    else next.subtitle = clip(req.subtitle, TEXT.subtitle);
  }
  if (typeof req.author === 'string') {
    if (req.author.trim() === '') delete next.author;
    else next.author = clip(req.author, 80);
  }
  if (req.theme !== undefined) {
    if (DECK_THEMES.includes(req.theme)) next.theme = req.theme;
    else warnings.push(`Unknown theme "${String(req.theme)}"; themes: ${DECK_THEMES.join(', ')}.`);
  }

  for (const ref of req.remove_slides ?? []) {
    const r = resolveSlide(ref, next.slides);
    if (!r.item) {
      errors.push(r.error ?? `No slide matching "${ref}".`);
      continue;
    }
    if (next.slides.length <= 1) {
      errors.push('A deck keeps at least one slide.');
      break;
    }
    if (r.note) notes.push(r.note);
    next.slides = next.slides.filter((s) => s !== r.item);
    removed.push(r.item.id);
  }

  for (const patch of req.update_slides ?? []) {
    if (patch == null) continue;
    const r = resolveSlide(patch.id, next.slides);
    if (!r.item) {
      errors.push(r.error ?? `No slide matching "${patch.id}".`);
      continue;
    }
    if (r.note) notes.push(r.note);
    const { id: _id, ...fields } = patch;
    applySlideFields(r.item, fields, warnings, context.queryResults, filled);
    touch(r.item.id);
  }

  const used = new Set(next.slides.map((s) => s.id));
  for (const add of req.add_slides ?? []) {
    if (add == null) continue;
    if (next.slides.length >= LIMITS.slides) {
      warnings.push(`A deck holds at most ${LIMITS.slides} slides.`);
      break;
    }
    const created = newSlide(add, used, next.slides.length, warnings, context.queryResults, filled);
    if (add.after === 'start') next.slides.unshift(created);
    else if (add.after) {
      const r = resolveSlide(add.after, next.slides);
      const idx = r.item ? next.slides.indexOf(r.item) : -1;
      // Before the closing slide by default, not after it
      if (idx >= 0) next.slides.splice(idx + 1, 0, created);
      else next.slides.push(created);
    } else {
      const closing = next.slides.findIndex((s) => s.layout === 'closing');
      if (closing >= 0 && created.layout !== 'closing') next.slides.splice(closing, 0, created);
      else next.slides.push(created);
    }
    added.push(created.id);
  }

  if (Array.isArray(req.reorder_slides) && req.reorder_slides.length > 0) {
    const ordered: Slide[] = [];
    for (const ref of req.reorder_slides) {
      const r = resolveSlide(ref, next.slides);
      if (r.item && !ordered.includes(r.item)) ordered.push(r.item);
      else if (!r.item) warnings.push(r.error ?? `No slide matching "${ref}" to reorder.`);
    }
    for (const s of next.slides) if (!ordered.includes(s)) ordered.push(s);
    if (ordered.some((s, i) => s !== next.slides[i])) {
      next.slides = ordered;
      for (const s of ordered) touch(s.id);
    }
  }

  if (errors.length > 0) return fail(errors, prev, warnings);

  fillBoundCharts(next, context.pageScene, context.dashboardResults, warnings);
  for (const id of [...added, ...updated]) {
    const s = next.slides.find((x) => x.id === id);
    const gap = s ? layoutGaps(s) : null;
    if (gap) warnings.push(gap);
  }
  for (const f of filled) notes.push(`From SQL: ${f}`);
  return { ok: true, deck: next, addedSlides: added, updatedSlides: updated, removedSlides: removed, errors: [], warnings, notes };
}

// ---------------------------------------------------------------------------
// Earlier versions: a Motion explainer opens as a deck
// ---------------------------------------------------------------------------

/** Turns a saved Motion explainer (the surface the Deck replaced) into a deck; undefined if it is not one. */
export function deckFromMotion(raw: any): DeckSpec | undefined {
  if (raw == null || typeof raw !== 'object' || !Array.isArray(raw.scenes)) return undefined;
  const inputs: SlideInput[] = [];
  raw.scenes.forEach((scene: any, i: number) => {
    if (scene == null || typeof scene !== 'object') return;
    const layers: any[] = Array.isArray(scene.layers) ? scene.layers.filter((l: unknown) => l != null && typeof l === 'object') : [];
    const texts = layers.filter((l) => l.kind === 'kinetic_text' && l.text);
    const badge = layers.find((l) => l.kind === 'badge' && l.text)?.text;
    const counters = layers.filter((l) => l.kind === 'metric_counter');
    const chart = layers.find((l) => l.kind === 'motion_chart' && Array.isArray(l.series) && l.series.length > 0);
    const flow = layers.find((l) => l.kind === 'flow_diagram' && Array.isArray(l.flowNodes ?? l.flow_nodes));
    const callout = layers.find((l) => l.kind === 'callout_card' && l.text);
    const headline = texts[0]?.text ?? scene.title;
    const base: SlideInput = {
      id: scene.id,
      title: headline,
      ...(badge ? { kicker: badge } : {}),
      ...(scene.narration ? { notes: scene.narration } : {}),
    };
    if (counters.length > 0) {
      inputs.push({
        ...base,
        layout: 'kpis',
        title: texts[0]?.text ?? scene.title,
        metrics: counters.map((c) => {
          const dec = typeof c.decimals === 'number' ? c.decimals : Number.isInteger(c.value) ? 0 : 1;
          const n = typeof c.value === 'number' ? c.value : 0;
          return {
            label: c.text ?? 'Metric',
            value: `${c.prefix ?? ''}${n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })}${c.suffix ?? ''}`,
            delta: c.deltaText ?? c.delta_text,
            note: c.subtext,
          };
        }),
      });
    } else if (chart) {
      const type = (chart.chartType ?? chart.chart_type) === 'line' ? 'line' : (chart.chartType ?? chart.chart_type) === 'donut' ? 'donut' : 'column';
      inputs.push({
        ...base,
        layout: 'chart',
        title: texts[0]?.text ?? scene.title,
        chart: {
          type,
          categories: chart.series.map((s: any) => s.label),
          series: [{ name: scene.title ?? 'Value', values: chart.series.map((s: any) => s.value) }],
          highlight_index: chart.highlightIndex ?? chart.highlight_index,
        },
        ...(chart.highlightNote ?? chart.highlight_note ? { takeaways: [chart.highlightNote ?? chart.highlight_note] } : {}),
      });
    } else if (flow) {
      inputs.push({
        ...base,
        layout: 'flow',
        title: texts[0]?.text ?? scene.title,
        points: (flow.flowNodes ?? flow.flow_nodes).map((n: any) => ({ title: n.label ?? n.id })),
      });
    } else {
      inputs.push({
        ...base,
        layout: i === 0 ? 'title' : 'statement',
        ...(texts[0]?.subtext ?? texts[1]?.text ?? callout?.text ? { subtitle: texts[0]?.subtext ?? texts[1]?.text ?? callout?.text } : {}),
      });
    }
  });
  if (inputs.length === 0) return undefined;
  if (inputs[0].layout !== 'title') {
    inputs.unshift({ id: 'title', layout: 'title', title: raw.title ?? 'Presentation', ...(raw.subtitle ? { subtitle: raw.subtitle } : {}) });
  }
  const used = new Set<string>();
  const warnings: string[] = [];
  return {
    title: clip(raw.title ?? inputs[0].title ?? 'Presentation', TEXT.title) || 'Presentation',
    ...(opt(raw.subtitle, TEXT.subtitle) ? { subtitle: opt(raw.subtitle, TEXT.subtitle) } : {}),
    theme: 'midnight',
    slides: inputs.slice(0, LIMITS.slides).map((s, i) => newSlide(s, used, i, warnings)),
  };
}

// ---------------------------------------------------------------------------
// For the agent
// ---------------------------------------------------------------------------

/** Compact description of the deck, returned to the voice agent with every tool result. */
export function describeDeck(d: DeckSpec): string {
  const lines = [`deck: ${JSON.stringify(d.title)} · theme ${d.theme} · ${d.slides.length} ${d.slides.length === 1 ? 'slide' : 'slides'}` +
    (d.author ? ` · by ${JSON.stringify(d.author)}` : '')];
  d.slides.forEach((s, i) => {
    const detail = s.layout === 'kpis'
      ? ` metrics: ${(s.metrics ?? []).map((m) => `${m.label} ${m.value}`).join('; ')}`
      : s.layout === 'chart'
        ? ` ${s.chart ? `${s.chart.type}, ${s.chart.categories.length} categories × ${s.chart.series.length} series` : 'no data'}${s.widgetId ? `, widget ${s.widgetId}` : ''}${s.query ? `, live SQL on ${s.query.source}` : ''}`
        : s.layout === 'table'
          ? ` ${s.columns?.length ?? 0} columns × ${s.rows?.length ?? 0} rows${s.query ? `, live SQL on ${s.query.source}` : ''}`
          : s.points
            ? ` ${s.points.length} ${s.layout === 'flow' ? 'steps' : 'points'}: ${s.points.map((p) => p.title).join(' | ')}`
            : '';
    lines.push(`  ${i + 1}. ${s.id} [${s.layout}] ${JSON.stringify(s.title)}${detail}` +
      (s.takeaways?.length ? ` · takeaways: ${s.takeaways.map((t) => JSON.stringify(t)).join(', ')}` : '') +
      (s.notes ? ' · has notes' : ''));
  });
  return lines.join('\n');
}
