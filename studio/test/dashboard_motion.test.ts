import { describe, expect, it } from 'vitest';
import { handleToolCall } from '../src/agent/dispatcher';
import { executeSqlQuery } from '../src/data/sqlEngine';
import {
  applyDashboardEdit,
  buildDashboard,
  dashboardToGrafanaJson,
  dashboardToSqlBundle,
  dashboardToStandaloneHtml,
  dashboardToVegaLiteHandoff,
  formatMetricValue,
} from '../src/engine/dashboard';
import {
  applyMotionEdit,
  aspectDimensions,
  buildMotion,
  generateMotionFromPage,
  totalMotionDurationMs,
} from '../src/engine/motion';
import { DiagramStore } from '../src/engine/store';
import { evaluateMotionAt } from '../src/engine/timeline';
import { Workspace } from '../src/engine/workspace';
import { pagesFromJson, pagesToJson } from '../src/ui/export';
import { STARTER_SAAS_DASHBOARD } from '../src/ui/dashboard/DashboardView';

describe('Live SQL Dashboard Engine & Exporters', () => {
  it('builds a dashboard, resolves fuzzy widget edits, and formats metrics cleanly', () => {
    const built = buildDashboard({
      title: 'SaaS Executive Metrics',
      subtitle: 'H1 2026',
      source: 'local',
      filters: [{ id: 'f_reg', label: 'Region', param: 'region', kind: 'select', options: ['ALL', 'EMEA'], value: 'ALL' }],
      widgets: [
        {
          id: 'mrr_kpi',
          title: 'Monthly Recurring Revenue',
          kind: 'kpi',
          sql: `SELECT SUM(mrr) AS mrr FROM monthly_revenue WHERE month = '2026-06'`,
          format: 'currency_usd',
          col_span: 4,
        },
        {
          id: 'reg_donut',
          title: 'Regional Share',
          kind: 'donut',
          sql: `SELECT region, SUM(mrr) AS mrr FROM monthly_revenue WHERE month = '2026-06' GROUP BY region`,
          col_span: 8,
        },
      ],
    });

    expect(built.ok).toBe(true);
    expect(built.dashboard.widgets).toHaveLength(2);
    expect(formatMetricValue(266500, 'currency_usd')).toBe('$266.5K');
    expect(formatMetricValue(116.7, 'percent')).toBe('116.7%');

    // Incremental edit referencing widget by fuzzy title
    const edited = applyDashboardEdit(built.dashboard, {
      update_widgets: [{ id: 'Regional Share', kind: 'bar', col_span: 6 }],
      add_widgets: [
        {
          id: 'accounts_tbl',
          title: 'Top Accounts',
          kind: 'table',
          sql: 'SELECT account_name, arr FROM enterprise_accounts ORDER BY arr DESC LIMIT 5',
          col_span: 6,
        },
      ],
      update_filters: [{ id: 'f_reg', value: 'EMEA' }],
    });

    expect(edited.ok).toBe(true);
    expect(edited.dashboard.widgets).toHaveLength(3);
    expect(edited.dashboard.widgets[1].kind).toBe('bar');
    expect(edited.dashboard.widgets[1].colSpan).toBe(6);
    expect(edited.dashboard.filters[0].value).toBe('EMEA');
  });

  it('exports SQL bundles, Vega-Lite specs, Grafana JSON, and standalone HTML reports', async () => {
    // Verify every widget query in STARTER_SAAS_DASHBOARD runs cleanly against local SQLite-Wasm
    const starter = buildDashboard(STARTER_SAAS_DASHBOARD);
    expect(starter.ok).toBe(true);
    for (const w of starter.dashboard.widgets) {
      const r = await executeSqlQuery(w.sql, { params: { region: 'ALL' } });
      expect(r.ok, `Widget ${w.id} failed: ${r.error}`).toBe(true);
      expect(r.rows.length).toBeGreaterThan(0);
    }

    const { dashboard } = buildDashboard({
      title: 'Revenue Snapshot',
      widgets: [
        {
          id: 'mrr_kpi',
          title: 'Latest MRR',
          kind: 'kpi',
          sql: `SELECT SUM(mrr_usd) AS mrr_usd FROM monthly_revenue WHERE month = '2026-06'`,
          format: 'currency_usd',
          explanation: 'Sums June MRR across regions.',
        },
        {
          id: 'mrr_bar',
          title: 'MRR by Region',
          kind: 'bar',
          sql: `SELECT region, SUM(mrr_usd) AS mrr_usd FROM monthly_revenue WHERE month = '2026-06' GROUP BY region`,
        },
      ],
    });

    const kpiRes = await executeSqlQuery(dashboard.widgets[0].sql);
    const barRes = await executeSqlQuery(dashboard.widgets[1].sql);
    const results = { mrr_kpi: kpiRes, mrr_bar: barRes };

    const sqlBundle = dashboardToSqlBundle(dashboard);
    expect(sqlBundle).toContain('-- Dashboard: Revenue Snapshot');
    expect(sqlBundle).toContain('SELECT SUM(mrr_usd) AS mrr_usd FROM monthly_revenue');

    const vega = JSON.parse(dashboardToVegaLiteHandoff(dashboard, results));
    expect(vega.$schema).toContain('vega-lite');
    expect(vega.vconcat).toHaveLength(1);
    expect(vega.vconcat[0].data.values.length).toBeGreaterThanOrEqual(3);

    const grafana = JSON.parse(dashboardToGrafanaJson(dashboard));
    expect(grafana.panels).toHaveLength(2);
    expect(grafana.panels[0].type).toBe('stat');

    const html = dashboardToStandaloneHtml(dashboard, results);
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('Inspect SQL Query');
    expect(html).toContain('$');
  });
});

