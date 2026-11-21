/**
 * Function declarations of the voice agent (Gemini API schema). Edits are
 * typed lists of operations on ids, so the model changes only what it names.
 */
import {
  AXIS_SCALES,
  CHART_DESIGN_PRESETS,
  CHART_ORIENTATIONS,
  CHART_PALETTES,
  CURVE_TYPES,
  DATA_LABEL_CONTENTS,
  DATA_LABEL_POSITIONS,
  FILTER_KINDS,
  LEGEND_POSITIONS,
  LINE_STYLES,
  MAP_SCOPES,
  SECONDARY_SERIES_TYPES,
  SORT_MODES,
  STACK_MODES,
  VALUE_FORMATS,
  WIDGET_KINDS,
} from '../engine/dashboard';
import { DECK_CHART_TYPES, DECK_THEMES, SLIDE_LAYOUTS } from '../engine/deck';
import { ARROWS, COLORS, DIAGRAM_TYPES, EDGE_STYLES, GROUP_KINDS, NODE_KINDS, PROVIDERS } from '../engine/types';

type Schema = Record<string, unknown>;

const str = (description: string): Schema => ({ type: 'STRING', description });
const enumOf = (values: readonly string[], description: string): Schema =>
  ({ type: 'STRING', format: 'enum', enum: [...values], description });
const arrayOf = (items: Schema, description: string): Schema => ({ type: 'ARRAY', items, description });
const obj = (properties: Record<string, Schema>, required: string[], description?: string): Schema =>
  ({ type: 'OBJECT', properties, required, ...(description ? { description } : {}) });

const nodeFields = {
  id: str('Short lowercase English snake_case id, e.g. "orders_db". Never changes.'),
  label: str('Short label shown on the canvas, in English.'),
  kind: enumOf(NODE_KINDS, 'What the node is; decides its shape and icon.'),
  tech: str('Technology or product, e.g. "Cloud Run", "PostgreSQL", "Kafka".'),
  provider: enumOf(PROVIDERS, 'Cloud provider of the product.'),
  description: str('Optional one-line description (C4 responsibilities).'),
  group: str('Id of the group (boundary) that contains the node.'),
  color: enumOf(COLORS, 'Only when the user asks for a color.'),
};

const edgeFields = {
  from: str('Id of the source node.'),
  to: str('Id of the target node.'),
  label: str('Protocol or intent, e.g. "HTTPS", "publishes", "Yes".'),
  style: enumOf(EDGE_STYLES, 'dashed for asynchronous messages and events.'),
  arrow: enumOf(ARROWS, 'Arrow heads, forward by default.'),
};

const groupFields = {
  id: str('Short lowercase English snake_case id.'),
  label: str('Label of the group, e.g. "Production VPC".'),
  kind: enumOf(GROUP_KINDS, 'What the group is.'),
  parent: str('Id of the enclosing group.'),
  color: enumOf(COLORS, 'Only when the user asks for a color.'),
};

const num = (description: string): Schema => ({ type: 'NUMBER', description });
const bool = (description: string): Schema => ({ type: 'BOOLEAN', description });

/**
 * The chart settings that change what a viewer understands (ordering, focus,
 * context lines, labels). Purely cosmetic settings stay in the chart panel.
 */
