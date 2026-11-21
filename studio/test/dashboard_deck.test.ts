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
  normalizeDashboard,
  normalizeRefreshSeconds,
} from '../src/engine/dashboard';
import { applyDeckEdit, buildDeck, generateDeckFromPage } from '../src/engine/deck';
import { DiagramStore } from '../src/engine/store';
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
    // Negative amounts put the sign before the currency symbol, in every size
    expect(formatMetricValue(-1_500_000, 'currency_usd')).toBe('-$1.50M');
    expect(formatMetricValue(-12_000, 'currency_eur')).toBe('-€12.0K');
    expect(formatMetricValue(-950, 'currency_gbp')).toBe('-£950');
    expect(formatMetricValue(-1234.5, 'currency_usd', undefined, { decimals: 2 })).toBe('-$1,234.50');
    expect(formatMetricValue(-0.2, 'currency_usd')).toBe('$0');
    expect(formatMetricValue(950, 'currency_usd')).toBe('$950');
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

  it('builds a dashboard from loosely typed model arguments instead of failing on them', () => {
    const res = buildDashboard({
      title: 42 as unknown as string,
      subtitle: 7 as unknown as string,
      widgets: [
        { sql: 'SELECT 1 AS n', kind: 'kpi' } as never,
        { title: 'Revenue', sql: 'SELECT month, mrr FROM monthly_revenue', kind: 'line', y_fields: 'mrr' as never, x_field: 3 as never } as never,
      ],
      filters: [{ options: ['EMEA', 'APAC'] } as never, null as never],
    } as never);
    expect(res.ok).toBe(true);
    expect(res.dashboard.title).toBe('Live Dashboard');
    expect(res.dashboard.widgets[0].title).toBe('Untitled Metric');
    expect(res.dashboard.widgets[1].yFields).toEqual(['mrr']);
    expect(res.dashboard.widgets[1].xField).toBeUndefined();
    expect(res.dashboard.filters).toHaveLength(1);
    expect(res.dashboard.filters[0].param).toBe('param_1');

    const edit = applyDashboardEdit(res.dashboard, {
      update_widgets: [{ id: 'revenue', y_fields: 'arr' } as never, null as never],
      add_filters: [{ value: 'x' } as never],
      update_filters: [null as never],
    });
    expect(edit.ok).toBe(true);
    expect(edit.dashboard.widgets.find((w) => w.id === 'revenue')!.yFields).toEqual(['arr']);
    expect(edit.dashboard.filters).toHaveLength(2);

    // A patch without an id is refused with an error the model can act on (and nothing changes)
    const noId = applyDashboardEdit(res.dashboard, { update_widgets: [{ title: 'no id' } as never] });
    expect(noId.ok).toBe(false);
    expect(noId.errors.join(' ')).toMatch(/widget reference is missing/);
  });

  it('keeps auto-refresh to the offered intervals so a warehouse is not queried every second', () => {
    expect(normalizeRefreshSeconds(0)).toBe(0);
    expect(normalizeRefreshSeconds(1)).toBe(30);
    expect(normalizeRefreshSeconds(0.01)).toBe(30);
    expect(normalizeRefreshSeconds(45)).toBe(30);
    expect(normalizeRefreshSeconds(50)).toBe(60);
    expect(normalizeRefreshSeconds(120)).toBe(60);
    expect(normalizeRefreshSeconds(86_400)).toBe(300);
    expect(normalizeRefreshSeconds(-5)).toBeUndefined();
    expect(normalizeRefreshSeconds('60')).toBeUndefined();
    const built = buildDashboard({ title: 'D', refresh_seconds: 1, widgets: [{ title: 'a', kind: 'kpi', sql: 'SELECT 1' }] } as never);
    expect(built.dashboard.refreshSeconds).toBe(30);
    expect(applyDashboardEdit(built.dashboard, { refresh_seconds: 2 }).dashboard.refreshSeconds).toBe(30);
    expect(normalizeDashboard({ widgets: [], refreshSeconds: 0.5 })!.refreshSeconds).toBe(30);
  });
});

