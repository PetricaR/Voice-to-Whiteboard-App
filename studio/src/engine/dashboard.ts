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
  // 1. Categorical (10)
  'bar',
  'column',
  'grouped_bar',
  'stacked_bar',
  'horizontal_bar',
  'pie',
  'donut',
  'nightingale_rose',
  'radar',
  'marimekko',
  // 2. Temporal (5)
  'line',
  'area',
  'gantt',
  'candlestick',
  'streamgraph',
  // 3. Distribution (4)
  'histogram',
  'box_plot',
  'density',
  'violin',
  // 4. Relational (6)
  'scatter',
  'bubble',
  'heatmap',
  'parallel_coordinates',
  'chord',
  'network_chart',
  // 5. Hierarchical (5)
  'treemap',
  'sunburst',
  'org_chart',
  'circle_packing',
  'parallel_sets',
  // 6. Geospatial (6)
  'choropleth_map',
  'dot_map',
  'geo_heatmap',
  'bubble_map',
  'flow_map',
  'connection_map',
  // 7. Proportional & Goal Tracking (6)
  'kpi',
  'proportional_area',
  'square_area',
  'gauge',
  'bullet',
  'funnel',
  // 8. Advanced & Specialized (6)
  'sankey',
  'spiral_plot',
  'arc_diagram',
  'trellis',
  'waterfall',
  'table',
] as const;
export type WidgetKind = (typeof WIDGET_KINDS)[number];

export const VALUE_FORMATS = [
  'number',
  'currency_usd',
  'currency_eur',
  'currency_gbp',
  'percent',
  'compact',
  'ms',
  'bytes',
  'raw',
] as const;
export type ValueFormat = (typeof VALUE_FORMATS)[number];

export const COL_SPANS = [3, 4, 6, 8, 12] as const;
export type ColSpan = (typeof COL_SPANS)[number];

export const FILTER_KINDS = ['select', 'text'] as const;
export type FilterKind = (typeof FILTER_KINDS)[number];

export const CHART_PALETTES = [
  'studio',
  'viridis',
  'ocean',
  'sunset',
  'forest',
  'pastel',
  'monochrome',
  'diverging',
  'neon',
] as const;
export type ChartPalette = (typeof CHART_PALETTES)[number];

export const CHART_ORIENTATIONS = ['auto', 'vertical', 'horizontal'] as const;
export type ChartOrientation = (typeof CHART_ORIENTATIONS)[number];

export const STACK_MODES = ['none', 'stacked', 'percent_100'] as const;
export type StackMode = (typeof STACK_MODES)[number];

export const SORT_MODES = ['none', 'value_desc', 'value_asc', 'label_asc', 'label_desc'] as const;
export type SortMode = (typeof SORT_MODES)[number];

export const CURVE_TYPES = ['linear', 'monotone', 'step'] as const;
export type CurveType = (typeof CURVE_TYPES)[number];

export const LINE_STYLES = ['solid', 'dashed', 'dotted'] as const;
export type LineStyle = (typeof LINE_STYLES)[number];

export const MARKER_SHAPES = ['circle', 'square', 'diamond', 'triangle'] as const;
export type MarkerShape = (typeof MARKER_SHAPES)[number];

export const AXIS_SCALES = ['linear', 'log', 'sqrt'] as const;
export type AxisScale = (typeof AXIS_SCALES)[number];

export const LEGEND_POSITIONS = ['top', 'bottom', 'left', 'right', 'none'] as const;
export type LegendPosition = (typeof LEGEND_POSITIONS)[number];

export const DATA_LABEL_POSITIONS = ['auto', 'outside', 'inside', 'center', 'top'] as const;
export type DataLabelPosition = (typeof DATA_LABEL_POSITIONS)[number];

export const DATA_LABEL_CONTENTS = ['value', 'percent', 'label_value', 'label_percent', 'label'] as const;
export type DataLabelContent = (typeof DATA_LABEL_CONTENTS)[number];

export const MAP_SCOPES = ['world', 'americas', 'emea', 'apac'] as const;
export type MapScope = (typeof MAP_SCOPES)[number];

export const CARD_BACKGROUNDS = ['default', 'subtle', 'elevated', 'tinted', 'glass'] as const;
export type CardBackground = (typeof CARD_BACKGROUNDS)[number];

export const CARD_BORDERS = ['default', 'none', 'strong', 'accent'] as const;
export type CardBorder = (typeof CARD_BORDERS)[number];

export const CARD_PADDINGS = ['compact', 'normal', 'spacious'] as const;
export type CardPadding = (typeof CARD_PADDINGS)[number];

export const FONT_FAMILIES = ['sans', 'mono', 'serif'] as const;
export type ChartFontFamily = (typeof FONT_FAMILIES)[number];

