/**
 * Complete Holistics 40+ Chart Types Catalog, Data Storytelling Guidelines,
 * Ready-to-Run Local SQLite Sample Presets, and Live Chart Storytelling Advisor.
 *
 * Grounded in the 8 analytical chart families and 6 dashboard design principles:
 * 1. Categorical  2. Temporal  3. Distribution  4. Relational
 * 5. Hierarchical  6. Geospatial  7. Proportional & Goal Tracking  8. Advanced & Specialized
 */
import type { QueryExecutionResult } from '../data/sqlEngine';
import type { IconName } from '../ui/icons';
import type {
  CreateDashboardRequest,
  DashboardWidget,
  DashboardWidgetInput,
  WidgetKind,
} from './dashboard';

export type ChartCategoryId =
  | 'categorical'
  | 'temporal'
  | 'distribution'
  | 'relational'
  | 'hierarchical'
  | 'geospatial'
  | 'proportional'
  | 'advanced';

export interface ChartCategoryMeta {
  id: ChartCategoryId;
  label: string;
  shortLabel: string;
  icon: IconName;
  description: string;
}

export interface ChartCatalogEntry {
  kind: WidgetKind;
  label: string;
  category: ChartCategoryId;
  icon: IconName;
  summary: string;
  whenToUse: string;
  avoidWhen: string;
  sqlShapeHint: string;
  sampleWidget: DashboardWidgetInput;
}

export interface ChartStoryAdvice {
  id: string;
  severity: 'tip' | 'warning';
  title: string;
  message: string;
  quickFix?: {
    label: string;
    patch: Partial<DashboardWidgetInput>;
  };
}

export const HOLISTICS_DESIGN_PRINCIPLES = [
  {
    id: 'integrity',
    title: 'Prioritize Data Integrity',
    detail: 'Start bar/column baselines at zero so bar length reflects true numerical proportion, and scale bubble/area radii by area rather than diameter.',
  },
  {
    id: 'audience',
    title: 'Tailor to Your Audience',
    detail: 'Lead executive views with headline KPIs, Bullet targets, and clean trends; use Box/Violin distributions, Parallel Coordinates, and SQL tables for deep exploration.',
  },
  {
    id: 'hierarchy',
    title: 'Use Visual Hierarchy',
    detail: 'Anchor headline KPIs at the top (3–4 cols), place primary trends/maps prominently (6–8 cols), and place detailed breakdowns or tables full-width below (12 cols).',
  },
  {
    id: 'simplicity',
    title: 'Embrace Simplicity',
    detail: 'Cap Pie/Donut slices at 5–6 (group the tail as "Other"), sort categorical bars by value, and replace >4 spaghetti lines with Direct Labels or Trellis facets.',
  },
  {
    id: 'accessibility',
    title: 'Design for Accessibility',
    detail: 'Combine colorblind-safe palettes (Viridis, Ocean, Studio) with distinct marker shapes, direct labels, and formatted tooltips.',
  },
  {
    id: 'context',
    title: 'Contextualize Every Metric',
    detail: 'Add target reference lines, qualitative threshold bands, clear units, footnotes, and 1-click SQL lineage so numbers never float without context.',
  },
] as const;

export const CHART_CATEGORIES: readonly ChartCategoryMeta[] = [
  {
    id: 'categorical',
    label: 'Categorical Comparisons',
    shortLabel: 'Categorical',
    icon: 'bar_chart',
    description: 'Compare discrete groups, rankings, stacked compositions, and multi-attribute profiles.',
  },
  {
    id: 'temporal',
    label: 'Temporal & Time-Series',
    shortLabel: 'Temporal',
    icon: 'show_chart',
    description: 'Track continuous trends, cumulative volume, project Gantt schedules, OHLC volatility, and stream flows.',
  },
  {
    id: 'distribution',
    label: 'Statistical Distribution',
    shortLabel: 'Distribution',
    icon: 'analytics',
    description: 'Inspect frequency bins, medians, IQR quartiles, smooth KDE density curves, and outliers.',
  },
  {
    id: 'relational',
    label: 'Relational & Network',
    shortLabel: 'Relational',
    icon: 'scatter_plot',
    description: 'Reveal X/Y correlations, 3-variable bubbles, 2D heatmaps, multivariate profiles, and node-link graphs.',
  },
  {
    id: 'hierarchical',
    label: 'Hierarchical & Part-to-Whole',
    shortLabel: 'Hierarchical',
    icon: 'account_tree',
    description: 'Drill into nested trees, squarified treemaps, concentric sunbursts, org reporting lines, and alluvial sets.',
  },
  {
    id: 'geospatial',
    label: 'Geospatial & Flow Maps',
    shortLabel: 'Geospatial',
    icon: 'public',
    description: 'Plot regional choropleths, hub pins, thermal hotspots, proportional geo-bubbles, and directional hub arcs.',
  },
  {
    id: 'proportional',
    label: 'Proportional & Goal Tracking',
    shortLabel: 'Goal & KPI',
    icon: 'speed',
    description: 'Communicate headline KPIs, waffle/area proportions, radial gauges, Stephen Few bullets, and funnels.',
  },
  {
    id: 'advanced',
    label: 'Advanced & Specialized',
    shortLabel: 'Advanced',
    icon: 'waterfall_chart',
    description: 'Build multi-stage Sankey flows, seasonal spirals, arc diagrams, Trellis small multiples, and waterfalls.',
  },
] as const;

