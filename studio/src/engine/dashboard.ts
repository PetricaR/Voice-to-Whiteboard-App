/**
 * Pure TypeScript model, atomic incremental operations, state summarizer, and
 * BI/HTML/SQL exporters for Live Dashboards.
 *
 * Every widget has a stable snake_case id, an explicit SQL query, and provenance
 * metadata so Gemini Live can refine single widgets without scrambling layout
 * and users can audit every single number on the dashboard.
 */
import type { QueryExecutionResult } from '../data/sqlEngine';
import { resolveRef, type Resolution } from './resolve';
import { COLORS, type ColorName } from './types';

export const WIDGET_KINDS = [
  'kpi',
  'bar',
  'stacked_bar',
  'horizontal_bar',
  'line',
  'area',
  'donut',
  'pie',
  'scatter',
  'funnel',
  'heatmap',
  'table',
] as const;
export type WidgetKind = (typeof WIDGET_KINDS)[number];

export const VALUE_FORMATS = [
  'number',
  'currency_usd',
  'currency_eur',
  'percent',
  'compact',
  'ms',
  'raw',
] as const;
export type ValueFormat = (typeof VALUE_FORMATS)[number];

export const COL_SPANS = [3, 4, 6, 8, 12] as const;
export type ColSpan = (typeof COL_SPANS)[number];

export const FILTER_KINDS = ['select', 'text'] as const;
export type FilterKind = (typeof FILTER_KINDS)[number];

export interface DashboardFilter {
  id: string;
  label: string;
  /** SQL parameter name without leading colon, e.g. "region" -> used as `:region` in SQL. */
  param: string;
  kind: FilterKind;
  options?: string[];
  value: string;
}

export interface DashboardWidget {
  id: string;
  title: string;
  subtitle?: string;
  kind: WidgetKind;
  /** Data source id: "local", "bigquery", "clickhouse", "postgres", or "rest:<name>". */
  source: string;
  /** Exact read-only SQL query powering this widget. */
  sql: string;
  /** Dimension column (X-axis / slice label / category). Auto-detected from column 0 if omitted. */
  xField?: string;
  /** Metric column(s) (Y-axis / KPI value). Auto-detected from numeric columns if omitted. */
  yFields?: string[];
  /** Optional grouping/pivoting column for multi-series line/bar/stacked_bar/heatmap charts. */
  seriesField?: string;
  /** Value display formatting. */
  format?: ValueFormat;
  /** Optional comparison/delta column for KPI cards (e.g. MoM % or target delta). */
  comparisonField?: string;
  /** Optional unit label (e.g. "seats", "req/s"). */
  unit?: string;
  /** Width in the 12-column responsive Bento grid (3, 4, 6, 8, or 12). */
  colSpan: ColSpan;
  /** Plain-language explanation of how this metric is computed (shown in Query Inspector). */
  explanation?: string;
  color?: ColorName;
}

export interface DashboardSpec {
  title: string;
  subtitle?: string;
  defaultSource: string;
  /** Auto-refresh cadence in seconds (0 = manual only, 30, 60, 300). */
  refreshSeconds: number;
  filters: DashboardFilter[];
  widgets: DashboardWidget[];
}

export interface DashboardWidgetInput {
  id?: string;
  title: string;
  subtitle?: string;
  kind: WidgetKind;
  source?: string;
  sql: string;
  x_field?: string;
  xField?: string;
  y_fields?: string[];
  yFields?: string[];
  series_field?: string;
  seriesField?: string;
  format?: ValueFormat;
  comparison_field?: string;
  comparisonField?: string;
  unit?: string;
  col_span?: number;
  colSpan?: number;
  explanation?: string;
  color?: ColorName | 'none';
}

export interface DashboardFilterInput {
  id?: string;
  label: string;
  param: string;
  kind?: FilterKind;
  options?: string[];
  value?: string;
}

export interface CreateDashboardRequest {
  title: string;
  subtitle?: string;
  source?: string;
  refresh_seconds?: number;
  filters?: DashboardFilterInput[];
  widgets: DashboardWidgetInput[];
  new_page?: boolean;
  replace?: boolean;
}