export const chartConfigFields = {
  // Shape the data
  sort_by: enumOf(SORT_MODES, 'Order of the categories: value_desc for rankings; none keeps the SQL order (time series, funnels).'),
  limit_items: { type: 'INTEGER', description: 'Show only the first N categories after sorting (top N).' },
  group_tail_as_other: bool('With limit_items: sum the remaining categories into one "Other" item (pie, donut, bars).'),
  orientation: enumOf(CHART_ORIENTATIONS, 'horizontal for long category labels.'),
  stack_mode: enumOf(STACK_MODES, 'stacked for totals, percent_100 to compare the mix (shares) instead of the volume.'),
  // Context that turns a chart into an insight
  target_value: num('Goal or quota: the target marker of kpi, gauge and bullet.'),
  reference_lines: arrayOf(obj({
    axis: enumOf(['x', 'y', 'y2'], 'y for a horizontal line on the left axis, y2 for the right (secondary) y axis, x for a vertical line at a category or date.'),
    value: str('Value on that axis, e.g. "180000" or "2026-07".'),
    label: str('Short label, e.g. "Target $180K".'),
  }, ['axis', 'value']), 'Target, budget, threshold or event lines.'),
  reference_bands: arrayOf(obj({
    axis: enumOf(['x', 'y', 'y2'], 'Axis of the band (x, y left, or y2 right).'),
    from: num('Start value.'),
    to: num('End value.'),
    label: str('Short label, e.g. "Healthy range".'),
  }, ['axis', 'from', 'to']), 'Shaded ranges, e.g. the healthy range of a metric.'),
  annotations: arrayOf(obj({
    target_label: str('Exact x value (category or period) the note points at, e.g. "2026-07" or "EMEA".'),
    text: str('The note, at most 6 words, e.g. "Pricing change" or "+42% after launch".'),
  }, ['text']), 'Notes on the data points that explain the story (at most 2 per chart). Use numbers from the chartReview facts.'),
  show_trendline: bool('Linear trend line (scatter, bubble, line).'),
  show_average_line: bool('Dashed line at the average.'),
  highlight_max_min: bool('Marks the highest and lowest point.'),
  // Labels and legend
  show_data_labels: bool('Values on the marks: for charts with at most 12 marks.'),
  data_label_content: enumOf(DATA_LABEL_CONTENTS, 'What the label shows; percent or label_percent for shares.'),
  direct_line_labels: bool('Labels at the line ends instead of a legend (2–4 series).'),
  show_legend: bool('Show or hide the legend.'),
  legend_position: enumOf(LEGEND_POSITIONS, 'Where the legend sits.'),
  donut_center_label: str('Big text in the middle of a donut, e.g. the total "$674K".'),
  donut_center_subtext: str('Small text under it, e.g. "Total MRR".'),
  footnote: str('One line under the chart: scope, caveat or data source.'),
  // Axes
  x_axis_title: str('Title of the x axis, when the column name is not clear.'),
  y_axis_title: str('Title of the left y axis, with the unit.'),
  y_axis_format: enumOf(VALUE_FORMATS, 'Format of the left y axis ticks when it differs from the widget format.'),
  y_axis_scale: enumOf(AXIS_SCALES, 'log when values span several orders of magnitude.'),
  start_from_zero: bool('Bars always start at zero. For lines, false zooms in on the variation.'),
  y_min: num('Lower bound of the left y axis.'),
  y_max: num('Upper bound of the left y axis, e.g. 100 for percentages.'),
  // Second Y-Axis (Dual-Axis & Combo)
  show_y2_axis: bool('Show an independent right-hand (second) Y-axis.'),
  secondary_y_fields: arrayOf(str('Series or column name.'), 'Metric columns or series plotted against the right-hand Y2 axis (e.g. ["ndr_pct"] on a combo or dual-axis chart).'),
  secondary_series_type: enumOf(SECONDARY_SERIES_TYPES, 'Visual geometry for secondary-axis series: line, dashed_line, area, or bar.'),
  y2_axis_title: str('Title of the right-hand (second) Y-axis, including unit (color-matched to the secondary series).'),
  y2_axis_format: enumOf(VALUE_FORMATS, 'Display format of the right-hand Y2 axis ticks and values (e.g. "percent" while left axis is "currency_usd").'),
  y2_axis_scale: enumOf(AXIS_SCALES, 'Scale of the right-hand Y2 axis: linear, log, or sqrt.'),
  y2_min: num('Lower bound of the right-hand Y2 axis.'),
  y2_max: num('Upper bound of the right-hand Y2 axis.'),
  y2_start_from_zero: bool('Whether the right-hand Y2 axis starts at zero (false often works better for rates/indices like 95%–125%).'),
  y2_unit: str('Optional unit suffix for secondary-axis values (e.g. "ms", "pts").'),
  y2_decimals: { type: 'INTEGER', description: 'Decimal places for secondary-axis values (0–6).' },
  // Visual Design Preset & Color
  design_preset: enumOf(CHART_DESIGN_PRESETS, 'Visual design system preset: editorial (FT/Economist), stripe (Stripe/Linear), flourish (Flourish storytelling), or minimal (Tufte).'),
  palette: enumOf(CHART_PALETTES, 'Color palette; editorial/stripe/flourish/economist/okabe_ito for high-craft categoricals, diverging around a midpoint, viridis/ocean for sequential intensity.'),
  color_by: enumOf(['series', 'category', 'value'], 'value shades by magnitude; category gives each bar its own color (only when the categories are the story).'),
  // Per kind
  curve_type: enumOf(CURVE_TYPES, 'monotone for smooth trends, step for values that change at discrete moments.'),
  show_markers: bool('Dots on the points of a line (at most ~24 points).'),
  bin_count: { type: 'INTEGER', description: 'Number of bins of a histogram (3–50).' },
  trellis_columns: { type: 'INTEGER', description: 'Panels per row of a trellis (1–6).' },
  trellis_sub_kind: enumOf(['line', 'area', 'bar', 'column'], 'Chart drawn in every trellis panel.'),
  map_scope: enumOf(MAP_SCOPES, 'Region shown by the maps.'),
  decimals: { type: 'INTEGER', description: 'Decimal places of the values (0–6).' },
  cross_filter_on_click: bool('Clicking a mark sets the dashboard filter of that dimension.'),
  // Visual design: change only when the user asks ("thicker line", "no gridlines", "taller", "brand colors")
  custom_colors: arrayOf(str('CSS color, e.g. "#1a73e8".'), 'Explicit series or slice colors in order; only when the user names colors or a brand.'),
  fill_opacity: num('Opacity of areas, bars and bubbles (0.05–1); about 0.65 for overlapping marks.'),
  gradient_fill: bool('Soft gradient under a line or area.'),
  stroke_width: num('Line thickness in px (0.5–10, default 2.5).'),
  line_style: enumOf(LINE_STYLES, 'Line dash: dashed or dotted for forecasts, targets or secondary series.'),
  marker_size: num('Size of the line markers (1–18).'),
  bar_radius: num('Corner radius of bars in px (0–24).'),
  inner_radius_ratio: num('Hole of a donut as a share of the radius (0–0.9, default 0.58).'),
  chart_height: num('Height of the plot in px (120–680, default 216).'),
  show_horizontal_grid: bool('Horizontal gridlines (keep them light; hide for sparse charts).'),
  show_vertical_grid: bool('Vertical gridlines (rarely useful).'),
  show_x_axis: bool('Show the x axis.'),
  show_y_axis: bool('Show the y axis (hide it when every mark has a data label).'),
  x_tick_rotation: { type: 'INTEGER', description: 'Rotation of the x labels: 0, -30, -45 or -90 (prefer horizontal_bar to rotated labels).' },
  y_axis_position: enumOf(['left', 'right'], 'Side of the y axis.'),
  data_label_position: enumOf(DATA_LABEL_POSITIONS, 'Where the data labels sit.'),
  prefix: str('Text before every value, e.g. "€".'),
  suffix: str('Text after every value, e.g. " seats".'),
  legend_show_values: bool('Values next to the legend entries.'),
  show_outliers: bool('box_plot: draw the outlier points.'),
  show_mean: bool('box_plot, violin: mark the mean.'),
};