export const CHART_CATALOG: readonly ChartCatalogEntry[] = [
  // =========================================================================
  // 1. CATEGORICAL (10)
  // =========================================================================
  {
    kind: 'bar',
    label: 'Bar Chart',
    category: 'categorical',
    icon: 'bar_chart',
    summary: 'Classic categorical comparison using proportional bar lengths anchored at zero.',
    whenToUse: 'Comparing discrete categories, regional totals, or ranked segments.',
    avoidWhen: 'Labels are very long (use Horizontal Bar) or baseline is truncated above zero.',
    sqlShapeHint: '1 category column + 1 numeric metric column',
    sampleWidget: {
      title: 'October MRR by Region',
      subtitle: 'Zero-anchored categorical comparison',
      kind: 'bar',
      sql: `SELECT region, SUM(mrr_usd) AS mrr_usd FROM monthly_revenue WHERE month = '2026-10' GROUP BY region ORDER BY mrr_usd DESC`,
      format: 'currency_usd',
      colSpan: 6,
      explanation: 'Compares October 2026 recurring revenue across regions.',
    },
  },
  {
    kind: 'column',
    label: 'Column Chart',
    category: 'categorical',
    icon: 'bar_chart',
    summary: 'Vertical columns emphasizing discrete period-over-period or cohort comparisons.',
    whenToUse: 'Comparing ordinal buckets, quarters, or up to 12 discrete categories.',
    avoidWhen: 'More than 15 categories crowd horizontal labels; consider Horizontal Bar or Line.',
    sqlShapeHint: '1 category/period column + 1 numeric metric column',
    sampleWidget: {
      title: 'Quarterly Gross Revenue',
      subtitle: 'Vertical column comparison by fiscal quarter',
      kind: 'column',
      sql: `SELECT quarter, SUM(gross_revenue_usd) AS gross_revenue_usd FROM daily_orders GROUP BY quarter ORDER BY quarter`,
      format: 'currency_usd',
      colSpan: 6,
      explanation: 'Sums gross e-commerce revenue per fiscal quarter.',
    },
  },
  {
    kind: 'grouped_bar',
    label: 'Grouped Bar Chart',
    category: 'categorical',
    icon: 'bar_chart',
    summary: 'Side-by-side clustered bars comparing sub-series within each primary category.',
    whenToUse: 'Directly comparing 2–4 sub-groups (such as pricing plans or environments) per category.',
    avoidWhen: 'More than 4 sub-series per cluster makes individual bars thin and hard to scan.',
    sqlShapeHint: 'category, series_field, metric (or category + multiple metric columns)',
    sampleWidget: {
      title: 'Regional MRR by Pricing Tier',
      subtitle: 'Clustered side-by-side plan comparison',
      kind: 'grouped_bar',
      sql: `SELECT region, plan, SUM(mrr_usd) AS mrr_usd FROM monthly_revenue WHERE month = '2026-10' GROUP BY region, plan ORDER BY region`,
      xField: 'region',
      seriesField: 'plan',
      yFields: ['mrr_usd'],
      format: 'currency_usd',
      colSpan: 6,
      explanation: 'Compares Enterprise, Pro, and Starter MRR side-by-side within each region.',
    },
  },
  {
    kind: 'stacked_bar',
    label: 'Stacked Bar Chart',
    category: 'categorical',
    icon: 'stacked_bar_chart',
    summary: 'Segmented bars showing both total magnitude and part-to-whole sub-category breakdown (or 100% share).',
    whenToUse: 'Showing total volume alongside how sub-segments (or 100% normalized shares) contribute.',
    avoidWhen: 'Precise comparison of middle/upper segments across bars is critical (only the bottom segment shares a flat baseline).',
    sqlShapeHint: 'category, series_field, metric (or category + 2..N numeric columns)',
    sampleWidget: {
      title: 'Monthly Orders by Acquisition Channel',
      subtitle: 'Stacked channel contribution over time',
      kind: 'stacked_bar',
      sql: `SELECT month, channel, SUM(orders) AS orders FROM daily_orders GROUP BY month, channel ORDER BY month`,
      xField: 'month',
      seriesField: 'channel',
      yFields: ['orders'],
      format: 'number',
      colSpan: 6,
      explanation: 'Stacks monthly completed orders across Organic Search, Paid Social, Direct, and Email.',
    },
  },
  {
    kind: 'horizontal_bar',
    label: 'Horizontal Bar Chart',
    category: 'categorical',
    icon: 'toc',
    summary: 'Left-to-right ranked bars giving long category or account names full legibility without rotation.',
    whenToUse: 'Ranking leaderboards, long service/company names, or >8 discrete items.',
    avoidWhen: 'Representing chronological time-series (time naturally reads left-to-right on X).',
    sqlShapeHint: 'label column + numeric value column (ideally sorted DESC)',
    sampleWidget: {
      title: 'Cloud Spend by Service',
      subtitle: 'Ranked horizontal bars for readable service labels',
      kind: 'horizontal_bar',
      sql: `SELECT service, SUM(cost_usd) AS cost_usd FROM service_spend GROUP BY service ORDER BY cost_usd DESC`,
      format: 'currency_usd',
      colSpan: 6,
      explanation: 'Ranks cloud & AI services from highest to lowest cumulative spend.',
    },
  },
  {
    kind: 'pie',
    label: 'Pie Chart',
    category: 'categorical',
    icon: 'pie_chart',
    summary: 'Circular part-to-whole wedges encoding percentage share of a single total.',
    whenToUse: 'Highlighting a dominant share among 2–5 mutually exclusive categories summing to 100%.',
    avoidWhen: 'More than 6 slices or slices with nearly identical values (use Horizontal Bar or group tail into "Other").',
    sqlShapeHint: 'slice_label, positive_value',
    sampleWidget: {
      title: 'Orders Share by Product Category',
      subtitle: '4-slice part-to-whole composition',
      kind: 'pie',
      sql: `SELECT category, SUM(orders) AS orders FROM daily_orders GROUP BY category ORDER BY orders DESC`,
      format: 'number',
      colSpan: 4,
      explanation: 'Shows each product category share of total completed orders.',
    },
  },
  {
    kind: 'donut',
    label: 'Donut Chart',
    category: 'categorical',
    icon: 'donut_large',
    summary: 'Ring chart emphasizing arc length over angle, with a center callout for total or headline KPI.',
    whenToUse: 'Part-to-whole composition (2–6 slices) where displaying the grand total in the center adds context.',
    avoidWhen: 'Many tiny slices (<4% each) — enable "Group tail as Other" in Chart Controls.',
    sqlShapeHint: 'slice_label, positive_value',
    sampleWidget: {
      title: 'MRR Share by Region',
      subtitle: 'Donut ring with grand total center callout',
      kind: 'donut',
      sql: `SELECT region, SUM(mrr_usd) AS mrr_usd FROM monthly_revenue WHERE month = '2026-10' GROUP BY region ORDER BY mrr_usd DESC`,
      format: 'currency_usd',
      colSpan: 4,
      explanation: 'Breaks down October 2026 MRR across global regions.',
    },
  },
  {
    kind: 'nightingale_rose',
    label: 'Nightingale Rose Chart',
    category: 'categorical',
    icon: 'donut_large',
    summary: 'Polar area (Coxcomb) diagram with equal-angle sectors whose outer radii scale with magnitude.',
    whenToUse: 'Cyclical or editorial categorical comparisons where radial prominence highlights top segments.',
    avoidWhen: 'Subtle numerical differences matter — wedge area grows quadratically with radius, so pair with data labels.',
    sqlShapeHint: 'category_or_cycle_label, numeric_value',
    sampleWidget: {
      title: 'Cloud & AI Service Spend Rose',
      subtitle: 'Florence Nightingale polar area comparison',
      kind: 'nightingale_rose',
      sql: `SELECT service, SUM(cost_usd) AS cost_usd FROM service_spend WHERE environment = 'production' GROUP BY service ORDER BY cost_usd DESC`,
      format: 'currency_usd',
      colSpan: 6,
      chartConfig: { showDataLabels: true },
      explanation: 'Displays production spend per service as equal-angle polar sectors.',
    },
  },
  {
    kind: 'radar',
    label: 'Radar / Spider Chart',
    category: 'categorical',
    icon: 'radar',
    summary: 'Multi-spoke radial polygon comparing performance profiles across 4–8 normalized dimensions.',
    whenToUse: 'Evaluating balanced scorecards, skill/health profiles, or comparing 1–3 entities across shared spokes.',
    avoidWhen: 'More than 3–4 overlapping polygons or spoke axes with wildly different scales without normalization.',
    sqlShapeHint: 'spoke_dimension, metric_1 [, metric_2] (or spoke, series_field, value)',
    sampleWidget: {
      title: 'Regional NDR Retention Profile',
      subtitle: 'Multi-axis spider comparison across pricing tiers',
      kind: 'radar',
      sql: `SELECT region, plan, ROUND(AVG(net_dollar_retention_pct), 1) AS ndr_pct FROM monthly_revenue WHERE month = '2026-10' GROUP BY region, plan`,
      xField: 'region',
      seriesField: 'plan',
      yFields: ['ndr_pct'],
      format: 'percent',
      colSpan: 6,
      explanation: 'Compares Net Dollar Retention % across regions for Enterprise, Pro, and Starter tiers.',
    },
  },
  {
    kind: 'marimekko',
    label: 'Marimekko (Mekko) Chart',
    category: 'categorical',
    icon: 'auto_awesome_mosaic',
    summary: 'Two-dimensional 100% stacked matrix where column width encodes market size and segment height encodes mix.',
    whenToUse: 'Simultaneously visualizing total segment weight (width) and sub-tier composition (height) with zero wasted whitespace.',
    avoidWhen: 'Many small categories create sliver columns that are difficult to label.',
    sqlShapeHint: 'column_category, stack_series, numeric_value',
    sampleWidget: {
      title: 'Market Matrix: Region Size × Plan Mix',
      subtitle: 'Column width = regional MRR share · Height = tier share',
      kind: 'marimekko',
      sql: `SELECT region, plan, SUM(mrr_usd) AS mrr_usd FROM monthly_revenue WHERE month = '2026-10' GROUP BY region, plan`,
      xField: 'region',
      seriesField: 'plan',
      yFields: ['mrr_usd'],
      format: 'currency_usd',
      colSpan: 6,
      explanation: 'Encodes both regional MRR volume (width) and pricing tier share (vertical split).',
    },
  },

  // =========================================================================
  // 2. TEMPORAL (5)
  // =========================================================================
  {
    kind: 'line',
    label: 'Line Chart',
    category: 'temporal',
    icon: 'show_chart',
    summary: 'Continuous trajectory connecting ordered time points to spotlight velocity, inflection points, and seasonality.',
    whenToUse: 'Tracking continuous metrics over days, weeks, months, or quarters across 1–4 series.',
    avoidWhen: 'More than 4–5 crossing lines create a "spaghetti chart" — switch to Direct Line Labels or Trellis.',
    sqlShapeHint: 'time_col, metric_col [, series_col]',
    sampleWidget: {
      title: 'MRR Growth by Region',
      subtitle: '12-month trajectory with direct endpoint labels',
      kind: 'line',
      sql: `SELECT month, region, SUM(mrr_usd) AS mrr_usd FROM monthly_revenue GROUP BY month, region ORDER BY month`,
      xField: 'month',
      seriesField: 'region',
      yFields: ['mrr_usd'],
      format: 'currency_usd',
      colSpan: 8,
      chartConfig: { curveType: 'monotone', directLineLabels: true },
      explanation: 'Tracks monthly recurring revenue per region from 2025-11 through 2026-10.',
    },
  },
  {
    kind: 'area',
    label: 'Area Chart',
    category: 'temporal',
    icon: 'stacked_line_chart',
    summary: 'Filled time-series curve emphasizing cumulative volume and total magnitude beneath the trendline.',
    whenToUse: 'Highlighting total volume growth over time or stacked cumulative contributions.',
    avoidWhen: 'Multiple unstacked overlapping areas obscure lower series without low fillOpacity.',
    sqlShapeHint: 'time_col, metric_col [, series_col]',
    sampleWidget: {
      title: 'Total Monthly Recurring Revenue',
      subtitle: 'Cumulative volume trajectory',
      kind: 'area',
      sql: `SELECT month, SUM(mrr_usd) AS mrr_usd FROM monthly_revenue GROUP BY month ORDER BY month`,
      format: 'currency_usd',
      colSpan: 6,
      chartConfig: { curveType: 'monotone', gradientFill: true },
      explanation: 'Aggregates monthly MRR across all regions and plans.',
    },
  },
  {
    kind: 'gantt',
    label: 'Gantt Chart',
    category: 'temporal',
    icon: 'timeline',
    summary: 'Horizontal schedule bars plotting task start, end/duration, workstream color, and completion progress.',
    whenToUse: 'Project roadmaps, launch schedules, sprint timelines, and milestone dependency windows.',
    avoidWhen: 'Hundreds of fine-grained subtasks clutter a single card — filter to key milestones.',
    sqlShapeHint: 'task_name, start_offset, end_offset [, progress_pct, workstream]',
    sampleWidget: {
      title: 'Platform Launch Roadmap',
      subtitle: 'Milestone schedule & completion % across workstreams',
      kind: 'gantt',
      sql: `SELECT task_name, start_day, end_day, progress_pct, workstream FROM project_roadmap ORDER BY start_day ASC`,
      xField: 'task_name',
      startField: 'start_day',
      endField: 'end_day',
      progressField: 'progress_pct',
      seriesField: 'workstream',
      format: 'number',
      unit: 'd',
      colSpan: 8,
      explanation: 'Plots start/end day windows and completion progress for each engineering milestone.',
    },
  },
  {
    kind: 'candlestick',
    label: 'Candlestick (OHLC) Chart',
    category: 'temporal',
    icon: 'candlestick_chart',
    summary: 'Financial open-high-low-close bodies and high/low wicks encoding price direction and intraday volatility.',
    whenToUse: 'Stock/crypto/commodity OHLC price action, latency min/p25/p75/max ranges, or financial variance.',
    avoidWhen: 'Audience only needs closing direction — a simple Line or Area chart is cleaner.',
    sqlShapeHint: 'date_col, open_col, high_col, low_col, close_col',
    sampleWidget: {
      title: 'CLDX Weekly Price Action (OHLC)',
      subtitle: 'Bullish/bearish bodies with weekly high-low wicks',
      kind: 'candlestick',
      sql: `SELECT trading_date, open_usd, high_usd, low_usd, close_usd FROM stock_ohlc ORDER BY trading_date ASC`,
      xField: 'trading_date',
      openField: 'open_usd',
      highField: 'high_usd',
      lowField: 'low_usd',
      closeField: 'close_usd',
      format: 'currency_usd',
      colSpan: 6,
      explanation: 'Displays weekly open, high, low, and close prices for ticker CLDX.',
    },
  },
  {
    kind: 'streamgraph',
    label: 'Streamgraph',
    category: 'temporal',
    icon: 'stacked_line_chart',
    summary: 'Organic, symmetrically centered flowing ribbons showing how category volumes ebb and swell over time.',
    whenToUse: 'Highlighting macro shifts, seasonal waves, and relative category momentum across time.',
    avoidWhen: 'Reading exact baseline-anchored values for a single point is required (use Stacked Area or Trellis).',
    sqlShapeHint: 'time_col, series_col, numeric_value',
    sampleWidget: {
      title: 'E-Commerce Category Revenue Stream',
      subtitle: 'Centered organic flow across 12 months',
      kind: 'streamgraph',
      sql: `SELECT month, category, SUM(net_revenue_usd) AS net_revenue_usd FROM daily_orders GROUP BY month, category ORDER BY month`,
      xField: 'month',
      seriesField: 'category',
      yFields: ['net_revenue_usd'],
      format: 'currency_usd',
      colSpan: 8,
      explanation: 'Visualizes organic ebb and flow of net revenue across product categories.',
    },
  },

  // =========================================================================
  // 3. DISTRIBUTION (4)
  // =========================================================================
  {
    kind: 'histogram',
    label: 'Histogram',
    category: 'distribution',
    icon: 'bar_chart',
    summary: 'Contiguous equal-width numeric bins revealing skewness, modality, concentration, and tail behavior.',
    whenToUse: 'Inspecting how continuous values (ARR, latency, order size, usage scores) are distributed across ranges.',
    avoidWhen: 'Comparing discrete named categories (that is a Bar/Column chart, not a Histogram).',
    sqlShapeHint: 'raw numeric column (auto-binned into configurable binCount)',
    sampleWidget: {
      title: 'Enterprise Account ARR Distribution',
      subtitle: 'Frequency histogram across ARR brackets',
      kind: 'histogram',
      sql: `SELECT account_name, arr_usd FROM enterprise_accounts`,
      yFields: ['arr_usd'],
      format: 'currency_usd',
      colSpan: 6,
      chartConfig: { binCount: 6, showDataLabels: true },
      explanation: 'Bins enterprise customer ARR into contiguous intervals to reveal deal-size concentration.',
    },
  },
  {
    kind: 'box_plot',
    label: 'Box & Whisker Plot',
    category: 'distribution',
    icon: 'analytics',
    summary: 'Five-number statistical summary (median, Q1–Q3 IQR box, 1.5×IQR whiskers, mean, and individual outliers) per group.',
    whenToUse: 'Comparing spread, symmetry, median, and outlier behavior across multiple regions, plans, or services.',
    avoidWhen: 'Distribution is bimodal (two peaks hide inside the IQR box — use a Violin Plot instead).',
    sqlShapeHint: 'group_category, raw_numeric_metric',
    sampleWidget: {
      title: 'MRR Cohort Spread by Region',
      subtitle: 'Median, Q1–Q3 IQR, 1.5×IQR whiskers & mean marker',
      kind: 'box_plot',
      sql: `SELECT region, mrr_usd FROM monthly_revenue`,
      xField: 'region',
      yFields: ['mrr_usd'],
      format: 'currency_usd',
      colSpan: 6,
      chartConfig: { showMean: true, showOutliers: true },
      explanation: 'Summarizes monthly MRR distribution quartiles and spread for each region.',
    },
  },
  {
    kind: 'density',
    label: 'Density Curve (KDE)',
    category: 'distribution',
    icon: 'ssid_chart',
    summary: 'Smooth Gaussian kernel density estimate revealing continuous probability peaks without bin-width artifacts.',
    whenToUse: 'Comparing smooth distribution shapes and multi-modal peaks across 1–3 cohorts.',
    avoidWhen: 'Sample size is tiny (<5 rows) where kernel smoothing implies false precision.',
    sqlShapeHint: 'numeric_metric (or series_group, numeric_metric)',
    sampleWidget: {
      title: 'Net Dollar Retention Density by Tier',
      subtitle: 'Smooth Gaussian KDE distribution across plans',
      kind: 'density',
      sql: `SELECT plan, net_dollar_retention_pct FROM monthly_revenue`,
      seriesField: 'plan',
      yFields: ['net_dollar_retention_pct'],
      format: 'percent',
      colSpan: 6,
      explanation: 'Estimates continuous probability density of NDR % across Enterprise, Pro, and Starter cohorts.',
    },
  },
  {
    kind: 'violin',
    label: 'Violin Plot',
    category: 'distribution',
    icon: 'analytics',
    summary: 'Hybrid mirrored kernel density silhouette enclosing an inner median & quartile box plot.',
    whenToUse: 'Seeing both summary quartiles AND full multi-modal probability shape side-by-side across groups.',
    avoidWhen: 'Non-technical audiences unfamiliar with mirrored density shapes may prefer a simpler Box Plot or Histogram.',
    sqlShapeHint: 'group_category, raw_numeric_metric',
    sampleWidget: {
      title: 'Order Revenue Violin by Category',
      subtitle: 'Mirrored KDE density + inner IQR median box',
      kind: 'violin',
      sql: `SELECT category, net_revenue_usd FROM daily_orders`,
      xField: 'category',
      yFields: ['net_revenue_usd'],
      format: 'currency_usd',
      colSpan: 6,
      explanation: 'Combines mirrored KDE curves with inner quartile markers per e-commerce category.',
    },
  },

  // =========================================================================
  // 4. RELATIONAL (6)
  // =========================================================================
  {
    kind: 'scatter',
    label: 'Scatter Plot',
    category: 'relational',
    icon: 'scatter_plot',
    summary: 'Two-dimensional Cartesian cloud revealing linear/non-linear correlations, clusters, and outliers.',
    whenToUse: 'Testing relationships between two numeric variables (e.g. seats vs ARR, usage score vs retention) with an optional OLS trendline.',
    avoidWhen: 'Thousands of overlapping points without translucency.',
    sqlShapeHint: 'label_or_x, numeric_x, numeric_y [, series_group]',
    sampleWidget: {
      title: 'Provisioned Seats vs Enterprise ARR',
      subtitle: 'Account correlation with linear regression trendline',
      kind: 'scatter',
      sql: `SELECT account_name, seats, arr_usd, region FROM enterprise_accounts`,
      xField: 'seats',
      yFields: ['arr_usd'],
      seriesField: 'region',
      format: 'currency_usd',
      colSpan: 6,
      chartConfig: { showTrendline: true, xAxisTitle: 'Provisioned Seats', yAxisTitle: 'ARR ($USD)' },
      explanation: 'Plots active seat count against ARR per enterprise account with an OLS regression line.',
    },
  },
  {
    kind: 'bubble',
    label: 'Bubble Chart',
    category: 'relational',
    icon: 'bubble_chart',
    summary: 'Three-variable relational plot encoding X position, Y position, area-proportional bubble size, and optional category hue.',
    whenToUse: 'Comparing entities across three quantitative dimensions (e.g. Win Probability × Deal Size × Weighted Value).',
    avoidWhen: 'Encoding negative values in bubble size or using opaque fills that hide smaller bubbles.',
    sqlShapeHint: 'entity_label, x_metric, y_metric, size_metric [, series_group]',
    sampleWidget: {
      title: 'CRM Pipeline: Probability × Deal Size × Weighted Value',
      subtitle: 'Area-scaled bubbles colored by region',
      kind: 'bubble',
      sql: `SELECT company, probability_pct, amount_usd, weighted_usd, region FROM deals_pipeline WHERE probability_pct > 0`,
      xField: 'probability_pct',
      yFields: ['amount_usd'],
      sizeField: 'weighted_usd',
      seriesField: 'region',
      format: 'currency_usd',
      colSpan: 6,
      chartConfig: { fillOpacity: 0.68, xAxisTitle: 'Win Probability (%)', yAxisTitle: 'Deal Amount ($)' },
      explanation: 'Maps win probability (X), contract value (Y), and weighted pipeline value (bubble area).',
    },
  },
  {
    kind: 'heatmap',
    label: 'Heatmap Matrix',
    category: 'relational',
    icon: 'grid_view',
    summary: 'Color-encoded 2D matrix (X × Y cells) spotting high/low intensity intersections at a glance.',
    whenToUse: 'Cross-tabulating two categorical/temporal axes (e.g. Region × Quarter or Category × Channel) by color intensity.',
    avoidWhen: 'Exact 4-digit precision comparison matters more than pattern recognition (enable cell data labels).',
    sqlShapeHint: 'x_category, y_category (seriesField), numeric_metric',
    sampleWidget: {
      title: 'Revenue Intensity: Category × Channel',
      subtitle: '2D color-encoded cross-tab matrix',
      kind: 'heatmap',
      sql: `SELECT channel, category, SUM(net_revenue_usd) AS net_revenue_usd FROM daily_orders GROUP BY channel, category`,
      xField: 'channel',
      seriesField: 'category',
      yFields: ['net_revenue_usd'],
      format: 'currency_usd',
      colSpan: 6,
      chartConfig: { showDataLabels: true },
      explanation: 'Cross-tabulates acquisition channel by product category net revenue.',
    },
  },
  {
    kind: 'parallel_coordinates',
    label: 'Parallel Coordinates',
    category: 'relational',
    icon: 'ssid_chart',
    summary: 'Multi-axis vertical scales connected by polylines to compare entities across 3–7 heterogeneous metrics simultaneously.',
    whenToUse: 'Profiling accounts, cloud services, or models across disparate units (ARR, seats, health score, risk).',
    avoidWhen: 'More than 30–40 ungrouped polylines create visual clutter.',
    sqlShapeHint: 'entity_label, metric_1, metric_2, metric_3 [, metric_4...]',
    sampleWidget: {
      title: 'Cloud Service Multi-Metric Telemetry Profile',
      subtitle: 'Normalized parallel axes: Spend · Requests · P95 Latency · Error %',
      kind: 'parallel_coordinates',
      sql: `SELECT service, ROUND(AVG(cost_usd), 0) AS cost_usd, ROUND(AVG(requests_millions), 1) AS req_m, ROUND(AVG(p95_latency_ms), 0) AS p95_ms, ROUND(AVG(error_rate_pct), 2) AS err_pct FROM service_spend WHERE environment = 'production' GROUP BY service`,
      xField: 'service',
      yFields: ['cost_usd', 'req_m', 'p95_ms', 'err_pct'],
      colSpan: 8,
      explanation: 'Profiles each production service across cost, traffic, P95 latency, and error rate.',
    },
  },
  {
    kind: 'chord',
    label: 'Chord Diagram',
    category: 'relational',
    icon: 'donut_large',
    summary: 'Circular node arcs linked by weighted Bezier ribbons showing bilateral or cross-group flow magnitudes.',
    whenToUse: 'Visualizing inter-regional traffic, cross-channel exchanges, or bilateral volume matrices.',
    avoidWhen: 'More than 12 outer nodes create dense crossing ribbons.',
    sqlShapeHint: 'source_node, target_node, weight_value',
    sampleWidget: {
      title: 'Inter-Regional Network Traffic Ribbons',
      subtitle: 'Weighted circular chord flows (Gbps)',
      kind: 'chord',
      sql: `SELECT origin_region, dest_region, SUM(volume_gbps) AS volume_gbps FROM global_flows GROUP BY origin_region, dest_region`,
      xField: 'origin_region',
      seriesField: 'dest_region',
      yFields: ['volume_gbps'],
      unit: 'Gbps',
      colSpan: 6,
      explanation: 'Connects origin and destination regions with ribbons proportional to Gbps bandwidth.',
    },
  },
  {
    kind: 'network_chart',
    label: 'Network Graph',
    category: 'relational',
    icon: 'hub',
    summary: 'Node-and-edge topology graph sizing hubs by degree/weight and connecting related entities.',
    whenToUse: 'Exploring hub-and-spoke topologies, service dependencies, account-rep clusters, or city corridors.',
    avoidWhen: 'Dense hairball graphs (>60 edges) without filtering to top connections.',
    sqlShapeHint: 'source_node, target_node [, edge_weight]',
    sampleWidget: {
      title: 'Global Hub Topology & Corridor Bandwidth',
      subtitle: 'Force-balanced node-link network',
      kind: 'network_chart',
      sql: `SELECT origin_city, dest_city, volume_gbps FROM global_flows`,
      xField: 'origin_city',
      seriesField: 'dest_city',
      yFields: ['volume_gbps'],
      unit: 'Gbps',
      colSpan: 6,
      explanation: 'Renders global city hubs and weighted backbone links.',
    },
  },

  // =========================================================================
  // 5. HIERARCHICAL (5)
  // =========================================================================
  {
    kind: 'treemap',
    label: 'Treemap',
    category: 'hierarchical',
    icon: 'auto_awesome_mosaic',
    summary: 'Space-filling squarified nested rectangles encoding hierarchical group membership and proportional size.',
    whenToUse: 'Comparing part-to-whole proportions across dozens of leaf items grouped by department, region, or tier.',
    avoidWhen: 'Values span many orders of magnitude (tiny leaves become 1px slivers) or include negative numbers.',
    sqlShapeHint: 'leaf_label [, group_or_parent], positive_metric',
    sampleWidget: {
      title: 'Enterprise ARR Portfolio Treemap',
      subtitle: 'Squarified account rectangles colored by region',
      kind: 'treemap',
      sql: `SELECT account_name, region, arr_usd FROM enterprise_accounts ORDER BY arr_usd DESC`,
      xField: 'account_name',
      seriesField: 'region',
      yFields: ['arr_usd'],
      format: 'currency_usd',
      colSpan: 6,
      explanation: 'Sizes each customer rectangle proportionally to ARR and colors by region.',
    },
  },
  {
    kind: 'sunburst',
    label: 'Sunburst Chart',
    category: 'hierarchical',
    icon: 'donut_large',
    summary: 'Concentric radial rings expanding outward from root to parent categories to leaf segments.',
    whenToUse: 'Showing multi-level hierarchical rollups (e.g. Region → Plan → MRR or Department → Team → Budget).',
    avoidWhen: 'Deep trees (>4 rings) produce narrow outer arc labels.',
    sqlShapeHint: 'parent_or_ring1, child_or_ring2, positive_metric',
    sampleWidget: {
      title: 'Regional & Tier MRR Sunburst',
      subtitle: 'Inner ring: Region · Outer ring: Pricing Tier',
      kind: 'sunburst',
      sql: `SELECT plan, region, SUM(mrr_usd) AS mrr_usd FROM monthly_revenue WHERE month = '2026-10' GROUP BY region, plan`,
      xField: 'plan',
      parentField: 'region',
      yFields: ['mrr_usd'],
      format: 'currency_usd',
      colSpan: 6,
      explanation: 'Rolls up pricing tier MRR (outer ring) into regional totals (inner ring).',
    },
  },
  {
    kind: 'org_chart',
    label: 'Org / Hierarchy Tree',
    category: 'hierarchical',
    icon: 'account_tree',
    summary: 'Top-down hierarchical reporting tree with orthogonal connectors, role cards, and headcount/budget badges.',
    whenToUse: 'Company org structures, cost-center rollups, taxonomy trees, or parent-child ownership.',
    avoidWhen: 'Very wide flat trees (>20 direct reports on one level) without filtering by department.',
    sqlShapeHint: 'node_id, label, parent_id [, metric]',
    sampleWidget: {
      title: 'Executive & Engineering Org Structure',
      subtitle: 'Reporting tree with team headcount badges',
      kind: 'org_chart',
      sql: `SELECT node_id, role_title, parent_id, headcount, department FROM org_directory`,
      xField: 'role_title',
      parentField: 'parent_id',
      yFields: ['headcount'],
      seriesField: 'department',
      unit: 'ppl',
      colSpan: 12,
      explanation: 'Renders the leadership reporting hierarchy from CEO through VP and Director teams.',
    },
  },
  {
    kind: 'circle_packing',
    label: 'Circle Packing',
    category: 'hierarchical',
    icon: 'bubble_chart',
    summary: 'Tangent nested proportional circles grouping leaf bubbles inside enclosing category clusters.',
    whenToUse: 'Visually engaging hierarchical overview of budgets, headcount, or account portfolios.',
    avoidWhen: 'Space efficiency or razor-sharp size comparison is paramount (a Treemap or Bar chart is tighter).',
    sqlShapeHint: 'leaf_label, group_category, positive_metric',
    sampleWidget: {
      title: 'Department Budget Circle Packing',
      subtitle: 'Clustered proportional circles by division',
      kind: 'circle_packing',
      sql: `SELECT role_title, department, budget_usd FROM org_directory WHERE parent_id IS NOT NULL`,
      xField: 'role_title',
      seriesField: 'department',
      yFields: ['budget_usd'],
      format: 'currency_usd',
      colSpan: 6,
      explanation: 'Packs team annual budgets inside division clusters.',
    },
  },
  {
    kind: 'parallel_sets',
    label: 'Parallel Sets (Alluvial)',
    category: 'hierarchical',
    icon: 'alt_route',
    summary: 'Multi-stage categorical ribbons splitting and merging proportional widths across discrete dimensions.',
    whenToUse: 'Tracing how categorical cohorts flow across dimensions (e.g. Region → Plan → Churn Risk).',
    avoidWhen: 'Dimensions have >10 categories each, creating dozens of thin crossing ribbons.',
    sqlShapeHint: 'dim_1, dim_2 [, dim_3], count_or_metric',
    sampleWidget: {
      title: 'Account Cohort Flow: Region → Plan → Churn Risk',
      subtitle: 'Proportional categorical alluvial ribbons',
      kind: 'parallel_sets',
      sql: `SELECT region, plan, churn_risk, SUM(arr_usd) AS arr_usd FROM enterprise_accounts GROUP BY region, plan, churn_risk`,
      xField: 'region',
      seriesField: 'churn_risk',
      yFields: ['arr_usd'],
      format: 'currency_usd',
      colSpan: 8,
      explanation: 'Traces how enterprise ARR flows from region through pricing plan to renewal risk tier.',
    },
  },

  // =========================================================================
  // 6. GEOSPATIAL (6)
  // =========================================================================
  {
    kind: 'choropleth_map',
    label: 'Choropleth Map',
    category: 'geospatial',
    icon: 'map',
    summary: 'Shaded geographic regions/continents colored along a sequential intensity scale by metric value.',
    whenToUse: 'Comparing regional rates, revenue totals, or adoption intensity across macro territories.',
    avoidWhen: 'Raw counts correlate purely with land area rather than normalized intensity — pair with region callouts.',
    sqlShapeHint: 'region_or_country_name, numeric_metric',
    sampleWidget: {
      title: 'Global MRR Choropleth by Region',
      subtitle: 'Shaded regional territories by October 2026 MRR',
      kind: 'choropleth_map',
      sql: `SELECT region, SUM(mrr_usd) AS mrr_usd FROM monthly_revenue WHERE month = '2026-10' GROUP BY region`,
      xField: 'region',
      yFields: ['mrr_usd'],
      format: 'currency_usd',
      colSpan: 6,
      chartConfig: { showMapLabels: true, showMapGraticule: true },
      explanation: 'Shades North America, EMEA, APAC, and LATAM territories by recurring revenue.',
    },
  },
  {
    kind: 'dot_map',
    label: 'Dot Distribution Map',
    category: 'geospatial',
    icon: 'public',
    summary: 'Crisp geographic pins plotted at exact latitude/longitude (or resolved city/region hubs) on a world basemap.',
    whenToUse: 'Showing physical presence, data center POPs, customer headquarters, or event locations.',
    avoidWhen: 'Encoding large magnitude differences — use a Bubble Map when marker size should scale with value.',
    sqlShapeHint: 'location_label [, lat, lon], metric',
    sampleWidget: {
      title: 'Global Edge POP Locations',
      subtitle: 'Active origin & destination city hubs',
      kind: 'dot_map',
      sql: `SELECT origin_city, origin_lat, origin_lon, SUM(volume_gbps) AS volume_gbps FROM global_flows GROUP BY origin_city, origin_lat, origin_lon`,
      xField: 'origin_city',
      latField: 'origin_lat',
      lonField: 'origin_lon',
      yFields: ['volume_gbps'],
      unit: 'Gbps',
      colSpan: 6,
      explanation: 'Plots active origin network hubs at their geographic coordinates.',
    },
  },
  {
    kind: 'geo_heatmap',
    label: 'Geographic Heatmap',
    category: 'geospatial',
    icon: 'public',
    summary: 'Glowing thermal radial gradients over a world basemap spotlighting spatial concentration and revenue hotspots.',
    whenToUse: 'Highlighting geographic demand density, traffic concentration, or incident hotspots.',
    avoidWhen: 'Exact jurisdictional boundaries matter more than smooth spatial concentration (use Choropleth).',
    sqlShapeHint: 'location_label [, lat, lon], intensity_metric',
    sampleWidget: {
      title: 'Global Corridor Revenue Hotspots',
      subtitle: 'Thermal geo-density glow by hub ARR',
      kind: 'geo_heatmap',
      sql: `SELECT origin_city, origin_lat, origin_lon, SUM(revenue_usd) AS revenue_usd FROM global_flows GROUP BY origin_city, origin_lat, origin_lon`,
      xField: 'origin_city',
      latField: 'origin_lat',
      lonField: 'origin_lon',
      yFields: ['revenue_usd'],
      format: 'currency_usd',
      colSpan: 6,
      explanation: 'Renders thermal hotspot intensity weighted by attributed hub ARR.',
    },
  },
  {
    kind: 'bubble_map',
    label: 'Bubble Map',
    category: 'geospatial',
    icon: 'public',
    summary: 'Area-scaled proportional circles anchored to geographic coordinates over a clean vector world map.',
    whenToUse: 'Comparing quantitative hub magnitudes across cities/countries without land-area bias.',
    avoidWhen: 'Tightly clustered cities overlap heavily — lower fillOpacity or scope the map to a region.',
    sqlShapeHint: 'location_label [, lat, lon], size_metric',
    sampleWidget: {
      title: 'Hub Bandwidth Capacity Bubble Map',
      subtitle: 'Proportional geo-circles scaled by Gbps throughput',
      kind: 'bubble_map',
      sql: `SELECT dest_city, dest_lat, dest_lon, SUM(volume_gbps) AS volume_gbps FROM global_flows GROUP BY dest_city, dest_lat, dest_lon`,
      xField: 'dest_city',
      latField: 'dest_lat',
      lonField: 'dest_lon',
      yFields: ['volume_gbps'],
      unit: 'Gbps',
      colSpan: 6,
      explanation: 'Scales destination hub circles proportionally to inbound Gbps volume.',
    },
  },
  {
    kind: 'flow_map',
    label: 'Flow Map',
    category: 'geospatial',
    icon: 'alt_route',
    summary: 'Directional curved great-circle arcs whose stroke widths encode movement volume between origin and destination hubs.',
    whenToUse: 'Visualizing cross-border trade, logistics shipments, migration, or data-center replication volume.',
    avoidWhen: 'Dozens of all-to-all routes cross over one another — limit to top corridors.',
    sqlShapeHint: 'origin_name, origin_lat, origin_lon, dest_name, dest_lat, dest_lon, flow_metric',
    sampleWidget: {
      title: 'Cross-Continental Traffic Flow Map',
      subtitle: 'Weighted directional arcs by Gbps throughput',
      kind: 'flow_map',
      sql: `SELECT origin_city, origin_lat, origin_lon, dest_city, dest_lat, dest_lon, volume_gbps FROM global_flows ORDER BY volume_gbps DESC`,
      xField: 'origin_city',
      latField: 'origin_lat',
      lonField: 'origin_lon',
      destLatField: 'dest_lat',
      destLonField: 'dest_lon',
      yFields: ['volume_gbps'],
      unit: 'Gbps',
      colSpan: 8,
      explanation: 'Draws directional curved arrows from origin POPs to destination POPs weighted by Gbps.',
    },
  },
  {
    kind: 'connection_map',
    label: 'Connection Map',
    category: 'geospatial',
    icon: 'lan',
    summary: 'Clean geodesic hub-to-hub link map highlighting spatial connectivity, peering routes, and RTT links.',
    whenToUse: 'Showing airline routes, fiber peering meshes, supply links, or multi-region replication topology.',
    avoidWhen: 'Magnitude differences between routes are the primary story (use Flow Map for weighted widths).',
    sqlShapeHint: 'origin_name, origin_lat, origin_lon, dest_name, dest_lat, dest_lon [, metric]',
    sampleWidget: {
      title: 'Global Backbone Peering Mesh',
      subtitle: 'Point-to-point hub connectivity & RTT latency',
      kind: 'connection_map',
      sql: `SELECT origin_city, origin_lat, origin_lon, dest_city, dest_lat, dest_lon, latency_ms FROM global_flows`,
      xField: 'origin_city',
      latField: 'origin_lat',
      lonField: 'origin_lon',
      destLatField: 'dest_lat',
      destLonField: 'dest_lon',
      yFields: ['latency_ms'],
      format: 'ms',
      colSpan: 6,
      explanation: 'Maps active point-to-point peering links and round-trip latency across global hubs.',
    },
  },

  // =========================================================================
  // 7. PROPORTIONAL & GOAL TRACKING (6)
  // =========================================================================
  {
    kind: 'kpi',
    label: 'KPI Headline Card',
    category: 'proportional',
    icon: 'payments',
    summary: 'High-impact executive figure with formatted units, comparison delta pill, and 1-click SQL lineage audit.',
    whenToUse: 'Anchoring the top row of a dashboard with 2–4 North Star numbers.',
    avoidWhen: 'Historical trajectory or distribution shape is needed — pair KPI cards with Line/Bullet charts below.',
    sqlShapeHint: '1 row: primary_metric [, optional delta_pct]',
    sampleWidget: {
      title: 'October Net Dollar Retention',
      subtitle: 'Cohort-weighted expansion health',
      kind: 'kpi',
      sql: `SELECT ROUND(AVG(net_dollar_retention_pct), 1) AS ndr_pct, ROUND(AVG(net_dollar_retention_pct) - 100, 1) AS expansion_pts FROM monthly_revenue WHERE month = '2026-10'`,
      format: 'percent',
      colSpan: 3,
      color: 'teal',
      explanation: 'Computes average October 2026 NDR % and net expansion points above 100%.',
    },
  },
  {
    kind: 'proportional_area',
    label: 'Proportional Area Chart',
    category: 'proportional',
    icon: 'bubble_chart',
    summary: 'Side-by-side or concentric geometric shapes scaled strictly by mathematical area (πr²) for magnitude shock-value.',
    whenToUse: 'Dramatizing order-of-magnitude differences between 2–8 totals.',
    avoidWhen: 'Fine 2–3% differences need to be read visually (human eyes judge linear bar length better than area).',
    sqlShapeHint: 'category_label, positive_value',
    sampleWidget: {
      title: 'ARR Scale by Pricing Plan',
      subtitle: 'True mathematical area-scaled circles',
      kind: 'proportional_area',
      sql: `SELECT plan, SUM(mrr_usd) * 12 AS annualized_arr FROM monthly_revenue WHERE month = '2026-10' GROUP BY plan ORDER BY annualized_arr DESC`,
      format: 'currency_usd',
      colSpan: 6,
      explanation: 'Compares annualized revenue scale across Enterprise, Pro, and Starter plans via true circle area.',
    },
  },
  {
    kind: 'square_area',
    label: 'Waffle / Square Area (10×10)',
    category: 'proportional',
    icon: 'grid_view',
    summary: '100-cell unit waffle grid where each square represents 1% of the whole — intuitive, distortion-free part-to-whole.',
    whenToUse: 'Communicating completion rates, risk mix, or category shares in human-countable 1% tiles.',
    avoidWhen: 'More than 5–6 categories or sub-0.5% fractions that round to zero cells.',
    sqlShapeHint: 'category_label, positive_value',
    sampleWidget: {
      title: 'Enterprise Portfolio by Churn Risk (10×10 Waffle)',
      subtitle: 'Each square = 1% of tracked ARR',
      kind: 'square_area',
      sql: `SELECT churn_risk, SUM(arr_usd) AS arr_usd FROM enterprise_accounts GROUP BY churn_risk ORDER BY arr_usd DESC`,
      xField: 'churn_risk',
      yFields: ['arr_usd'],
      format: 'currency_usd',
      colSpan: 6,
      explanation: 'Allocates 100 percentage tiles across Low, Medium, and High churn-risk ARR.',
    },
  },
  {
    kind: 'gauge',
    label: 'Radial & Multi-Value Gauge',
    category: 'proportional',
    icon: 'speed',
    summary: 'Radial dial (single row) or concentric multi-ring activity arcs (multiple rows) tracking progress toward target.',
    whenToUse: 'Quota attainment, SLA uptime, NDR health, or multi-ring workstream completion.',
    avoidWhen: 'Displaying many gauges side-by-side — Stephen Few Bullet Charts pack more context into less space.',
    sqlShapeHint: '1 row (metric [, target]) for single dial, or N rows (label, metric) for Multi-Value Gauge rings',
    sampleWidget: {
      title: 'Workstream Completion Multi-Gauge',
      subtitle: 'Concentric progress rings by engineering stream',
      kind: 'gauge',
      sql: `SELECT workstream, ROUND(AVG(progress_pct), 0) AS progress_pct FROM project_roadmap GROUP BY workstream ORDER BY progress_pct DESC LIMIT 4`,
      xField: 'workstream',
      yFields: ['progress_pct'],
      format: 'percent',
      colSpan: 4,
      chartConfig: { targetValue: 100 },
      explanation: 'Displays concentric radial completion arcs across top delivery workstreams.',
    },
  },
  {
    kind: 'bullet',
    label: 'Bullet Chart',
    category: 'proportional',
    icon: 'tune',
    summary: 'Stephen Few space-efficient goal bar layering qualitative background bands (poor/ok/good), actual bar, and target marker.',
    whenToUse: 'Tracking actual performance vs quota/target across multiple regions, reps, or KPIs.',
    avoidWhen: 'No meaningful benchmark or target exists (use a standard Horizontal Bar instead).',
    sqlShapeHint: 'label, actual_value [, target_comparison_col]',
    sampleWidget: {
      title: 'Regional October MRR vs $180K Quota',
      subtitle: 'Actual bar + qualitative bands + target marker',
      kind: 'bullet',
      sql: `SELECT region, SUM(mrr_usd) AS mrr_usd, 180000 AS quota_usd FROM monthly_revenue WHERE month = '2026-10' GROUP BY region ORDER BY mrr_usd DESC`,
      xField: 'region',
      yFields: ['mrr_usd'],
      comparisonField: 'quota_usd',
      format: 'currency_usd',
      colSpan: 6,
      chartConfig: { targetValue: 180000 },
      explanation: 'Compares each region’s October MRR against the $180K regional target.',
    },
  },
  {
    kind: 'funnel',
    label: 'Funnel Chart',
    category: 'proportional',
    icon: 'filter_list',
    summary: 'Centered progressive trapezoid/bar stages quantifying conversion rates and drop-off bottlenecks.',
    whenToUse: 'Storefront checkout funnels, user onboarding steps, or sequential CRM pipeline stages.',
    avoidWhen: 'Stages are unordered or non-sequential (use a Bar chart when items can occur in any order).',
    sqlShapeHint: 'ordered_stage_label, stage_volume',
    sampleWidget: {
      title: 'Storefront Checkout Conversion Funnel',
      subtitle: 'Top-of-funnel retention % at each step',
      kind: 'funnel',
      sql: `SELECT stage, SUM(users) AS total_users FROM conversion_funnel GROUP BY stage_order, stage ORDER BY stage_order ASC`,
      format: 'number',
      colSpan: 6,
      explanation: 'Tracks total users progressing from Landing Session through Order Completed.',
    },
  },

  // =========================================================================
  // 8. ADVANCED & SPECIALIZED (6)
  // =========================================================================
  {
    kind: 'sankey',
    label: 'Sankey Diagram',
    category: 'advanced',
    icon: 'call_split',
    summary: 'Multi-stage directed flow diagram where conserved ribbon widths equal exact quantity transferred.',
    whenToUse: 'Energy/cost allocation, revenue source-to-tier flows, or traffic routing across stages.',
    avoidWhen: 'Graph contains feedback cycles or tiny <1% branches that become hairline threads.',
    sqlShapeHint: 'source_stage, target_stage, flow_quantity',
    sampleWidget: {
      title: 'Revenue Flow: Region → Pricing Tier',
      subtitle: 'Width-proportional MRR Sankey ribbons',
      kind: 'sankey',
      sql: `SELECT region, plan, SUM(mrr_usd) AS mrr_usd FROM monthly_revenue WHERE month = '2026-10' GROUP BY region, plan ORDER BY mrr_usd DESC`,
      xField: 'region',
      seriesField: 'plan',
      yFields: ['mrr_usd'],
      format: 'currency_usd',
      colSpan: 8,
      explanation: 'Maps how October 2026 recurring revenue flows from geographic regions into pricing tiers.',
    },
  },
  {
    kind: 'spiral_plot',
    label: 'Spiral Plot',
    category: 'advanced',
    icon: 'refresh',
    summary: 'Archimedean spiral timeline wrapping sequential periods outward from the origin to highlight cyclical seasonality.',
    whenToUse: 'Spotting periodic spikes, holiday surges, or long sequential cycles in a compact square footprint.',
    avoidWhen: 'Precise point-to-point slope reading is needed (use a standard Line chart).',
    sqlShapeHint: 'ordered_period_label, numeric_metric',
    sampleWidget: {
      title: '12-Month E-Commerce Seasonality Spiral',
      subtitle: 'Radial bar amplitude along an Archimedean time spiral',
      kind: 'spiral_plot',
      sql: `SELECT month, SUM(orders) AS orders FROM daily_orders GROUP BY month ORDER BY month ASC`,
      xField: 'month',
      yFields: ['orders'],
      format: 'number',
      colSpan: 6,
      explanation: 'Plots monthly order volume outward along a continuous 12-month spiral.',
    },
  },
  {
    kind: 'arc_diagram',
    label: 'Arc Diagram',
    category: 'advanced',
    icon: 'commit' in ({} as Record<string, never>) ? 'hub' : 'polyline',
    summary: 'One-dimensional horizontal node axis linked by semicircular overhead arcs weighted by connection strength.',
    whenToUse: 'Highlighting co-occurrence, sequential handoffs, or hub links along an ordered baseline without 2D node crossings.',
    avoidWhen: 'Spatial clustering matters more than linear node ordering (use Network Graph).',
    sqlShapeHint: 'source_node, target_node, link_weight',
    sampleWidget: {
      title: 'Global Hub Corridor Arc Diagram',
      subtitle: 'Linear hub axis with bandwidth-weighted semicircular arcs',
      kind: 'arc_diagram',
      sql: `SELECT origin_city, dest_city, volume_gbps FROM global_flows ORDER BY volume_gbps DESC`,
      xField: 'origin_city',
      seriesField: 'dest_city',
      yFields: ['volume_gbps'],
      unit: 'Gbps',
      colSpan: 8,
      explanation: 'Connects city hubs along a horizontal baseline with semicircular bandwidth arcs.',
    },
  },
  {
    kind: 'trellis',
    label: 'Trellis (Small Multiples)',
    category: 'advanced',
    icon: 'grid_view',
    summary: 'Synchronized grid of mini charts—one facet per category—sharing a common scale to eliminate spaghetti overlap.',
    whenToUse: 'Comparing 3–12 series cleanly across time or categories without overlapping lines.',
    avoidWhen: 'Exact vertical superposition of two curves is required (use a 2-series Line chart).',
    sqlShapeHint: 'x_col, facet_series_col, metric_col',
    sampleWidget: {
      title: 'Regional MRR Small Multiples (Trellis)',
      subtitle: 'Synchronized Y-scale across all 4 regions — zero line overlap',
      kind: 'trellis',
      sql: `SELECT month, region, SUM(mrr_usd) AS mrr_usd FROM monthly_revenue GROUP BY month, region ORDER BY month`,
      xField: 'month',
      seriesField: 'region',
      yFields: ['mrr_usd'],
      format: 'currency_usd',
      colSpan: 12,
      chartConfig: { trellisColumns: 4, trellisSubKind: 'area' },
      explanation: 'Facets 12-month MRR trajectories into synchronized regional mini-charts.',
    },
  },
  {
    kind: 'waterfall',
    label: 'Waterfall Bridge Chart',
    category: 'advanced',
    icon: 'waterfall_chart',
    summary: 'Floating cumulative bridge bars showing positive additions, negative deductions, and ending net total.',
    whenToUse: 'MRR movement bridges (Starting + New + Expansion − Churn = Ending), P&L bridges, or headcount walks.',
    avoidWhen: 'Categories are independent rather than additive components of a net total.',
    sqlShapeHint: 'step_label, signed_delta (ending total auto-rendered or marked)',
    sampleWidget: {
      title: 'October MRR Movement Bridge',
      subtitle: 'Positive additions vs churn contraction to net change',
      kind: 'waterfall',
      sql: `SELECT 'New Logo MRR' AS step, SUM(new_mrr_usd) AS amount FROM monthly_revenue WHERE month = '2026-10'
UNION ALL
SELECT 'Expansion MRR', SUM(expansion_mrr_usd) FROM monthly_revenue WHERE month = '2026-10'
UNION ALL
SELECT 'Churned MRR', -SUM(churned_mrr_usd) FROM monthly_revenue WHERE month = '2026-10'`,
      xField: 'step',
      yFields: ['amount'],
      format: 'currency_usd',
      colSpan: 6,
      chartConfig: { showDataLabels: true },
      explanation: 'Bridges October New Logo MRR, Expansion MRR, and Churned MRR into net recurring additions.',
    },
  },
  {
    kind: 'table',
    label: 'Sortable SQL Data Table',
    category: 'advanced',
    icon: 'table_chart',
    summary: 'Container-responsive detail table with keyboard-accessible column sorting and 1-click cell SQL lineage.',
    whenToUse: 'Lookup of exact multi-column records, renewal dates, owners, and raw row verification at the bottom of a dashboard.',
    avoidWhen: 'Quick visual trend or shape recognition is the primary goal — pair above with summary charts.',
    sqlShapeHint: 'Any 2..12 SELECT columns',
    sampleWidget: {
      title: 'Enterprise Accounts & Renewal Health',
      subtitle: 'Click column headers to sort · Click any value to inspect SQL',
      kind: 'table',
      sql: `SELECT account_name, region, plan, arr_usd, seats, usage_score, renewal_date, churn_risk FROM enterprise_accounts ORDER BY arr_usd DESC`,
      format: 'currency_usd',
      colSpan: 12,
      explanation: 'Lists enterprise customer accounts with ARR, seat deployment, health score, and renewal risk.',
    },
  },
] as const;

