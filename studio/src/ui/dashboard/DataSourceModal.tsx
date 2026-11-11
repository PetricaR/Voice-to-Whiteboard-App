import { useEffect, useRef, useState } from 'react';
import {
  importDataFile,
  inspectDataSchema,
  listAllDataSources,
  type DataSourceInfo,
  type TableSchemaInfo,
} from '../../data/sqlEngine';
import { Icon, IconButton, useStudio } from '../context';
import { closeTopLayerElement } from '../domTransitions';
import { BigQueryCatalogPanel } from './BigQueryCatalogPanel';

export type DataModalTab = 'bigquery' | 'files';

export function DataSourceModal({
  open,
  initialTab = 'bigquery',
  onClose,
  onTableImported,
}: {
  open: boolean;
  initialTab?: DataModalTab;
  onClose: () => void;
  onTableImported?: (table: TableSchemaInfo) => void;
}) {
  const { store, workspace, agent, liveKey, auth, notify } = useStudio();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<DataModalTab>(initialTab);
  const [sources, setSources] = useState<DataSourceInfo[]>([]);
  const [activeSource, setActiveSource] = useState('local');
  const [tables, setTables] = useState<TableSchemaInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);

  const refreshSchema = async (sourceId = activeSource) => {
    setBusy(true);
    try {
      const [srcs, schema] = await Promise.all([
        listAllDataSources(true),
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
    if (open) {
      d.removeAttribute('data-closing');
      if (!d.open) {
        setUploadErr(null);
        void refreshSchema(activeSource);
        d.showModal();
      }
      return;
    }
    if (d.open) {
      let cancelled = false;
      void closeTopLayerElement(
        d,
        () => {
          if (!cancelled && d.open) d.close();
        },
        260,
      );
      return () => {
        cancelled = true;
      };
    }
  }, [open]);

  // Route native cancel (Escape) and backdrop click fallback through the smooth exit handler
  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    const onClick = (e: MouseEvent) => {
      if (!('closedBy' in HTMLDialogElement.prototype) && e.target === d) {
        onClose();
      }
    };
    d.addEventListener('cancel', onCancel);
    d.addEventListener('click', onClick);
    return () => {
      d.removeEventListener('cancel', onCancel);
      d.removeEventListener('click', onClick);
    };
  }, [onClose]);

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
    const isBigQuery = activeSource === 'bigquery' || activeSource.startsWith('bigquery:');
    const targetRef = isBigQuery ? `\`${t.fullName || t.name}\`` : `"${t.name}"`;
    const quoteCol = (c: string) => (isBigQuery ? `\`${c}\`` : `"${c}"`);

    const canAskGemini = liveKey === 'configured' && (!auth.required || (auth.configured && auth.account != null));
    if (canAskGemini) {
      agent
        .sendText(
          `Create a live dashboard exploring table ${targetRef} from source "${activeSource}" with KPI headlines, breakdowns, and an interactive table.`,
        )
        .catch(() => undefined);
      onClose();
      return;
    }

    const topCols = t.columns.filter((c) => !c.name.includes('.') && c.type !== 'RECORD' && c.type !== 'STRUCT');
    const numCol = topCols.find((c) => /INT|REAL|FLOAT|NUM|DEC/i.test(c.type))?.name;
    const dimCol =
      topCols.find((c) => c.name !== numCol)?.name ?? topCols[0]?.name ?? (isBigQuery ? undefined : 'rowid');

    store.createDashboard(
      {
        title: `${t.name.replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())} Overview`,
        subtitle: `Live SQL dashboard over ${activeSource}.${t.name}`,
        source: activeSource,
        replace: true,
        widgets: [
          {
            id: 'total_rows',
            title: 'Total Records',
            kind: 'kpi',
            sql: `SELECT COUNT(*) AS total_rows FROM ${targetRef}`,
            format: 'number',
            colSpan: 6,
          },
          numCol
            ? {
                id: 'sum_metric',
                title: `Total ${numCol.replace(/_/g, ' ')}`,
                kind: 'kpi',
                sql: `SELECT ROUND(SUM(${quoteCol(numCol)}), 2) AS total_metric FROM ${targetRef}`,
                format: 'compact',
                colSpan: 6,
              }
            : {
                id: 'distinct_dim',
                title: dimCol ? `Distinct ${dimCol.replace(/_/g, ' ')}` : 'Columns',
                kind: 'kpi',
                sql: dimCol
                  ? `SELECT COUNT(DISTINCT ${quoteCol(dimCol)}) AS distinct_values FROM ${targetRef}`
                  : `SELECT ${t.columns.length} AS column_count`,
                format: 'number',
                colSpan: 6,
              },
          ...(dimCol
            ? [
                {
                  id: 'top_breakdown',
                  title: numCol ? `${numCol} by ${dimCol}` : `Records by ${dimCol}`,
                  kind: 'bar' as const,
                  sql: numCol
                    ? `SELECT ${quoteCol(dimCol)} AS category, ROUND(SUM(${quoteCol(numCol)}), 2) AS total FROM ${targetRef} GROUP BY 1 ORDER BY 2 DESC LIMIT 8`
                    : `SELECT ${quoteCol(dimCol)} AS category, COUNT(*) AS records FROM ${targetRef} GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
                  colSpan: 12 as const,
                },
              ]
            : []),
          {
            id: 'raw_records',
            title: `Sample Rows (${t.name})`,
            kind: 'table',
            sql: `SELECT * FROM ${targetRef} LIMIT 40`,
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
        <div className="datasource-header-left">
          <h2 id="datasource-modal-title">Data Sources &amp; BigQuery Catalog</h2>
          <div className="datasource-mode-tabs" role="tablist" aria-label="Data source sections">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'bigquery'}
              className={`source-chip ${tab === 'bigquery' ? 'active' : ''}`}
              onClick={() => setTab('bigquery')}
            >
              <Icon name="cloud_sync" size={16} />
              <span>BigQuery Catalog</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'files'}
              className={`source-chip ${tab === 'files' ? 'active' : ''}`}
              onClick={() => {
                setTab('files');
                void refreshSchema(activeSource);
              }}
            >
              <Icon name="database" size={16} />
              <span>Files &amp; SQL Engines</span>
            </button>
          </div>
        </div>
        <IconButton icon="close" label="Close" onClick={onClose} />
      </header>

      {tab === 'bigquery' ? (
        <section className="dialog-section">
          <BigQueryCatalogPanel
            onCloseModal={onClose}
            onLocalTableLoaded={(tbl) => {
              onTableImported?.(tbl);
              void refreshSchema('local');
            }}
          />
        </section>
      ) : (
        <>
          <section className="dialog-section">
            <div
              className="file-dropzone"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void handleFile(e.dataTransfer.files?.[0]);
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
                  void handleFile(f);
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
                      void refreshSchema(s.id);
                    }}
                  >
                    <Icon name="database" size={16} />
                    <span>{s.label}</span>
                    <small>{connected ? (s.tableCount ? `${s.tableCount} tbl` : 'Ready') : 'Env not set'}</small>
                  </button>
                );
              })}
            </div>

            <div className="schema-browser">
              {busy ? (
                <p className="muted-hint">Inspecting schema…</p>
              ) : tables.length === 0 ? (
                <p className="muted-hint">
                  No tables reported by {activeSource}.
                  {(activeSource === 'bigquery' || activeSource.startsWith('bigquery:')) && (
                    <> Switch to the <strong>BigQuery Catalog</strong> tab above to sync GCP datasets and tables.</>
                  )}
                </p>
              ) : (
                tables.map((t) => (
                  <div key={t.fullName || t.name} className="schema-table-card">
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
        </>
      )}

      <footer className="dialog-actions">
        <button type="button" className="filled-btn" onClick={onClose}>Done</button>
      </footer>
    </dialog>
  );
}
