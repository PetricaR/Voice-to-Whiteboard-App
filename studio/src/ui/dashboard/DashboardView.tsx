import { useCallback, useEffect, useRef, useState } from 'react';
import { executeSqlQuery, importDataFile, type QueryExecutionResult } from '../../data/sqlEngine';
import {
  COL_SPANS,
  filterParamsOf,
  type ColSpan,
  type DashboardWidget,
} from '../../engine/dashboard';
import { Icon, IconButton, useStoreRevision, useStudio } from '../context';
import { ChartRenderer, type InspectedDatum } from './ChartRenderer';
import { DataSourceModal } from './DataSourceModal';
import { QueryInspectorDrawer } from './QueryInspectorDrawer';

export const STARTER_SAAS_DASHBOARD = {
  title: 'SaaS Executive Revenue & Retention',
  subtitle: 'Live SQLite-Wasm metrics across MRR, NDR, regional growth, and enterprise accounts',
  source: 'local',
  refresh_seconds: 0,
  filters: [
    {
      id: 'filter_region',
      label: 'Region',
      param: 'region',
      kind: 'select' as const,
      options: ['ALL', 'North America', 'EMEA', 'APAC', 'LATAM'],
      value: 'ALL',
    },
  ],
  widgets: [
    {
      id: 'latest_mrr',
      title: 'Latest Monthly MRR',
      subtitle: '2026-10 recurring revenue',
      kind: 'kpi' as const,
      sql: `SELECT SUM(mrr_usd) AS mrr_usd, ROUND(AVG(net_dollar_retention_pct) - 100, 1) AS net_expansion_pct
FROM monthly_revenue
WHERE month = '2026-10' AND (:region = 'ALL' OR region = :region)`,
      format: 'currency_usd' as const,
      col_span: 3,
      color: 'blue' as const,
      explanation: 'Sums recurring monthly revenue in October 2026 filtered by region, alongside net expansion above 100% NDR.',
    },
    {
      id: 'avg_nrr',
      title: 'Net Dollar Retention',
      subtitle: 'Cohort weighted NDR %',
      kind: 'kpi' as const,
      sql: `SELECT ROUND(AVG(net_dollar_retention_pct), 1) AS ndr_pct FROM monthly_revenue WHERE month = '2026-10' AND (:region = 'ALL' OR region = :region)`,
      format: 'percent' as const,
      col_span: 3,
      color: 'teal' as const,
      explanation: 'Average net dollar retention percentage across active plans in 2026-10.',
    },
    {
      id: 'new_arr_6m',
      title: '12-Month New MRR Added',
      subtitle: 'Gross new logo MRR booked',
      kind: 'kpi' as const,
      sql: `SELECT SUM(new_mrr_usd) AS new_mrr_usd FROM monthly_revenue WHERE (:region = 'ALL' OR region = :region)`,
      format: 'currency_usd' as const,
      col_span: 3,
      color: 'green' as const,
      explanation: 'Cumulative new logo MRR added across the 12-month window.',
    },
    {
      id: 'active_customers',
      title: 'Active Customers',
      subtitle: 'Paying SaaS accounts',
      kind: 'kpi' as const,
      sql: `SELECT SUM(active_customers) AS customers FROM monthly_revenue WHERE month = '2026-10' AND (:region = 'ALL' OR region = :region)`,
      format: 'number' as const,
      col_span: 3,
      color: 'purple' as const,
      explanation: 'Total paying accounts active in October 2026.',
    },
    {
      id: 'mrr_trend',
      title: 'Monthly Recurring Revenue Trajectory',
      subtitle: '12-month recurring growth curve',
      kind: 'area' as const,
      sql: `SELECT month, SUM(mrr_usd) AS mrr_usd FROM monthly_revenue WHERE (:region = 'ALL' OR region = :region) GROUP BY month ORDER BY month`,
      format: 'currency_usd' as const,
      col_span: 8,
      color: 'blue' as const,
      explanation: 'Aggregates monthly MRR from 2025-11 through 2026-10.',
    },
    {
      id: 'region_mix',
      title: 'MRR Share by Region',
      subtitle: 'October 2026 distribution',
      kind: 'donut' as const,
      sql: `SELECT region, SUM(mrr_usd) AS mrr_usd FROM monthly_revenue WHERE month = '2026-10' GROUP BY region ORDER BY mrr_usd DESC`,
      format: 'currency_usd' as const,
      col_span: 4,
      explanation: 'Regional contribution to October 2026 MRR.',
    },
    {
      id: 'top_accounts',
      title: 'Enterprise Accounts & Health',
      subtitle: 'Click any column header to sort or click any figure to inspect SQL',
      kind: 'table' as const,
      sql: `SELECT account_name, region, plan, arr_usd, seats, usage_score, renewal_date, churn_risk
FROM enterprise_accounts
WHERE (:region = 'ALL' OR region = :region)
ORDER BY arr_usd DESC`,
      format: 'currency_usd' as const,
      col_span: 12,
      explanation: 'Lists enterprise accounts with ARR, seat deployment, usage health score, renewal date, and churn risk.',
    },
  ],
};