export interface EditDashboardRequest {
  summary?: string;
  title?: string;
  subtitle?: string;
  refresh_seconds?: number;
  add_widgets?: (DashboardWidgetInput & { after?: string })[];
  update_widgets?: (Partial<DashboardWidgetInput> & { id: string })[];
  remove_widgets?: string[];
  reorder_widgets?: string[];
  add_filters?: DashboardFilterInput[];
  update_filters?: { id: string; label?: string; value?: string; options?: string[] }[];
  remove_filters?: string[];
}

export interface DashboardOpResult {
  ok: boolean;
  dashboard: DashboardSpec;
  addedWidgets: string[];
  updatedWidgets: string[];
  removedWidgets: string[];
  errors: string[];
  warnings: string[];
  notes: string[];
}

function slugId(raw: string, fallback: string): string {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return s || fallback;
}

function normalizeColSpan(raw: number | undefined, kind: WidgetKind): ColSpan {
  if (raw === 3 || raw === 4 || raw === 6 || raw === 8 || raw === 12) return raw;
  if (typeof raw === 'number') {
    if (raw <= 3) return 3;
    if (raw <= 5) return 4;
    if (raw <= 7) return 6;
    if (raw <= 9) return 8;
    return 12;
  }
  if (kind === 'kpi') return 3;
  if (kind === 'table') return 12;
  return 6;
}

function normalizeWidget(input: DashboardWidgetInput, defaultSource: string, usedIds: Set<string>, index: number): DashboardWidget {
  const kind: WidgetKind = WIDGET_KINDS.includes(input.kind) ? input.kind : 'bar';
  const baseId = slugId(input.id || input.title, `${kind}_${index + 1}`);
  let id = baseId;
  let n = 2;
  while (usedIds.has(id)) id = `${baseId}_${n++}`;
  usedIds.add(id);

  const color = input.color && input.color !== 'none' && COLORS.includes(input.color) ? input.color : undefined;
  const xField = input.xField ?? input.x_field;
  const yFields = input.yFields ?? input.y_fields;
  const seriesField = input.seriesField ?? input.series_field;
  const comparisonField = input.comparisonField ?? input.comparison_field;

  return {
    id,
    title: input.title.trim() || 'Untitled Metric',
    ...(input.subtitle?.trim() ? { subtitle: input.subtitle.trim() } : {}),
    kind,
    source: (input.source?.trim() || defaultSource || 'local'),
    sql: input.sql.trim(),
    ...(xField?.trim() ? { xField: xField.trim() } : {}),
    ...(Array.isArray(yFields) && yFields.length > 0 ? { yFields: yFields.map((s) => String(s).trim()).filter(Boolean) } : {}),
    ...(seriesField?.trim() ? { seriesField: seriesField.trim() } : {}),
    ...(input.format && VALUE_FORMATS.includes(input.format) ? { format: input.format } : {}),
    ...(comparisonField?.trim() ? { comparisonField: comparisonField.trim() } : {}),
    ...(input.unit?.trim() ? { unit: input.unit.trim() } : {}),
    colSpan: normalizeColSpan(input.colSpan ?? input.col_span, kind),
    ...(input.explanation?.trim() ? { explanation: input.explanation.trim() } : {}),
    ...(color ? { color } : {}),
  };
}

function normalizeFilter(input: DashboardFilterInput, usedIds: Set<string>, index: number): DashboardFilter {
  const param = slugId(input.param || input.id || input.label, `param_${index + 1}`);
  const baseId = slugId(input.id || `filter_${param}`, `filter_${index + 1}`);
  let id = baseId;
  let n = 2;
  while (usedIds.has(id)) id = `${baseId}_${n++}`;
  usedIds.add(id);
  const options = Array.isArray(input.options) && input.options.length > 0
    ? input.options.map(String)
    : undefined;
  const defaultValue = input.value !== undefined ? String(input.value) : (options?.[0] ?? 'ALL');
  return {
    id,
    label: input.label?.trim() || param,
    param,
    kind: input.kind === 'text' ? 'text' : 'select',
    ...(options ? { options } : {}),
    value: defaultValue,
  };
}

