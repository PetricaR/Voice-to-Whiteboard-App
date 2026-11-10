/**
 * Function declarations of the voice agent (Gemini API schema). Edits are
 * typed lists of operations on ids, so the model changes only what it names.
 */
import { FILTER_KINDS, VALUE_FORMATS, WIDGET_KINDS } from '../engine/dashboard';
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

const dashboardWidgetFields = {
  id: str('Short lowercase snake_case id, e.g. "mrr_trend" or "arr_by_region".'),
  title: str('Clear human-readable widget title.'),
  subtitle: str('Optional subtitle or timeframe, e.g. "H1 2026 · USD".'),
  kind: enumOf(WIDGET_KINDS, 'Visualization type: kpi for single headline metric, bar/line/area/donut/funnel/heatmap/scatter for charts, table for sortable detail rows.'),
  source: str('Data source id ("local" by default, or "bigquery", "clickhouse", "postgres", "rest:<name>").'),
  sql: str('Exact read-only SQL SELECT/WITH query. May reference dashboard filter params as :param_name (e.g. WHERE (:region = \'ALL\' OR region = :region)).'),
  x_field: str('Optional dimension/category column name.'),
  y_fields: arrayOf(str('Metric column name.'), 'Optional numeric metric column names.'),
  series_field: str('Optional series grouping column.'),
  format: enumOf(VALUE_FORMATS, 'Display formatting for values (currency_usd, percent, number, compact, ms).'),
  comparison_field: str('Optional secondary KPI delta column (e.g. mom_pct).'),
  unit: str('Optional unit suffix, e.g. "seats" or "ms".'),
  col_span: { type: 'INTEGER', description: 'Width in the 12-column Bento grid: 3 (4 per row, ideal for kpi), 4, 6 (half width), 8, or 12 (full width, ideal for table).' },
  explanation: str('One-sentence plain-English explanation of how this SQL computes the metric (shown in the SQL Lineage Inspector).'),
  color: enumOf(COLORS, 'Optional accent color.'),
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
    description: 'Inspects table names, column types, and sample rows of a data source so you can write accurate, schema-grounded SQL queries.',
    behavior: 'NON_BLOCKING',
    parameters: obj({
      source: str('Data source id ("local" by default, or "bigquery", "clickhouse", "postgres", "rest:<name>").'),
    }, []),
  },
  {
    name: 'run_query',
    description: 'Executes a read-only SELECT/WITH SQL query against a data source and returns columns and rows. Use to verify SQL or answer analytical questions with exact numbers.',
    behavior: 'NON_BLOCKING',
    parameters: obj({
      source: str('Data source id ("local" by default).'),
      sql: str('Read-only SQL SELECT or WITH query.'),
    }, ['sql']),
  },
  {
    name: 'create_dashboard',
    description: 'Creates an interactive live SQL dashboard on the active page (or a new page with new_page: true) and switches to the Dashboard view. Every widget is backed by an auditable SQL query.',
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
    description: 'Incrementally edits the live dashboard on the active page: add, update, remove, or reorder widgets and filters without disturbing untouched widgets.',
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
        id: str('Widget id or "@selected".'),
        title: dashboardWidgetFields.title,
        subtitle: dashboardWidgetFields.subtitle,
        kind: dashboardWidgetFields.kind,
        source: dashboardWidgetFields.source,
        sql: dashboardWidgetFields.sql,
        x_field: dashboardWidgetFields.x_field,
        y_fields: dashboardWidgetFields.y_fields,
        series_field: dashboardWidgetFields.series_field,
        format: dashboardWidgetFields.format,
        comparison_field: dashboardWidgetFields.comparison_field,
        unit: dashboardWidgetFields.unit,
        col_span: dashboardWidgetFields.col_span,
        explanation: dashboardWidgetFields.explanation,
        color: enumOf([...COLORS, 'none'], 'Color or "none".'),
      }, ['id']), 'Updates to existing widgets.'),
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
    description: 'Re-runs all SQL queries on the active dashboard and returns fresh live results.',
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
