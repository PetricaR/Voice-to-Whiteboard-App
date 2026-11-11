import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { executeSqlQuery, importDataFile, subscribeDataEngine, type QueryExecutionResult } from '../../data/sqlEngine';
import {
  COL_SPANS,
  filterParamsOf,
  type ColSpan,
  type DashboardFilter,
  type DashboardSpec,
  type DashboardWidget,
} from '../../engine/dashboard';
import { Icon, IconButton, useStoreRevision, useStudio } from '../context';
import { prefersReducedMotion, waitForAnimations } from '../domTransitions';
import { ErrorBoundary } from '../ErrorBoundary';
import { ChartGalleryModal } from './ChartGalleryModal';
import { ChartRenderer, type InspectedDatum } from './ChartRenderer';
import { QueryInspectorDrawer } from './QueryInspectorDrawer';
import { STARTER_SAAS_DASHBOARD } from './starterDashboard';

export { STARTER_SAAS_DASHBOARD };

interface DisplayWidgetItem {
  widget: DashboardWidget;
  exiting: boolean;
}

interface DisplayFilterItem {
  filter: DashboardFilter;
  exiting: boolean;
}

export function DashboardView({
  closing = false,
  onResultsChange,
  inspectorWidgetRequest,
  onClearInspectorRequest,
}: {
  closing?: boolean;
  onResultsChange?: (results: Record<string, QueryExecutionResult | undefined>) => void;
  inspectorWidgetRequest?: string | null;
  onClearInspectorRequest?: () => void;
}) {
  const { workspace, store, notify, openDataSources } = useStudio();
  useStoreRevision(store);
  const liveDashboard = store.scene.dashboard;

  // Retain outgoing dashboard or empty card briefly so transitions between empty <-> populated fade smoothly
  const [retainedDashboard, setRetainedDashboard] = useState<DashboardSpec | undefined>(liveDashboard);
  const [dashboardExiting, setDashboardExiting] = useState(false);
  const [emptyOverlayClosing, setEmptyOverlayClosing] = useState(false);
  const prevHasDashRef = useRef(Boolean(liveDashboard));

  useEffect(() => {
    const hasNow = Boolean(liveDashboard);
    const hadBefore = prevHasDashRef.current;
    prevHasDashRef.current = hasNow;

    if (liveDashboard) {
      setRetainedDashboard(liveDashboard);
      setDashboardExiting(false);
      if (!hadBefore) {
        setEmptyOverlayClosing(true);
        const ms = prefersReducedMotion() ? 100 : 240;
        const t = window.setTimeout(() => setEmptyOverlayClosing(false), ms);
        return () => window.clearTimeout(t);
      }
    } else if (hadBefore) {
      setDashboardExiting(true);
      const ms = prefersReducedMotion() ? 100 : 240;
      const t = window.setTimeout(() => {
        setDashboardExiting(false);
        setRetainedDashboard(undefined);
      }, ms);
      return () => window.clearTimeout(t);
    }
  }, [liveDashboard]);

  const dashboard = liveDashboard ?? (dashboardExiting ? retainedDashboard : undefined);

  const [results, setResults] = useState<Record<string, QueryExecutionResult | undefined>>({});
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [inspectedWidgetId, setInspectedWidgetId] = useState<string | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [inspectedDatum, setInspectedDatum] = useState<InspectedDatum | null>(null);
  const [exitTick, bumpExitTick] = useState(0);

  useEffect(() => subscribeDataEngine(() => setRefreshTick((n) => n + 1)), []);

  const resultsRef = useRef(results);
  resultsRef.current = results;

  // Track initial mount vs incremental edits so initial load cascades subtly while single edits highlight cleanly
  const initialMountDoneRef = useRef(false);
  const knownWidgetIdsRef = useRef<Set<string>>(new Set(dashboard?.widgets.map((w) => w.id) ?? []));
  const newlyAddedIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (dashboard && !initialMountDoneRef.current) {
      const t = window.setTimeout(() => {
        initialMountDoneRef.current = true;
      }, 450);
      return () => window.clearTimeout(t);
    }
  }, [Boolean(dashboard)]);

  // Synchronous reconciliation of active + exiting widgets so removed DOM nodes stay mounted during their CSS fade-out
  const renderedWidgetsRef = useRef<DisplayWidgetItem[]>([]);
  const exitingPendingRef = useRef<Set<string>>(new Set());
  const shellRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const filterChipRefs = useRef<Map<string, HTMLLabelElement>>(new Map());
  const renderedFiltersRef = useRef<DisplayFilterItem[]>([]);
  const exitingFiltersPendingRef = useRef<Set<string>>(new Set());

  const displayWidgets: DisplayWidgetItem[] = useMemo(() => {
    if (!dashboard) {
      renderedWidgetsRef.current = [];
      knownWidgetIdsRef.current.clear();
      return [];
    }
    const active = dashboard.widgets;
    const activeById = new Map(active.map((w) => [w.id, w]));
    const prevList = renderedWidgetsRef.current;

    if (initialMountDoneRef.current) {
      for (const w of active) {
        if (!knownWidgetIdsRef.current.has(w.id)) {
          newlyAddedIdsRef.current.add(w.id);
        }
      }
    }
    knownWidgetIdsRef.current = new Set(active.map((w) => w.id));

    // Full dashboard replacement (0 surviving widgets and >1 new widgets): skip ghosting the entire old dashboard
    const anySurviving = prevList.some((it) => !it.exiting && activeById.has(it.widget.id));
    if (!anySurviving && prevList.length > 0 && active.length > 1) {
      exitingPendingRef.current.clear();
      const fresh = active.map((widget) => ({ widget, exiting: false }));
      renderedWidgetsRef.current = fresh;
      return fresh;
    }

    // Build merged list preserving the exact slot of any newly-removed or still-exiting widget
    const nextList: DisplayWidgetItem[] = [];
    const placedActive = new Set<string>();

    // Walk previous slots so exiting items stay anchored right where they were
    let activeCursor = 0;
    for (const prevItem of prevList) {
      const id = prevItem.widget.id;
      const stillActive = activeById.get(id);
      if (stillActive) {
        // Emit any newly inserted active items that appear before `id` in the new `active` order
        const targetIdx = active.findIndex((w) => w.id === id);
        while (activeCursor < targetIdx) {
          const candidate = active[activeCursor++];
          if (!placedActive.has(candidate.id)) {
            nextList.push({ widget: candidate, exiting: false });
            placedActive.add(candidate.id);
          }
        }
        if (!placedActive.has(id)) {
          exitingPendingRef.current.delete(id);
          nextList.push({ widget: stillActive, exiting: false });
          placedActive.add(id);
        }
        activeCursor = Math.max(activeCursor, targetIdx + 1);
      } else if (!prevItem.exiting || exitingPendingRef.current.has(id)) {
        // Newly removed or mid-fade-out: keep DOM node alive with exiting=true
        exitingPendingRef.current.add(id);
        nextList.push({ widget: prevItem.widget, exiting: true });
      }
    }

    // Append any remaining active widgets
    for (const w of active) {
      if (!placedActive.has(w.id)) {
        nextList.push({ widget: w, exiting: false });
        placedActive.add(w.id);
      }
    }

    renderedWidgetsRef.current = nextList;
    return nextList;
  }, [dashboard, store.revision, refreshTick, exitTick]);

  // Schedule cleanup once exiting widgets finish their CSS fade-out animation
  const exitingIdsKey = displayWidgets
    .filter((d) => d.exiting)
    .map((d) => d.widget.id)
    .join(',');

  useEffect(() => {
    if (!exitingIdsKey) return;
    const ids = exitingIdsKey.split(',').filter(Boolean);
    let cancelled = false;
    const timeoutMs = prefersReducedMotion() ? 180 : 340;

    for (const id of ids) {
      const el = shellRefs.current.get(id) ?? null;
      void (async () => {
        if (el) {
          // Force style recalc so newly triggered CSS exit transitions appear in getAnimations()
          void el.offsetWidth;
          await waitForAnimations(el, { timeoutMs });
        }
        if (cancelled) return;
        if (exitingPendingRef.current.delete(id)) {
          renderedWidgetsRef.current = renderedWidgetsRef.current.filter(
            (item) => !(item.exiting && item.widget.id === id),
          );
          bumpExitTick((n) => n + 1);
        }
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [exitingIdsKey]);

  // Clear "newly added" highlight ring after entrance completes
  useEffect(() => {
    if (newlyAddedIdsRef.current.size === 0) return;
    const t = window.setTimeout(() => {
      newlyAddedIdsRef.current.clear();
      bumpExitTick((n) => n + 1);
    }, 1200);
    return () => window.clearTimeout(t);
  }, [displayWidgets.length]);

  // Synchronous reconciliation of active + exiting filter chips
  const displayFilters: DisplayFilterItem[] = useMemo(() => {
    if (!dashboard) {
      renderedFiltersRef.current = [];
      return [];
    }
    const active = dashboard.filters;
    const activeById = new Map(active.map((f) => [f.id, f]));
    const prevList = renderedFiltersRef.current;
    const nextList: DisplayFilterItem[] = [];
    const placed = new Set<string>();

    for (const prev of prevList) {
      const found = activeById.get(prev.filter.id);
      if (found) {
        exitingFiltersPendingRef.current.delete(found.id);
        nextList.push({ filter: found, exiting: false });
        placed.add(found.id);
      } else if (!prev.exiting || exitingFiltersPendingRef.current.has(prev.filter.id)) {
        exitingFiltersPendingRef.current.add(prev.filter.id);
        nextList.push({ filter: prev.filter, exiting: true });
      }
    }
    for (const f of active) {
      if (!placed.has(f.id)) {
        nextList.push({ filter: f, exiting: false });
        placed.add(f.id);
      }
    }
    renderedFiltersRef.current = nextList;
    return nextList;
  }, [dashboard, store.revision, exitTick]);

  const exitingFilterIdsKey = displayFilters
    .filter((f) => f.exiting)
    .map((f) => f.filter.id)
    .join(',');

  useEffect(() => {
    if (!exitingFilterIdsKey) return;
    const ids = exitingFilterIdsKey.split(',').filter(Boolean);
    let cancelled = false;
    const timeoutMs = prefersReducedMotion() ? 160 : 280;

    for (const id of ids) {
      const el = filterChipRefs.current.get(id) ?? null;
      void (async () => {
        if (el) {
          void el.offsetWidth;
          await waitForAnimations(el, { timeoutMs });
        }
        if (cancelled) return;
        if (exitingFiltersPendingRef.current.delete(id)) {
          renderedFiltersRef.current = renderedFiltersRef.current.filter(
            (f) => !(f.exiting && f.filter.id === id),
          );
          bumpExitTick((n) => n + 1);
        }
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [exitingFilterIdsKey]);

  // Smooth compositor-only FLIP glide when widgets resize, reorder, or neighbors collapse after an exit
  const prevRectsRef = useRef<Map<string, DOMRect>>(new Map());
  const layoutSignature = displayWidgets
    .map((d) => `${d.widget.id}:${d.widget.colSpan}:${d.exiting ? 'x' : 'a'}`)
    .join('|');

  useLayoutEffect(() => {
    const nextRects = new Map<string, DOMRect>();
    const canAnimate = !prefersReducedMotion();

    for (const item of displayWidgets) {
      if (item.exiting) continue;
      const el = shellRefs.current.get(item.widget.id);
      if (!el) continue;
      const next = el.getBoundingClientRect();
      nextRects.set(item.widget.id, next);
      const prev = prevRectsRef.current.get(item.widget.id);
      if (
        canAnimate &&
        prev &&
        typeof el.animate === 'function' &&
        (Math.abs(prev.left - next.left) > 2 || Math.abs(prev.top - next.top) > 2)
      ) {
        const dx = prev.left - next.left;
        const dy = prev.top - next.top;
        el.animate(
          [{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }],
          { duration: 280, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
        );
      }
    }

    prevRectsRef.current = nextRects;
  }, [layoutSignature]);

  const runAllQueries = useCallback(async () => {
    if (!liveDashboard) return;
    const params = filterParamsOf(liveDashboard);
    const widgets = liveDashboard.widgets;
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
  }, [liveDashboard, onResultsChange]);

  const widgetsSignature = liveDashboard
    ? JSON.stringify({
        w: liveDashboard.widgets.map((w) => [w.id, w.source, w.sql]),
        f: liveDashboard.filters.map((f) => [f.param, f.value]),
        r: refreshTick,
      })
    : '';

  useEffect(() => {
    if (liveDashboard) runAllQueries();
  }, [widgetsSignature]);

  // Scheduled live auto-refresh
  useEffect(() => {
    if (!liveDashboard || !liveDashboard.refreshSeconds || liveDashboard.refreshSeconds <= 0) return;
    const id = window.setInterval(() => {
      setRefreshTick((n) => n + 1);
    }, liveDashboard.refreshSeconds * 1000);
    return () => window.clearInterval(id);
  }, [liveDashboard?.refreshSeconds]);

  // Allow Gemini Live's `inspect_widget` tool to pop open the SQL inspector drawer
  useEffect(() => {
    if (inspectorWidgetRequest && liveDashboard?.widgets.some((w) => w.id === inspectorWidgetRequest)) {
      setInspectedWidgetId(inspectorWidgetRequest);
      setInspectedDatum(null);
      onClearInspectorRequest?.();
    }
  }, [inspectorWidgetRequest, liveDashboard, onClearInspectorRequest]);

  const isSurfaceClosing = closing || dashboardExiting;

  const emptyStateSection = (isClosingEmpty: boolean) => (
    <section
      className="surface-empty-view"
      data-closing={isClosingEmpty || closing ? '' : undefined}
      inert={isClosingEmpty || closing || undefined}
    >
      <div className="surface-empty-card">
        <div className="surface-empty-icon-wrap">
          <Icon name="dashboard" size={32} />
        </div>
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
          <button type="button" className="tonal-btn" onClick={() => openDataSources('bigquery')}>
            <Icon name="cloud_sync" size={18} /> Connect BigQuery / Upload Data
          </button>
        </div>
      </div>
    </section>
  );

  if (!dashboard) {
    return emptyStateSection(false);
  }

  const inspectedWidget: DashboardWidget | null =
    liveDashboard?.widgets.find((w) => w.id === inspectedWidgetId) ?? null;
  const inspectorOpen = inspectedWidget != null && !closing;

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
    <>
      {emptyOverlayClosing && emptyStateSection(true)}
      <div
        className={`dashboard-view${inspectorOpen ? ' inspector-open' : ''}`}
        data-closing={isSurfaceClosing ? '' : undefined}
        inert={isSurfaceClosing || undefined}
        onDragOver={(e) => e.preventDefault()}
        onDrop={async (e) => {
          const f = e.dataTransfer.files?.[0];
          if (!f) return;
          e.preventDefault();
          try {
            const tbl = await importDataFile(f);
            notify(`Imported "${tbl.name}" (${tbl.rowCount} rows) into local SQLite.`);
            openDataSources('files');
          } catch (err) {
            notify(err instanceof Error ? err.message : String(err));
          }
        }}
      >
        <div className="dashboard-inner">
          <header className="dashboard-toolbar">
            <div className="dashboard-heading">
              <div className="dashboard-meta-row">
                <div className="dashboard-live-pill">
                  <span className="live-dot" />
                  <span>LIVE SQL · {dashboard.defaultSource}</span>
                </div>
                {lastRefreshed && (
                  <span className="refresh-stamp" key={lastRefreshed}>
                    Updated {lastRefreshed}
                  </span>
                )}
              </div>
              <div className="dashboard-title-group">
                <h2 className="dashboard-title">{dashboard.title}</h2>
                {dashboard.subtitle && <p className="dashboard-subtitle">{dashboard.subtitle}</p>}
              </div>
            </div>

            <div className="dashboard-controls">
              {displayFilters.map(({ filter: f, exiting: fExiting }) => (
                <label
                  key={f.id}
                  ref={(el) => {
                    if (el) filterChipRefs.current.set(f.id, el);
                    else filterChipRefs.current.delete(f.id);
                  }}
                  className="dash-filter-chip"
                  data-closing={fExiting ? '' : undefined}
                  aria-hidden={fExiting || undefined}
                >
                  <Icon name="filter_list" size={15} />
                  <span>{f.label}:</span>
                  {f.kind === 'select' && f.options ? (
                    <select
                      aria-label={f.label}
                      value={f.value}
                      disabled={fExiting}
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
                      disabled={fExiting}
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

              <div className="dashboard-action-btns">
                <button type="button" className="tonal-btn small" onClick={() => setRefreshTick((n) => n + 1)}>
                  <Icon name="refresh" size={16} /> Refresh
                </button>
                <button type="button" className="tonal-btn small" onClick={() => setGalleryOpen(true)}>
                  <Icon name="add" size={16} /> Add chart
                </button>
                <button type="button" className="tonal-btn small" onClick={() => openDataSources('bigquery')}>
                  <Icon name="database" size={16} /> BigQuery &amp; Data
                </button>
                <button type="button" className="tonal-btn small accent" onClick={animateDashboard}>
                  <Icon name="movie" size={16} /> Animate Explainer
                </button>
              </div>
            </div>
          </header>

          <div className="dashboard-bento-grid">
            {displayWidgets.map(({ widget: w, exiting }, idx) => {
              const res = results[w.id];
              const isSelected = !exiting && (store.selection.includes(w.id) || inspectedWidgetId === w.id);
              const isNewlyAdded = !exiting && newlyAddedIdsRef.current.has(w.id);
              const staggerStyle = !initialMountDoneRef.current
                ? ({ '--widget-stagger': `${Math.min(idx, 7) * 32}ms` } as CSSProperties)
                : undefined;

              return (
                <div
                  key={w.id}
                  ref={(el) => {
                    if (el) shellRefs.current.set(w.id, el);
                    else shellRefs.current.delete(w.id);
                  }}
                  style={staggerStyle}
                  className={`widget-card-shell span-${w.colSpan}${isNewlyAdded ? ' is-newly-added' : ''}`}
                  data-closing={exiting ? '' : undefined}
                  aria-hidden={exiting || undefined}
                  inert={exiting || undefined}
                >
                  <article
                    className={`widget-card kind-${w.kind}${w.color ? ` accent-${w.color}` : ''}${isSelected ? ' selected' : ''}`}
                    data-widget-id={w.id}
                    onClick={(e) => {
                      if (exiting) return;
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
                          className={`sql-pill-btn${inspectedWidgetId === w.id ? ' active' : ''}`}
                          onClick={() => {
                            if (inspectedWidgetId === w.id && inspectedDatum === null) {
                              setInspectedWidgetId(null);
                            } else {
                              setInspectedWidgetId(w.id);
                              setInspectedDatum(null);
                            }
                          }}
                          title="Inspect & verify exact SQL query"
                        >
                          <Icon name="code" size={13} /> SQL
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
                      {/* One chart that cannot be drawn must not take the dashboard down */}
                      <ErrorBoundary
                        resetKey={`${JSON.stringify(w)}|${res?.executedAt ?? ''}`}
                        fallback={(e) => (
                          <div className="widget-error" role="alert">
                            This chart could not be drawn ({e.message}). Change its type or query, or ask for a different chart.
                          </div>
                        )}
                      >
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
                      </ErrorBoundary>
                    </div>
                  </article>
                </div>
              );
            })}
          </div>
        </div>

        <ChartGalleryModal
          open={galleryOpen}
          onClose={() => setGalleryOpen(false)}
          onWidgetAdded={(id) => {
            setInspectedDatum(null);
            setInspectedWidgetId(id);
          }}
        />
        <QueryInspectorDrawer
          open={inspectorOpen}
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
      </div>
    </>
  );
}
