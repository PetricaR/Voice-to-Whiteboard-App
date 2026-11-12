import { describe, expect, it } from 'vitest';
import { handleToolCall, type ToolContext } from '../src/agent/dispatcher';
import { SYSTEM_INSTRUCTION } from '../src/agent/prompt';
import { chartConfigFields, TOOL_DECLARATIONS } from '../src/agent/tools';
import { executeSqlQuery } from '../src/data/sqlEngine';
import { CHART_CATALOG } from '../src/engine/chartCatalog';
import { reviewDashboardLayout, reviewWidget, type WidgetReview } from '../src/engine/chartInsights';
import {
  buildDashboard,
  describeDashboard,
  normalizeChartConfig,
  WIDGET_KINDS,
  type DashboardWidgetInput,
} from '../src/engine/dashboard';
import { Workspace } from '../src/engine/workspace';

async function review(input: DashboardWidgetInput): Promise<WidgetReview> {
  const built = buildDashboard({ title: 'Test', widgets: [input] });
  const widget = built.dashboard.widgets[0];
  return reviewWidget(widget, await executeSqlQuery(widget.sql));
}

describe('Chart review: what the agent learns about a chart it built', () => {
  it('finds nothing to fix in any chart of the gallery', async () => {
    for (const entry of CHART_CATALOG) {
      const r = await review(entry.sampleWidget);
      expect(r.issues, `${entry.kind}: ${r.issues.join(' | ')}`).toEqual([]);
      expect(r.rows, entry.kind).toBeGreaterThan(0);
    }
  });

  it('reports a failing query, an empty result and a wrong field name', async () => {
    const failing = await review({ title: 'Bad', kind: 'bar', sql: 'SELECT nope FROM monthly_revenue' });
    expect(failing.issues[0]).toMatch(/query fails/i);

    const empty = await review({
      title: 'Empty',
      kind: 'bar',
      sql: `SELECT region, SUM(mrr_usd) AS mrr_usd FROM monthly_revenue WHERE month = '1999-01' GROUP BY region`,
    });
    expect(empty.issues[0]).toMatch(/0 rows/);
    expect(empty.facts).toEqual([]);

    const misnamed = await review({
      title: 'MRR by Region',
      kind: 'bar',
      sql: `SELECT region, SUM(mrr_usd) AS mrr_usd FROM monthly_revenue WHERE month = '2026-10' GROUP BY region`,
      x_field: 'Region',
      y_fields: ['mrr'],
    });
    expect(misnamed.issues.join(' ')).toMatch(/x_field "Region" is not a column/);
    expect(misnamed.issues.join(' ')).toMatch(/y_fields "mrr" is not a column/);
  });

  it('catches a result whose shape does not fit the chart kind', async () => {
    // One row per month and region drawn as a single line
    const unsplit = await review({
      title: 'MRR Trend',
      kind: 'line',
      sql: 'SELECT month, region, SUM(mrr_usd) AS mrr_usd FROM monthly_revenue GROUP BY month, region ORDER BY month',
    });
    expect(unsplit.issues.join(' ')).toMatch(/"month" repeats.*series_field: "region"/);

    const kpiRows = await review({ title: 'MRR', kind: 'kpi', sql: 'SELECT month, SUM(mrr_usd) AS mrr_usd FROM monthly_revenue GROUP BY month' });
    expect(kpiRows.issues.join(' ')).toMatch(/only the first of 12 rows/);

    const oneBar = await review({ title: 'Total', kind: 'bar', sql: `SELECT 'All' AS scope, SUM(mrr_usd) AS mrr_usd FROM monthly_revenue` });
    expect(oneBar.issues.join(' ')).toMatch(/single row.*kpi/);

    const unordered = await review({
      title: 'MRR Trend',
      kind: 'line',
      sql: 'SELECT month, SUM(mrr_usd) AS mrr_usd FROM monthly_revenue GROUP BY month ORDER BY mrr_usd DESC',
    });
    expect(unordered.issues.join(' ')).toMatch(/not in time order.*ORDER BY month ASC/);

    const unorderedCandles = await review({
      title: 'CLDX Price Action',
      kind: 'candlestick',
      sql: 'SELECT trading_date, open_usd, high_usd, low_usd, close_usd FROM stock_ohlc ORDER BY trading_date DESC',
      x_field: 'trading_date',
      open_field: 'open_usd',
      high_field: 'high_usd',
      low_field: 'low_usd',
      close_field: 'close_usd',
    });
    expect(unorderedCandles.issues.join(' ')).toMatch(/not in time order.*ORDER BY trading_date ASC/);
    expect(unorderedCandles.facts).toEqual([]);

    const scatter = await review({ title: 'Seats', kind: 'scatter', sql: 'SELECT account_name, seats FROM enterprise_accounts' });
    expect(scatter.issues.join(' ')).toMatch(/needs 2/);

    const stacked = await review({
      title: 'MRR by Region',
      kind: 'stacked_bar',
      sql: `SELECT region, SUM(mrr_usd) AS mrr_usd FROM monthly_revenue WHERE month = '2026-10' GROUP BY region`,
    });
    expect(stacked.issues.join(' ')).toMatch(/needs several series/);

    const aggregated = await review({
      title: 'ARR Distribution',
      kind: 'histogram',
      sql: 'SELECT region, AVG(arr_usd) AS arr_usd FROM enterprise_accounts GROUP BY region',
      y_fields: ['arr_usd'],
    });
    expect(aggregated.issues.join(' ')).toMatch(/needs raw rows/);
  });

  it('does not call a filtered single row a mistake', async () => {
    const built = buildDashboard({
      title: 'Filtered',
      filters: [{ label: 'Region', param: 'region', options: ['ALL', 'EMEA'], value: 'EMEA' }],
      widgets: [{
        title: 'MRR by Region',
        kind: 'bar',
        sql: `SELECT region, SUM(mrr_usd) AS mrr_usd FROM monthly_revenue WHERE month = '2026-10' AND (:region = 'ALL' OR region = :region) GROUP BY region`,
      }],
    });
    const w = built.dashboard.widgets[0];
    const r = reviewWidget(w, await executeSqlQuery(w.sql, { params: { region: 'EMEA' } }));
    expect(r.rows).toBe(1);
    expect(r.issues).toEqual([]);
  });

  it('advises with a patch the agent can send back unchanged', async () => {
    const trendOfCategories = await review({
      title: 'Spend',
      kind: 'line',
      sql: 'SELECT service, SUM(cost_usd) AS cost_usd FROM service_spend GROUP BY service',
      format: 'currency_usd',
    });
    const patch = trendOfCategories.advice.find((a) => /category, not time/.test(a));
    expect(patch).toMatch(/update_widgets \[\{"id":"spend","kind":"bar","chart_config":\{"sort_by":"value_desc"\}\}\]/);

    const noFormat = await review({ title: 'MRR by Region', kind: 'bar', sql: `SELECT region, SUM(mrr_usd) AS mrr_usd FROM monthly_revenue WHERE month = '2026-10' GROUP BY region ORDER BY mrr_usd DESC` });
    expect(noFormat.advice.join(' ')).toMatch(/"format":"currency_usd"/);

    const bareKpi = await review({ title: 'MRR', kind: 'kpi', format: 'currency_usd', sql: `SELECT SUM(mrr_usd) AS mrr_usd FROM monthly_revenue WHERE month = '2026-10'` });
    expect(bareKpi.advice.join(' ')).toMatch(/comparison_field/);
    // A gauge the user asked for is not talked into a bullet chart
    const gauge = await review({ title: 'NDR', kind: 'gauge', format: 'percent', sql: `SELECT AVG(net_dollar_retention_pct) AS ndr_pct FROM monthly_revenue WHERE month = '2026-10'` });
    expect(gauge.advice.join(' ')).not.toMatch(/bullet/i);
  });

  it('states the facts a chart shows: leaders and shares, trends, drop-offs, correlation', async () => {
    const ranking = await review({
      title: 'MRR by Region',
      kind: 'horizontal_bar',
      format: 'currency_usd',
      sql: `SELECT region, SUM(mrr_usd) AS mrr_usd FROM monthly_revenue WHERE month = '2026-10' GROUP BY region ORDER BY mrr_usd DESC`,
    });
    expect(ranking.facts[0]).toMatch(/^North America leads mrr_usd with \$[\d.]+K \(\d+\.\d% of \$[\d.]+K\); lowest is LATAM/);

    const trend = await review({
      title: 'MRR Trend',
      kind: 'area',
      format: 'currency_usd',
      sql: 'SELECT month, SUM(mrr_usd) AS mrr_usd FROM monthly_revenue GROUP BY month ORDER BY month',
    });
    expect(trend.facts[0]).toMatch(/\(2025-11\) → .*\(2026-10\), \+\d+\.\d% overall; [+−]\d+\.\d% vs 2026-09/);

    // A rate is never summed or turned into a share of a total
    const rate = await review({
      title: 'NDR by Region',
      kind: 'bar',
      format: 'percent',
      sql: `SELECT region, AVG(net_dollar_retention_pct) AS ndr_pct FROM monthly_revenue WHERE month = '2026-10' GROUP BY region ORDER BY ndr_pct DESC`,
    });
    expect(rate.facts[0]).toMatch(/^highest ndr_pct: .*lowest: .*average/);
    expect(rate.facts.join(' ')).not.toMatch(/% of/);

    const funnel = await review(CHART_CATALOG.find((c) => c.kind === 'funnel')!.sampleWidget);
    expect(funnel.facts.join(' ')).toMatch(/overall conversion.*largest drop-off/);

    const scatter = await review(CHART_CATALOG.find((c) => c.kind === 'scatter')!.sampleWidget);
    expect(scatter.facts[0]).toMatch(/seats vs arr_usd: r = \d\.\d\d \(strong positive correlation, 14 points\)/);

    const kpi = await review(CHART_CATALOG.find((c) => c.kind === 'kpi')!.sampleWidget);
    expect(kpi.facts[0]).toMatch(/ndr_pct = [\d.]+%, expansion_pts = \+[\d.]+/);
  });

  it('checks the layout of the 12-column grid', () => {
    const sql = 'SELECT 1 AS n';
    const tidy = buildDashboard({
      title: 'Tidy',
      widgets: [
        { title: 'A', kind: 'kpi', sql, col_span: 4 },
        { title: 'B', kind: 'kpi', sql, col_span: 4 },
        { title: 'C', kind: 'kpi', sql, col_span: 4 },
        { title: 'Trend', kind: 'line', sql, col_span: 8 },
        { title: 'Share', kind: 'donut', sql, col_span: 4 },
        { title: 'Rows', kind: 'table', sql, col_span: 12 },
      ],
    }).dashboard;
    expect(reviewDashboardLayout(tidy)).toEqual([]);

    const messy = buildDashboard({
      title: 'Messy',
      widgets: [
        { title: 'Rows', kind: 'table', sql, col_span: 12 },
        { title: 'Trend', kind: 'bar', sql, col_span: 8 },
        { title: 'Share', kind: 'bar', sql, col_span: 6 },
        { title: 'Rank', kind: 'bar', sql, col_span: 6 },
        { title: 'A', kind: 'kpi', sql, col_span: 3 },
      ],
    }).dashboard;
    const notes = reviewDashboardLayout(messy).join('\n');
    expect(notes).toMatch(/KPI cards are mixed in/);
    expect(notes).toMatch(/tables belong at the bottom/);
    expect(notes).toMatch(/trend \(8\) = 8\/12/);
    expect(notes).toMatch(/All 3 charts are "bar"/);
  });
});