const dashboardWidgetFields = {
  id: str('Short lowercase snake_case id, e.g. "mrr_trend" or "arr_by_region".'),
  title: str('Title that says what the chart shows or, better, what it reveals: "MRR by Region", "EMEA Drives 31% of MRR". Never "Chart" or the chart kind.'),
  subtitle: str('Scope of the numbers: period, unit, filter, e.g. "Nov 2025 – Oct 2026 · USD".'),
  kind: enumOf(WIDGET_KINDS,
    'Chart kind, chosen by the question the widget answers: one number → kpi; trend over time → line or area; ' +
    'ranking of categories → horizontal_bar (bar or column for at most 8 short labels); share of a whole → donut ' +
    '(at most 6 slices), treemap or stacked_bar with percent_100; composition over time → stacked_bar or area with ' +
    'series_field; relationship of two metrics → scatter or bubble; spread → histogram or box_plot; two dimensions ' +
    '→ heatmap; stages → funnel; contributions to a change → waterfall; actual vs target → bullet or gauge; ' +
    'geography → choropleth_map or bubble_map; flows → sankey; exact detail rows → table.'),
  source: str('Data source id ("local" by default, or "bigquery", "clickhouse", "postgres", "rest:<name>").'),
  sql: str('Exact read-only SQL SELECT/WITH query that returns the columns this chart kind expects, aggregated and ' +
    'ordered for the chart (time ascending for trends, metric descending for rankings), with clear column aliases. ' +
    'May reference dashboard filter params as :param_name (e.g. WHERE (:region = \'ALL\' OR region = :region)).'),
  x_field: str('Result column of the dimension (x axis, category, slice label). The first column when omitted.'),
  y_fields: arrayOf(str('Result column name.'), 'Result columns of the metrics. All numeric columns when omitted; always set it when the query returns numeric columns that must not be drawn.'),
  series_field: str('Result column that splits the rows into series (one line, bar segment, heatmap row or trellis panel per value). Required when the query returns one row per x and series.'),
  size_field: str('Result column of the bubble or node size (bubble, bubble_map, marimekko, circle_packing).'),
  parent_field: str('Result column of the parent of each row (org_chart, sunburst, treemap, circle_packing).'),
  open_field: str('candlestick: open column.'),
  high_field: str('candlestick: high column.'),
  low_field: str('candlestick: low column.'),
  close_field: str('candlestick: close column.'),
  start_field: str('gantt: start column.'),
  end_field: str('gantt: end column.'),
  progress_field: str('gantt: progress % column.'),
  lat_field: str('Maps: latitude column (origin latitude for flow_map and connection_map).'),
  lon_field: str('Maps: longitude column (origin longitude for flow_map and connection_map).'),
  dest_lat_field: str('flow_map, connection_map: destination latitude column.'),
  dest_lon_field: str('flow_map, connection_map: destination longitude column.'),
  format: enumOf(VALUE_FORMATS, 'Display format of the values: currency_usd for money, percent for values already in percent (42.5 → 42.5%), compact for large counts, ms, bytes.'),
  comparison_field: str('kpi: result column with the change vs the previous period or target, in percent (e.g. mom_pct), shown as ▲/▼ under the number.'),
  unit: str('Optional unit suffix, e.g. "seats" or "ms".'),
  col_span: { type: 'INTEGER', description: 'Width in the 12-column grid; the widgets of a row must sum to 12: 3 or 4 for kpi, 6 or 8 for charts (8 for the main trend next to a 4), 12 for tables, trellis and wide time series.' },
  explanation: str('One-sentence plain-English explanation of how this SQL computes the metric (shown in the SQL Lineage Inspector).'),
  color: enumOf(COLORS, 'Optional accent color.'),
  chart_config: obj(chartConfigFields, [], 'Settings that make the chart readable and its message obvious: ordering and top N, target and reference lines, annotations, data labels, axis. Only the fields given change.'),
};

const dashboardFilterFields = {
  id: str('Short snake_case filter id, e.g. "filter_region".'),
  label: str('Human label shown in the filter bar, e.g. "Region".'),
  param: str('SQL parameter name without colon, e.g. "region" (bound as :region in widget SQL).'),
  kind: enumOf(FILTER_KINDS, 'select or text.'),
  options: arrayOf(str('Option value, e.g. "ALL", "North America", "EMEA".'), 'Dropdown options for select filters.'),
  value: str('Initial selected value, e.g. "ALL".'),
};