export function DashboardView({
  onResultsChange,
  inspectorWidgetRequest,
  onClearInspectorRequest,
}: {
  onResultsChange?: (results: Record<string, QueryExecutionResult | undefined>) => void;
  inspectorWidgetRequest?: string | null;
  onClearInspectorRequest?: () => void;
}) {
  const { workspace, store, notify } = useStudio();
  useStoreRevision(store);
  const dashboard = store.scene.dashboard;

  const [results, setResults] = useState<Record<string, QueryExecutionResult | undefined>>({});
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [dataModalOpen, setDataModalOpen] = useState(false);
  const [inspectedWidgetId, setInspectedWidgetId] = useState<string | null>(null);
  const [inspectedDatum, setInspectedDatum] = useState<InspectedDatum | null>(null);
  const resultsRef = useRef(results);
  resultsRef.current = results;

  const runAllQueries = useCallback(async () => {
    if (!dashboard) return;
    const params = filterParamsOf(dashboard);
    const widgets = dashboard.widgets;
    setLoading(Object.fromEntries(widgets.map((w) => [w.id, true])));

    const nextResults: Record<string, QueryExecutionResult | undefined> = { ...resultsRef.current };
    const nextErrors: Record<string, string | undefined> = {};

    await Promise.all(
      widgets.map(async (w) => {
        try {
          const res = await executeSqlQuery(w.sql, { source: w.source, params });
          if (!res.ok) {
            nextErrors[w.id] = res.error ?? 'SQL query failed.';
          } else {
            nextResults[w.id] = res;
          }
        } catch (e) {
          nextErrors[w.id] = e instanceof Error ? e.message : String(e);
        }
      }),
    );

    setResults(nextResults);
    setErrors(nextErrors);
    setLoading({});
    setLastRefreshed(new Date().toLocaleTimeString());
    onResultsChange?.(nextResults);
  }, [dashboard, onResultsChange]);

  const widgetsSignature = dashboard
    ? JSON.stringify({
        w: dashboard.widgets.map((w) => [w.id, w.source, w.sql]),
        f: dashboard.filters.map((f) => [f.param, f.value]),
        r: refreshTick,
      })
    : '';

  useEffect(() => {
    if (dashboard) runAllQueries();
  }, [widgetsSignature]);

  // Scheduled live auto-refresh
  useEffect(() => {
    if (!dashboard || !dashboard.refreshSeconds || dashboard.refreshSeconds <= 0) return;
    const id = window.setInterval(() => {
      setRefreshTick((n) => n + 1);
    }, dashboard.refreshSeconds * 1000);
    return () => window.clearInterval(id);
  }, [dashboard?.refreshSeconds]);

  // Allow Gemini Live's `inspect_widget` tool to pop open the SQL inspector drawer
  useEffect(() => {
    if (inspectorWidgetRequest && dashboard?.widgets.some((w) => w.id === inspectorWidgetRequest)) {
      setInspectedWidgetId(inspectorWidgetRequest);
      setInspectedDatum(null);
      onClearInspectorRequest?.();
    }
  }, [inspectorWidgetRequest, dashboard, onClearInspectorRequest]);

  if (!dashboard) {
    return (
      <section className="surface-empty-view">
        <div className="surface-empty-card">
          <Icon name="dashboard" size={34} />
          <h2>Build a Live SQL Dashboard</h2>
          <p>
            Every KPI and chart runs real SQL against local CSV/Parquet/SQLite tables or connected cloud warehouses.
            Click any number at any time to verify the exact query behind it.
          </p>
          <div className="surface-empty-actions">
            <button
              type="button"
              className="filled-btn"
              onClick={() => {
                store.createDashboard(STARTER_SAAS_DASHBOARD, {
                  source: 'manual',
                  label: 'Loaded SaaS Revenue Dashboard',
                });
              }}
            >
              <Icon name="bar_chart" size={18} /> Load SaaS Executive Dashboard
            </button>
            <button type="button" className="tonal-btn" onClick={() => setDataModalOpen(true)}>
              <Icon name="upload_file" size={18} /> Upload CSV / Parquet / Inspect Schema
            </button>
          </div>
        </div>
        <DataSourceModal open={dataModalOpen} onClose={() => setDataModalOpen(false)} />
      </section>
    );
  }

  const inspectedWidget: DashboardWidget | null =
    dashboard.widgets.find((w) => w.id === inspectedWidgetId) ?? null;

  const cycleColSpan = (w: DashboardWidget) => {
    const idx = COL_SPANS.indexOf(w.colSpan);
    const nextSpan: ColSpan = COL_SPANS[(idx + 1) % COL_SPANS.length];
    store.editDashboard(
      { summary: `Resized ${w.title}`, update_widgets: [{ id: w.id, colSpan: nextSpan }] },
      { source: 'manual', label: `Resized “${w.title}” to ${nextSpan}/12 cols` },
    );
  };

  const animateDashboard = () => {
    store.createMotion(
      { from_current_page: true, title: `${dashboard.title} — Motion Walkthrough` },
      { source: 'manual', label: `Animated “${dashboard.title}”` },
      results,
    );
    workspace.showView('motion');
    notify('Synthesized animated explainer grounded in live dashboard metrics.');
  };

  return (
    <div
      className="dashboard-view"
      onDragOver={(e) => e.preventDefault()}
      onDrop={async (e) => {
        const f = e.dataTransfer.files?.[0];
        if (!f) return;
        e.preventDefault();
        try {
          const tbl = await importDataFile(f);
          notify(`Imported "${tbl.name}" (${tbl.rowCount} rows) into local SQLite.`);
          setDataModalOpen(true);
        } catch (err) {
          notify(err instanceof Error ? err.message : String(err));
        }
      }}
    >
      <header className="dashboard-toolbar">
        <div className="dashboard-heading">
          <div className="dashboard-live-pill">
            <span className="live-dot" />
            <span>LIVE SQL · {dashboard.defaultSource}</span>
          </div>
          {lastRefreshed && <span className="refresh-stamp">Updated {lastRefreshed}</span>}
        </div>

        <div className="dashboard-controls">
          {dashboard.filters.map((f) => (
            <label key={f.id} className="dash-filter-chip">
              <Icon name="filter_list" size={15} />
              <span>{f.label}:</span>
              {f.kind === 'select' && f.options ? (
                <select
                  aria-label={f.label}
                  value={f.value}
                  onChange={(e) =>
                    store.editDashboard(
                      { update_filters: [{ id: f.id, value: e.target.value }] },
                      { source: 'manual', label: `Filtered ${f.label} = ${e.target.value}` },
                    )
                  }
                >
                  {f.options.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              ) : (
                <input
                  aria-label={f.label}
                  value={f.value}
                  onChange={(e) =>
                    store.editDashboard(
                      { update_filters: [{ id: f.id, value: e.target.value }] },
                      { source: 'manual', label: `Filtered ${f.label}` },
                    )
                  }
                />
              )}
            </label>
          ))}

          <label className="dash-filter-chip" title="Auto-refresh schedule">
            <Icon name="refresh" size={15} />
            <select
              aria-label="Auto-refresh interval"
              value={dashboard.refreshSeconds}
              onChange={(e) =>
                store.editDashboard(
                  { refresh_seconds: Number(e.target.value) },
                  { source: 'manual', label: 'Changed auto-refresh interval' },
                )
              }
            >
              <option value={0}>Manual</option>
              <option value={30}>Every 30s</option>
              <option value={60}>Every 1m</option>
              <option value={300}>Every 5m</option>
            </select>
          </label>

          <button type="button" className="tonal-btn small" onClick={() => setRefreshTick((n) => n + 1)}>
            <Icon name="refresh" size={16} /> Refresh
          </button>
          <button type="button" className="tonal-btn small" onClick={() => setDataModalOpen(true)}>
            <Icon name="database" size={16} /> Data & Upload
          </button>
          <button type="button" className="tonal-btn small accent" onClick={animateDashboard}>
            <Icon name="movie" size={16} /> Animate Explainer
          </button>
        </div>
      </header>

      <div className="dashboard-bento-grid">
        {dashboard.widgets.map((w) => {
          const res = results[w.id];
          const isSelected = store.selection.includes(w.id) || inspectedWidgetId === w.id;
          return (
            <div key={w.id} className={`widget-card-shell span-${w.colSpan}`}>
              <article
                className={`widget-card kind-${w.kind}${isSelected ? ' selected' : ''}`}
                data-widget-id={w.id}
                onClick={(e) => {
                  if (!(e.target as HTMLElement).closest('button, select, input, a')) {
                    store.setSelection([w.id]);
                  }
                }}
              >
                <header className="widget-card-head">
                  <div className="widget-titles">
                    <h3>{w.title}</h3>
                    {w.subtitle && <p>{w.subtitle}</p>}
                  </div>
                  <div className="widget-actions">
                    <button
                      type="button"
                      className="sql-pill-btn"
                      onClick={() => {
                        setInspectedWidgetId(w.id);
                        setInspectedDatum(null);
                      }}
                      title="Inspect & verify exact SQL query"
                    >
                      <Icon name="code" size={14} /> SQL
                    </button>
                    <IconButton
                      icon="aspect_ratio"
                      label={`Resize widget (${w.colSpan}/12 cols)`}
                      onClick={() => cycleColSpan(w)}
                    />
                    <IconButton
                      icon="delete"
                      label={`Remove ${w.title}`}
                      onClick={() =>
                        store.editDashboard(
                          { remove_widgets: [w.id] },
                          { source: 'manual', label: `Removed “${w.title}”` },
                        )
                      }
                    />
                  </div>
                </header>

                <div className="widget-card-content">
                  <ChartRenderer
                    widget={w}
                    result={res}
                    loading={loading[w.id]}
                    error={errors[w.id]}
                    onInspectDatum={(datum) => {
                      setInspectedWidgetId(w.id);
                      setInspectedDatum(datum);
                    }}
                  />
                </div>
              </article>
            </div>
          );
        })}
      </div>

      <QueryInspectorDrawer
        open={inspectedWidget != null}
        dashboard={dashboard}
        widget={inspectedWidget}
        datum={inspectedDatum}
        cachedResult={inspectedWidget ? results[inspectedWidget.id] : undefined}
        onClose={() => {
          setInspectedWidgetId(null);
          setInspectedDatum(null);
        }}
        onResultUpdated={(widgetId, updatedRes) => {
          setResults((prev) => {
            const next = { ...prev, [widgetId]: updatedRes };
            onResultsChange?.(next);
            return next;
          });
        }}
      />

      <DataSourceModal
        open={dataModalOpen}
        onClose={() => setDataModalOpen(false)}
        onTableImported={() => setRefreshTick((n) => n + 1)}
      />
    </div>
  );
}
