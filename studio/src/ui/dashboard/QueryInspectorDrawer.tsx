import { useEffect, useRef, useState } from 'react';
import { executeSqlQuery, type QueryExecutionResult } from '../../data/sqlEngine';
import { adviseChartStorytelling, getChartMeta } from '../../engine/chartCatalog';
import { filterParamsOf, type DashboardSpec, type DashboardWidget } from '../../engine/dashboard';
import { Icon, IconButton, useStudio } from '../context';
import type { IconName } from '../icons';
import { closeTopLayerElement } from '../domTransitions';
import { ChartControlsPanel, type InspectorControlTab } from './ChartControlsPanel';
import type { InspectedDatum } from './ChartRenderer';

export type InspectorDrawerTab = 'sql' | InspectorControlTab;

const DRAWER_TABS: { id: InspectorDrawerTab; label: string; icon: IconName }[] = [
  { id: 'sql', label: 'SQL', icon: 'code' },
  { id: 'type', label: 'Type', icon: 'bar_chart' },
  { id: 'axes', label: 'Axes', icon: 'grid_on' },
  { id: 'style', label: 'Style', icon: 'palette' },
  { id: 'overlays', label: 'Overlays', icon: 'tune' },
];

export function QueryInspectorDrawer({
  open,
  dashboard,
  widget,
  datum,
  cachedResult,
  initialTab = 'sql',
  tabTrigger = 0,
  onClose,
  onResultUpdated,
}: {
  open: boolean;
  dashboard: DashboardSpec;
  widget: DashboardWidget | null;
  datum: InspectedDatum | null;
  cachedResult?: QueryExecutionResult;
  initialTab?: InspectorDrawerTab;
  tabTrigger?: number;
  onClose: () => void;
  onResultUpdated: (widgetId: string, res: QueryExecutionResult) => void;
}) {
  const { store, agent, ensureCanTalk, notify } = useStudio();
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Retain the last inspected widget/datum during the exit fade-out so content never blanks mid-transition
  const [retainedWidget, setRetainedWidget] = useState<DashboardWidget | null>(widget);
  const [retainedDatum, setRetainedDatum] = useState<InspectedDatum | null>(datum);
  const activeWidget = widget ?? retainedWidget;
  const activeDatum = widget ? datum : retainedDatum;

  const [activeTab, setActiveTab] = useState<InspectorDrawerTab>(initialTab);
  const [sqlDraft, setSqlDraft] = useState('');
  const [preview, setPreview] = useState<QueryExecutionResult | undefined>(cachedResult);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab, tabTrigger]);

  useEffect(() => {
    if (widget) {
      setRetainedWidget(widget);
      setRetainedDatum(datum);
      setSqlDraft(widget.sql);
      setPreview(cachedResult);
      setError(null);
    }
  }, [widget, datum, cachedResult]);

  // Non-modal top-layer popover drawer with smooth entry & exit transitions
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const anyEl = el as HTMLDialogElement & { showPopover?: () => void; hidePopover?: () => void };

    if (open) {
      el.removeAttribute('data-closing');
      try {
        if (typeof anyEl.showPopover === 'function') {
          if (!el.matches(':popover-open')) anyEl.showPopover();
        } else {
          el.setAttribute('open', '');
        }
      } catch {
        el.setAttribute('open', '');
      }
      return;
    }

    const isOpenNow =
      el.hasAttribute('open') ||
      (typeof el.matches === 'function' &&
        (() => {
          try {
            return el.matches(':popover-open');
          } catch {
            return false;
          }
        })());

    if (!isOpenNow) return;

    let cancelled = false;
    void closeTopLayerElement(
      el,
      () => {
        if (cancelled) return;
        try {
          if (typeof anyEl.hidePopover === 'function' && el.matches(':popover-open')) {
            anyEl.hidePopover();
          } else {
            el.removeAttribute('open');
          }
        } catch {
          el.removeAttribute('open');
        }
      },
      280,
    );

    return () => {
      cancelled = true;
    };
  }, [open]);

  // Allow Escape to dismiss the non-modal inspector cleanly
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('dialog:modal')) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!activeWidget) {
    return <dialog ref={dialogRef} popover="manual" className="inspector-drawer" aria-label="Query Inspector" />;
  }

  const effectiveResult = preview ?? cachedResult;
  const storyAdvice = adviseChartStorytelling(activeWidget, effectiveResult);
  const chartMeta = getChartMeta(activeWidget.kind);

  const runPreview = async (sqlToRun = sqlDraft) => {
    setRunning(true);
    setError(null);
    try {
      const res = await executeSqlQuery(sqlToRun, { source: activeWidget.source, params: filterParamsOf(dashboard) });
      if (!res.ok) {
        setError(res.error ?? 'SQL query failed.');
        return;
      }
      setPreview(res);
      if (sqlToRun.trim() === activeWidget.sql.trim()) {
        onResultUpdated(activeWidget.id, res);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const saveSqlToWidget = async () => {
    const trimmed = sqlDraft.trim();
    if (!trimmed) return;
    setRunning(true);
    setError(null);
    try {
      const res = await executeSqlQuery(trimmed, { source: activeWidget.source, params: filterParamsOf(dashboard) });
      if (!res.ok) {
        setError(res.error ?? 'SQL query failed.');
        return;
      }
      const edit = store.editDashboard(
        {
          summary: `Updated SQL for ${activeWidget.title}`,
          update_widgets: [{ id: activeWidget.id, sql: trimmed }],
        },
        { source: 'manual', label: `Updated SQL of “${activeWidget.title}”` },
      );
      if (edit.ok) {
        setPreview(res);
        onResultUpdated(activeWidget.id, res);
        notify(`Saved SQL query to “${activeWidget.title}”`);
      } else {
        setError(edit.errors.join(' '));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const askGeminiToExplain = () => {
    if (!ensureCanTalk()) return;
    const sampleRows = (effectiveResult?.rows ?? []).slice(0, 5).map((r) => JSON.stringify(r)).join('; ');
    const prompt = activeDatum
      ? `Explain the figure ${activeDatum.formattedValue} (${activeDatum.label} · ${activeDatum.column}) in widget "${activeWidget.title}" (id: ${activeWidget.id}, kind: ${activeWidget.kind}). Its SQL query is: ${activeWidget.sql}. Recent rows: ${sampleRows}.`
      : `Explain how widget "${activeWidget.title}" (id: ${activeWidget.id}, kind: ${activeWidget.kind}) is calculated and suggest any Holistics data storytelling refinements. SQL: ${activeWidget.sql}. Rows: ${sampleRows}.`;
    agent.sendText(prompt).catch(() => undefined);
    notify('Asked Gemini Live to explain this metric.');
  };

  const refreshedLabel = effectiveResult?.executedAt
    ? new Date(effectiveResult.executedAt).toLocaleTimeString()
    : 'Not run yet';

  return (
    <dialog
      ref={dialogRef}
      popover="manual"
      className="inspector-drawer"
      aria-labelledby="inspector-drawer-title"
    >
      <header className="inspector-header">
        <div className="inspector-heading-text">
          <span className="inspector-eyebrow">
            {activeTab === 'sql' ? 'Transparent SQL Lineage' : `Chart Studio · ${chartMeta.label}`}
          </span>
          <h2 id="inspector-drawer-title">{activeWidget.title}</h2>
        </div>
        <IconButton icon="close" label="Close SQL inspector" onClick={onClose} />
      </header>

      <div className="inspector-tabs" role="tablist" aria-label="Chart Studio and SQL Inspector tabs">
        {DRAWER_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={activeTab === t.id}
            className={`inspector-tab-btn${activeTab === t.id ? ' active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            <Icon name={t.icon} size={15} />
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      <div className="inspector-body" key={activeWidget.id}>
        {/* Holistics Live Storytelling Advisor */}
        {storyAdvice.length > 0 && (
          <div className="story-advice-stack" aria-label="Data storytelling recommendations">
            {storyAdvice.slice(0, 2).map((adv) => (
              <div key={adv.id} className={`story-advice-banner is-${adv.severity}`}>
                <div className="story-advice-copy">
                  <strong>
                    <Icon name={adv.severity === 'warning' ? 'warning' : 'auto_awesome_mosaic'} size={15} /> {adv.title}
                  </strong>
                  <span>{adv.message}</span>
                </div>
                {adv.quickFix && (
                  <button
                    type="button"
                    className="story-fix-btn"
                    onClick={() => {
                      store.editDashboard(
                        {
                          summary: `${adv.quickFix!.label} on ${activeWidget.title}`,
                          update_widgets: [{ id: activeWidget.id, ...adv.quickFix!.patch }],
                        },
                        { source: 'manual', label: `${adv.quickFix!.label} (“${activeWidget.title}”)` },
                      );
                      notify(`Applied: ${adv.quickFix!.label}`);
                    }}
                  >
                    {adv.quickFix.label}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {activeTab === 'sql' ? (
          <>
            {activeDatum && (
              <div className="inspected-datum-banner" key={`${activeDatum.column}-${activeDatum.label}`}>
                <Icon name="query_stats" size={20} />
                <div>
                  <strong>{activeDatum.formattedValue}</strong>
                  <span>{activeDatum.label} · column <code>{activeDatum.column}</code></span>
                </div>
              </div>
            )}

            <div className="inspector-meta-pills">
              <span className="meta-pill"><Icon name="database" size={15} /> Source: <code>{activeWidget.source}</code></span>
              <span className="meta-pill"><Icon name="history" size={15} /> Refreshed: {refreshedLabel}</span>
              {effectiveResult && (
                <span className="meta-pill">
                  {effectiveResult.rowCount} {effectiveResult.rowCount === 1 ? 'row' : 'rows'} · {effectiveResult.durationMs} ms
                </span>
              )}
            </div>

            {activeWidget.explanation && (
              <p className="inspector-explanation">{activeWidget.explanation}</p>
            )}

            <label className="inspector-sql-label" htmlFor="inspector-sql-editor">
              <span>Read-only SQL Query</span>
              <button
                type="button"
                className="text-btn small"
                onClick={() => {
                  navigator.clipboard?.writeText(sqlDraft).then(() => notify('Copied SQL to clipboard')).catch(() => undefined);
                }}
              >
                <Icon name="content_copy" size={15} /> Copy SQL
              </button>
            </label>
            <textarea
              id="inspector-sql-editor"
              className="inspector-sql-editor"
              value={sqlDraft}
              onChange={(e) => setSqlDraft(e.target.value)}
              rows={6}
              spellCheck={false}
            />

            {error && <div className="widget-error" role="alert">{error}</div>}

            <div className="inspector-actions">
              <button type="button" className="tonal-btn" disabled={running} onClick={() => runPreview()}>
                <Icon name="play_arrow" size={18} /> {running ? 'Running…' : 'Test Query'}
              </button>
              <button
                type="button"
                className="filled-btn"
                disabled={running || sqlDraft.trim() === activeWidget.sql.trim()}
                onClick={saveSqlToWidget}
              >
                <Icon name="check" size={18} /> Save to Widget
              </button>
              <button type="button" className="tonal-btn accent" onClick={askGeminiToExplain}>
                <Icon name="mic" size={18} /> Ask Gemini Live
              </button>
            </div>

            {effectiveResult && effectiveResult.columns.length > 0 && (
              <div className="inspector-preview-section">
                <h3>Result Rows ({effectiveResult.rowCount})</h3>
                <div className="inspector-table-scroll" tabIndex={0} role="region" aria-label="Raw SQL result rows">
                  <table className="dash-table compact">
                    <thead>
                      <tr>
                        {effectiveResult.columns.map((c) => <th key={c} scope="col">{c}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {effectiveResult.rows.slice(0, 30).map((r, ri) => (
                        <tr key={ri}>
                          {r.map((cell, ci) => (
                            <td key={ci}>{cell === null || cell === undefined ? 'NULL' : String(cell)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        ) : (
          <ChartControlsPanel
            widget={activeWidget}
            tab={activeTab}
            availableColumns={effectiveResult?.columns ?? []}
          />
        )}
      </div>
    </dialog>
  );
}