describe('Dashboard tools give the agent what it needs to build good charts', () => {
  const declaration = (name: string) => TOOL_DECLARATIONS.find((t) => t.name === name) as any;
  const widgetProps = (tool: string, list: string) => declaration(tool).parameters.properties[list].items.properties;

  it('every chart_config field of the schema is understood by the engine', () => {
    const samples: Record<string, unknown> = {
      reference_lines: [{ axis: 'y', value: '180000', label: 'Target' }],
      reference_bands: [{ axis: 'y', from: 100, to: 120, label: 'Healthy' }],
      annotations: [{ target_label: '2026-07', text: 'Pricing change' }],
    };
    for (const [key, schema] of Object.entries(chartConfigFields) as [string, any][]) {
      const value = samples[key] ??
        (schema.enum ? schema.enum[schema.enum.length - 1]
          : schema.type === 'BOOLEAN' ? true
            : schema.type === 'INTEGER' || schema.type === 'NUMBER' ? 5
              : 'Text');
      const cfg = normalizeChartConfig({ [key]: value });
      expect(cfg && Object.keys(cfg).length, `chart_config.${key} is dropped by normalizeChartConfig`).toBe(1);
    }
    // A reference line given as text is still drawn at its numeric value
    expect(normalizeChartConfig({ reference_lines: samples.reference_lines })!.referenceLines![0].value).toBe(180000);
    expect(normalizeChartConfig({ annotations: samples.annotations })!.annotations![0].targetLabel).toBe('2026-07');
  });

  it('exposes every chart kind, the field mappings and chart_config on create and edit', () => {
    for (const [tool, list] of [['create_dashboard', 'widgets'], ['edit_dashboard', 'add_widgets'], ['edit_dashboard', 'update_widgets']]) {
      const props = widgetProps(tool, list);
      expect(props.kind.enum).toEqual([...WIDGET_KINDS]);
      for (const field of ['x_field', 'y_fields', 'series_field', 'size_field', 'parent_field', 'lat_field', 'close_field', 'end_field', 'chart_config']) {
        expect(props[field], `${tool}.${list}.${field}`).toBeDefined();
      }
      expect(Object.keys(props.chart_config.properties)).toEqual(Object.keys(chartConfigFields));
    }
    expect(widgetProps('edit_dashboard', 'update_widgets').reset_chart_config.type).toBe('BOOLEAN');
  });

  it('tells the model which result columns every chart kind expects', () => {
    for (const kind of WIDGET_KINDS) {
      expect(SYSTEM_INSTRUCTION, kind).toContain(`\n${kind}: `);
    }
    expect(SYSTEM_INSTRUCTION).toContain('chartReview');
  });

  it('inspect_schema lists the values and ranges the SQL literals must come from', async () => {
    const ctx: ToolContext = { workspace: new Workspace(), source: 'voice' };
    const res = await handleToolCall('inspect_schema', { table: 'monthly_revenue' }, ctx) as any;
    const columns = Object.fromEntries(res.tables[0].columns.map((c: any) => [c.name, c]));
    expect(columns.region.values).toEqual(['APAC', 'EMEA', 'LATAM', 'North America']);
    expect(columns.plan.values).toEqual(['Enterprise', 'Pro', 'Starter']);
    // The latest period is the upper end of the range
    expect(columns.month.values).toEqual(expect.arrayContaining(['2025-11', '2026-10']));
    expect(columns.mrr_usd.range).toHaveLength(2);
    expect(columns.mrr_usd.range[0]).toBeLessThan(columns.mrr_usd.range[1]);
    expect(columns.mrr_usd.values).toBeUndefined();

    const accounts = await handleToolCall('inspect_schema', { table: 'enterprise_accounts' }, ctx) as any;
    const renewal = accounts.tables[0].columns.find((c: any) => c.name === 'renewal_date');
    expect(renewal.range[0] <= renewal.range[1]).toBe(true);
    expect(renewal.distinct).toBeGreaterThan(12);
  });

  it('shows the field mapping, the settings and the whole query in the state', () => {
    const sql = `SELECT month, region, SUM(mrr_usd) AS mrr_usd FROM monthly_revenue WHERE month >= '2026-01' AND region IN ('North America', 'EMEA', 'APAC', 'LATAM') GROUP BY month, region ORDER BY month`;
    const { dashboard } = buildDashboard({
      title: 'State',
      widgets: [{
        title: 'MRR by Region',
        kind: 'line',
        sql,
        x_field: 'month',
        y_fields: ['mrr_usd'],
        series_field: 'region',
        format: 'currency_usd',
        chart_config: { limit_items: 5, reference_lines: [{ axis: 'y', value: '200000', label: 'Target $200K' }] },
      }],
    });
    const state = describeDashboard(dashboard);
    expect(state).toContain('(x=month, y=mrr_usd, series=region, currency_usd)');
    expect(state).toContain('top=5');
    expect(state).toContain('refLines=Target $200K');
    expect(state).toContain(sql);
  });

  it('create_dashboard, edit_dashboard and refresh_dashboard return the chart review', async () => {
    const ws = new Workspace();
    const ctx: ToolContext = { workspace: ws, source: 'voice' };

    const created = await handleToolCall('create_dashboard', {
      title: 'SaaS Revenue Overview',
      widgets: [
        {
          id: 'mrr',
          title: 'MRR',
          kind: 'kpi',
          format: 'currency_usd',
          col_span: 4,
          comparison_field: 'mom_pct',
          // The query of the system instruction's example must run on the local engine
          sql: 'WITH m AS (SELECT month, SUM(mrr_usd) AS mrr_usd FROM monthly_revenue GROUP BY month) SELECT mrr_usd, ROUND(100.0 * (mrr_usd - LAG(mrr_usd) OVER (ORDER BY month)) / LAG(mrr_usd) OVER (ORDER BY month), 1) AS mom_pct FROM m ORDER BY month DESC LIMIT 1',
        },
        {
          id: 'mrr_trend',
          title: 'MRR by Region',
          kind: 'line',
          format: 'currency_usd',
          col_span: 8,
          sql: 'SELECT month, region, SUM(mrr_usd) AS mrr_usd FROM monthly_revenue GROUP BY month, region ORDER BY month',
        },
      ],
    }, ctx) as any;
    expect(created.ok).toBe(true);
    const byId = (res: any, id: string) => res.chartReview.widgets.find((w: any) => w.id === id);
    expect(byId(created, 'mrr').facts[0]).toMatch(/mrr_usd = \$[\d.]+K, mom_pct = [+−][\d.]+/);
    expect(byId(created, 'mrr').issues).toBeUndefined();
    expect(byId(created, 'mrr_trend').issues[0]).toMatch(/series_field: "region"/);
    expect(created.chartReview.next).toMatch(/1 issue: fix all of them now/);
    // The canvas state stays the last thing the model reads
    expect(Object.keys(created).pop()).toBe('diagram');

    // The fix the review asked for, plus a setting through chart_config
    const edited = await handleToolCall('edit_dashboard', {
      summary: 'Split the trend by region',
      update_widgets: [{ id: 'mrr_trend', series_field: 'region', chart_config: { direct_line_labels: true, reference_lines: [{ axis: 'y', value: '300000', label: 'Target' }] } }],
    }, ctx) as any;
    expect(edited.ok).toBe(true);
    expect(edited.chartReview.widgets.map((w: any) => w.id)).toEqual(['mrr_trend']);
    expect(byId(edited, 'mrr_trend').issues).toBeUndefined();
    expect(byId(edited, 'mrr_trend').facts.join(' ')).toMatch(/total mrr_usd: .*overall.*by region: North America/);
    expect(edited.chartReview.next).toMatch(/^No issues/);
    const stored = ws.store.scene.dashboard!.widgets.find((w) => w.id === 'mrr_trend')!;
    expect(stored.chartConfig).toMatchObject({ directLineLabels: true, referenceLines: [{ axis: 'y', value: 300000, label: 'Target' }] });

    const refreshed = await handleToolCall('refresh_dashboard', {}, ctx) as any;
    expect(refreshed.chartReview.widgets).toHaveLength(2);
    expect(byId(refreshed, 'mrr_trend').title).toBe('MRR by Region');
    expect(refreshed.chartReview.next).toMatch(/Answer from the facts/);

    const inspected = await handleToolCall('inspect_widget', { widget_id: 'mrr' }, ctx) as any;
    expect(inspected.facts[0]).toMatch(/mrr_usd = /);
  });
});
