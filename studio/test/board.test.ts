import { describe, expect, it } from 'vitest';
import { sqlParamsOf } from '../src/engine/board';
import { DiagramStore } from '../src/engine/store';
import { describeScene } from '../src/engine/summary';
import { fromJson, toJson } from '../src/ui/export';

const meta = { source: 'text' as const };

function storeWithBoard() {
  const store = new DiagramStore();
  const r = store.editDashboard({
    summary: 'Explored churn',
    add_filters: [{ label: 'Region', param: 'region', options: ['ALL', 'EMEA'], value: 'ALL' }],
    add_widgets: [
      { id: 'churn_trend', title: 'Churn by Month', kind: 'line', asked_as: 'how does churn develop?', sql: "SELECT month, SUM(churned) AS churned FROM churn WHERE (:region = 'ALL' OR region = :region) GROUP BY month" },
      { id: 'churn_by_plan', title: 'Churn by Plan', kind: 'bar', sql: 'SELECT plan, SUM(churned) AS churned FROM churn GROUP BY plan' },
    ],
    refresh_seconds: 30,
  }, meta, 'board');
  expect(r.ok).toBe(true);
  return store;
}

describe('the Board', () => {
  it('is made by the first edit that adds to it, never refreshes by itself, and leaves the dashboard alone', () => {
    const store = storeWithBoard();
    const board = store.scene.board!;
    expect(board.widgets.map((w) => w.id)).toEqual(['churn_trend', 'churn_by_plan']);
    expect(board.refreshSeconds).toBe(0);
    expect(board.widgets[0].askedAs).toBe('how does churn develop?');
    expect(store.scene.dashboard).toBeUndefined();
    expect(store.scene.title).toBe('');
    // Edits of the Board keep its notes
    store.editDashboard({ update_widgets: [{ id: 'churn_trend', kind: 'area' }] }, meta, 'board');
    expect(store.scene.board!.widgets[0]).toMatchObject({ kind: 'area', askedAs: 'how does churn develop?' });
  });

  it('keeps insights with the charts in the same step of the history', () => {
    const store = storeWithBoard();
    const steps = store.history.length;
    store.noteBoardInsights({ churn_trend: 'churned = 42 in October, +12%', nope: 'ignored' });
    expect(store.history.length).toBe(steps);
    expect(store.scene.board!.widgets[0].insight).toBe('churned = 42 in October, +12%');
    store.undo();
    expect(store.scene.board).toBeUndefined();
  });

  it('promotes a chart as a copy with its filter, in one undoable step', () => {
    const store = storeWithBoard();
    const steps = store.history.length;
    const r = store.promoteToDashboard(['churn_trend'], meta);
    expect(r.ok).toBe(true);
    expect(r.createdDashboard).toBe(true);
    expect(r.promoted).toEqual([['churn_trend', 'churn_trend']]);
    const dash = store.scene.dashboard!;
    expect(dash.widgets.map((w) => w.id)).toEqual(['churn_trend']);
    expect(dash.widgets[0].askedAs).toBeUndefined();
    expect(dash.filters.map((f) => f.param)).toEqual(['region']);
    expect(store.scene.board!.widgets[0].promotedAs).toBe('churn_trend');
    expect(store.history.length).toBe(steps + 1);

    // Again: not copied twice
    const again = store.promoteToDashboard(['churn_trend'], meta);
    expect(again.promoted).toEqual([]);
    expect(again.warnings[0]).toMatch(/already on the dashboard/);
    expect(store.scene.dashboard!.widgets.length).toBe(1);

    store.undo();
    expect(store.scene.dashboard).toBeUndefined();
    expect(store.scene.board!.widgets[0].promotedAs).toBeUndefined();
  });

  it('gives a copy its own id when the dashboard has that id, and keeps the dashboard filter it shares', () => {
    const store = storeWithBoard();
    store.createDashboard({
      title: 'Churn',
      filters: [{ label: 'Region', param: 'region', options: ['ALL', 'APAC'], value: 'APAC' }],
      widgets: [{ id: 'churn_trend', title: 'Old trend', kind: 'line', sql: 'SELECT 1' }],
    }, meta);
    store.setSelection(['churn_by_plan']);
    const r = store.promoteToDashboard(['churn_trend', '@selected'], meta);
    expect(r.promoted).toEqual([['churn_trend', 'churn_trend_2'], ['churn_by_plan', 'churn_by_plan']]);
    const dash = store.scene.dashboard!;
    expect(dash.widgets.map((w) => w.id)).toEqual(['churn_trend', 'churn_trend_2', 'churn_by_plan']);
    // The dashboard keeps its own region filter (and its value)
    expect(dash.filters).toHaveLength(1);
    expect(dash.filters[0].value).toBe('APAC');
    expect(r.addedFilters).toEqual([]);
  });

  it('says what it cannot promote', () => {
    const store = new DiagramStore();
    expect(store.promoteToDashboard(['x'], meta).errors[0]).toMatch(/nothing on its Board/);
    const withBoard = storeWithBoard();
    const r = withBoard.promoteToDashboard(['no_such_chart'], meta);
    expect(r.ok).toBe(false);
    expect(withBoard.scene.dashboard).toBeUndefined();
  });

  it('is saved with the page and shown to the agent', () => {
    const store = storeWithBoard();
    store.noteBoardInsights({ churn_trend: 'peak in October' });
    store.promoteToDashboard(['churn_trend'], meta);
    const back = fromJson(toJson(store.scene))!;
    expect(back.board!.widgets[0]).toMatchObject({ askedAs: 'how does churn develop?', insight: 'peak in October', promotedAs: 'churn_trend' });
    expect(back.board!.refreshSeconds).toBe(0);
    const state = describeScene(store.scene);
    expect(state).toMatch(/1 dashboard widget, 2 board charts/);
    expect(state).toMatch(/board \(work in progress/);
    expect(state).toMatch(/asked "how does churn develop\?" · on the dashboard as churn_trend/);
  });
});

describe('query parameters', () => {
  it('finds :params outside quotes and comments', () => {
    expect(sqlParamsOf("SELECT * FROM t WHERE (:region = 'ALL' OR region = :region) AND d > :from_day -- :not_this")).toEqual(['region', 'from_day']);
    expect(sqlParamsOf("SELECT ':nope', CAST(x AS INT)::text, \"a:b\" FROM t")).toEqual([]);
  });
});

describe('the agent on the Board', () => {
  it('explores on the Board, keeps the question and the insight, and pins a chart to the dashboard', async () => {
    const { handleToolCall } = await import('../src/agent/dispatcher');
    const { Workspace } = await import('../src/engine/workspace');
    const ws = new Workspace();
    const ctx = { workspace: ws, source: 'voice' as const, request: 'How is MRR split by region?' };
    const res = await handleToolCall('edit_dashboard', {
      target: 'board',
      summary: 'MRR by region',
      add_widgets: [{ id: 'mrr_by_region', title: 'MRR by Region', kind: 'bar', sql: "SELECT region, SUM(mrr_usd) AS mrr_usd FROM monthly_revenue WHERE month = '2026-10' GROUP BY region ORDER BY mrr_usd DESC" }],
    }, ctx);
    expect(res.ok).toBe(true);
    expect(ws.view).toBe('board');
    const board = ws.store.scene.board!;
    expect(board.widgets[0].askedAs).toBe('How is MRR split by region?');
    expect(board.widgets[0].insight).toMatch(/North America/);
    expect(ws.store.scene.dashboard).toBeUndefined();
    expect(String(res.diagram)).toMatch(/board \(1 chart\)/);
    // Board facts are kept, not laid out like a dashboard
    expect((res.chartReview as Record<string, unknown>).layout ?? []).toEqual([]);

    const refreshed = await handleToolCall('refresh_dashboard', { target: 'board' }, ctx);
    expect(refreshed.ok).toBe(true);

    const pinned = await handleToolCall('promote_to_dashboard', { widgets: ['MRR by Region'] }, { ...ctx, request: 'Pin that.' });
    expect(pinned.ok).toBe(true);
    expect(String(pinned.result)).toMatch(/mrr_by_region copied to the dashboard \(the page had no dashboard: it was made\)/);
    expect(ws.view).toBe('dashboard');
    expect(ws.store.scene.dashboard!.widgets.map((w) => w.id)).toEqual(['mrr_by_region']);
    expect(pinned.chartReview).toBeDefined();

    const twice = await handleToolCall('promote_to_dashboard', { widgets: ['mrr_by_region'] }, ctx);
    expect(twice.ok).toBe(false);
    expect(JSON.stringify(twice.warnings)).toMatch(/already on the dashboard/);
  });
});