export const CHART_CATALOG_BY_KIND: Record<WidgetKind, ChartCatalogEntry> = Object.fromEntries(
  CHART_CATALOG.map((entry) => [entry.kind, entry]),
) as Record<WidgetKind, ChartCatalogEntry>;

export function getChartMeta(kind: WidgetKind): ChartCatalogEntry {
  return CHART_CATALOG_BY_KIND[kind] ?? CHART_CATALOG[0];
}

function looksTemporalLabel(s: string): boolean {
  return /^(\d{4}[-/]\d{1,2}|\d{4}-Q[1-4]|Q[1-4]\b|W\d+\b|\d+\.\s|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i.test(
    s.trim(),
  );
}

/**
 * Evaluates a widget and its live SQL result against Holistics' data storytelling
 * rules, returning concise tips/warnings and 1-click quick fixes.
 */
export function adviseChartStorytelling(
  widget: DashboardWidget,
  result?: QueryExecutionResult,
): ChartStoryAdvice[] {
  const advice: ChartStoryAdvice[] = [];
  const cfg = widget.chartConfig ?? {};
  const rows = result?.rows ?? [];
  const cols = result?.columns ?? [];
  const rowCount = rows.length;

  // 1. Bar / Column non-zero baseline distortion (Holistics Principle #1: Data Integrity)
  const isBarFamily =
    widget.kind === 'bar' ||
    widget.kind === 'column' ||
    widget.kind === 'grouped_bar' ||
    widget.kind === 'horizontal_bar' ||
    widget.kind === 'stacked_bar';
  if (isBarFamily && (cfg.startFromZero === false || (typeof cfg.yMin === 'number' && cfg.yMin > 0))) {
    advice.push({
      id: 'bar_zero_baseline',
      severity: 'warning',
      title: 'Truncated Bar Baseline Distorts Proportions',
      message: 'Bar lengths encode magnitude from zero; starting above 0 exaggerates small differences.',
      quickFix: {
        label: 'Anchor Baseline at 0',
        patch: { chartConfig: { startFromZero: true, yMin: null as unknown as undefined } },
      },
    });
  }

  // 2. Pie / Donut > 6 slices clutter
  if ((widget.kind === 'pie' || widget.kind === 'donut') && rowCount > 6 && !cfg.groupTailAsOther) {
    advice.push({
      id: 'pie_too_many_slices',
      severity: 'warning',
      title: `${rowCount} Slices Harder to Compare by Angle`,
      message: 'Keep Pie/Donut charts to 5–6 slices so viewers can judge shares accurately.',
      quickFix: {
        label: 'Group Top 5 + Other',
        patch: { chartConfig: { limitItems: 5, groupTailAsOther: true, sortBy: 'value_desc' } },
      },
    });
  }

  // 3. Multi-series Line spaghetti vs Direct Labels / Trellis
  if (widget.kind === 'line' && rows.length > 0) {
    const sIdx = widget.seriesField ? cols.indexOf(widget.seriesField) : -1;
    const distinctSeries = sIdx >= 0 ? new Set(rows.map((r) => String(r[sIdx] ?? ''))).size : (widget.yFields?.length ?? 1);
    if (distinctSeries > 4) {
      advice.push({
        id: 'line_spaghetti',
        severity: 'warning',
        title: `${distinctSeries} Overlapping Lines ("Spaghetti Chart")`,
        message: 'More than 4 crossing trajectories make individual series hard to follow.',
        quickFix: {
          label: 'Facet as Trellis Grid',
          patch: { kind: 'trellis', colSpan: 12, chartConfig: { trellisSubKind: 'line' } },
        },
      });
    } else if (distinctSeries >= 2 && !cfg.directLineLabels) {
      advice.push({
        id: 'line_direct_labels',
        severity: 'tip',
        title: 'Add Direct Line Endpoint Labels',
        message: 'Direct labels on multi-series lines save viewers from scanning back and forth to a legend.',
        quickFix: {
          label: 'Enable Direct Labels',
          patch: { chartConfig: { directLineLabels: true } },
        },
      });
    }
  }

  // 4. Long X-axis labels on vertical bars
  if ((widget.kind === 'bar' || widget.kind === 'column') && rowCount >= 4 && cfg.orientation !== 'horizontal') {
    const xIdx = widget.xField ? Math.max(0, cols.indexOf(widget.xField)) : 0;
    const maxLen = rows.slice(0, 12).reduce((m, r) => Math.max(m, String(r[xIdx] ?? '').length), 0);
    if (maxLen >= 15 && !cfg.xTickRotation) {
      advice.push({
        id: 'long_category_labels',
        severity: 'tip',
        title: 'Long Category Labels Truncated Horizontally',
        message: 'Horizontal bars let full category names read naturally left-to-right without tilt or ellipsis.',
        quickFix: {
          label: 'Switch to Horizontal Bar',
          patch: { kind: 'horizontal_bar' },
        },
      });
    }
  }

  // 5. Unsorted categorical bar chart
  if ((widget.kind === 'bar' || widget.kind === 'column' || widget.kind === 'horizontal_bar') && rowCount >= 4 && (!cfg.sortBy || cfg.sortBy === 'none')) {
    const xIdx = widget.xField ? Math.max(0, cols.indexOf(widget.xField)) : 0;
    const yIdx = widget.yFields?.[0] ? Math.max(0, cols.indexOf(widget.yFields[0])) : Math.min(1, cols.length - 1);
    const firstLabel = String(rows[0]?.[xIdx] ?? '');
    if (!looksTemporalLabel(firstLabel)) {
      const nums = rows.map((r) => Number(r[yIdx]) || 0);
      let desc = true;
      let asc = true;
      for (let i = 1; i < nums.length; i++) {
        if (nums[i] > nums[i - 1]) desc = false;
        if (nums[i] < nums[i - 1]) asc = false;
      }
      if (!desc && !asc) {
        advice.push({
          id: 'unsorted_bars',
          severity: 'tip',
          title: 'Sort Bars by Magnitude for Faster Ranking',
          message: 'Ordering non-temporal categories High → Low reveals leaders and laggards immediately.',
          quickFix: {
            label: 'Sort High → Low',
            patch: { chartConfig: { sortBy: 'value_desc' } },
          },
        });
      }
    }
  }

  // 6. Bubble / Scatter overplotting opacity
  if ((widget.kind === 'bubble' || widget.kind === 'scatter') && rowCount >= 8 && (cfg.fillOpacity ?? 1) > 0.82) {
    advice.push({
      id: 'bubble_opacity',
      severity: 'tip',
      title: 'Use Semi-Transparent Fill for Overlapping Marks',
      message: 'Lowering fill opacity to ~65% prevents larger bubbles from hiding co-located points.',
      quickFix: {
        label: 'Set Fill Opacity 65%',
        patch: { chartConfig: { fillOpacity: 0.65 } },
      },
    });
  }

  // 7. Nightingale Rose quadratic area reminder
  if (widget.kind === 'nightingale_rose' && !cfg.showDataLabels) {
    advice.push({
      id: 'rose_area_labels',
      severity: 'tip',
      title: 'Pair Polar Wedges with Direct Values',
      message: 'Nightingale sector area scales with radius²; showing data labels keeps exact magnitudes crystal clear.',
      quickFix: {
        label: 'Show Data Labels',
        patch: { chartConfig: { showDataLabels: true } },
      },
    });
  }

  // 8. Single-row Gauge space tip
  if (widget.kind === 'gauge' && rowCount === 1) {
    advice.push({
      id: 'gauge_to_bullet',
      severity: 'tip',
      title: 'Want More Context in Less Space?',
      message: 'A Stephen Few Bullet Chart shows actual value, target marker, and qualitative bands in a compact bar.',
      quickFix: {
        label: 'Try Bullet Chart',
        patch: { kind: 'bullet' },
      },
    });
  }

  return advice;
}

/**
 * Flagship multi-category showcase dashboard demonstrating all 8 Holistics
 * chart families working live over local SQLite-Wasm datasets.
 */
export const HOLISTICS_SHOWCASE_DASHBOARD: CreateDashboardRequest = {
  title: 'Holistics 8-Family Data Storytelling Showcase',
  subtitle: 'Live SQLite-Wasm gallery across Categorical, Temporal, Distribution, Relational, Hierarchical, Geospatial, Goal & Advanced charts',
  source: 'local',
  filters: [
    {
      id: 'filter_region',
      label: 'Region',
      param: 'region',
      kind: 'select',
      options: ['ALL', 'North America', 'EMEA', 'APAC', 'LATAM'],
      value: 'ALL',
    },
  ],
  widgets: [
    {
      id: 'kpi_oct_mrr',
      title: 'October Recurring Revenue',
      subtitle: 'Headline North Star metric',
      kind: 'kpi',
      sql: `SELECT SUM(mrr_usd) AS mrr_usd, ROUND(AVG(net_dollar_retention_pct) - 100, 1) AS net_expansion_pct FROM monthly_revenue WHERE month = '2026-10' AND (:region = 'ALL' OR region = :region)`,
      format: 'currency_usd',
      colSpan: 3,
      color: 'blue',
      explanation: 'Total October 2026 MRR and net expansion rate.',
    },
    {
      id: 'bullet_regional_quota',
      title: 'Regional MRR vs $180K Target',
      subtitle: 'Proportional & Goal · Bullet Chart',
      kind: 'bullet',
      sql: `SELECT region, SUM(mrr_usd) AS mrr_usd, 180000 AS quota FROM monthly_revenue WHERE month = '2026-10' GROUP BY region ORDER BY mrr_usd DESC`,
      xField: 'region',
      yFields: ['mrr_usd'],
      comparisonField: 'quota',
      format: 'currency_usd',
      colSpan: 5,
      chartConfig: { targetValue: 180000 },
      explanation: 'Stephen Few bullet graph comparing regional MRR against the $180K target.',
    },
    {
      id: 'waffle_risk_mix',
      title: 'ARR Share by Churn Risk',
      subtitle: 'Proportional · 10×10 Waffle Grid',
      kind: 'square_area',
      sql: `SELECT churn_risk, SUM(arr_usd) AS arr_usd FROM enterprise_accounts WHERE (:region = 'ALL' OR region = :region) GROUP BY churn_risk ORDER BY arr_usd DESC`,
      xField: 'churn_risk',
      yFields: ['arr_usd'],
      format: 'currency_usd',
      colSpan: 4,
      explanation: 'Each tile represents 1% of enterprise ARR by churn risk tier.',
    },
    {
      id: 'flow_global_hubs',
      title: 'Global Backbone Traffic Corridors',
      subtitle: 'Geospatial · Weighted Flow Map (Gbps)',
      kind: 'flow_map',
      sql: `SELECT origin_city, origin_lat, origin_lon, dest_city, dest_lat, dest_lon, volume_gbps FROM global_flows WHERE (:region = 'ALL' OR origin_region = :region OR dest_region = :region) ORDER BY volume_gbps DESC`,
      xField: 'origin_city',
      latField: 'origin_lat',
      lonField: 'origin_lon',
      destLatField: 'dest_lat',
      destLonField: 'dest_lon',
      yFields: ['volume_gbps'],
      unit: 'Gbps',
      colSpan: 7,
      explanation: 'Curved directional hub-to-hub traffic corridors scaled by Gbps.',
    },
    {
      id: 'waterfall_mrr_bridge',
      title: 'October MRR Movement Bridge',
      subtitle: 'Advanced · Waterfall Additions vs Churn',
      kind: 'waterfall',
      sql: `SELECT 'New Logo' AS step, SUM(new_mrr_usd) AS delta FROM monthly_revenue WHERE month = '2026-10' AND (:region = 'ALL' OR region = :region)
UNION ALL
SELECT 'Expansion', SUM(expansion_mrr_usd) FROM monthly_revenue WHERE month = '2026-10' AND (:region = 'ALL' OR region = :region)
UNION ALL
SELECT 'Churned', -SUM(churned_mrr_usd) FROM monthly_revenue WHERE month = '2026-10' AND (:region = 'ALL' OR region = :region)`,
      xField: 'step',
      yFields: ['delta'],
      format: 'currency_usd',
      colSpan: 5,
      chartConfig: { showDataLabels: true },
      explanation: 'Cumulative MRR walk from new & expansion additions minus churn.',
    },
    {
      id: 'candlestick_cldx',
      title: 'CLDX Weekly OHLC Volatility',
      subtitle: 'Temporal · Candlestick Chart',
      kind: 'candlestick',
      sql: `SELECT trading_date, open_usd, high_usd, low_usd, close_usd FROM stock_ohlc ORDER BY trading_date ASC`,
      xField: 'trading_date',
      openField: 'open_usd',
      highField: 'high_usd',
      lowField: 'low_usd',
      closeField: 'close_usd',
      format: 'currency_usd',
      colSpan: 6,
      explanation: 'Weekly open, high, low, and close share prices.',
    },
    {
      id: 'violin_orders',
      title: 'Net Revenue Distribution by Category',
      subtitle: 'Distribution · Violin KDE + Inner IQR Box',
      kind: 'violin',
      sql: `SELECT category, net_revenue_usd FROM daily_orders`,
      xField: 'category',
      yFields: ['net_revenue_usd'],
      format: 'currency_usd',
      colSpan: 6,
      explanation: 'Mirrored kernel density estimate with median and IQR markers per product category.',
    },
    {
      id: 'bubble_deals',
      title: 'CRM Pipeline: Win % × Deal Size × Weighted Value',
      subtitle: 'Relational · 3-Variable Bubble + Trendline',
      kind: 'bubble',
      sql: `SELECT company, probability_pct, amount_usd, weighted_usd, region FROM deals_pipeline WHERE probability_pct > 0 AND (:region = 'ALL' OR region = :region)`,
      xField: 'probability_pct',
      yFields: ['amount_usd'],
      sizeField: 'weighted_usd',
      seriesField: 'region',
      format: 'currency_usd',
      colSpan: 6,
      chartConfig: { fillOpacity: 0.68, showTrendline: true, xAxisTitle: 'Win Probability (%)', yAxisTitle: 'Contract Value ($)' },
      explanation: 'Plots win probability, contract value, and weighted USD across active deals.',
    },
    {
      id: 'sankey_rev_flow',
      title: 'MRR Flow: Region → Pricing Plan',
      subtitle: 'Advanced · Multi-Stage Sankey Diagram',
      kind: 'sankey',
      sql: `SELECT region, plan, SUM(mrr_usd) AS mrr_usd FROM monthly_revenue WHERE month = '2026-10' AND (:region = 'ALL' OR region = :region) GROUP BY region, plan ORDER BY mrr_usd DESC`,
      xField: 'region',
      seriesField: 'plan',
      yFields: ['mrr_usd'],
      format: 'currency_usd',
      colSpan: 6,
      explanation: 'Conserves total October MRR across regional inflows and pricing tier outflows.',
    },
    {
      id: 'mekko_market',
      title: 'Regional Market Width × Tier Share',
      subtitle: 'Categorical · Marimekko 2D Matrix',
      kind: 'marimekko',
      sql: `SELECT region, plan, SUM(mrr_usd) AS mrr_usd FROM monthly_revenue WHERE month = '2026-10' GROUP BY region, plan`,
      xField: 'region',
      seriesField: 'plan',
      yFields: ['mrr_usd'],
      format: 'currency_usd',
      colSpan: 6,
      explanation: 'Encodes regional market weight on X width and plan mix on Y height.',
    },
    {
      id: 'sunburst_org_budget',
      title: 'Department & Team Budget Hierarchy',
      subtitle: 'Hierarchical · Concentric Sunburst',
      kind: 'sunburst',
      sql: `SELECT role_title, department, budget_usd FROM org_directory WHERE parent_id IS NOT NULL`,
      xField: 'role_title',
      parentField: 'department',
      yFields: ['budget_usd'],
      format: 'currency_usd',
      colSpan: 6,
      explanation: 'Inner ring shows executive divisions; outer ring shows director-level team budgets.',
    },
    {
      id: 'trellis_region_mrr',
      title: '12-Month Regional Trajectory (Zero Spaghetti)',
      subtitle: 'Advanced · Synchronized Trellis Small Multiples',
      kind: 'trellis',
      sql: `SELECT month, region, SUM(mrr_usd) AS mrr_usd FROM monthly_revenue GROUP BY month, region ORDER BY month`,
      xField: 'month',
      seriesField: 'region',
      yFields: ['mrr_usd'],
      format: 'currency_usd',
      colSpan: 12,
      chartConfig: { trellisColumns: 4, trellisSubKind: 'area' },
      explanation: 'Splits multi-region time-series into synchronized facets for effortless comparison.',
    },
  ],
};
