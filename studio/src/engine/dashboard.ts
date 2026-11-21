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
  // 2. Temporal (6)
  'line',
  'area',
  'combo',
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
  'editorial',
  'stripe',
  'flourish',
  'economist',
  'okabe_ito',
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

export const CHART_DESIGN_PRESETS = ['editorial', 'stripe', 'flourish', 'minimal'] as const;
export type ChartDesignPreset = (typeof CHART_DESIGN_PRESETS)[number];

export const SECONDARY_SERIES_TYPES = ['line', 'dashed_line', 'area', 'bar'] as const;
export type SecondarySeriesType = (typeof SECONDARY_SERIES_TYPES)[number];

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
  axis: 'x' | 'y' | 'y2';
  value: number | string;
  label?: string;
  color?: string;
  style?: LineStyle;
}

export interface ChartReferenceBand {
  id?: string;
  axis: 'x' | 'y' | 'y2';
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
  // 1. Typography, Visual Design Preset & Card Frame
  designPreset?: ChartDesignPreset;
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

  // 5. Y-Axis (Primary Left)
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

  // 5B. Secondary Y-Axis (Right / Dual-Axis & Combo)
  showY2Axis?: boolean;
  secondaryYFields?: string[];
  secondarySeriesType?: SecondarySeriesType;
  y2AxisTitle?: string;
  y2AxisFormat?: ValueFormat;
  y2AxisScale?: AxisScale;
  y2Min?: number;
  y2Max?: number;
  y2StartFromZero?: boolean;
  y2Unit?: string;
  y2Decimals?: number;

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
  /** A new widget; with copy_of it starts as a copy of that widget and the given fields override it. */
  add_widgets?: (Partial<DashboardWidgetInput> & { after?: string; copy_of?: string })[];
  /** remove_chart_settings: chart_config settings (snake_case) to drop, e.g. ["reference_lines"]. */
  update_widgets?: (Partial<DashboardWidgetInput> & { id: string; remove_chart_settings?: string[] })[];
  remove_widgets?: string[];
  reorder_widgets?: string[];
  /** Moves single widgets without listing the others: after or before another widget, or "start" / "end". */
  move_widgets?: { id: string; after?: string; before?: string }[];
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

/**
 * A trimmed, non-empty string from a model's argument, or undefined. Tool
 * arguments are only as typed as the model makes them: a missing title or a
 * number where a string belongs must not crash the whole dashboard.
 */
const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);

/** One field name or a list of them: `"revenue"` means `["revenue"]`, never its letters. */
const fieldList = (v: unknown): string[] | undefined => {
  const list = typeof v === 'string' ? [v] : Array.isArray(v) ? v : undefined;
  return list?.map((s) => String(s).trim()).filter(Boolean);
};

/** The auto-refresh choices the dashboard offers: manual, 30 s, 1 min, 5 min. */
const REFRESH_CHOICES = [0, 30, 60, 300] as const;

/**
 * The refresh interval as one of the offered choices, or undefined for a value
 * that is not a number. A request for "every second" would re-run every query
 * (and bill every warehouse scan) once a second; it becomes 30 s.
 */