export const TITLE_SIZES = ['sm', 'md', 'lg'] as const;
export type ChartTitleSize = (typeof TITLE_SIZES)[number];

export interface ChartReferenceLine {
  id?: string;
  axis: 'x' | 'y';
  value: number | string;
  label?: string;
  color?: string;
  style?: LineStyle;
}

export interface ChartReferenceBand {
  id?: string;
  axis: 'x' | 'y';
  from: number;
  to: number;
  label?: string;
  color?: string;
  opacity?: number;
}

export interface ChartAnnotation {
  id?: string;
  /** Optional category/label to anchor the annotation to; falls back to xRatio/yRatio (0..1). */
  targetLabel?: string;
  xRatio?: number;
  yRatio?: number;
  text: string;
  color?: string;
}

export interface ChartRangeBand {
  to: number;
  label?: string;
  color?: string;
}

/**
 * Granular configuration controlling every anatomical element of a chart:
 * card frame, typography, data shaping, palettes, axes, gridlines, margins,
 * series geometry, data labels, legends, reference lines/bands, trendlines,
 * annotations, and interactivity.
 */
export interface ChartElementConfig {
  // 1. Typography & Card Frame
  footnote?: string;
  badgeText?: string;
  titleSize?: ChartTitleSize;
  titleAlign?: 'left' | 'center' | 'right';
  fontFamily?: ChartFontFamily;
  cardBackground?: CardBackground;
  cardBorder?: CardBorder;
  cardPadding?: CardPadding;
  chartHeight?: number;

  // 2. Data Shaping & Orientation
  orientation?: ChartOrientation;
  stackMode?: StackMode;
  sortBy?: SortMode;
  limitItems?: number;
  groupTailAsOther?: boolean;

  // 3. Colors & Palettes
  palette?: ChartPalette;
  colorBy?: 'series' | 'category' | 'value';
  customColors?: string[];
  fillOpacity?: number;
  gradientFill?: boolean;

  // 4. X-Axis
  showXAxis?: boolean;
  showXTicks?: boolean;
  xAxisTitle?: string;
  xTickRotation?: 0 | -30 | -45 | -90;
  xTickMaxCount?: number;
  xTickTruncate?: number;
  xAxisScale?: AxisScale;

  // 5. Y-Axis
  showYAxis?: boolean;
  showYTicks?: boolean;
  yAxisTitle?: string;
  yAxisPosition?: 'left' | 'right';
  yAxisScale?: AxisScale;
  yMin?: number;
  yMax?: number;
  startFromZero?: boolean;
  yTickCount?: number;
  yAxisFormat?: ValueFormat;

  // 6. Grid & Plot Margins
  showHorizontalGrid?: boolean;
  showVerticalGrid?: boolean;
  gridStyle?: LineStyle;
  gridOpacity?: number;
  showPlotBorder?: boolean;
  plotPaddingTop?: number;
  plotPaddingRight?: number;
  plotPaddingBottom?: number;
  plotPaddingLeft?: number;

  // 7. Series Geometry (Line, Bar, Radial, Distribution, Hierarchy, Flow, Map)
  curveType?: CurveType;
  strokeWidth?: number;
  lineStyle?: LineStyle;
  showMarkers?: boolean;
  markerSize?: number;
  markerShape?: MarkerShape;
  directLineLabels?: boolean;
  barRadius?: number;
  barGap?: number;
  barMaxWidth?: number;
  innerRadiusRatio?: number;
  padAngle?: number;
  startAngle?: number;
  donutCenterLabel?: string;
  donutCenterSubtext?: string;
  binCount?: number;
  showOutliers?: boolean;
  showMean?: boolean;
  targetValue?: number;
  ranges?: ChartRangeBand[];
  trellisColumns?: number;
  trellisSubKind?: 'line' | 'area' | 'bar' | 'column';
  mapScope?: MapScope;
  showMapGraticule?: boolean;
  showMapLabels?: boolean;
  nodeSize?: number;
  linkCurvature?: number;

  // 8. Data Labels & Formatting
  showDataLabels?: boolean;
  dataLabelPosition?: DataLabelPosition;
  dataLabelContent?: DataLabelContent;
  dataLabelFontSize?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;

  // 9. Legend
  showLegend?: boolean;
  legendPosition?: LegendPosition;
  legendShowValues?: boolean;