export function cloneDashboard(d: DashboardSpec): DashboardSpec {
  return {
    ...d,
    filters: d.filters.map((f) => ({ ...f, options: f.options ? [...f.options] : undefined })),
    widgets: d.widgets.map((w) => ({ ...w, yFields: w.yFields ? [...w.yFields] : undefined })),
  };
}

export function normalizeDashboard(raw: any): DashboardSpec | undefined {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.widgets)) return undefined;
  const defaultSource = typeof raw.defaultSource === 'string' && raw.defaultSource ? raw.defaultSource : 'local';
  const usedW = new Set<string>();
  const usedF = new Set<string>();
  const widgets = raw.widgets
    .filter((w: any) => w && typeof w.title === 'string' && typeof w.sql === 'string')
    .map((w: any, i: number) => normalizeWidget(w, defaultSource, usedW, i));
  const filters = (Array.isArray(raw.filters) ? raw.filters : [])
    .filter((f: any) => f && (typeof f.param === 'string' || typeof f.label === 'string'))
    .map((f: any, i: number) => normalizeFilter(f, usedF, i));
  return {
    title: typeof raw.title === 'string' ? raw.title : 'Live Dashboard',
    ...(typeof raw.subtitle === 'string' && raw.subtitle ? { subtitle: raw.subtitle } : {}),
    defaultSource,
    refreshSeconds: typeof raw.refreshSeconds === 'number' && raw.refreshSeconds >= 0 ? raw.refreshSeconds : 0,
    filters,
    widgets,
  };
}

/** Parameter dictionary derived from active dashboard filters (`:param`). */
export function filterParamsOf(dashboard: DashboardSpec | undefined): Record<string, string> {
  if (!dashboard) return {};
  const out: Record<string, string> = {};
  for (const f of dashboard.filters) {
    out[f.param] = f.value;
  }
  return out;
}

export function buildDashboard(req: CreateDashboardRequest): DashboardOpResult {
  const errors: string[] = [];
  if (!Array.isArray(req.widgets) || req.widgets.length === 0) {
    errors.push('create_dashboard requires at least 1 widget with a title and read-only SQL query.');
  }
  for (const w of req.widgets ?? []) {
    if (!w?.sql || typeof w.sql !== 'string' || !w.sql.trim()) {
      errors.push(`Widget "${w?.title ?? 'unnamed'}" is missing a SQL query.`);
    }
  }
  if (errors.length > 0) {
    return {
      ok: false,
      dashboard: { title: req.title || '', defaultSource: 'local', refreshSeconds: 0, filters: [], widgets: [] },
      addedWidgets: [],
      updatedWidgets: [],
      removedWidgets: [],
      errors,
      warnings: [],
      notes: [],
    };
  }

  const defaultSource = req.source?.trim() || 'local';
  const usedW = new Set<string>();
  const usedF = new Set<string>();
  const filters = (req.filters ?? []).map((f, i) => normalizeFilter(f, usedF, i));
  const widgets = req.widgets.map((w, i) => normalizeWidget(w, defaultSource, usedW, i));

  const dashboard: DashboardSpec = {
    title: req.title?.trim() || 'Live Dashboard',
    ...(req.subtitle?.trim() ? { subtitle: req.subtitle.trim() } : {}),
    defaultSource,
    refreshSeconds: typeof req.refresh_seconds === 'number' && req.refresh_seconds >= 0 ? req.refresh_seconds : 0,
    filters,
    widgets,
  };

  return {
    ok: true,
    dashboard,
    addedWidgets: widgets.map((w) => w.id),
    updatedWidgets: [],
    removedWidgets: [],
    errors: [],
    warnings: [],
    notes: [],
  };
}

function resolveWidgetRef(ref: string, widgets: DashboardWidget[], selection: string[]): Resolution<DashboardWidget> {
  if (ref === '@selected' && selection.length > 0) {
    const found = widgets.find((w) => selection.includes(w.id));
    if (found) return { item: found, note: `"@selected" → ${found.id}` };
  }
  const r = resolveRef(
    ref,
    widgets.map((w) => ({ id: w.id, label: w.title, kind: w.kind, widget: w })),
    'widget',
  );
  return { item: r.item?.widget, note: r.note, error: r.error };
}