describe('Slide Deck Engine', () => {
  it('builds a deck from slides and edits it incrementally', () => {
    const { ok, deck, warnings } = buildDeck({
      title: 'Quarterly Review',
      theme: 'ocean',
      slides: [
        { id: 's1', layout: 'title', title: 'Quarterly Review' },
        {
          id: 's2',
          layout: 'chart',
          title: 'NA leads revenue at $600K',
          chart: { type: 'column', categories: ['NA', 'EMEA'], series: [{ name: 'Revenue', values: [600, 400] }], highlight_index: 0 },
          takeaways: ['EMEA follows at $400K'],
        },
        { id: 's3', layout: 'closing', title: 'What this means', takeaways: ['Invest in EMEA'] },
      ],
    }, { date: 'November 2026' });
    expect(ok).toBe(true);
    expect(warnings).toEqual([]);
    expect(deck.theme).toBe('ocean');
    expect(deck.slides.map((x) => x.layout)).toEqual(['title', 'chart', 'closing']);
    expect(deck.slides[1].chart?.highlight).toBe(0);

    const edited = applyDeckEdit(deck, {
      theme: 'forest',
      update_slides: [{ id: '2', title: 'NA leads revenue at $650K', chart: { type: 'bar', categories: ['NA', 'EMEA'], series: [{ name: 'Revenue', values: [650, 400] }] } }],
      add_slides: [{ layout: 'statement', title: 'Fund EMEA now' }],
    });
    expect(edited.ok).toBe(true);
    expect(edited.deck.theme).toBe('forest');
    expect(edited.deck.slides[1].chart?.type).toBe('bar');
    expect(edited.updatedSlides).toEqual(['s2']);
    // A new slide goes before the closing slide
    expect(edited.deck.slides.map((x) => x.layout)).toEqual(['title', 'chart', 'statement', 'closing']);

    const bad = applyDeckEdit(deck, { remove_slides: ['slide 9'] });
    expect(bad.ok).toBe(false);
    expect(bad.deck).toBe(deck);
  });

  it('builds a data-grounded deck from a page with a live dashboard and diagram', async () => {
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
            sql: `SELECT region, SUM(mrr_usd) AS mrr_usd FROM monthly_revenue WHERE month = '2026-06' GROUP BY region ORDER BY 2 DESC`,
            format: 'currency_usd',
          },
        ],
      },
      { source: 'text' },
    );

    const r1 = await executeSqlQuery(store.scene.dashboard!.widgets[0].sql);
    const r2 = await executeSqlQuery(store.scene.dashboard!.widgets[1].sql);
    const deck = generateDeckFromPage(store.scene, { mrr_kpi: r1, reg_bar: r2 }, { date: 'November 2026' })!;

    const layouts = deck.slides.map((x) => x.layout);
    expect(layouts[0]).toBe('title');
    expect(layouts.at(-1)).toBe('closing');
    expect(layouts).toContain('kpis');
    expect(layouts).toContain('chart');
    expect(layouts).toContain('flow');
    const kpi = deck.slides.find((x) => x.layout === 'kpis')!;
    expect(kpi.metrics?.[0].value).toMatch(/^\$\d/);
    const chart = deck.slides.find((x) => x.layout === 'chart')!;
    expect(chart.widgetId).toBe('reg_bar');
    // The title states what the chart shows, with the real leader and figure
    const top = String(r2.rows[0][0]);
    expect(chart.title).toContain(`${top} leads MRR by Region`);
    expect(chart.chart?.highlight).toBe(0);
    expect(chart.notes).toBeTruthy();
    expect(deck.slides.every((x) => x.notes)).toBe(true);
  });
});