  // 10. Annotations, Reference Lines, Bands, Trendlines & Interactivity
  showTrendline?: boolean;
  showAverageLine?: boolean;
  highlightMaxMin?: boolean;
  referenceLines?: ChartReferenceLine[];
  referenceBands?: ChartReferenceBand[];
  annotations?: ChartAnnotation[];
  showTooltip?: boolean;
  crossFilterOnClick?: boolean;
  animate?: boolean;
}

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
  /** Optional grouping/pivoting column for multi-series line/bar/stacked_bar/heatmap/trellis charts. */
  seriesField?: string;
  /** Optional bubble/node size column (bubble, bubble_map, marimekko, circle_packing). */
  sizeField?: string;
  /** Optional parent node column for hierarchical trees (org_chart, sunburst, treemap, circle_packing). */
  parentField?: string;
  /** Optional OHLC financial columns for candlestick charts. */
  openField?: string;
  highField?: string;
  lowField?: string;
  closeField?: string;
  /** Optional Gantt schedule columns. */
  startField?: string;
  endField?: string;
  progressField?: string;
  /** Optional geospatial coordinate columns for dot/bubble/flow/connection maps. */
  latField?: string;
  lonField?: string;
  destLatField?: string;
  destLonField?: string;
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
  /** Granular per-element chart configuration (axes, grid, geometry, labels, legends, overlays, frame). */
  chartConfig?: ChartElementConfig;
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

export type ChartElementConfigInput = Partial<ChartElementConfig> & Record<string, unknown>;

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
  size_field?: string;
  sizeField?: string;
  parent_field?: string;
  parentField?: string;
  open_field?: string;
  openField?: string;
  high_field?: string;
  highField?: string;
  low_field?: string;
  lowField?: string;
  close_field?: string;
  closeField?: string;
  start_field?: string;
  startField?: string;
  end_field?: string;
  endField?: string;
  progress_field?: string;
  progressField?: string;
  lat_field?: string;
  latField?: string;
  lon_field?: string;
  lonField?: string;
  dest_lat_field?: string;
  destLatField?: string;
  dest_lon_field?: string;
  destLonField?: string;
  format?: ValueFormat;
  comparison_field?: string;
  comparisonField?: string;
  unit?: string;
  col_span?: number;
  colSpan?: number;
  explanation?: string;
  color?: ColorName | 'none';
  chart_config?: ChartElementConfigInput;
  chartConfig?: ChartElementConfigInput;
  reset_chart_config?: boolean;
  resetChartConfig?: boolean;
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
  if (kind === 'table' || kind === 'trellis') return 12;
  return 6;
}

function snakeToCamelKey(k: string): string {
  return k.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());
}

const clampNum = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