describe('Programmatic Motion Engine & Deterministic Timeline', () => {
  it('evaluates scenes, spring easings, metric counters, and aspect ratios deterministically', () => {
    expect(aspectDimensions('16:9')).toEqual({ width: 1920, height: 1080 });
    expect(aspectDimensions('9:16')).toEqual({ width: 1080, height: 1920 });
    expect(aspectDimensions('1:1')).toEqual({ width: 1080, height: 1080 });

    const { ok, motion } = buildMotion({
      title: 'Quarterly Explainer',
      aspect_ratio: '16:9',
      fps: 60,
      scenes: [
        {
          id: 's1',
          title: 'Hook',
          duration_ms: 3000,
          narration: 'Revenue grew rapidly across every region.',
          layers: [
            { id: 'h1', kind: 'kinetic_text', text: 'Q2 Growth', enter_at_ms: 0 },
            { id: 'c1', kind: 'metric_counter', text: 'ARR', start_value: 0, value: 1000, enter_at_ms: 200 },
          ],
        },
        {
          id: 's2',
          title: 'Breakdown',
          duration_ms: 3500,
          transition: 'slide_left',
          layers: [
            {
              id: 'ch1',
              kind: 'motion_chart',
              chart_type: 'bar',
              series: [
                { label: 'NA', value: 600 },
                { label: 'EMEA', value: 400 },
              ],
            },
          ],
        },
      ],
    });

    expect(ok).toBe(true);
    expect(totalMotionDurationMs(motion)).toBe(6500);

    const frameMidS1 = evaluateMotionAt(motion, 1800);
    expect(frameMidS1.scene.id).toBe('s1');
    const counterLayer = frameMidS1.layers.find((l) => l.layer.id === 'c1');
    expect(counterLayer?.currentNumber).toBeCloseTo(1000, 0);

    const frameS2 = evaluateMotionAt(motion, 4200);
    expect(frameS2.scene.id).toBe('s2');
    expect(frameS2.layers[0].layer.kind).toBe('motion_chart');

    const edited = applyMotionEdit(motion, {
      aspect_ratio: '9:16',
      update_scenes: [{ id: 's1', duration_ms: 4000 }],
      update_layers: [{ scene_id: 's1', id: 'h1', text: 'Updated Hook Title' }],
    });
    expect(edited.ok).toBe(true);
    expect(edited.motion.aspectRatio).toBe('9:16');
    expect(totalMotionDurationMs(edited.motion)).toBe(7500);
    expect(edited.motion.scenes[0].layers[0].text).toBe('Updated Hook Title');
  });

  it('synthesizes a data-grounded MotionSpec from a page with a live dashboard and diagram', async () => {
    const store = new DiagramStore();
    await store.create(
      {
        diagram_type: 'architecture',
        title: 'Analytics Platform',
        nodes: [
          { id: 'ing', label: 'Ingestion', kind: 'queue' },
          { id: 'wh', label: 'BigQuery', kind: 'database' },
        ],
        edges: [{ from: 'ing', to: 'wh' }],
      },
      { source: 'text' },
    );
    store.createDashboard(
      {
        title: 'SaaS Metrics',
        widgets: [
          {
            id: 'mrr_kpi',
            title: 'June MRR',
            kind: 'kpi',
            sql: `SELECT SUM(mrr_usd) AS mrr_usd FROM monthly_revenue WHERE month = '2026-06'`,
            format: 'currency_usd',
          },
          {
            id: 'reg_bar',
            title: 'MRR by Region',
            kind: 'bar',
            sql: `SELECT region, SUM(mrr_usd) AS mrr_usd FROM monthly_revenue WHERE month = '2026-06' GROUP BY region`,
          },
        ],
      },
      { source: 'text' },
    );

    const r1 = await executeSqlQuery(store.scene.dashboard!.widgets[0].sql);
    const r2 = await executeSqlQuery(store.scene.dashboard!.widgets[1].sql);
    const synth = generateMotionFromPage(store.scene, { mrr_kpi: r1, reg_bar: r2 });

    expect(synth.scenes.length).toBeGreaterThanOrEqual(3);
    const hasCounter = synth.scenes.some((s) => s.layers.some((l) => l.kind === 'metric_counter' && (l.value ?? 0) > 0));
    const hasFlow = synth.scenes.some((s) => s.layers.some((l) => l.kind === 'flow_diagram'));
    expect(hasCounter).toBe(true);
    expect(hasFlow).toBe(true);
  });
});

