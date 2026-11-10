import { useEffect, useRef, useState } from 'react';
import { executeSqlQuery, type QueryExecutionResult } from '../../data/sqlEngine';
import { filterParamsOf, type DashboardSpec, type DashboardWidget } from '../../engine/dashboard';
import { Icon, IconButton, useStudio } from '../context';
import type { InspectedDatum } from './ChartRenderer';

export function QueryInspectorDrawer({
  open,
  dashboard,
  widget,
  datum,
  cachedResult,
  onClose,
  onResultUpdated,
}: {
  open: boolean;
  dashboard: DashboardSpec;
  widget: DashboardWidget | null;
  datum: InspectedDatum | null;
  cachedResult?: QueryExecutionResult;
  onClose: () => void;
  onResultUpdated: (widgetId: string, res: QueryExecutionResult) => void;
}) {
  const { store, agent, ensureCanTalk, notify } = useStudio();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [sqlDraft, setSqlDraft] = useState('');
  const [preview, setPreview] = useState<QueryExecutionResult | undefined>(cachedResult);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    setSqlDraft(widget?.sql ?? '');
    setPreview(cachedResult);
    setError(null);
  }, [widget?.id, widget?.sql, cachedResult]);

  // Non-modal top-layer popover drawer so the user can keep clicking dashboard numbers while inspecting SQL
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const anyEl = el as HTMLDialogElement & { showPopover?: () => void; hidePopover?: () => void };
    if (open) {
      try {
        if (typeof anyEl.showPopover === 'function') {
          if (!el.matches(':popover-open')) anyEl.showPopover();
        } else {
          el.setAttribute('open', '');
        }
      } catch {
        el.setAttribute('open', '');
      }
    } else {
      try {
        if (typeof anyEl.hidePopover === 'function' && el.matches(':popover-open')) {
          anyEl.hidePopover();
        } else {
          el.removeAttribute('open');
        }
      } catch {
        el.removeAttribute('open');
      }
    }
  }, [open]);

  if (!widget) {
    return <dialog ref={dialogRef} popover="manual" className="inspector-drawer" aria-label="Query Inspector" />;
  }

  const runPreview = async (sqlToRun = sqlDraft) => {
    setRunning(true);
    setError(null);
    try {
      const res = await executeSqlQuery(sqlToRun, { source: widget.source, params: filterParamsOf(dashboard) });
      if (!res.ok) {
        setError(res.error ?? 'SQL query failed.');
        return;
      }
      setPreview(res);
      if (sqlToRun.trim() === widget.sql.trim()) {
        onResultUpdated(widget.id, res);
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
      const res = await executeSqlQuery(trimmed, { source: widget.source, params: filterParamsOf(dashboard) });
      if (!res.ok) {
        setError(res.error ?? 'SQL query failed.');
        return;
      }
      const edit = store.editDashboard(
        {
          summary: `Updated SQL for ${widget.title}`,
          update_widgets: [{ id: widget.id, sql: trimmed }],
        },
        { source: 'manual', label: `Updated SQL of “${widget.title}”` },
      );
      if (edit.ok) {
        setPreview(res);
        onResultUpdated(widget.id, res);
        notify(`Saved SQL query to “${widget.title}”`);
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
    const sampleRows = (preview?.rows ?? []).slice(0, 5).map((r) => JSON.stringify(r)).join('; ');
    const prompt = datum
      ? `Explain the figure ${datum.formattedValue} (${datum.label} · ${datum.column}) in widget "${widget.title}" (id: ${widget.id}). Its SQL query is: ${widget.sql}. Recent rows: ${sampleRows}.`
      : `Explain how widget "${widget.title}" (id: ${widget.id}) is calculated and what stands out in its numbers. SQL: ${widget.sql}. Rows: ${sampleRows}.`;
    agent.sendText(prompt).catch(() => undefined);
    notify('Asked Gemini Live to explain this metric.');
  };

  const refreshedLabel = preview?.executedAt
    ? new Date(preview.executedAt).toLocaleTimeString()
    : 'Not run yet';

  return (
    <dialog
      ref={dialogRef}
      popover="manual"
      className="inspector-drawer"
      aria-labelledby="inspector-drawer-title"
    >
      <header className="inspector-header">
        <div>
          <span className="inspector-eyebrow">Transparent SQL Lineage</span>
          <h2 id="inspector-drawer-title">{widget.title}</h2>
        </div>
        <IconButton icon="close" label="Close SQL inspector" onClick={onClose} />
      </header>

      <div className="inspector-body">
        {datum && (
          <div className="inspected-datum-banner">
            <Icon name="query_stats" size={20} />
            <div>
              <strong>{datum.formattedValue}</strong>
              <span>{datum.label} · column <code>{datum.column}</code></span>
            </div>
          </div>
        )}

        <div className="inspector-meta-pills">
          <span className="meta-pill"><Icon name="database" size={15} /> Source: <code>{widget.source}</code></span>
          <span className="meta-pill"><Icon name="history" size={15} /> Refreshed: {refreshedLabel}</span>
          {preview && (
            <span className="meta-pill">
              {preview.rowCount} {preview.rowCount === 1 ? 'row' : 'rows'} · {preview.durationMs} ms
            </span>
          )}
        </div>

        {widget.explanation && (
          <p className="inspector-explanation">{widget.explanation}</p>
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
            disabled={running || sqlDraft.trim() === widget.sql.trim()}
            onClick={saveSqlToWidget}
          >
            <Icon name="check" size={18} /> Save to Widget
          </button>
          <button type="button" className="tonal-btn accent" onClick={askGeminiToExplain}>
            <Icon name="mic" size={18} /> Ask Gemini Live
          </button>
        </div>

        {preview && preview.columns.length > 0 && (
          <div className="inspector-preview-section">
            <h3>Result Rows ({preview.rowCount})</h3>
            <div className="inspector-table-scroll" tabIndex={0} role="region" aria-label="Raw SQL result rows">
              <table className="dash-table compact">
                <thead>
                  <tr>
                    {preview.columns.map((c) => <th key={c} scope="col">{c}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 30).map((r, ri) => (
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
      </div>
    </dialog>
  );
}