const deckSlideFields = {
  id: str('Short snake_case slide id, e.g. "revenue_trend". Never changes.'),
  layout: enumOf(SLIDE_LAYOUTS, 'title (opening), section (divider), kpis (2–4 headline figures), chart (one chart + up to 3 takeaways), ' +
    'points (2–4 cards: findings, options, recommendations), flow (2–6 process or architecture steps), table (≤ 8 rows × 6 columns), ' +
    'statement (one big message or the ask), closing (takeaways + next steps).'),
  title: str('The message of the slide as a short full sentence ("EMEA grew 24% and now leads new bookings"), not a topic label; no final period. On title/section slides: the name.'),
  subtitle: str('Optional supporting line under the title.'),
  kicker: str('Optional 1–3 word label above the title, e.g. "Revenue", "Executive summary".'),
  notes: str('Speaker notes: what to say on this slide (2–4 sentences).'),
  source: str('Footer source line, e.g. "Source: monthly_revenue, SQL".'),
  metrics: arrayOf(obj({
    label: str('What the figure is, e.g. "June MRR".'),
    value: str('The formatted figure, e.g. "$266.5K", "116.7%". Copy real numbers from query results; never invent.'),
    delta: str('Optional change, e.g. "+34.6% vs H2 2025".'),
    trend: enumOf(['up', 'down', 'flat'], 'Direction of the change.'),
    note: str('Optional short context line.'),
    widget_id: str('Optional KPI widget id of the dashboard the figure comes from (kept fresh by sync).'),
    sql: str('Optional read-only SQL whose first row gives the figure (first numeric column; a second numeric column is the % change). Replaces value; re-run by sync.'),
    data_source: str('Data source of sql: "local" (default: the page\'s), "bigquery", "clickhouse", "postgres" or "rest:<name>".'),
    format: enumOf(VALUE_FORMATS, 'How the sql figure is formatted, e.g. currency_usd, percent.'),
  }, ['label']), 'kpis slides: 2–4 figures.'),
  chart: obj({
    type: enumOf(DECK_CHART_TYPES, 'column (categories), bar (rankings, long labels), stacked_column, line or area (time), donut (shares of a whole, ≤ 6 slices).'),
    categories: arrayOf(str('Category or period label.'), 'X-axis categories (≤ 12; ≤ 24 for line/area).'),
    series: arrayOf(obj({
      name: str('Series name.'),
      values: arrayOf(num('Value.'), 'One value per category.'),
    }, ['name', 'values']), 'Up to 4 series (1 for donut).'),
    format: enumOf(VALUE_FORMATS, 'How values are shown, e.g. currency_usd, percent.'),
    highlight_index: { type: 'INTEGER', description: '0-based category to draw in the accent color (the one the title talks about).' },
  }, [], 'chart slides: typed data (categories + series), only when no sql or widget_id gives it. On a slide with sql, send chart: { type } (or format, highlight_index) alone.'),
  widget_id: str('chart or table slides: a dashboard widget id; the slide takes that widget\'s live SQL result.'),
  sql: str('chart or table slides: the slide\'s own read-only SQL; its result fills the chart (label column, then numeric columns; ' +
    'or label, series, value) or the table (≤ 6 columns, ≤ 8 rows), and sync re-runs it. Use instead of chart data or widget_id. "" removes it.'),
  data_source: str('Data source of sql: "local" (default: the page\'s), "bigquery", "clickhouse", "postgres" or "rest:<name>".'),
  points: arrayOf(obj({
    title: str('Short heading (2–6 words), or the step name on flow slides.'),
    text: str('One sentence.'),
  }, ['title']), 'points slides: 2–4 cards; flow slides: 2–6 steps in order; closing slides: next steps.'),
  columns: arrayOf(str('Column header.'), 'table slides with typed text (plans, owners, comparisons): 2–6 headers. Data from tables: use sql instead.'),
  rows: arrayOf(arrayOf(str('Cell text.'), 'One row.'), 'table slides with typed text: up to 8 rows. Never copy rows from query or schema samples: give sql and the table fills from it.'),
  takeaways: arrayOf(str('One short sentence.'), 'chart slides: 1–3 takeaways beside the chart; kpis slides: up to 2; closing: 2–4.'),
};

