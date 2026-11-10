import { useEffect, useRef, useState } from 'react';
import {
  importDataFile,
  inspectDataSchema,
  listAllDataSources,
  type DataSourceInfo,
  type TableSchemaInfo,
} from '../../data/sqlEngine';
import { Icon, IconButton, useStudio } from '../context';

export function DataSourceModal({
  open,
  onClose,
  onTableImported,
}: {
  open: boolean;
  onClose: () => void;
  onTableImported?: (table: TableSchemaInfo) => void;
}) {
  const { store, workspace, agent, liveKey, auth, notify } = useStudio();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [sources, setSources] = useState<DataSourceInfo[]>([]);
  const [activeSource, setActiveSource] = useState('local');
  const [tables, setTables] = useState<TableSchemaInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);

  const refreshSchema = async (sourceId = activeSource) => {
    setBusy(true);
    try {
      const [srcs, schema] = await Promise.all([
        listAllDataSources(),
        inspectDataSchema({ source: sourceId }),
      ]);
      setSources(srcs);
      setTables(schema.tables);
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) {
      setUploadErr(null);
      refreshSchema(activeSource);
      d.showModal();
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  // Backdrop click light-dismiss fallback when closedby="any" is unsupported
  useEffect(() => {
    const d = dialogRef.current;
    if (!d || 'closedBy' in HTMLDialogElement.prototype) return;
    const onClick = (e: MouseEvent) => {
      if (e.target === d) d.close();
    };
    d.addEventListener('click', onClick);
    return () => d.removeEventListener('click', onClick);
  }, []);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setUploadErr(null);
    try {
      const imported = await importDataFile(file);
      await refreshSchema('local');
      setActiveSource('local');
      notify(`Loaded "${imported.name}" (${imported.rowCount} rows) into local SQLite.`);
      onTableImported?.(imported);
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const quickBuildFromTable = (t: TableSchemaInfo) => {
    const canAskGemini = liveKey === 'configured' && (!auth.required || (auth.configured && auth.account != null));
    if (canAskGemini) {
      agent.sendText(`Create a live dashboard exploring table "${t.name}" from source "${activeSource}" with KPI headlines, breakdowns, and an interactive table.`).catch(() => undefined);
      onClose();
      return;
    }
    const numCol = t.columns.find((c) => /INT|REAL|FLOAT|NUM|DEC/i.test(c.type))?.name ?? t.columns[1]?.name ?? t.columns[0]?.name ?? '1';
    const dimCol = t.columns.find((c) => c.name !== numCol)?.name ?? t.columns[0]?.name ?? 'rowid';
    store.createDashboard(
      {
        title: `${t.name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())} Overview`,
        subtitle: `Live SQL dashboard over ${activeSource}.${t.name}`,
        source: activeSource,
        replace: true,
        widgets: [
          {
            id: 'total_rows',
            title: 'Total Records',
            kind: 'kpi',
            sql: `SELECT COUNT(*) AS total_rows FROM "${t.name}"`,
            format: 'number',
            colSpan: 6,
          },
          {
            id: 'sum_metric',
            title: `Total ${numCol.replace(/_/g, ' ')}`,
            kind: 'kpi',
            sql: `SELECT ROUND(SUM("${numCol}"), 2) AS total_metric FROM "${t.name}"`,
            format: 'compact',
            colSpan: 6,
          },
          {
            id: 'top_breakdown',
            title: `${numCol} by ${dimCol}`,
            kind: 'bar',
            sql: `SELECT "${dimCol}" AS category, ROUND(SUM("${numCol}"), 2) AS total FROM "${t.name}" GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
            colSpan: 12,
          },
          {
            id: 'raw_records',
            title: `Sample Rows (${t.name})`,
            kind: 'table',
            sql: `SELECT * FROM "${t.name}" LIMIT 40`,
            colSpan: 12,
          },
        ],
      },
      { source: 'manual', label: `Built dashboard from ${t.name}` },
    );
    workspace.showView('dashboard');
    onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      className="dialog datasource-dialog"
      closedby="any"
      onClose={onClose}
      aria-labelledby="datasource-modal-title"
    >
      <header className="dialog-header">
        <h2 id="datasource-modal-title">Data Sources & File Upload</h2>
        <IconButton icon="close" label="Close" onClick={onClose} />
      </header>

      <section className="dialog-section">
        <div
          className="file-dropzone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleFile(e.dataTransfer.files?.[0]);
          }}
        >
          <Icon name="upload_file" size={26} />
          <div>
            <strong>Drop a CSV, TSV, JSON, or Parquet file</strong>
            <p>Loaded directly into in-browser SQLite-Wasm — private, zero-config, and queryable via SQL or voice.</p>
          </div>
          <button type="button" className="tonal-btn" disabled={busy} onClick={() => fileRef.current?.click()}>
            Choose file…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,.json,.jsonl,.parquet"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              handleFile(f);
            }}
          />
        </div>
        {uploadErr && <div className="widget-error" role="alert">{uploadErr}</div>}
      </section>

      <section className="dialog-section">
        <h3>Connected Engines</h3>
        <div className="source-tabs" role="tablist" aria-label="Data sources">
          {sources.map((s) => {
            const connected = s.status === 'connected';
            return (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={activeSource === s.id}
                className={`source-chip ${activeSource === s.id ? 'active' : ''}`}
                disabled={!connected}
                onClick={() => {
                  setActiveSource(s.id);
                  refreshSchema(s.id);
                }}
              >
                <Icon name="database" size={16} />
                <span>{s.label}</span>
                <small>{connected ? 'Ready' : 'Env not set'}</small>
              </button>
            );
          })}
        </div>

        <div className="schema-browser">
          {busy ? (
            <p className="muted-hint">Inspecting schema…</p>
          ) : tables.length === 0 ? (
            <p className="muted-hint">No tables reported by {activeSource}.</p>
          ) : (
            tables.map((t) => (
              <div key={t.name} className="schema-table-card">
                <div className="schema-table-head">
                  <div>
                    <strong><code>{t.name}</code></strong>
                    {typeof t.rowCount === 'number' && <span className="row-badge">{t.rowCount} rows</span>}
                    {t.description && <p>{t.description}</p>}
                  </div>
                  <button type="button" className="tonal-btn small" onClick={() => quickBuildFromTable(t)}>
                    <Icon name="bar_chart" size={16} /> Build Dashboard
                  </button>
                </div>
                <div className="schema-cols">
                  {t.columns.map((c) => (
                    <span key={c.name} className="col-pill">
                      <code>{c.name}</code> <small>{c.type}</small>
                    </span>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <footer className="dialog-actions">
        <button type="button" className="filled-btn" onClick={onClose}>Done</button>
      </footer>
    </dialog>
  );
}