describe('Workspace Persistence & Gemini Live Tool Dispatcher', () => {
  it('supports undo/redo and JSON round-trip for dashboards and motion explainers', () => {
    const ws = new Workspace();
    ws.store.createDashboard(
      {
        title: 'FinOps Board',
        widgets: [{ id: 'w1', title: 'Spend', kind: 'kpi', sql: 'SELECT SUM(cost_usd) FROM service_spend' }],
      },
      { source: 'text' },
    );
    ws.showView('dashboard');
    expect(ws.view).toBe('dashboard');

    ws.store.createMotion(
      {
        title: 'FinOps Reel',
        scenes: [{ id: 's1', title: 'Intro', duration_ms: 3000, layers: [{ kind: 'kinetic_text', text: 'Cloud Spend' }] }],
      },
      { source: 'text' },
    );
    ws.showView('motion');
    expect(ws.view).toBe('motion');

    // Workspace serialize & restore
    const saved = ws.serialize();
    const restored = new Workspace(saved);
    expect(restored.view).toBe('motion');
    expect(restored.store.scene.dashboard?.title).toBe('FinOps Board');
    expect(restored.store.scene.motion?.title).toBe('FinOps Reel');

    // Studio JSON export/import round-trip
    const json = pagesToJson(ws.pages.map((p) => p.store.scene));
    const imported = pagesFromJson(json);
    expect(imported).not.toBeNull();
    expect(imported![0].dashboard?.widgets[0].id).toBe('w1');
    expect(imported![0].motion?.scenes[0].id).toBe('s1');

    // Undo / Redo
    ws.store.undo();
    expect(ws.store.scene.motion).toBeUndefined();
    expect(ws.store.scene.dashboard?.title).toBe('FinOps Board');
    ws.store.redo();
    expect(ws.store.scene.motion?.title).toBe('FinOps Reel');
  });

  it('dispatches Gemini Live data, dashboard, inspector, and motion tools end-to-end', async () => {
    const ws = new Workspace();
    const inspectedIds: string[] = [];
    const motionActions: string[] = [];

    const ctx = {
      workspace: ws,
      source: 'voice' as const,
      studio: {
        inspectWidget: (id: string) => inspectedIds.push(id),
        controlMotion: (action: string) => motionActions.push(action),
      },
    };

    const sourcesRes = await handleToolCall('list_data_sources', {}, ctx);
    expect(sourcesRes.ok).toBe(true);

    const schemaRes = await handleToolCall('inspect_schema', { source: 'local', table: 'monthly_revenue' }, ctx);
    expect(schemaRes.ok).toBe(true);
    expect((schemaRes.tables as unknown[]).length).toBe(1);

    const queryRes = await handleToolCall(
      'run_query',
      { source: 'local', sql: `SELECT region, SUM(mrr_usd) AS total_mrr FROM monthly_revenue WHERE month = '2026-06' GROUP BY region` },
      ctx,
    );
    expect(queryRes.ok).toBe(true);
    expect((queryRes.rows as unknown[]).length).toBeGreaterThanOrEqual(3);

    // Hallucinated column should be caught BEFORE mutating the dashboard!
    const badDash = await handleToolCall(
      'create_dashboard',
      {
        title: 'Broken SQL',
        widgets: [{ id: 'bad', title: 'Bad', kind: 'kpi', sql: 'SELECT non_existent_col FROM monthly_revenue' }],
      },
      ctx,
    );
    expect(badDash.ok).toBe(false);
    expect(ws.store.scene.dashboard).toBeUndefined();

    // Valid dashboard creation switches view to 'dashboard'
    const goodDash = await handleToolCall(
      'create_dashboard',
      {
        title: 'Executive Revenue',
        widgets: [
          {
            id: 'june_mrr',
            title: 'June MRR',
            kind: 'kpi',
            sql: `SELECT SUM(mrr_usd) AS mrr_usd FROM monthly_revenue WHERE month = '2026-06'`,
            format: 'currency_usd',
          },
          {
            id: 'reg_mrr',
            title: 'Regional MRR',
            kind: 'bar',
            sql: `SELECT region, SUM(mrr_usd) AS mrr_usd FROM monthly_revenue WHERE month = '2026-06' GROUP BY region`,
          },
        ],
      },
      ctx,
    );
    expect(goodDash.ok).toBe(true);
    expect(ws.view).toBe('dashboard');

    // Inspect widget opens inspector drawer via StudioController
    const inspectRes = await handleToolCall('inspect_widget', { widget_id: 'June MRR' }, ctx);
    expect(inspectRes.ok).toBe(true);
    expect(inspectedIds).toEqual(['june_mrr']);

    // Incremental edit_dashboard
    const editDash = await handleToolCall(
      'edit_dashboard',
      {
        summary: 'Added top accounts table',
        add_widgets: [
          {
            id: 'accts',
            title: 'Enterprise Accounts',
            kind: 'table',
            sql: 'SELECT account_name, arr_usd FROM enterprise_accounts ORDER BY arr_usd DESC LIMIT 5',
          },
        ],
      },
      ctx,
    );
    expect(editDash.ok).toBe(true);
    expect(ws.store.scene.dashboard?.widgets).toHaveLength(3);

    // Cross-surface motion synthesis from the live dashboard!
    const createMotion = await handleToolCall(
      'create_motion',
      { title: 'Executive Revenue Reel', from_current_page: true, aspect_ratio: '16:9' },
      ctx,
    );
    expect(createMotion.ok).toBe(true);
    expect(ws.view).toBe('motion');
    expect((ws.store.scene.motion?.scenes.length ?? 0)).toBeGreaterThanOrEqual(3);

    // Control motion playback (create_motion auto-triggers 'restart', then control_motion triggers 'play')
    const ctrlRes = await handleToolCall('control_motion', { action: 'play' }, ctx);
    expect(ctrlRes.ok).toBe(true);
    expect(motionActions).toEqual(['restart', 'play']);

    // Switch back to dashboard view via switch_page
    const switchRes = await handleToolCall('switch_page', { view: 'dashboard' }, ctx);
    expect(switchRes.ok).toBe(true);
    expect(ws.view).toBe('dashboard');
  });
});