/** Normalizes camelCase or snake_case chart element properties into a clean `ChartElementConfig`. */
export function normalizeChartConfig(
  raw: unknown,
  base?: ChartElementConfig,
): ChartElementConfig | undefined {
  if (!raw || typeof raw !== 'object') return base ? cloneChartConfig(base) : undefined;
  const src: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    src[snakeToCamelKey(k)] = v;
  }
  const out: ChartElementConfig = base ? (cloneChartConfig(base) ?? {}) : {};

  const setStr = (key: keyof ChartElementConfig, allowEmpty = false) => {
    if (!(key in src)) return;
    const v = src[key];
    if (v === null || v === undefined || (!allowEmpty && v === '')) {
      delete out[key];
    } else if (typeof v === 'string') {
      (out as Record<string, unknown>)[key] = allowEmpty ? v : v.trim();
    }
  };
  const setBool = (key: keyof ChartElementConfig) => {
    if (!(key in src)) return;
    const v = src[key];
    if (v === null || v === undefined) delete out[key];
    else if (typeof v === 'boolean') (out as Record<string, unknown>)[key] = v;
  };
  const setNum = (key: keyof ChartElementConfig, min: number, max: number) => {
    if (!(key in src)) return;
    const v = src[key];
    if (v === null || v === undefined || v === '') {
      delete out[key];
    } else {
      const n = typeof v === 'number' ? v : Number(v);
      if (Number.isFinite(n)) (out as Record<string, unknown>)[key] = clampNum(n, min, max);
    }
  };
  const setFreeNum = (key: keyof ChartElementConfig) => {
    if (!(key in src)) return;
    const v = src[key];
    if (v === null || v === undefined || v === '') {
      delete out[key];
    } else {
      const n = typeof v === 'number' ? v : Number(v);
      if (Number.isFinite(n)) (out as Record<string, unknown>)[key] = n;
    }
  };
  const setEnum = <T extends string>(key: keyof ChartElementConfig, allowed: readonly T[]) => {
    if (!(key in src)) return;
    const v = src[key];
    if (v === null || v === undefined || v === '') delete out[key];
    else if (typeof v === 'string' && (allowed as readonly string[]).includes(v)) {
      (out as Record<string, unknown>)[key] = v;
    }
  };

  // 1. Typography & Card Frame
  setStr('footnote');
  setStr('badgeText');
  setEnum('titleSize', TITLE_SIZES);
  setEnum('titleAlign', ['left', 'center', 'right'] as const);
  setEnum('fontFamily', FONT_FAMILIES);
  setEnum('cardBackground', CARD_BACKGROUNDS);
  setEnum('cardBorder', CARD_BORDERS);
  setEnum('cardPadding', CARD_PADDINGS);
  setNum('chartHeight', 120, 680);

  // 2. Data Shaping & Orientation
  setEnum('orientation', CHART_ORIENTATIONS);
  setEnum('stackMode', STACK_MODES);
  setEnum('sortBy', SORT_MODES);
  setNum('limitItems', 1, 500);
  setBool('groupTailAsOther');

  // 3. Colors & Palettes
  setEnum('palette', CHART_PALETTES);
  setEnum('colorBy', ['series', 'category', 'value'] as const);
  if ('customColors' in src) {
    const cc = src.customColors;
    if (cc === null || cc === undefined) delete out.customColors;
    else if (Array.isArray(cc)) {
      const cleaned = cc.map((c) => String(c).trim()).filter(Boolean);
      if (cleaned.length > 0) out.customColors = cleaned;
      else delete out.customColors;
    }
  }
  setNum('fillOpacity', 0.05, 1);
  setBool('gradientFill');

  // 4. X-Axis
  setBool('showXAxis');
  setBool('showXTicks');
  setStr('xAxisTitle');
  if ('xTickRotation' in src) {
    const r = Number(src.xTickRotation);
    if (r === 0 || r === -30 || r === -45 || r === -90) out.xTickRotation = r;
    else if (src.xTickRotation === null) delete out.xTickRotation;
  }
  setNum('xTickMaxCount', 2, 48);
  setNum('xTickTruncate', 3, 60);
  setEnum('xAxisScale', AXIS_SCALES);

  // 5. Y-Axis
  setBool('showYAxis');
  setBool('showYTicks');
  setStr('yAxisTitle');
  setEnum('yAxisPosition', ['left', 'right'] as const);
  setEnum('yAxisScale', AXIS_SCALES);
  setFreeNum('yMin');
  setFreeNum('yMax');
  setBool('startFromZero');
  setNum('yTickCount', 2, 12);
  setEnum('yAxisFormat', VALUE_FORMATS);

  // 6. Grid & Plot Margins
  setBool('showHorizontalGrid');
  setBool('showVerticalGrid');
  setEnum('gridStyle', LINE_STYLES);
  setNum('gridOpacity', 0, 1);
  setBool('showPlotBorder');
  setNum('plotPaddingTop', 4, 120);
  setNum('plotPaddingRight', 4, 140);
  setNum('plotPaddingBottom', 8, 140);
  setNum('plotPaddingLeft', 8, 160);

  // 7. Series Geometry
  setEnum('curveType', CURVE_TYPES);
  setNum('strokeWidth', 0.5, 10);
  setEnum('lineStyle', LINE_STYLES);
  setBool('showMarkers');
  setNum('markerSize', 1, 18);
  setEnum('markerShape', MARKER_SHAPES);
  setBool('directLineLabels');
  setNum('barRadius', 0, 24);
  setNum('barGap', 0, 0.9);
  setNum('barMaxWidth', 8, 180);
  setNum('innerRadiusRatio', 0, 0.9);
  setNum('padAngle', 0, 16);
  setNum('startAngle', -360, 360);
  setStr('donutCenterLabel');
  setStr('donutCenterSubtext');
  setNum('binCount', 3, 50);
  setBool('showOutliers');
  setBool('showMean');
  setFreeNum('targetValue');
  if ('ranges' in src) {
    if (src.ranges === null || src.ranges === undefined) delete out.ranges;
    else if (Array.isArray(src.ranges)) {
      out.ranges = src.ranges
        .filter((r: any) => r && Number.isFinite(Number(r.to)))
        .map((r: any) => ({
          to: Number(r.to),
          ...(r.label ? { label: String(r.label) } : {}),
          ...(r.color ? { color: String(r.color) } : {}),
        }));
    }
  }
  setNum('trellisColumns', 1, 6);
  setEnum('trellisSubKind', ['line', 'area', 'bar', 'column'] as const);
  setEnum('mapScope', MAP_SCOPES);
  setBool('showMapGraticule');
  setBool('showMapLabels');
  setNum('nodeSize', 2, 36);
  setNum('linkCurvature', 0, 1);

  // 8. Data Labels & Formatting
  setBool('showDataLabels');
  setEnum('dataLabelPosition', DATA_LABEL_POSITIONS);
  setEnum('dataLabelContent', DATA_LABEL_CONTENTS);
  setNum('dataLabelFontSize', 8, 22);
  setNum('decimals', 0, 6);
  setStr('prefix', true);
  setStr('suffix', true);

  // 9. Legend
  setBool('showLegend');
  setEnum('legendPosition', LEGEND_POSITIONS);
  setBool('legendShowValues');

  // 10. Overlays & Interactivity
  setBool('showTrendline');
  setBool('showAverageLine');
  setBool('highlightMaxMin');
  if ('referenceLines' in src) {
    if (src.referenceLines === null || src.referenceLines === undefined) delete out.referenceLines;
    else if (Array.isArray(src.referenceLines)) {
      out.referenceLines = src.referenceLines
        .filter((rl: any) => rl && (rl.axis === 'x' || rl.axis === 'y') && rl.value !== undefined)
        .map((rl: any, i: number) => ({
          id: rl.id ? String(rl.id) : `ref_${i + 1}`,
          axis: rl.axis === 'x' ? 'x' : 'y',
          value: typeof rl.value === 'number' || (typeof rl.value === 'string' && rl.value.trim() !== '' && !Number.isNaN(Number(rl.value)))
            ? Number(rl.value)
            : String(rl.value),
          ...(rl.label ? { label: String(rl.label) } : {}),
          ...(rl.color ? { color: String(rl.color) } : {}),
          ...(rl.style && LINE_STYLES.includes(rl.style) ? { style: rl.style } : {}),
        }));
    }
  }
  if ('referenceBands' in src) {
    if (src.referenceBands === null || src.referenceBands === undefined) delete out.referenceBands;
    else if (Array.isArray(src.referenceBands)) {
      out.referenceBands = src.referenceBands
        .filter((rb: any) => rb && (rb.axis === 'x' || rb.axis === 'y') && Number.isFinite(Number(rb.from)) && Number.isFinite(Number(rb.to)))
        .map((rb: any, i: number) => ({
          id: rb.id ? String(rb.id) : `band_${i + 1}`,
          axis: rb.axis === 'x' ? 'x' : 'y',
          from: Number(rb.from),
          to: Number(rb.to),
          ...(rb.label ? { label: String(rb.label) } : {}),
          ...(rb.color ? { color: String(rb.color) } : {}),
          ...(typeof rb.opacity === 'number' ? { opacity: clampNum(rb.opacity, 0.02, 0.8) } : {}),
        }));
    }
  }
  if ('annotations' in src) {
    if (src.annotations === null || src.annotations === undefined) delete out.annotations;
    else if (Array.isArray(src.annotations)) {
      out.annotations = src.annotations
        .filter((an: any) => an && typeof an.text === 'string' && an.text.trim())
        .map((an: any, i: number) => ({
          id: an.id ? String(an.id) : `ann_${i + 1}`,
          text: String(an.text).trim(),
          ...(an.targetLabel ?? an.target_label ? { targetLabel: String(an.targetLabel ?? an.target_label) } : {}),
          ...(typeof (an.xRatio ?? an.x_ratio) === 'number' ? { xRatio: clampNum(Number(an.xRatio ?? an.x_ratio), 0, 1) } : {}),
          ...(typeof (an.yRatio ?? an.y_ratio) === 'number' ? { yRatio: clampNum(Number(an.yRatio ?? an.y_ratio), 0, 1) } : {}),
          ...(an.color ? { color: String(an.color) } : {}),
        }));
    }
  }
  setBool('showTooltip');
  setBool('crossFilterOnClick');
  setBool('animate');

  return Object.keys(out).length > 0 ? out : undefined;
}