export function normalizeRefreshSeconds(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return undefined;
  if (v === 0) return 0;
  return REFRESH_CHOICES.slice(1).reduce((best, c) => (Math.abs(c - v) < Math.abs(best - v) ? c : best), 30);
}

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

  // 1. Typography, Visual Design Preset & Card Frame
  setEnum('designPreset', CHART_DESIGN_PRESETS);
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

  // 5. Y-Axis (Primary)
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

  // 5B. Secondary Y-Axis (Right / Dual-Axis)
  setBool('showY2Axis');
  if ('secondaryYFields' in src) {
    const sy = src.secondaryYFields;
    if (sy === null || sy === undefined) delete out.secondaryYFields;
    else if (Array.isArray(sy)) {
      const cleaned = sy.map((s) => String(s).trim()).filter(Boolean);
      if (cleaned.length > 0) out.secondaryYFields = cleaned;
      else delete out.secondaryYFields;
    } else if (typeof sy === 'string' && sy.trim()) {
      out.secondaryYFields = [sy.trim()];
    }
  }
  setEnum('secondarySeriesType', SECONDARY_SERIES_TYPES);
  setStr('y2AxisTitle');
  setEnum('y2AxisFormat', VALUE_FORMATS);
  setEnum('y2AxisScale', AXIS_SCALES);
  setFreeNum('y2Min');
  setFreeNum('y2Max');
  setBool('y2StartFromZero');
  setStr('y2Unit');
  setNum('y2Decimals', 0, 6);

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
        .filter((rl: any) => rl && (rl.axis === 'x' || rl.axis === 'y' || rl.axis === 'y2') && rl.value !== undefined)
        .map((rl: any, i: number) => ({
          id: rl.id ? String(rl.id) : `ref_${i + 1}`,
          axis: rl.axis === 'x' ? 'x' : rl.axis === 'y2' ? 'y2' : 'y',
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
        .filter((rb: any) => rb && (rb.axis === 'x' || rb.axis === 'y' || rb.axis === 'y2') && Number.isFinite(Number(rb.from)) && Number.isFinite(Number(rb.to)))
        .map((rb: any, i: number) => ({
          id: rb.id ? String(rb.id) : `band_${i + 1}`,
          axis: rb.axis === 'x' ? 'x' : rb.axis === 'y2' ? 'y2' : 'y',
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
    ...(cfg.secondaryYFields ? { secondaryYFields: [...cfg.secondaryYFields] } : {}),
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
  const title = text(input.title);
  const baseId = slugId(text(input.id) ?? title ?? '', `${kind}_${index + 1}`);
  let id = baseId;
  let n = 2;
  while (usedIds.has(id)) id = `${baseId}_${n++}`;
  usedIds.add(id);

  const color = input.color && input.color !== 'none' && COLORS.includes(input.color) ? input.color : undefined;
  const xField = text(input.xField ?? input.x_field);
  const yFields = fieldList(input.yFields ?? input.y_fields);
  const seriesField = text(input.seriesField ?? input.series_field);
  const comparisonField = text(input.comparisonField ?? input.comparison_field);
  const subtitle = text(input.subtitle);
  const unit = text(input.unit);
  const explanation = text(input.explanation);
  const chartConfig = normalizeChartConfig(input.chartConfig ?? input.chart_config);

  const widget: DashboardWidget = {
    id,
    title: title ?? 'Untitled Metric',
    ...(subtitle ? { subtitle } : {}),
    kind,
    source: text(input.source) ?? (defaultSource || 'local'),
    sql: (typeof input.sql === 'string' ? input.sql : '').trim(),
    ...(xField ? { xField } : {}),
    ...(yFields && yFields.length > 0 ? { yFields } : {}),
    ...(seriesField ? { seriesField } : {}),
    ...(input.format && VALUE_FORMATS.includes(input.format) ? { format: input.format } : {}),
    ...(comparisonField ? { comparisonField } : {}),
    ...(unit ? { unit } : {}),
    colSpan: normalizeColSpan(input.colSpan ?? input.col_span, kind),
    ...(explanation ? { explanation } : {}),
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
  const param = slugId(text(input.param) ?? text(input.id) ?? text(input.label) ?? '', `param_${index + 1}`);
  const baseId = slugId(text(input.id) ?? `filter_${param}`, `filter_${index + 1}`);
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
    label: text(input.label) ?? param,
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
    refreshSeconds: normalizeRefreshSeconds(raw.refreshSeconds) ?? 0,
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
      dashboard: { title: text(req.title) ?? '', defaultSource: 'local', refreshSeconds: 0, filters: [], widgets: [] },
      addedWidgets: [],
      updatedWidgets: [],
      removedWidgets: [],
      errors,
      warnings: [],
      notes: [],
    };
  }

  const defaultSource = text(req.source) ?? 'local';
  const usedW = new Set<string>();
  const usedF = new Set<string>();
  const filters = (Array.isArray(req.filters) ? req.filters : [])
    .filter((f) => f != null && typeof f === 'object')
    .map((f, i) => normalizeFilter(f, usedF, i));
  const widgets = req.widgets.map((w, i) => normalizeWidget(w, defaultSource, usedW, i));

  const dashboard: DashboardSpec = {
    title: text(req.title) ?? 'Live Dashboard',
    ...(text(req.subtitle) ? { subtitle: text(req.subtitle) } : {}),
    defaultSource,
    refreshSeconds: normalizeRefreshSeconds(req.refresh_seconds) ?? 0,
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

const camelToSnake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** A widget as create input (snake_case fields), the base of a copy. */
function widgetToInput(w: DashboardWidget): DashboardWidgetInput {
  const input: DashboardWidgetInput = {
    title: w.title,
    kind: w.kind,
    source: w.source,
    sql: w.sql,
    col_span: w.colSpan,
    ...(w.subtitle ? { subtitle: w.subtitle } : {}),
    ...(w.xField ? { x_field: w.xField } : {}),
    ...(w.yFields ? { y_fields: [...w.yFields] } : {}),
    ...(w.seriesField ? { series_field: w.seriesField } : {}),
    ...(w.format ? { format: w.format } : {}),
    ...(w.comparisonField ? { comparison_field: w.comparisonField } : {}),
    ...(w.unit ? { unit: w.unit } : {}),
    ...(w.explanation ? { explanation: w.explanation } : {}),
    ...(w.color ? { color: w.color } : {}),
    ...(w.chartConfig ? { chart_config: cloneChartConfig(w.chartConfig) as ChartElementConfigInput } : {}),
  };
  for (const [targetKey, , snakeKey] of EXTRA_FIELD_PAIRS) {
    const v = (w as unknown as Record<string, unknown>)[targetKey];
    if (typeof v === 'string') (input as unknown as Record<string, unknown>)[snakeKey] = v;
  }
  return input;
}

/**
 * Settings of a chart_config patch that did not take effect (unknown name or
 * invalid value), so the model hears about them instead of assuming they did.
 */
function ignoredChartSettings(patch: unknown, merged: ChartElementConfig | undefined): string[] {
  if (!patch || typeof patch !== 'object') return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v === null || v === undefined || v === '') continue;
    const key = snakeToCamelKey(k) as keyof ChartElementConfig;
    if (merged?.[key] === undefined) out.push(`${camelToSnake(key)}=${JSON.stringify(v)}`);
  }
  return out;
}

function resolveWidgetRef(ref: unknown, widgets: DashboardWidget[], selection: string[]): Resolution<DashboardWidget> {
  if (typeof ref !== 'string' || ref.trim() === '') {
    return { error: 'A widget reference is missing: give the widget id (or its title).' };
  }
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
  const refresh = normalizeRefreshSeconds(req.refresh_seconds);
  if (refresh !== undefined) next.refreshSeconds = refresh;

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
    if (patch == null || typeof patch !== 'object') continue;
    const r = resolveWidgetRef(patch.id, next.widgets, selection);
    const target = 'widget' in (r.item ?? {}) ? (r.item as any).widget as DashboardWidget : (r.item as DashboardWidget | undefined);
    if (!target) {
      errors.push(r.error ?? `No widget matching "${patch.id}".`);
      continue;
    }
    if (r.note) notes.push(r.note);
    const before = JSON.stringify(target);
    if (patch.kind !== undefined && !WIDGET_KINDS.includes(patch.kind)) {
      warnings.push(`${target.id}: kind "${patch.kind}" does not exist; it stays "${target.kind}".`);
    }
    if (patch.format !== undefined && !VALUE_FORMATS.includes(patch.format)) {
      warnings.push(`${target.id}: format "${patch.format}" does not exist (${VALUE_FORMATS.join(', ')}).`);
    }
    if (text(patch.title)) target.title = text(patch.title)!;
    if (typeof patch.subtitle === 'string') {
      if (patch.subtitle.trim() === '') delete target.subtitle;
      else target.subtitle = patch.subtitle.trim();
    }
    if (patch.kind !== undefined && WIDGET_KINDS.includes(patch.kind)) target.kind = patch.kind;
    if (text(patch.source)) target.source = text(patch.source)!;
    if (text(patch.sql)) target.sql = text(patch.sql)!;
    const xF = patch.xField ?? patch.x_field;
    if (typeof xF === 'string') {
      if (xF.trim() === '') delete target.xField;
      else target.xField = xF.trim();
    }
    const yF = patch.yFields ?? patch.y_fields;
    if (yF !== undefined && yF !== null) {
      const list = fieldList(yF) ?? [];
      target.yFields = list.length > 0 ? list : undefined;
    }
    const sF = patch.seriesField ?? patch.series_field;
    if (typeof sF === 'string') {
      if (sF.trim() === '') delete target.seriesField;
      else target.seriesField = sF.trim();
    }
    for (const [targetKey, camelKey, snakeKey] of EXTRA_FIELD_PAIRS) {
      const val = patch[camelKey] ?? patch[snakeKey];
      if (typeof val === 'string') {
        if (val.trim() === '') delete (target as unknown as Record<string, unknown>)[targetKey];
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
    if (Array.isArray(patch.remove_chart_settings) && patch.remove_chart_settings.length > 0) {
      const drop: Record<string, null> = {};
      for (const k of patch.remove_chart_settings) drop[String(k)] = null;
      const kept = normalizeChartConfig(drop, target.chartConfig);
      if (kept) target.chartConfig = kept;
      else delete target.chartConfig;
    }
    const cfgPatch = patch.chartConfig ?? patch.chart_config;
    if (cfgPatch !== undefined) {
      const merged = normalizeChartConfig(cfgPatch, target.chartConfig);
      if (merged) target.chartConfig = merged;
      else delete target.chartConfig;
      const ignored = ignoredChartSettings(cfgPatch, merged);
      if (ignored.length > 0) {
        warnings.push(`${target.id}: chart_config ${ignored.join(', ')} had no effect (unknown setting or invalid value).`);
      }
    }
    if (JSON.stringify(target) === before) {
      warnings.push(`${target.id}: nothing changed (the values given are the current ones).`);
    }
    if (!updatedWidgets.includes(target.id)) updatedWidgets.push(target.id);
  }

  // Add widgets
  const usedIds = new Set(next.widgets.map((w) => w.id));
  for (const raw of req.add_widgets ?? []) {
    if (raw == null || typeof raw !== 'object') continue;
    let add = raw as DashboardWidgetInput & { after?: string; copy_of?: string };
    if (raw.copy_of) {
      const r = resolveWidgetRef(raw.copy_of, next.widgets, selection);
      if (!r.item) {
        errors.push(r.error ?? `copy_of: no widget matching "${raw.copy_of}".`);
        continue;
      }
      const base = widgetToInput(r.item);
      const own = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined && v !== ''));
      const cfgPatch = raw.chart_config ?? raw.chartConfig;
      add = {
        ...base,
        ...own,
        id: raw.id ?? '',
        title: text(raw.title) ?? `${r.item.title} (copy)`,
        chart_config: (cfgPatch !== undefined ? normalizeChartConfig(cfgPatch, r.item.chartConfig) : base.chart_config) as ChartElementConfigInput,
        chartConfig: undefined,
        after: raw.after ?? r.item.id,
      } as typeof add;
    }
    if (!text(add.sql)) {
      errors.push(`New widget "${add.title || 'unnamed'}" requires a non-empty SQL query (or copy_of an existing widget).`);
      continue;
    }
    if (!text(add.title)) add = { ...add, title: 'Untitled Metric' };
    if (!add.kind) {
      errors.push(`New widget "${add.title}" requires a kind.`);
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

  // Move single widgets relative to others
  for (const mv of req.move_widgets ?? []) {
    if (mv == null || typeof mv !== 'object') continue;
    const r = resolveWidgetRef(mv.id, next.widgets, selection);
    if (!r.item) {
      errors.push(r.error ?? `move_widgets: no widget matching "${mv.id}".`);
      continue;
    }
    const moving = r.item;
    const rest = next.widgets.filter((w) => w.id !== moving.id);
    const anchorRef = mv.after ?? mv.before;
    let at = rest.length;
    if (anchorRef === 'start') at = 0;
    else if (anchorRef && anchorRef !== 'end') {
      const a = resolveWidgetRef(anchorRef, rest, []);
      if (!a.item) {
        errors.push(a.error ?? `move_widgets: no widget matching "${anchorRef}".`);
        continue;
      }
      const idx = rest.findIndex((w) => w.id === a.item!.id);
      at = mv.after !== undefined ? idx + 1 : idx;
    }
    rest.splice(at, 0, moving);
    next.widgets = rest;
    if (!updatedWidgets.includes(moving.id)) updatedWidgets.push(moving.id);
  }

  // Filters: remove, update, add
  for (const fRef of req.remove_filters ?? []) {
    next.filters = next.filters.filter((f) => f.id !== fRef && f.param !== fRef);
  }
  for (const fPatch of req.update_filters ?? []) {
    if (fPatch == null || typeof fPatch !== 'object') continue;
    const f = next.filters.find((x) => x.id === fPatch.id || x.param === fPatch.id);
    if (!f) {
      warnings.push(`No filter "${fPatch.id}" found.`);
      continue;
    }
    if (text(fPatch.label)) f.label = text(fPatch.label)!;
    if (fPatch.value !== undefined && fPatch.value !== null) f.value = String(fPatch.value);
    if (Array.isArray(fPatch.options)) f.options = fPatch.options.map(String);
  }
  const usedFIds = new Set(next.filters.map((f) => f.id));
  for (const fAdd of req.add_filters ?? []) {
    if (fAdd == null || typeof fAdd !== 'object') continue;
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

/**
 * Every chart_config setting of a widget, with the names and shapes the model
 * passes to edit_dashboard, so an edit can keep, change or drop each one
 * (e.g. ` chart_config {"sort_by":"value_desc","reference_lines":[{"axis":"y","value":200000,"label":"Target"}]}`).
 */
function summarizeChartConfig(cfg: ChartElementConfig | undefined): string {
  if (!cfg) return '';
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cfg)) {
    if (v === undefined) continue;
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object') {
      // Generated ids are noise; the model identifies these by their content
      out[camelToSnake(k)] = v.map((item) => Object.fromEntries(Object.entries(item as Record<string, unknown>)
        .filter(([ik]) => ik !== 'id')
        .map(([ik, iv]) => [camelToSnake(ik), iv])));
    } else {
      out[camelToSnake(k)] = v;
    }
  }
  return Object.keys(out).length > 0 ? ` chart_config ${JSON.stringify(out)}` : '';
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
  if (w.unit) parts.push(`unit ${JSON.stringify(w.unit)}`);
  if (w.color) parts.push(`color ${w.color}`);
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
      `  - ${w.id} [${w.kind}, span ${w.colSpan}/12, src=${w.source}]${summarizeFields(w)} ${JSON.stringify(w.title)}` +
      (w.subtitle ? ` · ${JSON.stringify(w.subtitle)}` : '') +
      `${summarizeChartConfig(w.chartConfig)}: ` +
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
    case 'currency_eur':
    case 'currency_gbp': {
      const symbol = format === 'currency_usd' ? '$' : format === 'currency_eur' ? '€' : '£';
      const abs = Math.abs(num);
      const body = decOverride !== undefined
        ? new Intl.NumberFormat('en-US', { minimumFractionDigits: decOverride, maximumFractionDigits: decOverride }).format(abs)
        : abs >= 1_000_000
          ? `${(abs / 1_000_000).toFixed(2)}M`
          : abs >= 10_000
            ? `${(abs / 1_000).toFixed(1)}K`
            : new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(abs);
      // The sign goes before the symbol: −$1.50M, not $-1.50M; nothing that rounds to zero is negative
      const negative = num < 0 && /[1-9]/.test(body);
      out = `${negative ? '-' : ''}${symbol}${body}`;
      break;
    }
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
    const y2Col = cfg?.secondaryYFields?.[0] ?? (w.kind === 'combo' ? (w.yFields?.[1] ?? cols[2]) : undefined);
    if (y2Col && !isArc && y2Col !== yCol) {
      const secondaryMark = cfg?.secondarySeriesType === 'bar' ? 'bar' : cfg?.secondarySeriesType === 'area' ? 'area' : 'line';
      return {
        title: {
          text: w.title,
          subtitle: w.subtitle ?? `SQL: ${w.sql.replace(/\s+/g, ' ')}`,
        },
        data: { values },
        layer: [
          {
            mark: { type: w.kind === 'combo' ? 'bar' : mark, tooltip: cfg?.showTooltip !== false },
            encoding: {
              x: { field: xCol, type: 'nominal', ...(cfg?.xAxisTitle ? { title: cfg.xAxisTitle } : {}) },
              y: {
                field: yCol,
                type: 'quantitative',
                axis: { title: cfg?.yAxisTitle ?? yCol, orient: 'left' },
                ...(cfg?.yAxisScale && cfg.yAxisScale !== 'linear' ? { scale: { type: cfg.yAxisScale } } : {}),
              },
            },
          },
          {
            mark: {
              type: secondaryMark,
              tooltip: cfg?.showTooltip !== false,
              ...(cfg?.secondarySeriesType === 'dashed_line' ? { strokeDash: [6, 4] } : {}),
            },
            encoding: {
              x: { field: xCol, type: 'nominal' },
              y: {
                field: y2Col,
                type: 'quantitative',
                axis: { title: cfg?.y2AxisTitle ?? y2Col, orient: 'right' },
                ...(cfg?.y2AxisScale && cfg.y2AxisScale !== 'linear' ? { scale: { type: cfg.y2AxisScale } } : {}),
              },
            },
          },
        ],
        resolve: { scale: { y: 'independent' } },
        ...(w.chartConfig ? { usermeta: { studioChartKind: w.kind, chartConfig: w.chartConfig } } : {}),
      };
    }
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
    case 'combo':
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