export function applyDashboardEdit(
  prev: DashboardSpec,
  req: EditDashboardRequest,
  selection: string[] = [],
): DashboardOpResult {
  const next = cloneDashboard(prev);
  const errors: string[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];
  const addedWidgets: string[] = [];
  const updatedWidgets: string[] = [];
  const removedWidgets: string[] = [];

  if (typeof req.title === 'string' && req.title.trim()) next.title = req.title.trim();
  if (typeof req.subtitle === 'string') {
    if (req.subtitle.trim() === '') delete next.subtitle;
    else next.subtitle = req.subtitle.trim();
  }
  if (typeof req.refresh_seconds === 'number' && req.refresh_seconds >= 0) {
    next.refreshSeconds = req.refresh_seconds;
  }

  // Remove widgets
  for (const rawRef of req.remove_widgets ?? []) {
    const r = resolveWidgetRef(rawRef, next.widgets, selection);
    const target = 'widget' in (r.item ?? {}) ? (r.item as any).widget as DashboardWidget : (r.item as DashboardWidget | undefined);
    if (!target) {
      errors.push(r.error ?? `No widget matching "${rawRef}".`);
      continue;
    }
    if (r.note) notes.push(r.note);
    next.widgets = next.widgets.filter((w) => w.id !== target.id);
    removedWidgets.push(target.id);
  }

  // Update widgets
  for (const patch of req.update_widgets ?? []) {
    const r = resolveWidgetRef(patch.id, next.widgets, selection);
    const target = 'widget' in (r.item ?? {}) ? (r.item as any).widget as DashboardWidget : (r.item as DashboardWidget | undefined);
    if (!target) {
      errors.push(r.error ?? `No widget matching "${patch.id}".`);
      continue;
    }
    if (r.note) notes.push(r.note);
    if (patch.title !== undefined && patch.title.trim()) target.title = patch.title.trim();
    if (patch.subtitle !== undefined) {
      if (patch.subtitle.trim() === '') delete target.subtitle;
      else target.subtitle = patch.subtitle.trim();
    }
    if (patch.kind !== undefined && WIDGET_KINDS.includes(patch.kind)) target.kind = patch.kind;
    if (patch.source !== undefined && patch.source.trim()) target.source = patch.source.trim();
    if (patch.sql !== undefined && patch.sql.trim()) target.sql = patch.sql.trim();
    const xF = patch.xField ?? patch.x_field;
    if (xF !== undefined) {
      if (xF === '') delete target.xField;
      else target.xField = xF;
    }
    const yF = patch.yFields ?? patch.y_fields;
    if (yF !== undefined) target.yFields = yF.length > 0 ? [...yF] : undefined;
    const sF = patch.seriesField ?? patch.series_field;
    if (sF !== undefined) {
      if (sF === '') delete target.seriesField;
      else target.seriesField = sF;
    }
    if (patch.format !== undefined && VALUE_FORMATS.includes(patch.format)) target.format = patch.format;
    const cF = patch.comparisonField ?? patch.comparison_field;
    if (cF !== undefined) {
      if (cF === '') delete target.comparisonField;
      else target.comparisonField = cF;
    }
    if (patch.unit !== undefined) {
      if (patch.unit === '') delete target.unit;
      else target.unit = patch.unit;
    }
    const span = patch.colSpan ?? patch.col_span;
    if (span !== undefined) target.colSpan = normalizeColSpan(span, target.kind);
    if (patch.explanation !== undefined) {
      if (patch.explanation === '') delete target.explanation;
      else target.explanation = patch.explanation;
    }
    if (patch.color !== undefined) {
      if (patch.color === 'none') delete target.color;
      else if (COLORS.includes(patch.color)) target.color = patch.color;
    }
    if (!updatedWidgets.includes(target.id)) updatedWidgets.push(target.id);
  }

  // Add widgets
  const usedIds = new Set(next.widgets.map((w) => w.id));
  for (const add of req.add_widgets ?? []) {
    if (!add.sql || !add.sql.trim()) {
      errors.push(`New widget "${add.title || 'unnamed'}" requires a non-empty SQL query.`);
      continue;
    }
    const w = normalizeWidget(add, next.defaultSource, usedIds, next.widgets.length);
    if (add.after === 'start') {
      next.widgets.unshift(w);
    } else if (add.after) {
      const idx = next.widgets.findIndex((x) => x.id === add.after);
      if (idx >= 0) next.widgets.splice(idx + 1, 0, w);
      else next.widgets.push(w);
    } else {
      next.widgets.push(w);
    }
    addedWidgets.push(w.id);
  }

  // Reorder widgets
  if (Array.isArray(req.reorder_widgets) && req.reorder_widgets.length > 0) {
    const byId = new Map(next.widgets.map((w) => [w.id, w]));
    const ordered: DashboardWidget[] = [];
    for (const id of req.reorder_widgets) {
      const w = byId.get(id);
      if (w) {
        ordered.push(w);
        byId.delete(id);
      }
    }
    for (const rest of byId.values()) ordered.push(rest);
    next.widgets = ordered;
  }

  // Filters: remove, update, add
  for (const fRef of req.remove_filters ?? []) {
    next.filters = next.filters.filter((f) => f.id !== fRef && f.param !== fRef);
  }
  for (const fPatch of req.update_filters ?? []) {
    const f = next.filters.find((x) => x.id === fPatch.id || x.param === fPatch.id);
    if (!f) {
      warnings.push(`No filter "${fPatch.id}" found.`);
      continue;
    }
    if (fPatch.label !== undefined && fPatch.label.trim()) f.label = fPatch.label.trim();
    if (fPatch.value !== undefined) f.value = String(fPatch.value);
    if (fPatch.options !== undefined) f.options = fPatch.options.map(String);
  }
  const usedFIds = new Set(next.filters.map((f) => f.id));
  for (const fAdd of req.add_filters ?? []) {
    next.filters.push(normalizeFilter(fAdd, usedFIds, next.filters.length));
  }

  if (errors.length > 0) {
    return {
      ok: false,
      dashboard: prev,
      addedWidgets: [],
      updatedWidgets: [],
      removedWidgets: [],
      errors,
      warnings,
      notes,
    };
  }

  return {
    ok: true,
    dashboard: next,
    addedWidgets,
    updatedWidgets,
    removedWidgets,
    errors: [],
    warnings,
    notes,
  };
}