export const TOOL_DECLARATIONS = [
  {
    name: 'list_data_sources',
    description: 'Lists all connected data sources: built-in & uploaded SQLite-Wasm local tables (SaaS revenue, e-commerce funnel, cloud FinOps, sales CRM, plus any user CSV/JSON/Parquet uploads) and server connectors (BigQuery, ClickHouse, Postgres, REST).',
    behavior: 'NON_BLOCKING',
  },
  {
    name: 'inspect_schema',
    description: 'Inspects table names, column types, and sample rows of a data source so you can write accurate, schema-grounded SQL queries. ' +
      'For local tables every column also comes with "values" (all its distinct values, when there are few: use them as SQL literals, filter options and series) or "range" (smallest and largest value: the first and latest period, the scale of a metric). ' +
      'A large source answers with a list of its tables only: call again with "table" or "search" to get the columns of the ones you need.',
    behavior: 'NON_BLOCKING',
    parameters: obj({
      source: str('Data source id ("local" by default, or "bigquery", "bigquery:<project_id>", "clickhouse", "postgres", "rest:<name>").'),
      table: str('Optional dataset or table name filter.'),
      search: str('Optional words to find tables by name, description or column name (e.g. "orders revenue").'),
    }, []),
  },
  {
    name: 'sync_bigquery',
    description: 'Connects and syncs datasets, tables, and column schemas from Google Cloud BigQuery into the studio catalog (and optionally loads a table into local SQLite-Wasm).',
    behavior: 'NON_BLOCKING',
    parameters: obj({
      project_id: str('Optional GCP project ID to register and sync. When omitted, syncs all active BigQuery sources.'),
      dataset_filter: str('Optional dataset prefix filter, e.g. "mart_".'),
      load_table_to_local: str('Optional "dataset.table" in project_id to materialize into local SQLite-Wasm (up to 1000 rows).'),
    }, []),
  },
  {
    name: 'run_query',
    description: 'Executes a read-only SELECT/WITH SQL query against a data source and returns columns and rows. Use to verify SQL, to answer analytical questions with exact numbers, ' +
      'and to explore before charting: the distinct values of a dimension (for filters and series), the date range, the latest period.',
    behavior: 'NON_BLOCKING',
    parameters: obj({
      source: str('Data source id ("local" by default).'),
      sql: str('Read-only SQL SELECT or WITH query.'),
    }, ['sql']),
  },
  {
    name: 'create_dashboard',
    description: 'Creates an interactive live SQL dashboard on the active page (or a new page with new_page: true) and switches to the Dashboard view — only when the user asks for a dashboard; a question to explore ("show me…", "why…", "how does … develop") goes to the Board with edit_dashboard target "board". Every widget is backed by an auditable SQL query. ' +
      'The result contains "chartReview": for every widget the rows and columns its query returned, "issues" (the chart is empty, broken or misleading: fix them with edit_dashboard), ' +
      '"advice" (improvements with the exact patch) and "facts" (the numbers the chart shows, for the spoken insight, titles and annotations), plus "layout" notes.',
    behavior: 'NON_BLOCKING',
    parameters: obj({
      title: str('Dashboard title, e.g. "Executive SaaS Revenue & Retention".'),
      subtitle: str('Optional subtitle describing scope or data source.'),
      source: str('Default data source id ("local" by default).'),
      refresh_seconds: { type: 'INTEGER', description: 'Optional auto-refresh interval in seconds (0 for manual, 30, 60, or 300).' },
      filters: arrayOf(obj(dashboardFilterFields, ['label', 'param']), 'Interactive filter controls bound as :param in widget SQL.'),
      widgets: arrayOf(obj(dashboardWidgetFields, ['title', 'kind', 'sql']), 'KPI cards, charts, and sortable tables.'),
      new_page: { type: 'BOOLEAN', description: 'True to open on a new workspace tab and keep the current page.' },
      replace: { type: 'BOOLEAN', description: 'True to replace an existing dashboard on this page.' },
    }, ['title', 'widgets']),
  },
  {
    name: 'edit_dashboard',
    description: 'Incrementally edits the live dashboard on the active page — or, with target "board", the page\'s Board (work in progress while exploring; made by the first edit that adds to it): add, copy, update, remove, move or reorder widgets and filters without disturbing untouched widgets. ' +
      'Everything not named stays exactly as it is. The result contains "chartReview" (issues, advice and facts) for the widgets it added or changed, ' +
      'and "warnings" for anything that had no effect.',
    behavior: 'NON_BLOCKING',
    parameters: obj({
      summary: str('Short summary of what changed (at most 8 words).'),
      target: enumOf(['dashboard', 'board'], 'Where the edit goes: "dashboard" (default) or "board" (exploring: questions and findings).'),
      title: str('Optional new dashboard title.'),
      subtitle: str('Optional new subtitle, or "" to clear.'),
      refresh_seconds: { type: 'INTEGER', description: 'Auto-refresh interval in seconds (0, 30, 60, 300).' },
      add_widgets: arrayOf(obj({
        ...dashboardWidgetFields,
        after: str('Optional widget id to insert after, or "start".'),
        copy_of: str('Id of an existing widget (or "@selected") to start from: its SQL, fields and settings are copied, the fields given here override them, and it is placed right after it. ' +
          'Use it for "the same chart as …", "duplicate this as a …", "the same for EMEA"; kind and sql are then optional.'),
      }, ['title']), 'New widgets to add (kind and sql are required unless copy_of is set).'),
      update_widgets: arrayOf(obj({
        ...dashboardWidgetFields,
        id: str('Widget id or "@selected".'),
        color: enumOf([...COLORS, 'none'], 'Color or "none".'),
        remove_chart_settings: arrayOf(str('chart_config setting name, e.g. "reference_lines".'),
          'chart_config settings to drop and return to their default, e.g. ["reference_lines"] for "remove the target line", ["annotations"], ["custom_colors"].'),
        reset_chart_config: bool('True to drop every chart_config setting of the widget before applying chart_config.'),
      }, ['id']), 'Updates to existing widgets: only the given fields change (chart_config is merged field by field; a list such as reference_lines or annotations is replaced as a whole, so repeat the items to keep).'),
      remove_widgets: arrayOf(str('Widget id or "@selected".'), 'Widgets to remove.'),
      move_widgets: arrayOf(obj({
        id: str('Widget id or "@selected".'),
        after: str('Widget id it goes after, or "start" / "end".'),
        before: str('Widget id it goes before.'),
      }, ['id']), 'Moves single widgets ("put the table at the bottom", "move this next to the trend") without listing the others.'),
      reorder_widgets: arrayOf(str('Widget id.'), 'New order: the listed widgets first, in this order, then the rest.'),
      add_filters: arrayOf(obj(dashboardFilterFields, ['label', 'param']), 'Filters to add.'),
      update_filters: arrayOf(obj({
        id: str('Filter id or param name.'),
        label: str('New label.'),
        value: str('New active filter value.'),
        options: arrayOf(str('Option.'), 'Updated options.'),
      }, ['id']), 'Filter updates (e.g. switching region filter to "EMEA").'),
      remove_filters: arrayOf(str('Filter id or param.'), 'Filters to remove.'),
    }, ['summary']),
  },
  {
    name: 'refresh_dashboard',
    description: 'Re-runs all SQL queries on the active dashboard (or, with target "board", on the Board) and returns "chartReview": the facts every chart shows right now (leaders, shares, trends, drop-offs) and any issues. ' +
      'Use it to answer "what does this dashboard tell us?", "what are the insights?" or "summarize this".',
    behavior: 'NON_BLOCKING',
    parameters: obj({
      target: enumOf(['dashboard', 'board'], '"dashboard" (default) or "board".'),
    }, []),
  },
  {
    name: 'promote_to_dashboard',
    description: 'Copies charts from the page\'s Board to its dashboard (made when there is none): "pin that", "keep this one", "move these to the dashboard". ' +
      'A copy keeps its SQL, settings and the filters its query uses; the Board chart stays and is marked as promoted. ' +
      'The result contains "chartReview" for the copies and "layout" notes for the dashboard.',
    behavior: 'NON_BLOCKING',
    parameters: obj({
      widgets: arrayOf(str('Board chart id or title, or "@selected".'), 'The Board charts to copy, in the order they go on the dashboard.'),
      summary: str('Short summary (at most 8 words).'),
    }, ['widgets']),
  },
  {
    name: 'inspect_widget',
    description: 'Opens the transparent SQL Lineage Inspector drawer for a specific dashboard widget and returns its exact SQL and current rows.',
    behavior: 'NON_BLOCKING',
    parameters: obj({
      widget_id: str('Id or title of the widget to inspect, or "@selected".'),
    }, ['widget_id']),
  },
  {
    name: 'create_deck',
    description: 'Creates the slide deck (presentation) of the active page and opens the Deck tab. With from_current_page: true and no slides, ' +
      'builds a professional deck from the page: title, executive summary, headline metrics, one slide per dashboard chart whose title states ' +
      'what the chart shows, tables, the architecture flow, documentation highlights and a closing slide — all numbers from live SQL. ' +
      'Or pass slides to write a deck yourself (pitch, plan, update). The deck exports to PowerPoint and Google Slides.',
    behavior: 'NON_BLOCKING',
    parameters: obj({
      title: str('Deck title, e.g. "Q3 Revenue Review".'),
      subtitle: str('Optional subtitle on the title slide.'),
      theme: enumOf(DECK_THEMES, 'Visual theme; pick one that suits the topic (midnight is the default).'),
      author: str('Presenter or team shown on the title slide.'),
      from_current_page: { type: 'BOOLEAN', description: 'True (without slides) to build the deck from the page\'s dashboard, diagram and documentation.' },
      slides: arrayOf(obj(deckSlideFields, ['layout', 'title']), 'The slides in order: usually title, then content, then closing.'),
      new_page: { type: 'BOOLEAN', description: 'True to put the deck on a new page (tab).' },
      replace: { type: 'BOOLEAN', description: 'True to replace the deck this page already has.' },
    }, []),
  },
  {
    name: 'edit_deck',
    description: 'Edits the deck of the active page: change the words, numbers, layout, chart or notes of named slides, add, remove or reorder slides, ' +
      'or change the theme or title. Charts, tables and figures can take live data from their own sql (run now, re-run by sync). Only the fields given change.',
    behavior: 'NON_BLOCKING',
    parameters: obj({
      summary: str('Short summary of the change (at most 8 words).'),
      title: str('New deck title.'),
      subtitle: str('New deck subtitle.'),
      theme: enumOf(DECK_THEMES, 'New theme.'),
      author: str('New presenter or team.'),
      add_slides: arrayOf(obj({
        ...deckSlideFields,
        after: str('Slide id or number to insert after, or "start". By default before the closing slide.'),
      }, ['layout', 'title']), 'Slides to add.'),
      update_slides: arrayOf(obj({
        ...deckSlideFields,
        id: str('Slide id, number ("3", "slide 3", "last") or title.'),
      }, ['id']), 'Changes to existing slides; lists given replace the old ones.'),
      remove_slides: arrayOf(str('Slide id or number.'), 'Slides to remove.'),
      reorder_slides: arrayOf(str('Slide id or number.'), 'The new order (slides not named keep their order after these).'),
    }, ['summary']),
  },
  {
    name: 'control_deck',
    description: 'Presents the deck full screen and moves through it ("next slide", "go to slide 4", "stop presenting"), refreshes its numbers ' +
      'from the dashboard (sync_data), or exports it: export_pptx downloads an editable PowerPoint file; export_google_slides offers the user ' +
      'a button to save it to their Google Drive as Google Slides.',
    behavior: 'NON_BLOCKING',
    parameters: obj({
      action: enumOf(['present', 'next', 'previous', 'go_to', 'exit', 'sync_data', 'export_pptx', 'export_google_slides'], 'What to do.'),
      slide: str('present / go_to: slide number or id (present starts at 1 by default).'),
    }, ['action']),
  },
  {
    name: 'create_diagram',
    description: 'Draws a complete new diagram, laid out automatically. Only when the current page is empty, or the ' +
      'user asks for a new, separate diagram (new_page: true opens it on a new page and keeps the current one), or ' +
      'explicitly asks to replace this one / start over (replace: true). Every other change is edit_diagram. ' +
      'Pass all the nodes and all the edges in this one call: the layout is computed from the connections. ' +
      'Returns the diagram state.',
    behavior: 'NON_BLOCKING',
    parameters: obj({
      diagram_type: enumOf(DIAGRAM_TYPES, 'Kind of diagram.'),
      direction: enumOf(['LR', 'TB'], 'LR (left to right) for architectures, TB (top to bottom) for flowcharts.'),
      title: str('Title shown above the diagram and on its page tab, e.g. "Checkout on Google Cloud".'),
      subtitle: str('Optional line under the title, e.g. scope, environment or version.'),
      groups: arrayOf(obj(groupFields, ['id', 'label']), 'Boundaries, e.g. cloud, region, VPC, cluster.'),
      nodes: arrayOf(obj(nodeFields, ['id', 'label', 'kind']), 'All nodes.'),
      edges: arrayOf(obj(edgeFields, ['from', 'to']), 'All connections, in this same call (not in a later edit).'),
      new_page: { type: 'BOOLEAN', description: 'True to draw it on a new page (tab) and keep the current diagram. Use for every new, separate or additional diagram when the current page is not empty.' },
      replace: { type: 'BOOLEAN', description: 'True to replace the diagram on the current page (only when the user explicitly asks to replace it or start over).' },
    }, ['diagram_type', 'nodes', 'edges']),
  },
  {
    name: 'edit_diagram',
    description: 'Changes the diagram on the canvas with the smallest set of operations; everything not named stays ' +
      'exactly as it is, positions included. All operations of one request in one call. Returns the new state, or ' +
      'errors without changing anything.',
    behavior: 'NON_BLOCKING',
    parameters: obj({
      base_version: { type: 'INTEGER', description: 'Version of the state this edit is based on.' },
      summary: str('What changed, at most 8 words, in English (shown in the history).'),
      add_nodes: arrayOf(obj({
        ...nodeFields,
        near: str('Only if the user says where: id of the node to put it next to.'),
        side: enumOf(['right', 'left', 'above', 'below'], 'Only if the user says where: side of near.'),
      }, ['id', 'label', 'kind']), 'New nodes.'),
      update_nodes: arrayOf(obj({
        id: str('Id of the node, or "@selected" for the selected nodes.'),
        label: nodeFields.label,
        kind: nodeFields.kind,
        tech: nodeFields.tech,
        provider: nodeFields.provider,
        description: nodeFields.description,
        group: str('Id of the group to move it into, or "none" to take it out of its group.'),
        color: enumOf([...COLORS, 'none'], 'Color, or none for the default.'),
      }, ['id']), 'Changes to existing nodes: only the given fields change.'),
      remove_nodes: arrayOf(str('Node id or "@selected".'), 'Nodes to remove, with their connections.'),
      add_edges: arrayOf(obj(edgeFields, ['from', 'to']), 'New connections.'),
      update_edges: arrayOf(obj({
        from: edgeFields.from,
        to: edgeFields.to,
        label: str('New label, or "" to remove it.'),
        style: edgeFields.style,
        arrow: edgeFields.arrow,
        new_from: str('Reconnect: id of the new source node.'),
        new_to: str('Reconnect: id of the new target node.'),
        reverse: { type: 'BOOLEAN', description: 'Swap the direction.' },
      }, ['from', 'to']), 'Changes to existing connections, found by their two nodes.'),
      remove_edges: arrayOf(obj({
        from: edgeFields.from,
        to: edgeFields.to,
        label: str('Only to pick one of several connections between the same nodes.'),
      }, ['from', 'to']), 'Connections to remove.'),
      add_groups: arrayOf(obj({
        ...groupFields,
        members: arrayOf(str('Node id or "@selected".'), 'Existing nodes to move into the group.'),
      }, ['id', 'label']), 'New groups.'),
      update_groups: arrayOf(obj({
        id: str('Id of the group.'),
        label: groupFields.label,
        kind: groupFields.kind,
        parent: str('Id of the new enclosing group, or "none".'),
        color: enumOf([...COLORS, 'none'], 'Color, or none for the default.'),
        add_members: arrayOf(str('Node id or "@selected".'), 'Nodes to move into the group.'),
        remove_members: arrayOf(str('Node id.'), 'Nodes to take out of the group.'),
      }, ['id']), 'Changes to existing groups.'),
      remove_groups: arrayOf(str('Group id.'), 'Groups to remove; their nodes stay.'),
      remove_blocks: arrayOf(str('Id of a documentation chapter (text or table), or "@selected" for the open chapter.'),
        'Chapters of the documentation to remove.'),
      title: str('New title of the diagram (also renames its page).'),
      subtitle: str('New line under the title, or "" to remove it.'),
      confirm_large_removal: {
        type: 'BOOLEAN',
        description: 'Only when the user explicitly asked to remove more than a third of the diagram.',
      },
    }, ['summary']),
  },
  {
    name: 'write_text',
    description: 'Writes one chapter of the documentation of the current page. The documentation is not drawn on the ' +
      'canvas: it is a reference guide in its own tab, with a table of contents (chapters, and the "## " / "### " ' +
      'headings of each chapter as its sections), and it opens at this chapter. Supports embedding the full ' +
      'architecture diagram inline (`{{diagram | Caption}}`), subsystem-focused architecture diagrams ' +
      '(`{{diagram: node_id1, node_id2 | Caption}}`), language-tagged fenced code blocks (```typescript, ```python, ' +
      '```sql, ```hcl, ```yaml, ```bash), typed production callouts (`> [!WARNING] ...`, `> [!IMPORTANT] ...`, ' +
      '`> [!NOTE] ...`, `> [!TIP] ...`), and inline Markdown comparison tables. Use it for full low-level design ' +
      'architecture and concrete implementation guidelines, overview/topology, runtime flows, ADRs, runbooks, and ' +
      'rollout roadmaps. With the id of an existing chapter it rewrites that chapter (append: true adds to its end). Returns the state.',
    behavior: 'NON_BLOCKING',
    parameters: obj({
      id: str('Short snake_case id of a new chapter (e.g. "overview", "runtime", "lld_data_isolation", "decisions", "rollout"), or the id of an existing chapter to rewrite.'),
      title: str('Title of the chapter in the table of contents, e.g. "Architecture Overview & System Topology", "AlloyDB Isolation & Vector Search", "Implementation Roadmap & Verification".'),
      text: str('Rich Markdown body of the chapter, without repeating the chapter title: `{{diagram | Caption}}` to embed the full architecture or `{{diagram: id1, id2 | Caption}}` to highlight a subsystem in context; "## " / "### " section headings; "- " bullets and "1. " steps; `> [!WARNING] ...` / `> [!IMPORTANT] ...` callout boxes; "| a | b |" comparison tables; and language-tagged fenced code blocks (```python, ```typescript, ```sql, ```yaml, ```hcl, ```bash) with production-ready implementation guidelines. Uses exact canvas labels; inferred targets/limits are marked "(_Assumption_)". In English.'),
      append: { type: 'BOOLEAN', description: 'Add the text to the end of the existing chapter instead of replacing it.' },
      after: str('Only to set the reading order: id of the chapter this one follows, or "start". New chapters go at the end.'),
      summary: str('What changed, at most 8 words (shown in the history).'),
    }, ['text']),
  },
  {
    name: 'write_table',
    description: 'Writes a table as a chapter of the documentation (its own tab, a book with a table of contents), ' +
      'e.g. the context and scope, the building blocks (components, technologies, responsibilities), risks and ' +
      'technical debt, a glossary, SLOs, ports and protocols, costs, a comparison. The first column holds the ' +
      'exact labels of the diagram. With the id of an existing table it replaces its columns and rows ' +
      '(append: true adds the rows). Returns the state.',
    behavior: 'NON_BLOCKING',
    parameters: obj({
      id: str('Short snake_case id of a new table (e.g. "building_blocks", "risks"), or the id of an existing table to rewrite.'),
      title: str('Title of the chapter, e.g. "Building blocks", "Risks and technical debt".'),
      columns: arrayOf(str('Column header.'), 'Column headers, 2 to 6 short ones.'),
      rows: arrayOf(arrayOf(str('Cell text.'), 'One row: one cell per column.'), 'Rows of the table.'),
      append: { type: 'BOOLEAN', description: 'Add the rows to the existing table instead of replacing them.' },
      after: str('Only to set the reading order: id of the chapter this one follows, or "start". New chapters go at the end.'),
      summary: str('What changed, at most 8 words (shown in the history).'),
    }, ['columns', 'rows']),
  },
  {
    name: 'new_page',
    description: 'Opens a new empty page (tab) after the current one and switches to it. To draw a new diagram on ' +
      'a new page in one step, use create_diagram with new_page: true instead.',
    behavior: 'NON_BLOCKING',
    parameters: obj({ title: str('Name of the page (the title of its diagram).') }, []),
  },
  {
    name: 'switch_page',
    description: 'Shows a page (tab) and/or switches its active view: live dashboard, Board (work in progress), slide deck, diagram canvas, or documentation book.',
    behavior: 'NON_BLOCKING',
    parameters: obj({
      page: str('Page id, name, or number ("2"), or "next", "previous", "last"; the current page if omitted.'),
      view: enumOf(['dashboard', 'board', 'deck', 'diagram', 'documentation'], 'What to show on the page: dashboard, board (work in progress), deck (slides), diagram, or documentation.'),
      chapter: str('Id or title of the chapter to open in the documentation.'),
    }, []),
  },
  {
    name: 'rename_page',
    description: 'Renames a page (its diagram title).',
    behavior: 'NON_BLOCKING',
    parameters: obj({
      page: str('Page id, name or number; the current page if omitted.'),
      title: str('New name.'),
    }, ['title']),
  },
  {
    name: 'delete_page',
    description: 'Closes a page (tab) when the user asks to delete or close it. Its diagram stays in the diagram history.',
    behavior: 'NON_BLOCKING',
    parameters: obj({ page: str('Page id, name or number; the current page if omitted.') }, []),
  },
  {
    name: 'change_view',
    description: 'Moves the view of the canvas, only when the user asks: zoom in or out, fit the whole diagram, ' +
      '100 %, or focus on some elements.',
    behavior: 'NON_BLOCKING',
    parameters: obj({
      action: enumOf(['zoom_in', 'zoom_out', 'fit', 'actual_size', 'focus'], 'What to do with the view.'),
      targets: arrayOf(str('Id of a node or group (or of a chapter, which opens it in the documentation tab).'),
        'For focus: the elements to zoom to.'),
    }, ['action']),
  },
  {
    name: 'tidy_layout',
    description: 'Lays out the whole diagram again, keeping its order. Only when the user asks to tidy up, ' +
      'rearrange, or change the direction.',
    behavior: 'NON_BLOCKING',
    parameters: obj({
      direction: enumOf(['LR', 'TB'], 'New direction, if the user asked for one.'),
    }, []),
  },
  {
    name: 'get_diagram',
    description: 'Returns the current state of the canvas (the user may have changed it by hand) and the selection.',
    behavior: 'NON_BLOCKING',
  },
  {
    name: 'search_catalog',
    description: 'Searches the Gen AI Technical Blueprints & Cloud Architecture RAG knowledge base for reference ' +
      'architectures (Customer, Employee/RAG, Data/NL2SQL, Code/DevOps, Creative/Commerce, Security/SecOps agents, ' +
      'Three-Tier HA, Multi-Cloud Zero-Trust) and official cloud/AI components across all layers and providers.',
    behavior: 'NON_BLOCKING',
    parameters: obj({
      query: str('Search query: use case, industry, agent type, architectural layer, or component (e.g. "rag document ai", "customer agent", "secops", "vector database").'),
      provider: enumOf(PROVIDERS, 'Optional cloud provider filter ("gcp", "aws", "azure", "k8s", "onprem").'),
      category: enumOf(['customer', 'employee', 'data', 'code', 'creative', 'security', 'architecture', 'flowchart'], 'Optional blueprint category: blueprints of this category rank first, the others still match the query.'),
    }, ['query']),
  },
  {
    name: 'search_google_docs',
    description: 'Searches Google’s official Developer Knowledge MCP server (developerknowledge.googleapis.com/mcp) covering ' +
      'docs.cloud.google.com, ai.google.dev, firebase.google.com, adk.dev, genkit.dev, docs.apigee.com, developer.android.com, ' +
      'developer.chrome.com, docs.flutter.dev, go.dev, web.dev, and Google Workspace docs. Returns authoritative Markdown snippets ' +
      'plus exact "parent" ("documents/...") resource names and "uri" ("https://...") citation URLs. Mandatory before writing ' +
      'Low-Level Design or Implementation Guidelines for any Google / Google Cloud service.',
    behavior: 'NON_BLOCKING',
    parameters: obj({
      query: str('Focused technical search query naming the Google product and low-level mechanic (e.g. "AlloyDB pgvector ScaNN index row level security", "Cloud Run concurrency max instances VPC egress", "Cloud Tasks OIDC token verification", "Gemini API structured output thoughtSignature").'),
      limit: { type: 'INTEGER', description: 'Maximum snippets to return (1–12, default 8).' },
    }, ['query']),
  },
  {
    name: 'get_google_docs',
    description: 'Fetches full, latest official Google documentation Markdown pages via the official Developer Knowledge MCP ' +
      'get_documents tool (exact SDK APIs, DDL/SQL, IAM roles, CLI flags, limits, and official code samples). ' +
      'Pass 1 to 5 exact "parent" ("documents/...") names or "uri" URLs returned by search_google_docs or answer_google_docs.',
    behavior: 'NON_BLOCKING',
    parameters: obj({
      names: arrayOf(str('Official document resource name ("documents/docs.cloud.google.com/...") or URI returned by search_google_docs / answer_google_docs.'), '1 to 5 document names to retrieve in one batch.'),
    }, ['names']),
  },
  {
    name: 'answer_google_docs',
    description: 'Calls Google’s official Developer Knowledge MCP answer_query tool for synthesized, authoritative answers ' +
      'grounded in official Google documentation with exact "references" URIs. Automatically falls back to search_documents on quota limits.',
    behavior: 'NON_BLOCKING',
    parameters: obj({
      query: str('Technical question about official Google Cloud, Gemini/Vertex AI, Firebase, or Google developer APIs, architecture limits, or best practices.'),
    }, ['query']),
  },
  {
    name: 'undo',
    description: 'Undoes the last change(s) on the canvas.',
    behavior: 'NON_BLOCKING',
    parameters: obj({ steps: { type: 'INTEGER', description: 'Number of changes to undo, 1 by default.' } }, []),
  },
  {
    name: 'redo',
    description: 'Redoes changes that were undone.',
    behavior: 'NON_BLOCKING',
    parameters: obj({ steps: { type: 'INTEGER', description: 'Number of changes to redo, 1 by default.' } }, []),
  },
];