export function cloneChartConfig(cfg: ChartElementConfig | undefined): ChartElementConfig | undefined {
  if (!cfg) return undefined;
  return {
    ...cfg,
    ...(cfg.customColors ? { customColors: [...cfg.customColors] } : {}),
    ...(cfg.ranges ? { ranges: cfg.ranges.map((r) => ({ ...r })) } : {}),
    ...(cfg.referenceLines ? { referenceLines: cfg.referenceLines.map((rl) => ({ ...rl })) } : {}),
    ...(cfg.referenceBands ? { referenceBands: cfg.referenceBands.map((rb) => ({ ...rb })) } : {}),
    ...(cfg.annotations ? { annotations: cfg.annotations.map((an) => ({ ...an })) } : {}),
  };
}

const EXTRA_FIELD_PAIRS: [keyof DashboardWidget, keyof DashboardWidgetInput, keyof DashboardWidgetInput][] = [
  ['sizeField', 'sizeField', 'size_field'],
  ['parentField', 'parentField', 'parent_field'],
  ['openField', 'openField', 'open_field'],
  ['highField', 'highField', 'high_field'],
  ['lowField', 'lowField', 'low_field'],
  ['closeField', 'closeField', 'close_field'],
  ['startField', 'startField', 'start_field'],
  ['endField', 'endField', 'end_field'],
  ['progressField', 'progressField', 'progress_field'],
  ['latField', 'latField', 'lat_field'],
  ['lonField', 'lonField', 'lon_field'],
  ['destLatField', 'destLatField', 'dest_lat_field'],
  ['destLonField', 'destLonField', 'dest_lon_field'],
];

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
  const chartConfig = normalizeChartConfig(input.chartConfig ?? input.chart_config);

  const widget: DashboardWidget = {
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
    ...(chartConfig ? { chartConfig } : {}),
  };

  for (const [targetKey, camelKey, snakeKey] of EXTRA_FIELD_PAIRS) {
    const raw = (input[camelKey] ?? input[snakeKey]) as string | undefined;
    if (typeof raw === 'string' && raw.trim()) {
      (widget as unknown as Record<string, unknown>)[targetKey] = raw.trim();
    }
  }

  return widget;
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
    widgets: d.widgets.map((w) => ({
      ...w,
      yFields: w.yFields ? [...w.yFields] : undefined,
      ...(w.chartConfig ? { chartConfig: cloneChartConfig(w.chartConfig) } : {}),
    })),
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
    for (const [targetKey, camelKey, snakeKey] of EXTRA_FIELD_PAIRS) {
      const val = (patch[camelKey] ?? patch[snakeKey]) as string | undefined;
      if (val !== undefined) {
        if (val === '') delete (target as unknown as Record<string, unknown>)[targetKey];
        else (target as unknown as Record<string, unknown>)[targetKey] = val.trim();
      }
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
    if (patch.resetChartConfig || patch.reset_chart_config) {
      delete target.chartConfig;
    }
    const cfgPatch = patch.chartConfig ?? patch.chart_config;
    if (cfgPatch !== undefined) {
      const merged = normalizeChartConfig(cfgPatch, target.chartConfig);
      if (merged) target.chartConfig = merged;
      else delete target.chartConfig;
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

function summarizeChartConfig(cfg: ChartElementConfig | undefined): string {
  if (!cfg) return '';
  const tags: string[] = [];
  if (cfg.palette) tags.push(`palette=${cfg.palette}`);
  if (cfg.orientation && cfg.orientation !== 'auto') tags.push(`orient=${cfg.orientation}`);
  if (cfg.stackMode && cfg.stackMode !== 'none') tags.push(`stack=${cfg.stackMode}`);
  if (cfg.sortBy && cfg.sortBy !== 'none') tags.push(`sort=${cfg.sortBy}`);
  if (cfg.showDataLabels) tags.push('labels=on');
  if (cfg.legendPosition) tags.push(`legend=${cfg.legendPosition}`);
  if (cfg.showTrendline) tags.push('trendline');
  if (cfg.showAverageLine) tags.push('avgLine');
  if (cfg.limitItems) tags.push(`top=${cfg.limitItems}${cfg.groupTailAsOther ? '+other' : ''}`);
  if (typeof cfg.targetValue === 'number') tags.push(`target=${cfg.targetValue}`);
  if (cfg.referenceLines?.length) tags.push(`refLines=${cfg.referenceLines.map((r) => r.label ?? r.value).join('|')}`);
  if (cfg.annotations?.length) tags.push(`notes=${cfg.annotations.map((a) => a.text).join('|')}`);
  return tags.length > 0 ? ` {${tags.join(', ')}}` : '';
}

/** How the result columns are mapped onto the chart, e.g. " (x=month, y=mrr_usd, series=region, currency_usd)". */
function summarizeFields(w: DashboardWidget): string {
  const parts: string[] = [];
  if (w.xField) parts.push(`x=${w.xField}`);
  if (w.yFields?.length) parts.push(`y=${w.yFields.join('+')}`);
  if (w.seriesField) parts.push(`series=${w.seriesField}`);
  if (w.sizeField) parts.push(`size=${w.sizeField}`);
  if (w.comparisonField) parts.push(`delta=${w.comparisonField}`);
  if (w.format) parts.push(w.format);
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

/** Long enough for the model to rewrite a query precisely without asking for it again. */
const STATE_SQL_CHARS = 420;

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
      `  - ${w.id} [${w.kind}, span ${w.colSpan}/12, src=${w.source}]${summarizeFields(w)}${summarizeChartConfig(w.chartConfig)} ${JSON.stringify(w.title)}: ` +
      `${sqlOneLine.length > STATE_SQL_CHARS ? sqlOneLine.slice(0, STATE_SQL_CHARS) + '…' : sqlOneLine}`,
    );
  }
  return lines.join('\n');
}