/** Compact summary of the active dashboard returned to Gemini Live on every tool call. */
export function describeDashboard(d: DashboardSpec): string {
  const lines: string[] = [];
  lines.push(
    `dashboard: ${JSON.stringify(d.title)}` +
    (d.subtitle ? ` (${JSON.stringify(d.subtitle)})` : '') +
    ` · source ${d.defaultSource} · ${d.widgets.length} ${d.widgets.length === 1 ? 'widget' : 'widgets'}` +
    (d.refreshSeconds > 0 ? ` · auto-refresh ${d.refreshSeconds}s` : ''),
  );
  if (d.filters.length > 0) {
    lines.push('  filters: ' + d.filters.map((f) => `${f.id} (:${f.param} = ${JSON.stringify(f.value)})`).join(' · '));
  }
  for (const w of d.widgets) {
    const sqlOneLine = w.sql.replace(/\s+/g, ' ').trim();
    lines.push(
      `  - ${w.id} [${w.kind}, span ${w.colSpan}/12, src=${w.source}] ${JSON.stringify(w.title)}: ` +
      `${sqlOneLine.length > 140 ? sqlOneLine.slice(0, 140) + '…' : sqlOneLine}`,
    );
  }
  return lines.join('\n');
}

export function formatMetricValue(val: unknown, format: ValueFormat = 'number', unit?: string): string {
  if (val === null || val === undefined || val === '') return '—';
  const num = typeof val === 'number' ? val : Number(val);
  if (!Number.isFinite(num)) return String(val);

  let out: string;
  switch (format) {
    case 'currency_usd':
      out = Math.abs(num) >= 1_000_000
        ? `$${(num / 1_000_000).toFixed(2)}M`
        : Math.abs(num) >= 10_000
          ? `$${(num / 1_000).toFixed(1)}K`
          : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(num);
      break;
    case 'currency_eur':
      out = Math.abs(num) >= 1_000_000
        ? `€${(num / 1_000_000).toFixed(2)}M`
        : Math.abs(num) >= 10_000
          ? `€${(num / 1_000).toFixed(1)}K`
          : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(num);
      break;
    case 'percent':
      out = `${num.toFixed(1)}%`;
      break;
    case 'ms':
      out = `${Math.round(num)} ms`;
      break;
    case 'compact':
      out = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(num);
      break;
    case 'raw':
      out = String(num);
      break;
    default:
      out = new Intl.NumberFormat('en-US', { maximumFractionDigits: Number.isInteger(num) ? 0 : 2 }).format(num);
      break;
  }
  return unit ? `${out} ${unit}` : out;
}

