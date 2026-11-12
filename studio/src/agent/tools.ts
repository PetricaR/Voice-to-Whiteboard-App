/**
 * Function declarations of the voice agent (Gemini API schema). Edits are
 * typed lists of operations on ids, so the model changes only what it names.
 */
import {
  AXIS_SCALES,
  CHART_ORIENTATIONS,
  CHART_PALETTES,
  CURVE_TYPES,
  DATA_LABEL_CONTENTS,
  FILTER_KINDS,
  LEGEND_POSITIONS,
  MAP_SCOPES,
  SORT_MODES,
  STACK_MODES,
  VALUE_FORMATS,
  WIDGET_KINDS,
} from '../engine/dashboard';
import { ASPECT_RATIOS, EASING_PRESETS, MOTION_LAYER_KINDS, TRANSITION_KINDS } from '../engine/motion';
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
    axis: enumOf(['x', 'y'], 'y for a horizontal line at a value (target, budget, SLA); x for a vertical line at a category or date.'),
    value: str('Value on that axis, e.g. "180000" or "2026-07".'),
    label: str('Short label, e.g. "Target $180K".'),
  }, ['axis', 'value']), 'Target, budget, threshold or event lines.'),
  reference_bands: arrayOf(obj({
    axis: enumOf(['x', 'y'], 'Axis of the band.'),
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
  y_axis_title: str('Title of the y axis, with the unit.'),
  y_axis_format: enumOf(VALUE_FORMATS, 'Format of the axis ticks when it differs from the widget format.'),
  y_axis_scale: enumOf(AXIS_SCALES, 'log when values span several orders of magnitude.'),
  start_from_zero: bool('Bars always start at zero. For lines, false zooms in on the variation.'),
  y_min: num('Lower bound of the y axis.'),
  y_max: num('Upper bound of the y axis, e.g. 100 for percentages.'),
  // Color
  palette: enumOf(CHART_PALETTES, 'Color palette; diverging for values around a midpoint, viridis/ocean for sequential intensity.'),
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

const motionLayerFields = {
  id: str('Short snake_case layer id, e.g. "headline_1" or "arr_counter".'),
  kind: enumOf(MOTION_LAYER_KINDS, 'Animated element type: badge, kinetic_text, metric_counter, motion_chart, flow_diagram, or callout_card.'),
  enter_at_ms: { type: 'INTEGER', description: 'Millisecond offset within the scene when this layer animates in (e.g. 0, 200, 450).' },
  exit_at_ms: { type: 'INTEGER', description: 'Optional millisecond offset when this layer exits.' },
  easing: enumOf(EASING_PRESETS, 'Animation curve: spring, smooth, snappy, or linear.'),
  x: { type: 'NUMBER', description: 'Left position as % of stage width (0..95).' },
  y: { type: 'NUMBER', description: 'Top position as % of stage height (0..95).' },
  w: { type: 'NUMBER', description: 'Width as % of stage width (8..100).' },
  h: { type: 'NUMBER', description: 'Height as % of stage height (6..100).' },
  color: enumOf(COLORS, 'Accent color.'),
  text: str('Primary headline, badge label, or metric label.'),
  subtext: str('Supporting subtitle or caption.'),
  size: enumOf(['sm', 'md', 'lg', 'xl'], 'Typography scale for kinetic_text.'),
  align: enumOf(['left', 'center', 'right'], 'Text alignment.'),
  value: { type: 'NUMBER', description: 'Target numeric value for metric_counter.' },
  start_value: { type: 'NUMBER', description: 'Starting number for metric_counter roll-up (default 0).' },
  prefix: str('Counter prefix, e.g. "$" or "€".'),
  suffix: str('Counter suffix, e.g. "M", "K", "%".'),
  decimals: { type: 'INTEGER', description: 'Decimal places (0..3).' },
  delta_text: str('Optional delta callout on metric_counter, e.g. "+18.4% YoY".'),
  chart_type: enumOf(['bar', 'line', 'donut'], 'Chart type for motion_chart.'),
  series: arrayOf(obj({
    label: str('Category label.'),
    value: { type: 'NUMBER', description: 'Numeric value.' },
    color: enumOf(COLORS, 'Optional bar/slice color.'),
  }, ['label', 'value']), 'Data points for motion_chart.'),
  highlight_index: { type: 'INTEGER', description: '0-based index of the bar/point to spotlight.' },
  highlight_note: str('Callout pill on motion_chart, e.g. "Top region: North America".'),
  flow_nodes: arrayOf(obj({
    id: str('Node id.'),
    label: str('Node label.'),
    color: enumOf(COLORS, 'Optional color.'),
  }, ['id', 'label']), 'Nodes for flow_diagram layer.'),
  flow_edges: arrayOf(obj({
    from: str('Source node id.'),
    to: str('Target node id.'),
    label: str('Optional label.'),
  }, ['from', 'to']), 'Connections for flow_diagram layer.'),
};

const motionSceneFields = {
  id: str('Short snake_case scene id, e.g. "opening_hook" or "revenue_rollup".'),
  title: str('Short scene title shown on the timeline.'),
  duration_ms: { type: 'INTEGER', description: 'Scene duration in milliseconds (2500..15000, typically 4500).' },
  transition: enumOf(TRANSITION_KINDS, 'Entrance transition: fade, slide_left, slide_up, zoom_through, or cut.'),
  accent_color: enumOf(COLORS, 'Ambient glow & accent color for the scene.'),
  narration: str('Concise spoken/caption line displayed as kinetic captions during this scene.'),
  layers: arrayOf(obj(motionLayerFields, ['kind']), 'Animated layers inside this scene.'),
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
    description: 'Creates an interactive live SQL dashboard on the active page (or a new page with new_page: true) and switches to the Dashboard view. Every widget is backed by an auditable SQL query. ' +
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
    description: 'Incrementally edits the live dashboard on the active page: add, update, remove, or reorder widgets and filters without disturbing untouched widgets. ' +
      'The result contains "chartReview" (issues, advice and facts) for the widgets it added or changed.',
    behavior: 'NON_BLOCKING',
    parameters: obj({
      summary: str('Short summary of what changed (at most 8 words).'),
      title: str('Optional new dashboard title.'),
      subtitle: str('Optional new subtitle, or "" to clear.'),
      refresh_seconds: { type: 'INTEGER', description: 'Auto-refresh interval in seconds (0, 30, 60, 300).' },
      add_widgets: arrayOf(obj({
        ...dashboardWidgetFields,
        after: str('Optional widget id to insert after, or "start".'),
      }, ['title', 'kind', 'sql']), 'New widgets to add.'),
      update_widgets: arrayOf(obj({
        ...dashboardWidgetFields,
        id: str('Widget id or "@selected".'),
        color: enumOf([...COLORS, 'none'], 'Color or "none".'),
        reset_chart_config: bool('True to drop every chart_config setting of the widget before applying chart_config.'),
      }, ['id']), 'Updates to existing widgets: only the given fields change (chart_config is merged field by field).'),
      remove_widgets: arrayOf(str('Widget id or "@selected".'), 'Widgets to remove.'),
      reorder_widgets: arrayOf(str('Widget id.'), 'Ordered list of widget ids.'),
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
    description: 'Re-runs all SQL queries on the active dashboard and returns "chartReview": the facts every chart shows right now (leaders, shares, trends, drop-offs) and any issues. ' +
      'Use it to answer "what does this dashboard tell us?", "what are the insights?" or "summarize this".',
    behavior: 'NON_BLOCKING',
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
    name: 'create_motion',
    description: 'Creates a deterministic, code-backed animated Motion Explainer on the active page (or a new page) and opens the Motion Studio view. Set from_current_page: true (without scenes) to automatically synthesize a multi-scene storyboard grounded in the current page’s live dashboard numbers, diagram, or docs; or pass custom scenes for bespoke animated explainers.',
    behavior: 'NON_BLOCKING',
    parameters: obj({
      title: str('Explainer title, e.g. "Q2 SaaS Growth Walkthrough".'),
      subtitle: str('Optional subtitle.'),
      aspect_ratio: enumOf(ASPECT_RATIOS, '16:9 (landscape presentation), 9:16 (vertical social/mobile), or 1:1 (square).'),
      fps: { type: 'INTEGER', description: '30 or 60 fps.' },
      show_captions: { type: 'BOOLEAN', description: 'Whether to display kinetic captions from scene narration (true by default).' },
      from_current_page: { type: 'BOOLEAN', description: 'When true and scenes is omitted, synthesizes scenes automatically from the active page’s live dashboard/diagram/docs.' },
      scenes: arrayOf(obj(motionSceneFields, ['title', 'layers']), 'Ordered storyboard scenes.'),
      new_page: { type: 'BOOLEAN', description: 'True to create on a new workspace tab.' },
      replace: { type: 'BOOLEAN', description: 'True to replace an existing motion composition on this page.' },
    }, []),
  },
  {
    name: 'edit_motion',
    description: 'Incrementally edits the Motion Explainer: change a single headline, number, color, scene duration, transition, or layer entrance millisecond without regenerating the whole video.',
    behavior: 'NON_BLOCKING',
    parameters: obj({
      summary: str('Short summary of what changed (at most 8 words).'),
      title: str('New title.'),
      subtitle: str('New subtitle.'),
      aspect_ratio: enumOf(ASPECT_RATIOS, '16:9, 9:16, or 1:1.'),
      show_captions: { type: 'BOOLEAN', description: 'Show or hide kinetic captions.' },
      add_scenes: arrayOf(obj({
        ...motionSceneFields,
        after: str('Scene id to insert after, or "start".'),
      }, ['title', 'layers']), 'Scenes to add.'),
      update_scenes: arrayOf(obj({
        id: str('Scene id, title, or 1-based scene number ("1", "scene 2").'),
        title: str('Updated scene title.'),
        duration_ms: { type: 'INTEGER', description: 'Updated duration in ms.' },
        transition: enumOf(TRANSITION_KINDS, 'Updated transition.'),
        accent_color: enumOf([...COLORS, 'none'], 'Updated accent color.'),
        narration: str('Updated caption/narration text.'),
      }, ['id']), 'Scene updates.'),
      remove_scenes: arrayOf(str('Scene id or number.'), 'Scenes to remove.'),
      reorder_scenes: arrayOf(str('Scene id.'), 'New scene order.'),
      add_layers: arrayOf(obj({
        ...motionLayerFields,
        scene_id: str('Target scene id or number.'),
      }, ['scene_id', 'kind']), 'Layers to add to a scene.'),
      update_layers: arrayOf(obj({
        ...motionLayerFields,
        id: str('Layer id or "@selected".'),
        scene_id: str('Optional scene id to scope lookup.'),
      }, ['id']), 'Direct updates to existing layers (copy, numbers, timings, positions, colors).'),
      remove_layers: arrayOf(str('Layer id.'), 'Layers to remove.'),
    }, ['summary']),
  },
  {
    name: 'control_motion',
    description: 'Plays, pauses, restarts, scrubs, or triggers MP4 video export of the active Motion Explainer.',
    behavior: 'NON_BLOCKING',
    parameters: obj({
      action: enumOf(['play', 'pause', 'restart', 'seek', 'export_mp4'], 'Playback or export command.'),
      time_ms: { type: 'INTEGER', description: 'Target timestamp in milliseconds when action is "seek".' },
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
    description: 'Writes one chapter of the documentation of the current page. The documentation is not on the ' +
      'canvas: it is a book in its own tab, with a table of contents (chapters, and the "## " headings of each ' +
      'chapter as its sections), and it opens at this chapter. Use it for the text chapters of arc42-style ' +
      'architecture documentation (introduction and goals, runtime view, deployment, cross-cutting concepts, ' +
      'architecture decision records), and for runbooks and notes. With the id of an existing chapter it rewrites ' +
      'that chapter (append: true adds to its end, e.g. one more ADR). Returns the state.',
    behavior: 'NON_BLOCKING',
    parameters: obj({
      id: str('Short snake_case id of a new chapter (e.g. "overview", "runtime", "decisions"), or the id of an existing chapter to rewrite.'),
      title: str('Title of the chapter in the table of contents, e.g. "Introduction and goals", "Runtime view", "Architecture decisions".'),
      text: str('Markdown body of the chapter, without the chapter title: "## " section headings, "- " bullets, ' +
        '"1. " steps, **bold**, _italic_, `code`, "| a | b |" tables. Uses the exact labels of the diagram; ' +
        'anything the diagram does not show is marked "_Assumption:_". In English.'),
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
    description: 'Shows a page (tab) and/or switches its active view: live dashboard, motion explainer, diagram canvas, or documentation book.',
    behavior: 'NON_BLOCKING',
    parameters: obj({
      page: str('Page id, name, or number ("2"), or "next", "previous", "last"; the current page if omitted.'),
      view: enumOf(['dashboard', 'motion', 'diagram', 'documentation'], 'What to show on the page: dashboard, motion, diagram, or documentation.'),
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