describe('Workspace Persistence & Gemini Live Tool Dispatcher', () => {
  it('supports undo/redo and JSON round-trip for dashboards and decks', () => {
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

    ws.store.createDeck(
      {
        title: 'FinOps Review',
        slides: [{ id: 's1', layout: 'title', title: 'FinOps Review' }, { layout: 'statement', title: 'Cloud spend is under control' }],
      },
      { source: 'text' },
    );
    ws.showView('deck');
    expect(ws.view).toBe('deck');

    // Workspace serialize & restore
    const saved = ws.serialize();
    const restored = new Workspace(saved);
    expect(restored.view).toBe('deck');
    expect(restored.store.scene.dashboard?.title).toBe('FinOps Board');
    expect(restored.store.scene.deck?.title).toBe('FinOps Review');

    // Studio JSON export/import round-trip
    const json = pagesToJson(ws.pages.map((p) => p.store.scene));
    const imported = pagesFromJson(json);
    expect(imported).not.toBeNull();
    expect(imported![0].dashboard?.widgets[0].id).toBe('w1');
    expect(imported![0].deck?.slides[0].id).toBe('s1');

    // Undo / Redo
    ws.store.undo();
    expect(ws.store.scene.deck).toBeUndefined();
    expect(ws.store.scene.dashboard?.title).toBe('FinOps Board');
    ws.store.redo();
    expect(ws.store.scene.deck?.title).toBe('FinOps Review');
  });

  it('dispatches Gemini Live data, dashboard, inspector, and deck tools end-to-end', async () => {
    const ws = new Workspace();
    const inspectedIds: string[] = [];
    const deckActions: string[] = [];

    const ctx = {
      workspace: ws,
      source: 'voice' as const,
      studio: {
        inspectWidget: (id: string) => inspectedIds.push(id),
        controlDeck: (action: string, slide?: number) => deckActions.push(`${action}:${slide ?? ''}`),
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

    // A deck built from the live dashboard
    const createDeck = await handleToolCall('create_deck', { title: 'Executive Revenue Review', from_current_page: true }, ctx);
    expect(createDeck.ok).toBe(true);
    expect(ws.view).toBe('deck');
    const deck = ws.store.scene.deck!;
    expect(deck.slides.length).toBeGreaterThanOrEqual(4);
    expect(deck.slides.some((x) => x.layout === 'chart' && x.widgetId === 'reg_mrr')).toBe(true);
    expect(deck.slides.some((x) => x.layout === 'table')).toBe(true);
    expect(String(createDeck.diagram)).toContain('deck: "Executive Revenue Review"');

    // A second create_deck without replace is refused; edit_deck changes only what it names
    const again = await handleToolCall('create_deck', { slides: [{ layout: 'title', title: 'Other' }] }, ctx);
    expect(again.ok).toBe(false);
    const edit = await handleToolCall('edit_deck', { summary: 'Retitled slide 2', theme: 'graphite', update_slides: [{ id: '2', title: 'Revenue grew in every region' }] }, ctx);
    expect(edit.ok).toBe(true);
    expect(ws.store.scene.deck!.slides[1].title).toBe('Revenue grew in every region');
    expect(ws.store.scene.deck!.theme).toBe('graphite');

    // Presenting and moving through the slides
    expect((await handleToolCall('control_deck', { action: 'present' }, ctx)).ok).toBe(true);
    expect((await handleToolCall('control_deck', { action: 'go_to', slide: '3' }, ctx)).ok).toBe(true);
    expect((await handleToolCall('control_deck', { action: 'go_to', slide: '99' }, ctx)).ok).toBe(false);
    expect((await handleToolCall('control_deck', { action: 'sync_data' }, ctx)).ok).toBe(true);
    expect(deckActions).toEqual(['go_to:0', 'go_to:1', 'present:', 'go_to:2']);

    // Switch back to dashboard view via switch_page
    const switchRes = await handleToolCall('switch_page', { view: 'dashboard' }, ctx);
    expect(switchRes.ok).toBe(true);
    expect(ws.view).toBe('dashboard');
  });
});