export function formatMetricValue(
  val: unknown,
  format: ValueFormat = 'number',
  unit?: string,
  opts?: { decimals?: number; prefix?: string; suffix?: string },
): string {
  if (val === null || val === undefined || val === '') return '—';
  const num = typeof val === 'number' ? val : Number(val);
  if (!Number.isFinite(num)) return String(val);

  const decOverride = opts?.decimals;
  let out: string;
  switch (format) {
    case 'currency_usd':
      out = decOverride !== undefined
        ? `$${new Intl.NumberFormat('en-US', { minimumFractionDigits: decOverride, maximumFractionDigits: decOverride }).format(num)}`
        : Math.abs(num) >= 1_000_000
          ? `$${(num / 1_000_000).toFixed(2)}M`
          : Math.abs(num) >= 10_000
            ? `$${(num / 1_000).toFixed(1)}K`
            : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(num);
      break;
    case 'currency_eur':
      out = decOverride !== undefined
        ? `€${new Intl.NumberFormat('en-US', { minimumFractionDigits: decOverride, maximumFractionDigits: decOverride }).format(num)}`
        : Math.abs(num) >= 1_000_000
          ? `€${(num / 1_000_000).toFixed(2)}M`
          : Math.abs(num) >= 10_000
            ? `€${(num / 1_000).toFixed(1)}K`
            : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(num);
      break;
    case 'currency_gbp':
      out = decOverride !== undefined
        ? `£${new Intl.NumberFormat('en-US', { minimumFractionDigits: decOverride, maximumFractionDigits: decOverride }).format(num)}`
        : Math.abs(num) >= 1_000_000
          ? `£${(num / 1_000_000).toFixed(2)}M`
          : Math.abs(num) >= 10_000
            ? `£${(num / 1_000).toFixed(1)}K`
            : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(num);
      break;
    case 'percent':
      out = `${num.toFixed(decOverride ?? 1)}%`;
      break;
    case 'ms':
      out = `${decOverride !== undefined ? num.toFixed(decOverride) : Math.round(num)} ms`;
      break;
    case 'bytes': {
      const abs = Math.abs(num);
      if (abs >= 1_073_741_824) out = `${(num / 1_073_741_824).toFixed(decOverride ?? 1)} GB`;
      else if (abs >= 1_048_576) out = `${(num / 1_048_576).toFixed(decOverride ?? 1)} MB`;
      else if (abs >= 1024) out = `${(num / 1024).toFixed(decOverride ?? 1)} KB`;
      else out = `${Math.round(num)} B`;
      break;
    }
    case 'compact':
      out = new Intl.NumberFormat('en-US', {
        notation: 'compact',
        maximumFractionDigits: decOverride ?? 1,
      }).format(num);
      break;
    case 'raw':
      out = decOverride !== undefined ? num.toFixed(decOverride) : String(num);
      break;
    default:
      out = new Intl.NumberFormat('en-US', {
        ...(decOverride !== undefined ? { minimumFractionDigits: decOverride } : {}),
        maximumFractionDigits: decOverride ?? (Number.isInteger(num) ? 0 : 2),
      }).format(num);
      break;
  }
  const withAffixes = `${opts?.prefix ?? ''}${out}${opts?.suffix ?? ''}`;
  return unit ? `${withAffixes} ${unit}` : withAffixes;
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

function vegaMarkForKind(kind: WidgetKind): string {
  switch (kind) {
    case 'line':
    case 'parallel_coordinates':
    case 'spiral_plot':
      return 'line';
    case 'area':
    case 'density':
    case 'streamgraph':
      return 'area';
    case 'scatter':
    case 'bubble':
    case 'dot_map':
    case 'bubble_map':
    case 'proportional_area':
    case 'circle_packing':
      return 'circle';
    case 'pie':
    case 'donut':
    case 'nightingale_rose':
    case 'sunburst':
    case 'gauge':
      return 'arc';
    case 'box_plot':
    case 'violin':
      return 'boxplot';
    case 'heatmap':
    case 'geo_heatmap':
    case 'treemap':
    case 'marimekko':
    case 'square_area':
      return 'rect';
    case 'candlestick':
      return 'rule';
    default:
      return 'bar';
  }
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
    const cfg = w.chartConfig;
    const mark = vegaMarkForKind(w.kind);
    const isArc = mark === 'arc';
    return {
      title: {
        text: w.title,
        subtitle: w.subtitle ?? `SQL: ${w.sql.replace(/\s+/g, ' ')}`,
      },
      data: { values },
      mark: {
        type: mark,
        tooltip: cfg?.showTooltip !== false,
        ...(w.kind === 'donut' || (cfg?.innerRadiusRatio && cfg.innerRadiusRatio > 0)
          ? { innerRadius: Math.round((cfg?.innerRadiusRatio ?? 0.58) * 80) }
          : {}),
        ...(cfg?.curveType === 'monotone' ? { interpolate: 'monotone' } : cfg?.curveType === 'step' ? { interpolate: 'step-after' } : {}),
        ...(typeof cfg?.barRadius === 'number' ? { cornerRadiusEnd: cfg.barRadius } : {}),
        ...(typeof cfg?.fillOpacity === 'number' ? { fillOpacity: cfg.fillOpacity } : {}),
      },
      encoding: isArc
        ? {
            theta: { field: yCol, type: 'quantitative' },
            color: { field: xCol, type: 'nominal', ...(cfg?.legendPosition === 'none' || cfg?.showLegend === false ? { legend: null } : {}) },
          }
        : {
            x: {
              field: xCol,
              type: w.kind === 'scatter' || w.kind === 'bubble' || w.kind === 'histogram' ? 'quantitative' : 'nominal',
              ...(cfg?.xAxisTitle ? { title: cfg.xAxisTitle } : {}),
              ...(cfg?.showXAxis === false ? { axis: null } : {}),
            },
            y: {
              field: yCol,
              type: 'quantitative',
              ...(cfg?.yAxisTitle ? { title: cfg.yAxisTitle } : {}),
              ...(cfg?.showYAxis === false ? { axis: null } : {}),
              ...(cfg?.yAxisScale && cfg.yAxisScale !== 'linear' ? { scale: { type: cfg.yAxisScale } } : {}),
            },
            ...(w.seriesField ? { color: { field: w.seriesField, type: 'nominal' } } : {}),
            ...(w.sizeField ? { size: { field: w.sizeField, type: 'quantitative' } } : {}),
          },
      ...(w.chartConfig ? { usermeta: { studioChartKind: w.kind, chartConfig: w.chartConfig } } : {}),
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

function grafanaTypeForKind(kind: WidgetKind): string {
  switch (kind) {
    case 'kpi':
      return 'stat';
    case 'table':
      return 'table';
    case 'pie':
    case 'donut':
    case 'nightingale_rose':
    case 'sunburst':
      return 'piechart';
    case 'line':
    case 'area':
    case 'streamgraph':
    case 'density':
    case 'spiral_plot':
      return 'timeseries';
    case 'gauge':
    case 'bullet':
      return 'gauge';
    case 'heatmap':
    case 'geo_heatmap':
      return 'heatmap';
    case 'candlestick':
      return 'candlestick';
    case 'histogram':
      return 'histogram';
    case 'choropleth_map':
    case 'dot_map':
    case 'bubble_map':
    case 'flow_map':
    case 'connection_map':
      return 'geomap';
    default:
      return 'barchart';
  }
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
      type: grafanaTypeForKind(w.kind),
      gridPos: { x, y, w: gridW, h: gridH },
      targets: [{ refId: 'A', rawSql: w.sql, format: 'table', datasource: { type: w.source } }],
      ...(w.chartConfig ? { options: { studioChartKind: w.kind, studioChartConfig: w.chartConfig } } : {}),
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
    const fmtOpts = {
      decimals: w.chartConfig?.decimals,
      prefix: w.chartConfig?.prefix,
      suffix: w.chartConfig?.suffix,
    };
    let contentHtml = '';
    if (w.kind === 'kpi') {
      const valIdx = w.yFields?.[0] ? Math.max(0, cols.indexOf(w.yFields[0])) : Math.max(0, cols.length - 1);
      const val = rows[0]?.[valIdx];
      contentHtml = `<div class="kpi-val">${esc(formatMetricValue(val, w.format, w.unit, fmtOpts))}</div>`;
    } else {
      contentHtml = `<div class="tbl-wrap"><table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>` +
        rows.slice(0, 25).map((r) => `<tr>${r.map((c) => `<td>${esc(c === null ? '—' : String(c))}</td>`).join('')}</tr>`).join('') +
        `</tbody></table></div>`;
    }
    const footnoteHtml = w.chartConfig?.footnote ? `<p class="footnote">${esc(w.chartConfig.footnote)}</p>` : '';
    return `<article class="card span-${w.colSpan}">
      <header><div><h3>${esc(w.title)} <small>[${esc(w.kind)}]</small></h3>${w.subtitle ? `<p>${esc(w.subtitle)}</p>` : ''}</div><span class="meta">${esc(w.source)} · ${esc(refreshed)}</span></header>
      ${contentHtml}
      ${footnoteHtml}
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
  h3 small { opacity: 0.55; font-weight: 400; font-size: 11px; }
  header p, .meta, .footnote { margin: 2px 0 0; font-size: 12px; opacity: 0.68; }
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