/** Annotated `.sql` file export containing all transparent widget queries & active parameters. */
export function dashboardToSqlBundle(d: DashboardSpec): string {
  const header = [
    `-- Dashboard: ${d.title}`,
    d.subtitle ? `-- Subtitle: ${d.subtitle}` : '',
    `-- Exported: ${new Date().toISOString()}`,
    d.filters.length > 0
      ? `-- Active Filters: ${d.filters.map((f) => `:${f.param} = '${f.value}'`).join(', ')}`
      : '',
    '',
  ].filter(Boolean).join('\n');

  const body = d.widgets.map((w, idx) => [
    `-- [${idx + 1}] ${w.title} (id: ${w.id}, type: ${w.kind}, source: ${w.source})`,
    w.explanation ? `-- Logic: ${w.explanation}` : '',
    `${w.sql.trim().replace(/;$/, '')};`,
    '',
  ].filter(Boolean).join('\n')).join('\n');

  return `${header}\n${body}`;
}

/** Exports BI handoff specification compatible with Vega-Lite / Hex / Observable workflows. */
export function dashboardToVegaLiteHandoff(
  d: DashboardSpec,
  results: Record<string, QueryExecutionResult | undefined>,
): string {
  const vconcat = d.widgets.filter((w) => w.kind !== 'kpi' && w.kind !== 'table').map((w) => {
    const res = results[w.id];
    const cols = res?.columns ?? [];
    const values = (res?.rows ?? []).map((r) => Object.fromEntries(cols.map((c, idx) => [c, r[idx]])));
    const xCol = w.xField ?? cols[0] ?? 'x';
    const yCol = w.yFields?.[0] ?? cols[1] ?? 'y';
    const mark = w.kind === 'line' ? 'line' : w.kind === 'area' ? 'area' : w.kind === 'scatter' ? 'point' : w.kind === 'pie' || w.kind === 'donut' ? 'arc' : 'bar';
    return {
      title: { text: w.title, subtitle: w.subtitle ?? `SQL: ${w.sql.replace(/\s+/g, ' ')}` },
      data: { values },
      mark: { type: mark, tooltip: true, ...(w.kind === 'donut' ? { innerRadius: 50 } : {}) },
      encoding: w.kind === 'pie' || w.kind === 'donut'
        ? { theta: { field: yCol, type: 'quantitative' }, color: { field: xCol, type: 'nominal' } }
        : {
            x: { field: xCol, type: 'nominal' },
            y: { field: yCol, type: 'quantitative' },
            ...(w.seriesField ? { color: { field: w.seriesField, type: 'nominal' } } : {}),
          },
    };
  });
  return JSON.stringify(
    {
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      title: d.title,
      description: d.subtitle ?? 'Exported from Voice Whiteboard Studio',
      vconcat,
    },
    null,
    2,
  );
}

/** Exports a Grafana Dashboard JSON model for direct import into Grafana / observability stacks. */
export function dashboardToGrafanaJson(d: DashboardSpec): string {
  let y = 0;
  let x = 0;
  const panels = d.widgets.map((w, idx) => {
    const gridW = w.colSpan * 2; // Grafana uses 24-column grid
    const gridH = w.kind === 'kpi' ? 5 : 9;
    if (x + gridW > 24) {
      x = 0;
      y += gridH;
    }
    const panel = {
      id: idx + 1,
      title: w.title,
      description: w.explanation ?? w.subtitle ?? '',
      type: w.kind === 'kpi' ? 'stat' : w.kind === 'table' ? 'table' : w.kind === 'pie' || w.kind === 'donut' ? 'piechart' : w.kind === 'line' || w.kind === 'area' ? 'timeseries' : 'barchart',
      gridPos: { x, y, w: gridW, h: gridH },
      targets: [{ refId: 'A', rawSql: w.sql, format: 'table', datasource: { type: w.source } }],
    };
    x += gridW;
    return panel;
  });
  return JSON.stringify(
    {
      title: d.title,
      schemaVersion: 39,
      refresh: d.refreshSeconds > 0 ? `${d.refreshSeconds}s` : '',
      templating: {
        list: d.filters.map((f) => ({
          name: f.param,
          label: f.label,
          type: 'custom',
          current: { text: f.value, value: f.value },
        })),
      },
      panels,
    },
    null,
    2,
  );
}

/** Exports a self-contained, zero-dependency interactive HTML report with transparent SQL toggle per widget. */
export function dashboardToStandaloneHtml(
  d: DashboardSpec,
  results: Record<string, QueryExecutionResult | undefined>,
): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const cards = d.widgets.map((w) => {
    const res = results[w.id];
    const rows = res?.rows ?? [];
    const cols = res?.columns ?? [];
    const refreshed = res?.executedAt ? new Date(res.executedAt).toLocaleString() : 'Not executed';
    let contentHtml = '';
    if (w.kind === 'kpi') {
      const valIdx = w.yFields?.[0] ? Math.max(0, cols.indexOf(w.yFields[0])) : Math.max(0, cols.length - 1);
      const val = rows[0]?.[valIdx];
      contentHtml = `<div class="kpi-val">${esc(formatMetricValue(val, w.format, w.unit))}</div>`;
    } else {
      contentHtml = `<div class="tbl-wrap"><table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>` +
        rows.slice(0, 25).map((r) => `<tr>${r.map((c) => `<td>${esc(c === null ? '—' : String(c))}</td>`).join('')}</tr>`).join('') +
        `</tbody></table></div>`;
    }
    return `<article class="card span-${w.colSpan}">
      <header><div><h3>${esc(w.title)}</h3>${w.subtitle ? `<p>${esc(w.subtitle)}</p>` : ''}</div><span class="meta">${esc(w.source)} · ${esc(refreshed)}</span></header>
      ${contentHtml}
      <details><summary>Inspect SQL Query (${rows.length} rows)</summary><pre>${esc(w.sql)}</pre>${w.explanation ? `<p class="exp">${esc(w.explanation)}</p>` : ''}</details>
    </article>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${esc(d.title)} — Interactive Dashboard Snapshot</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, -apple-system, sans-serif; }
  body { margin: 0; padding: 32px; background: Canvas; color: CanvasText; }
  h1 { margin: 0 0 4px; font-size: 26px; }
  .sub { opacity: 0.72; margin-bottom: 24px; }
  .grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 16px; }
  .card { border: 1px solid color-mix(in srgb, CanvasText 16%, transparent); border-radius: 16px; padding: 18px; grid-column: span 12; }
  @media (min-width: 900px) { .span-3 { grid-column: span 3; } .span-4 { grid-column: span 4; } .span-6 { grid-column: span 6; } .span-8 { grid-column: span 8; } }
  header { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; margin-bottom: 12px; }
  h3 { margin: 0; font-size: 15px; }
  header p, .meta { margin: 2px 0 0; font-size: 12px; opacity: 0.68; }
  .kpi-val { font-size: 34px; font-weight: 700; margin: 12px 0; }
  .tbl-wrap { overflow-x: auto; max-height: 280px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid color-mix(in srgb, CanvasText 10%, transparent); }
  details { margin-top: 12px; font-size: 12px; }
  summary { cursor: pointer; opacity: 0.78; font-weight: 500; }
  pre { background: color-mix(in srgb, CanvasText 6%, transparent); padding: 10px; border-radius: 8px; overflow-x: auto; }
</style>
</head>
<body>
  <h1>${esc(d.title)}</h1>
  ${d.subtitle ? `<div class="sub">${esc(d.subtitle)}</div>` : ''}
  <section class="grid">${cards}</section>
</body>
</html>`;
}
