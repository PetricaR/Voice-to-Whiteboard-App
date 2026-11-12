import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  bqApi,
  compactNumber,
  formatBytes,
  formatDateTime,
  getSessionGcpToken,
  plural,
  setSessionGcpToken,
  useSourceSync,
  type BqDatasetRead,
  type BqPreviewEstimate,
  type BqPreviewResult,
  type BqProjectInfo,
  type BqSourceRead,
  type BqTableSummary,
  type SyncProgressItem,
} from '../../data/bqCatalogClient';
import {
  importRowsIntoLocalTable,
  listAllDataSources,
  type DataSourceInfo,
  type TableSchemaInfo,
} from '../../data/sqlEngine';
import type { CreateDashboardRequest } from '../../engine/dashboard';
import { DiagramStore } from '../../engine/store';
import { Icon, IconButton, useStudio } from '../context';

/** Renders per-project sync progress ported from DS Data Catalog (`SourceSync.tsx`). */
function SyncProgressList({
  items,
  onDismiss,
}: {
  items: SyncProgressItem[];
  onDismiss?: () => void;
}) {
  const [openErr, setOpenErr] = useState<string | null>(null);
  if (items.length === 0) return null;
  const allFinished = items.every((i) => i.status !== 'pending' && i.status !== 'running');

  return (
    <div className="bq-sync-progress" role="status" aria-live="polite">
      <div className="bq-sync-progress-head">
        <span>Sync progress</span>
        {allFinished && onDismiss && (
          <button type="button" className="text-btn small" onClick={onDismiss}>
            Dismiss
          </button>
        )}
      </div>
      <div className="bq-sync-progress-rows">
        {items.map((item) => {
          const r = item.result;
          return (
            <div key={item.key} className={`bq-sync-item status-${item.status}`}>
              <div className="bq-sync-item-main">
                <span className="bq-sync-icon">
                  {item.status === 'running' ? (
                    <span className="bq-spinner" aria-hidden="true" />
                  ) : item.status === 'ok' ? (
                    <Icon name="check_circle" size={16} />
                  ) : item.status === 'partial' || item.status === 'error' ? (
                    <Icon name="error" size={16} />
                  ) : (
                    <Icon name="cloud_sync" size={16} />
                  )}
                </span>
                <span className="bq-sync-label">
                  <strong>{item.label}</strong>
                  {item.sublabel && <code>{item.sublabel}</code>}
                </span>
                <span className="bq-sync-stats">
                  {item.status === 'pending' && 'Queued'}
                  {item.status === 'running' && 'Syncing datasets & schemas…'}
                  {r && (
                    <>
                      +{r.datasets_added + r.datasets_updated} ds · +{r.tables_added + r.tables_updated} tbl ·{' '}
                      {r.columns_synced} cols
                    </>
                  )}
                  {item.status === 'error' && !r && 'Sync failed'}
                  {item.error && item.status !== 'error' && (
                    <button
                      type="button"
                      className="bq-err-toggle"
                      aria-expanded={openErr === item.key}
                      onClick={() => setOpenErr(openErr === item.key ? null : item.key)}
                    >
                      {plural(r?.errors.length ?? 1, 'warning')}
                    </button>
                  )}
                </span>
              </div>
              {item.error && (item.status === 'error' || openErr === item.key) && (
                <div className="bq-sync-error-detail">{item.error}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Inline GCP Project Picker ported from DS Data Catalog (`ProjectPicker.tsx`). */
function ProjectPickerPanel({
  onAdded,
  onCancel,
}: {
  /** `allAdded` is false when some of the chosen projects failed, so the picker stays open to say so. */
  onAdded: (added: BqSourceRead[], allAdded: boolean) => void;
  onCancel: () => void;
}) {
  const [projects, setProjects] = useState<BqProjectInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);

  const fetchProjects = useCallback(() => {
    setLoading(true);
    setError('');
    bqApi
      .listProjects()
      .then(setProjects)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to list GCP projects.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (p) => p.project_id.toLowerCase().includes(q) || p.display_name.toLowerCase().includes(q),
    );
  }, [projects, filter]);

  const toggle = (projectId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  const handleAddSelected = async () => {
    if (selected.size === 0) return;
    setAdding(true);
    setError('');
    const created: BqSourceRead[] = [];
    const failed: string[] = [];
    for (const pid of selected) {
      const info = projects.find((p) => p.project_id === pid);
      try {
        const src = await bqApi.addSource({
          project_id: pid,
          display_name: info && info.display_name !== pid ? info.display_name : null,
        });
        created.push(src);
      } catch (e) {
        failed.push(`${pid}: ${e instanceof Error ? e.message : 'could not be added'}`);
      }
    }
    setAdding(false);
    if (failed.length > 0) setError(failed.join(' · '));
    if (created.length > 0) onAdded(created, failed.length === 0);
    if (failed.length > 0) {
      setSelected(new Set());
      if (created.length > 0) fetchProjects();
    }
  };

  return (
    <div className="bq-subpanel">
      <div className="bq-subpanel-head">
        <strong>Discover accessible GCP projects</strong>
        <button type="button" className="text-btn small" onClick={onCancel}>
          Close
        </button>
      </div>
      <p className="muted-hint">
        Lists the projects the studio server's Google identity can see (on Cloud Run, its service account).
        To list the projects of your own account, paste an access token under <em>Auth</em> first.
      </p>

      {loading ? (
        <p className="muted-hint">Querying Cloud Resource Manager for active GCP projects…</p>
      ) : error && projects.length === 0 ? (
        <div className="widget-error bq-error-with-action" role="alert">
          <span>{error}</span>
          <button type="button" className="text-btn small" onClick={fetchProjects}>
            Retry
          </button>
        </div>
      ) : projects.length === 0 ? (
        <p className="muted-hint">No active GCP projects found for current credentials.</p>
      ) : (
        <>
          {error && (
            <div className="widget-error" role="alert">
              {error}
            </div>
          )}
          <input
            type="search"
            className="bq-input"
            aria-label="Filter projects"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={`Filter ${projects.length} accessible GCP projects…`}
          />
          <div className="bq-project-list">
            {filtered.length === 0 && <p className="muted-hint">No projects match “{filter.trim()}”.</p>}
            {filtered.map((p) => (
              <label
                key={p.project_id}
                className={`bq-project-row${p.already_added ? ' is-added' : ''}`}
              >
                <input
                  type="checkbox"
                  disabled={p.already_added || adding}
                  checked={selected.has(p.project_id)}
                  onChange={() => toggle(p.project_id)}
                />
                <span className="bq-project-names">
                  <strong>{p.display_name}</strong>
                  {p.display_name !== p.project_id && <code>{p.project_id}</code>}
                </span>
                {p.already_added && <span className="row-badge">Added</span>}
              </label>
            ))}
          </div>
          <div className="bq-subpanel-foot">
            <span className="muted-hint">
              {selected.size > 0 ? plural(selected.size, 'project') + ' selected' : 'Select projects to connect & sync'}
            </span>
            <button
              type="button"
              className="filled-btn small"
              disabled={selected.size === 0 || adding}
              onClick={handleAddSelected}
            >
              {adding
                ? 'Connecting…'
                : selected.size > 0
                  ? `Add & Sync ${plural(selected.size, 'Project')}`
                  : 'Add & Sync Projects'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function BigQueryCatalogPanel({
  onCloseModal,
  onLocalTableLoaded,
}: {
  onCloseModal: () => void;
  onLocalTableLoaded?: (table: TableSchemaInfo) => void;
}) {
  const { workspace, store, agent, liveKey, auth, notify } = useStudio();
  const [sources, setSources] = useState<BqSourceRead[]>([]);
  const [datasets, setDatasets] = useState<BqDatasetRead[]>([]);
  const [connectors, setConnectors] = useState<DataSourceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Result of the last load (the app's own toasts sit behind this modal's backdrop)
  const [notice, setNotice] = useState<string | null>(null);

  // Panels: 'none' | 'discover' | 'add' | 'token'
  const [panel, setPanel] = useState<'none' | 'discover' | 'add' | 'token'>('none');
  const canManageSources = !auth.required || (auth.configured && auth.account?.plan === 'owner');

  // Add/Ad-hoc form fields
  const [projectIdInput, setProjectIdInput] = useState('');
  const [displayNameInput, setDisplayNameInput] = useState('');
  const [datasetFilterInput, setDatasetFilterInput] = useState('');
  const [secretNameInput, setSecretNameInput] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Optional session OAuth token (`X-GCP-Access-Token`)
  const [gcpToken, setGcpToken] = useState(getSessionGcpToken);

  // Catalog browser filters & expanded state
  const [projectFilter, setProjectFilter] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [expandedDatasets, setExpandedDatasets] = useState<Set<string>>(new Set());
  // While searching every match is open; these are the ones closed by hand
  const [collapsedInSearch, setCollapsedInSearch] = useState<Set<string>>(new Set());
  const [expandedColumns, setExpandedColumns] = useState<Set<string>>(new Set());

  // Per-table preview & import state
  const [activePreviewKey, setActivePreviewKey] = useState<string | null>(null);
  const [previewEstimate, setPreviewEstimate] = useState<BqPreviewEstimate | null>(null);
  const [previewData, setPreviewData] = useState<BqPreviewResult | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [importingKey, setImportingKey] = useState<string | null>(null);
  const [importingDatasetId, setImportingDatasetId] = useState<string | null>(null);
  // The preview that was asked for last: a slower, older answer must not replace it
  const previewRequest = useRef(0);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [srcs, dsRes, allConns] = await Promise.all([
        bqApi.listSources(),
        bqApi.listDatasets(),
        listAllDataSources(true),
      ]);
      setSources(srcs);
      setDatasets(dsRes.datasets);
      setConnectors(allConns);
      if (dsRes.datasets.length > 0) {
        setExpandedDatasets((prev) => {
          if (prev.size > 0) return prev;
          return new Set(dsRes.datasets.slice(0, 3).map((d) => d.id));
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const sync = useSourceSync(loadCatalog);
  const activeSources = useMemo(() => sources.filter((s) => s.is_active), [sources]);

  // A filter on a project that has since been removed would hide everything with no way back
  const activeProjectFilter =
    sources.length > 1 && sources.some((s) => s.project_id === projectFilter) ? projectFilter : 'ALL';
  const searching = search.trim() !== '';

  const filteredDatasets = useMemo(() => {
    const q = search.trim().toLowerCase();
    return datasets
      .filter((ds) => activeProjectFilter === 'ALL' || ds.project_id === activeProjectFilter)
      .map((ds) => {
        if (!q) return ds;
        const dsHit =
          ds.dataset_id.toLowerCase().includes(q) ||
          ds.project_id.toLowerCase().includes(q) ||
          ds.description.toLowerCase().includes(q);
        if (dsHit) return ds;
        const matchingTables = ds.tables.filter(
          (t) =>
            t.table_id.toLowerCase().includes(q) ||
            t.description.toLowerCase().includes(q) ||
            t.columns.some(
              (c) => c.name.toLowerCase().includes(q) || (c.description ?? '').toLowerCase().includes(q),
            ),
        );
        if (matchingTables.length === 0) return null;
        return { ...ds, tables: matchingTables };
      })
      .filter((d): d is BqDatasetRead => d !== null);
  }, [datasets, activeProjectFilter, search]);

  const stats = useMemo(() => {
    let tables = 0;
    let cols = 0;
    for (const ds of datasets) {
      tables += ds.tables.length;
      for (const t of ds.tables) cols += t.columns.length;
    }
    return {
      projects: sources.length,
      datasets: datasets.length,
      tables,
      columns: cols,
    };
  }, [sources, datasets]);

  const resolveConnectorIdForProject = (projectId: string): string => {
    const primary = connectors.find((c) => c.id === 'bigquery');
    if (primary?.projectId === projectId) return 'bigquery';
    const named = connectors.find((c) => c.id === `bigquery:${projectId}`);
    if (named) return named.id;
    return primary ? `bigquery:${projectId}` : 'bigquery';
  };

  const handleAddSource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectIdInput.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await bqApi.addSource({
        project_id: projectIdInput.trim(),
        display_name: displayNameInput.trim() || null,
        dataset_filter: datasetFilterInput.trim() || null,
        secret_name: secretNameInput.trim() || null,
      });
      setProjectIdInput('');
      setDisplayNameInput('');
      setDatasetFilterInput('');
      setSecretNameInput('');
      setPanel('none');
      await loadCatalog();
      void sync.syncSources([created]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleSourceActive = async (s: BqSourceRead) => {
    try {
      await bqApi.updateSource(s.id, { is_active: !s.is_active });
      await loadCatalog();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRemoveSource = async (s: BqSourceRead) => {
    const name = s.display_name || s.project_id;
    if (!window.confirm(`Remove "${name}" and its synced datasets and tables from the catalog?`)) return;
    try {
      await bqApi.deleteSource(s.id, true);
      await loadCatalog();
      setNotice(`Removed "${name}" from the catalog.`);
      notify(`Removed BigQuery source "${name}".`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const toggleDatasetExpanded = (dsId: string) => {
    const setter = searching ? setCollapsedInSearch : setExpandedDatasets;
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(dsId)) next.delete(dsId);
      else next.add(dsId);
      return next;
    });
  };

  const handleEstimatePreview = async (tbl: BqTableSummary) => {
    const request = ++previewRequest.current;
    if (activePreviewKey === tbl.full_name) {
      setActivePreviewKey(null);
      setPreviewBusy(false);
      return;
    }
    setActivePreviewKey(tbl.full_name);
    setPreviewEstimate(null);
    setPreviewData(null);
    setPreviewError(null);
    setPreviewBusy(true);
    try {
      const est = await bqApi.estimatePreview({
        project_id: tbl.project_id,
        dataset_id: tbl.dataset_id,
        table_id: tbl.table_id,
        limit: 100,
      });
      if (request !== previewRequest.current) return;
      setPreviewEstimate(est);
    } catch (err) {
      if (request !== previewRequest.current) return;
      setPreviewError(err instanceof Error ? err.message : String(err));
    } finally {
      if (request === previewRequest.current) setPreviewBusy(false);
    }
  };

  const handleRunPreview = async (tbl: BqTableSummary) => {
    const request = ++previewRequest.current;
    setPreviewBusy(true);
    setPreviewError(null);
    try {
      const res = await bqApi.runPreview({
        project_id: tbl.project_id,
        dataset_id: tbl.dataset_id,
        table_id: tbl.table_id,
        limit: 100,
      });
      if (request !== previewRequest.current) return;
      setPreviewData(res);
    } catch (err) {
      if (request !== previewRequest.current) return;
      setPreviewError(err instanceof Error ? err.message : String(err));
    } finally {
      if (request === previewRequest.current) setPreviewBusy(false);
    }
  };

  const handleImportTableToLocal = async (tbl: BqTableSummary, silent = false): Promise<TableSchemaInfo | null> => {
    setImportingKey(tbl.full_name);
    try {
      const res = await bqApi.runPreview({
        project_id: tbl.project_id,
        dataset_id: tbl.dataset_id,
        table_id: tbl.table_id,
        limit: 1000,
        sample: false,
      });
      const colTypes: Record<string, string> = {};
      const colDescs: Record<string, string> = {};
      for (const c of tbl.columns) {
        colTypes[c.name] = c.data_type;
        if (c.description) colDescs[c.name] = c.description;
      }
      const meta = await importRowsIntoLocalTable({
        tableName: `${tbl.dataset_id}_${tbl.table_id}`,
        columns: res.columns,
        rows: res.rows,
        dataset: `${tbl.project_id}.${tbl.dataset_id}`,
        datasetLabel: `BigQuery · ${tbl.project_id}.${tbl.dataset_id}`,
        description: tbl.description || `Loaded from BigQuery \`${tbl.full_name}\` (${res.row_count} rows).`,
        columnTypes: colTypes,
        columnDescriptions: colDescs,
      });
      onLocalTableLoaded?.(meta);
      if (!silent) {
        setNotice(`Loaded "${meta.name}" (${plural(meta.rowCount ?? res.row_count, 'row')}) into local SQLite.`);
        notify(`Loaded "${meta.name}" (${meta.rowCount} rows) from BigQuery into local SQLite.`);
      }
      return meta;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Could not load ${tbl.dataset_id}.${tbl.table_id}: ${msg}`);
      return null;
    } finally {
      setImportingKey(null);
    }
  };

  const handleImportDatasetToLocal = async (ds: BqDatasetRead) => {
    const targets = ds.tables.slice(0, 8);
    if (targets.length === 0) return;
    setImportingDatasetId(ds.id);
    setError(null);
    let loadedCount = 0;
    try {
      for (const tbl of targets) {
        const meta = await handleImportTableToLocal(tbl, true);
        if (meta) loadedCount += 1;
      }
    } finally {
      setImportingDatasetId(null);
    }
    if (loadedCount > 0) {
      const skipped = ds.tables.length - targets.length;
      const msg =
        `Loaded ${plural(loadedCount, 'table')} from ${ds.dataset_id} into local SQLite` +
        (skipped > 0 ? ` (the first ${targets.length} of ${ds.tables.length}).` : '.');
      setNotice(msg);
      notify(msg);
    }
  };

  /** Builds a Live SQL Dashboard directly over a BigQuery table using Standard SQL backticks. */
  const handleBuildLiveBqDashboard = (tbl: BqTableSummary) => {
    const connectorId = resolveConnectorIdForProject(tbl.project_id);
    const canAskGemini = liveKey === 'configured' && (!auth.required || (auth.configured && auth.account != null));
    if (canAskGemini) {
      agent
        .sendText(
          `Create a live BigQuery dashboard exploring \`${tbl.full_name}\` using data source "${connectorId}" with KPI headlines, visual breakdowns, and sample rows.`,
        )
        .catch(() => undefined);
      onCloseModal();
      return;
    }

    const topLevelCols = tbl.columns.filter(
      (c) => !c.name.includes('.') && c.mode !== 'REPEATED' && c.data_type !== 'RECORD' && c.data_type !== 'STRUCT',
    );
    const numCol = topLevelCols.find((c) => /^(INT64|INTEGER|FLOAT64|FLOAT|NUMERIC|BIGNUMERIC)$/i.test(c.data_type))?.name;
    const dimCol =
      topLevelCols.find((c) => c.name !== numCol && /^(STRING|DATE|TIMESTAMP|DATETIME|BOOL|BOOLEAN)$/i.test(c.data_type))
        ?.name ??
      topLevelCols.find((c) => c.name !== numCol)?.name ??
      topLevelCols[0]?.name;

    const fq = `\`${tbl.full_name}\``;
    const widgets: CreateDashboardRequest['widgets'] = [
      {
        id: 'total_rows',
        title: 'Total Records',
        kind: 'kpi' as const,
        sql: `SELECT COUNT(*) AS total_rows FROM ${fq}`,
        format: 'number' as const,
        colSpan: 6 as const,
        explanation: `Counts total rows in BigQuery table ${tbl.full_name}.`,
      },
      numCol
        ? {
            id: 'sum_metric',
            title: `Total ${numCol.replace(/_/g, ' ')}`,
            kind: 'kpi' as const,
            sql: `SELECT ROUND(SUM(CAST(\`${numCol}\` AS FLOAT64)), 2) AS total_metric FROM ${fq}`,
            format: 'compact' as const,
            colSpan: 6 as const,
            explanation: `Sums ${numCol} across ${tbl.full_name}.`,
          }
        : {
            id: 'distinct_dim',
            title: dimCol ? `Distinct ${dimCol.replace(/_/g, ' ')}` : 'Schema Columns',
            kind: 'kpi' as const,
            sql: dimCol
              ? `SELECT COUNT(DISTINCT \`${dimCol}\`) AS distinct_count FROM ${fq}`
              : `SELECT ${tbl.columns.length} AS column_count`,
            format: 'number' as const,
            colSpan: 6 as const,
            explanation: dimCol ? `Counts distinct values of ${dimCol}.` : 'Total columns in table schema.',
          },
    ];

    if (dimCol) {
      widgets.push({
        id: 'top_breakdown',
        title: numCol ? `${numCol} by ${dimCol}` : `Records by ${dimCol}`,
        kind: 'bar' as const,
        sql: numCol
          ? `SELECT CAST(\`${dimCol}\` AS STRING) AS category, ROUND(SUM(CAST(\`${numCol}\` AS FLOAT64)), 2) AS total FROM ${fq} WHERE \`${dimCol}\` IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 10`
          : `SELECT CAST(\`${dimCol}\` AS STRING) AS category, COUNT(*) AS records FROM ${fq} WHERE \`${dimCol}\` IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
        format: 'compact' as const,
        colSpan: 12 as const,
        explanation: `Groups ${tbl.table_id} by ${dimCol}.`,
      });
    }

    widgets.push({
      id: 'raw_records',
      title: `Sample Rows (${tbl.dataset_id}.${tbl.table_id})`,
      kind: 'table' as const,
      sql: `SELECT * FROM ${fq} LIMIT 40`,
      format: 'number' as const,
      colSpan: 12 as const,
      explanation: `Fetches live sample records from ${tbl.full_name}.`,
    });

    store.createDashboard(
      {
        title: `${tbl.table_id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())} — BigQuery`,
        subtitle: `Live Standard SQL over ${tbl.full_name}`,
        source: connectorId,
        replace: true,
        widgets,
      },
      { source: 'manual', label: `Built BigQuery dashboard from ${tbl.full_name}` },
    );
    workspace.showView('dashboard');
    onCloseModal();
  };

  /** Draws a BigQuery dataset's tables, inferred relationships, and schema catalog onto the Whiteboard. */
  const handleDrawDatasetOnWhiteboard = async (ds: BqDatasetRead) => {
    const tablesToDraw = ds.tables.slice(0, 16);
    if (tablesToDraw.length === 0) {
      notify(`Dataset "${ds.dataset_id}" has no synced tables to draw.`);
      return;
    }

    const safeSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'item';
    const projGroupId = `gcp_${safeSlug(ds.project_id).slice(0, 20)}`;
    const dsGroupId = `ds_${safeSlug(ds.dataset_id).slice(0, 20)}`;
    const hubId = `bq_${safeSlug(ds.dataset_id).slice(0, 18)}`;

    const nodeIdByTable = new Map<string, string>();
    const nodes = [
      {
        id: hubId,
        label: ds.dataset_id,
        kind: 'analytics',
        tech: 'BigQuery',
        provider: 'gcp',
        description: `${ds.table_count} tables${ds.location ? ` · ${ds.location}` : ''}`,
        group: dsGroupId,
      },
      ...tablesToDraw.map((t, idx) => {
        const nid = `t_${idx + 1}_${safeSlug(t.table_id).slice(0, 16)}`;
        nodeIdByTable.set(t.table_id.toLowerCase(), nid);
        return {
          id: nid,
          label: t.table_id,
          kind: t.table_type === 'VIEW' || t.table_type === 'MATERIALIZED_VIEW' ? 'analytics' : 'database',
          tech: 'BigQuery',
          provider: 'gcp',
          description: `${t.table_type} · ${t.columns.length} cols${t.row_count != null ? ` · ${compactNumber(t.row_count)} rows` : ''}`,
          group: dsGroupId,
        };
      }),
    ];

    // Infer foreign-key edges (`<entity>_id` -> `<entity>` or `<entity>s`) + dataset membership edges
    const edges: { from: string; to: string; label?: string; style?: string }[] = [];
    const connectedTargets = new Set<string>();
    for (const t of tablesToDraw) {
      const fromId = nodeIdByTable.get(t.table_id.toLowerCase())!;
      for (const col of t.columns) {
        const m = /^([a-z0-9_]+)_id$/i.exec(col.name);
        if (!m) continue;
        const stem = m[1].toLowerCase();
        const targetId =
          nodeIdByTable.get(stem) ||
          nodeIdByTable.get(`${stem}s`) ||
          nodeIdByTable.get(`${stem}es`);
        if (targetId && targetId !== fromId) {
          edges.push({ from: fromId, to: targetId, label: col.name, style: 'dashed' });
          connectedTargets.add(fromId);
        }
      }
    }
    for (const t of tablesToDraw) {
      const tid = nodeIdByTable.get(t.table_id.toLowerCase())!;
      edges.push({ from: hubId, to: tid, label: t.table_type === 'VIEW' ? 'view' : undefined });
    }

    const createReq = {
      diagram_type: 'architecture',
      direction: 'LR',
      title: `BigQuery · ${ds.project_id}.${ds.dataset_id}`,
      subtitle: `${ds.table_count} tables${ds.location ? ` in ${ds.location}` : ''} synced from BigQuery Catalog`,
      groups: [
        { id: projGroupId, label: `Google Cloud (${ds.project_id})`, kind: 'region' },
        { id: dsGroupId, label: `Dataset: ${ds.dataset_id}`, kind: 'system', parent: projGroupId },
      ],
      nodes,
      edges,
      replace: true,
    };

    const docBlock = {
      id: 'bq_schema_catalog',
      kind: 'table',
      title: `Schema Catalog — ${ds.project_id}.${ds.dataset_id}`,
      columns: ['Table', 'Type', 'Rows', 'Size', 'Columns'],
      rows: ds.tables.slice(0, 80).map((t) => [
        t.table_id,
        t.table_type,
        compactNumber(t.row_count),
        formatBytes(t.size_bytes),
        t.columns
          .slice(0, 8)
          .map((c) => `${c.name} (${c.data_type})`)
          .join(', ') + (t.columns.length > 8 ? ` +${t.columns.length - 8} more` : ''),
      ]),
    };

    const isEmpty = store.scene.nodes.length === 0 && store.scene.groups.length === 0;
    if (isEmpty) {
      await store.create(createReq, { source: 'manual', label: `Loaded BigQuery dataset ${ds.dataset_id}` });
      store.edit({ write_blocks: [docBlock] }, { source: 'manual', label: `Added ${ds.dataset_id} schema table` });
      workspace.showView('diagram');
    } else {
      const draft = new DiagramStore();
      await draft.create(createReq, { source: 'manual', label: `Loaded BigQuery dataset ${ds.dataset_id}` });
      draft.edit({ write_blocks: [docBlock] }, { source: 'manual', label: `Added ${ds.dataset_id} schema table` });
      workspace.addPage({
        scene: draft.scene,
        view: 'diagram',
        label: `BigQuery · ${ds.dataset_id}`,
      });
    }

    notify(`Loaded ${ds.project_id}.${ds.dataset_id} (${tablesToDraw.length} tables) onto the Whiteboard.`);
    onCloseModal();
  };

  const togglePanel = (next: Exclude<typeof panel, 'none'>) => setPanel(panel === next ? 'none' : next);
  const COLUMN_PREVIEW_COUNT = 12;

  return (
    <div className="bq-catalog-panel">
      {/* Summary & actions */}
      <div className="bq-topbar">
        <dl className="bq-stats-strip" aria-label="Catalog size">
          <div><dt>{stats.projects === 1 ? 'Project' : 'Projects'}</dt><dd>{compactNumber(stats.projects)}</dd></div>
          <div><dt>{stats.datasets === 1 ? 'Dataset' : 'Datasets'}</dt><dd>{compactNumber(stats.datasets)}</dd></div>
          <div><dt>{stats.tables === 1 ? 'Table' : 'Tables'}</dt><dd>{compactNumber(stats.tables)}</dd></div>
          <div><dt>{stats.columns === 1 ? 'Column' : 'Columns'}</dt><dd>{compactNumber(stats.columns)}</dd></div>
        </dl>

        <div className="bq-toolbar-actions">
          <button
            type="button"
            className={`text-btn small${panel === 'token' ? ' active' : ''}`}
            aria-expanded={panel === 'token'}
            title="Configure GCP OAuth access token or ADC"
            onClick={() => togglePanel('token')}
          >
            <Icon name="vpn_key" size={16} /> Auth
          </button>
          {canManageSources ? (
            <>
              <button
                type="button"
                className={`tonal-btn small${panel === 'discover' ? ' active' : ''}`}
                aria-expanded={panel === 'discover'}
                onClick={() => togglePanel('discover')}
              >
                <Icon name="find_in_page" size={16} /> Discover Projects
              </button>
              <button
                type="button"
                className={`tonal-btn small${panel === 'add' ? ' active' : ''}`}
                aria-expanded={panel === 'add'}
                onClick={() => togglePanel('add')}
              >
                <Icon name="add" size={16} /> Add Project
              </button>
              {activeSources.length > 0 && (
                <button
                  type="button"
                  className="filled-btn small"
                  disabled={sync.syncing}
                  onClick={() => sync.syncSources(activeSources)}
                >
                  <Icon name="refresh" size={16} /> {sync.syncing ? 'Syncing…' : 'Sync All'}
                </button>
              )}
            </>
          ) : (
            <span className="muted-hint">Sources managed by studio owner</span>
          )}
        </div>
      </div>

      {(error || notice) && (
        <div className="bq-banners">
          {error && (
            <div className="widget-error bq-banner" role="alert">
              <Icon name="error" size={16} />
              <span>{error}</span>
              <button type="button" className="text-btn small" onClick={() => setError(null)}>
                Dismiss
              </button>
            </div>
          )}
          {notice && !error && (
            <div className="bq-banner bq-banner-ok" role="status">
              <Icon name="check_circle" size={16} />
              <span>{notice}</span>
              <button type="button" className="text-btn small" onClick={() => setNotice(null)}>
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}

      {/* Expandable action panels */}
      {panel === 'discover' && (
        <ProjectPickerPanel
          onCancel={() => setPanel('none')}
          onAdded={async (added, allAdded) => {
            if (allAdded) setPanel('none');
            await loadCatalog();
            void sync.syncSources(added);
          }}
        />
      )}

      {panel === 'add' && canManageSources && (
        <form className="bq-subpanel" onSubmit={handleAddSource}>
          <div className="bq-subpanel-head">
            <strong>Register a GCP project</strong>
            <button type="button" className="text-btn small" onClick={() => setPanel('none')}>
              Close
            </button>
          </div>
          <div className="bq-fields-row">
            <label>
              <span>GCP project ID *</span>
              <input
                required
                className="bq-input"
                value={projectIdInput}
                onChange={(e) => setProjectIdInput(e.target.value)}
                placeholder="analytics-prod-123"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <label>
              <span>Display name</span>
              <input
                className="bq-input"
                value={displayNameInput}
                onChange={(e) => setDisplayNameInput(e.target.value)}
                placeholder="Production Analytics"
              />
            </label>
            <label>
              <span>Dataset prefix filter</span>
              <input
                className="bq-input"
                value={datasetFilterInput}
                onChange={(e) => setDatasetFilterInput(e.target.value)}
                placeholder="mart_ (optional)"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <label>
              <span>Secret Manager SA key</span>
              <input
                className="bq-input"
                value={secretNameInput}
                onChange={(e) => setSecretNameInput(e.target.value)}
                placeholder="bq-reader-sa (optional)"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          </div>
          <div className="bq-subpanel-foot">
            <span className="muted-hint">
              Uses the server's ADC (<code>gcloud auth application-default login</code>),{' '}
              <code>BIGQUERY_ACCESS_TOKEN</code>, or the Secret Manager key.
            </span>
            <button type="submit" className="filled-btn small" disabled={submitting || sync.syncing}>
              {submitting ? 'Adding…' : 'Add & Sync'}
            </button>
          </div>
        </form>
      )}

      {panel === 'token' && (
        <div className="bq-subpanel">
          <div className="bq-subpanel-head">
            <strong>Google Cloud authentication</strong>
            <button type="button" className="text-btn small" onClick={() => setPanel('none')}>
              Close
            </button>
          </div>
          <p className="muted-hint">
            By default the Studio server authenticates with Application Default Credentials
            (<code>gcloud auth application-default login</code>), Cloud Run workload identity, or per-project Secret
            Manager keys. You can also paste a short-lived OAuth token (<code>gcloud auth print-access-token</code>)
            for this browser session:
          </p>
          <div className="bq-inline-actions">
            <input
              type="password"
              className="bq-input"
              aria-label="GCP access token"
              autoComplete="off"
              value={gcpToken}
              onChange={(e) => setGcpToken(e.target.value)}
              placeholder="ya29.a0AfH6SM… (optional session override)"
            />
            <button
              type="button"
              className="filled-btn small"
              onClick={() => {
                setSessionGcpToken(gcpToken);
                setPanel('none');
                const msg = gcpToken.trim()
                  ? 'Saved GCP session token.'
                  : 'Cleared GCP session token (using server ADC).';
                setNotice(msg);
                notify(msg);
              }}
            >
              Save
            </button>
          </div>
        </div>
      )}

      <SyncProgressList items={sync.items} onDismiss={sync.clear} />

      {/* Registered GCP projects */}
      {sources.length > 0 && (
        <section className="bq-section" aria-label="Connected projects">
          <h3 className="bq-section-title">Connected projects</h3>
          <ul className="bq-source-list">
            {sources.map((s) => (
              <li key={s.id} className={`bq-source-row${s.is_active ? '' : ' is-paused'}`}>
                <label className="bq-switch" title={s.is_active ? 'Included in Sync All' : 'Paused'}>
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label={`${s.display_name || s.project_id} is active`}
                    disabled={!canManageSources}
                    checked={s.is_active}
                    onChange={() => handleToggleSourceActive(s)}
                  />
                </label>
                <div className="bq-source-meta">
                  <div className="bq-source-title">
                    <strong>{s.display_name || s.project_id}</strong>
                    {s.display_name && <code>{s.project_id}</code>}
                  </div>
                  <div className="bq-source-sub">
                    <span>{s.is_active ? `Synced ${formatDateTime(s.last_synced_at)}` : 'Paused'}</span>
                    {s.dataset_filter && (
                      <span className="row-badge" title="Dataset prefix filter">{s.dataset_filter}*</span>
                    )}
                    {s.secret_name && (
                      <span className="row-badge" title="Secret Manager service-account key">
                        Key: {s.secret_name}
                      </span>
                    )}
                  </div>
                </div>
                {canManageSources && (
                  <div className="bq-source-btns">
                    <button
                      type="button"
                      className="tonal-btn small"
                      disabled={sync.syncing || !s.is_active}
                      onClick={() => sync.syncSources([s])}
                    >
                      <Icon name="refresh" size={15} /> Sync
                    </button>
                    <IconButton icon="delete" label={`Remove ${s.project_id}`} onClick={() => handleRemoveSource(s)} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Search & project filter */}
      <section className="bq-section" aria-label="Datasets and tables">
        {(datasets.length > 0 || searching) && (
          <div className="bq-browser-controls">
            <h3 className="bq-section-title">Datasets &amp; tables</h3>
            <input
              type="search"
              className="bq-input"
              aria-label="Search the catalog"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCollapsedInSearch(new Set());
              }}
              placeholder="Search datasets, tables, descriptions or columns…"
            />
            {sources.length > 1 && (
              <div className="source-tabs" role="group" aria-label="Filter by project">
                <button
                  type="button"
                  className={`source-chip ${activeProjectFilter === 'ALL' ? 'active' : ''}`}
                  aria-pressed={activeProjectFilter === 'ALL'}
                  onClick={() => setProjectFilter('ALL')}
                >
                  <span>All projects</span>
                </button>
                {sources.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`source-chip ${activeProjectFilter === s.project_id ? 'active' : ''}`}
                    aria-pressed={activeProjectFilter === s.project_id}
                    onClick={() => setProjectFilter(s.project_id)}
                  >
                    <span>{s.display_name || s.project_id}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Dataset & table tree */}
        <div className="bq-dataset-list">
          {loading && datasets.length === 0 ? (
            <p className="muted-hint">Loading BigQuery catalog…</p>
          ) : filteredDatasets.length === 0 ? (
            <div className="bq-empty-box">
              <Icon name="cloud_sync" size={28} />
              <strong>
                {sources.length === 0
                  ? 'No BigQuery projects connected yet'
                  : datasets.length === 0
                    ? 'Projects connected — nothing synced yet'
                    : 'No datasets or tables match'}
              </strong>
              <p className="muted-hint">
                {sources.length === 0
                  ? canManageSources
                    ? 'Connect a Google Cloud project, sync its datasets and schemas, then load tables into live dashboards, local SQLite or the whiteboard.'
                    : 'An owner of this studio has not connected any Google Cloud projects yet.'
                  : datasets.length === 0
                    ? canManageSources
                      ? 'Run Sync All to pull the datasets, tables and schemas of the connected projects.'
                      : 'An owner of this studio has not synced the connected projects yet.'
                    : 'Try another search, or another project.'}
              </p>
              {sources.length === 0 && canManageSources ? (
                <div className="bq-empty-actions">
                  <button type="button" className="filled-btn small" onClick={() => setPanel('discover')}>
                    <Icon name="find_in_page" size={16} /> Discover Projects
                  </button>
                  <button type="button" className="tonal-btn small" onClick={() => setPanel('add')}>
                    <Icon name="add" size={16} /> Add Project
                  </button>
                </div>
              ) : datasets.length > 0 ? (
                <div className="bq-empty-actions">
                  <button
                    type="button"
                    className="tonal-btn small"
                    onClick={() => {
                      setSearch('');
                      setProjectFilter('ALL');
                    }}
                  >
                    Clear filters
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            filteredDatasets.map((ds) => {
              const expanded = searching ? !collapsedInSearch.has(ds.id) : expandedDatasets.has(ds.id);
              const dsImporting = importingDatasetId === ds.id;
              return (
                <div key={ds.id} className={`bq-dataset-card${expanded ? ' is-open' : ''}`}>
                  <div className="bq-dataset-head">
                    <button
                      type="button"
                      className="bq-dataset-toggle"
                      onClick={() => toggleDatasetExpanded(ds.id)}
                      aria-expanded={expanded}
                    >
                      <Icon name="chevron_right" size={18} className={expanded ? 'bq-chevron open' : 'bq-chevron'} />
                      <span className="bq-dataset-name">
                        <strong>{ds.dataset_id}</strong>
                        <code>{ds.project_id}</code>
                      </span>
                      <span className="bq-dataset-badges">
                        {ds.location && <span className="row-badge">{ds.location}</span>}
                        <span className="row-badge">{plural(ds.tables.length, 'table')}</span>
                      </span>
                    </button>

                    <div className="bq-dataset-actions">
                      <button
                        type="button"
                        className="text-btn small"
                        disabled={importingDatasetId !== null || importingKey !== null || ds.tables.length === 0}
                        title="Import this dataset's tables (up to 8) into local in-browser SQLite-Wasm"
                        onClick={() => handleImportDatasetToLocal(ds)}
                      >
                        <Icon name="download" size={15} /> {dsImporting ? 'Loading…' : 'Load to SQLite'}
                      </button>
                      <button
                        type="button"
                        className="text-btn small"
                        disabled={ds.tables.length === 0}
                        title="Draw dataset schema & table relationships on the Whiteboard"
                        onClick={() => handleDrawDatasetOnWhiteboard(ds)}
                      >
                        <Icon name="account_tree" size={15} /> Whiteboard
                      </button>
                    </div>
                  </div>

                  {ds.description && <p className="bq-dataset-desc">{ds.description}</p>}

                  {expanded && (
                    <div className="bq-tables-container">
                      {ds.tables.length === 0 ? (
                        <p className="muted-hint">No tables synced in this dataset.</p>
                      ) : (
                        ds.tables.map((tbl) => {
                          const isPreviewOpen = activePreviewKey === tbl.full_name;
                          const isImporting = importingKey === tbl.full_name;
                          const allColumns = expandedColumns.has(tbl.full_name);
                          const shownColumns = allColumns ? tbl.columns : tbl.columns.slice(0, COLUMN_PREVIEW_COUNT);
                          const hiddenColumns = tbl.columns.length - COLUMN_PREVIEW_COUNT;
                          return (
                            <div key={tbl.full_name} className="bq-table-card">
                              <div className="bq-table-head">
                                <div className="bq-table-info">
                                  <code className="bq-table-name">{tbl.table_id}</code>
                                  <div className="bq-table-meta">
                                    <span className="row-badge">{tbl.table_type.replace(/_/g, ' ')}</span>
                                    {tbl.row_count != null && <span>{compactNumber(tbl.row_count)} rows</span>}
                                    {tbl.size_bytes != null && <span>{formatBytes(tbl.size_bytes)}</span>}
                                    <span>{plural(tbl.columns.length, 'column')}</span>
                                  </div>
                                  {tbl.description && <p className="bq-table-desc">{tbl.description}</p>}
                                </div>

                                <div className="bq-table-actions">
                                  <button
                                    type="button"
                                    className={`text-btn small${isPreviewOpen ? ' active' : ''}`}
                                    aria-expanded={isPreviewOpen}
                                    onClick={() => handleEstimatePreview(tbl)}
                                  >
                                    <Icon name={isPreviewOpen ? 'visibility_off' : 'visibility'} size={15} /> Preview
                                  </button>
                                  <button
                                    type="button"
                                    className="tonal-btn small"
                                    disabled={importingKey !== null || importingDatasetId !== null}
                                    title="Pull up to 1,000 rows from BigQuery into local SQLite-Wasm"
                                    onClick={() => handleImportTableToLocal(tbl)}
                                  >
                                    <Icon name="download" size={15} /> {isImporting ? 'Loading…' : 'Load to SQLite'}
                                  </button>
                                  <button
                                    type="button"
                                    className="filled-btn small"
                                    onClick={() => handleBuildLiveBqDashboard(tbl)}
                                  >
                                    <Icon name="bar_chart" size={15} /> Live Dashboard
                                  </button>
                                </div>
                              </div>

                              {tbl.columns.length > 0 && (
                                <div className="schema-cols">
                                  {shownColumns.map((c) => (
                                    <span key={c.name} className="col-pill" title={c.description ?? undefined}>
                                      <code>{c.name}</code> <small>{c.data_type}</small>
                                    </span>
                                  ))}
                                  {hiddenColumns > 0 && (
                                    <button
                                      type="button"
                                      className="col-pill col-pill-more"
                                      aria-expanded={allColumns}
                                      onClick={() =>
                                        setExpandedColumns((prev) => {
                                          const next = new Set(prev);
                                          if (next.has(tbl.full_name)) next.delete(tbl.full_name);
                                          else next.add(tbl.full_name);
                                          return next;
                                        })
                                      }
                                    >
                                      {allColumns ? 'Show fewer' : `+${hiddenColumns} more`}
                                    </button>
                                  )}
                                </div>
                              )}

                              {isPreviewOpen && (
                                <div className="bq-preview-drawer">
                                  {previewBusy && !previewEstimate && (
                                    <p className="muted-hint">Running dry-run byte &amp; cost estimate…</p>
                                  )}
                                  {previewError && (
                                    <div className="widget-error" role="alert">
                                      {previewError}
                                    </div>
                                  )}
                                  {previewEstimate && (
                                    <div className="bq-preview-meta">
                                      <div className="bq-preview-estimate">
                                        <span className="muted-hint">
                                          Dry-run scan: <strong>{formatBytes(previewEstimate.estimated_bytes)}</strong> ·
                                          Est. cost:{' '}
                                          <strong>
                                            ${previewEstimate.estimated_cost_usd < 0.0001 && previewEstimate.estimated_bytes > 0
                                              ? '<0.0001'
                                              : previewEstimate.estimated_cost_usd.toFixed(4)}
                                          </strong>
                                        </span>
                                        <code className="bq-preview-sql">{previewEstimate.query}</code>
                                      </div>
                                      {!previewData && (
                                        <button
                                          type="button"
                                          className="tonal-btn small"
                                          disabled={previewBusy}
                                          onClick={() => handleRunPreview(tbl)}
                                        >
                                          <Icon name="play_arrow" size={15} />{' '}
                                          {previewBusy ? 'Querying…' : 'Fetch 100 Rows'}
                                        </button>
                                      )}
                                    </div>
                                  )}
                                  {previewData && previewData.rows.length === 0 && (
                                    <p className="muted-hint">The query returned no rows.</p>
                                  )}
                                  {previewData && previewData.rows.length > 0 && (
                                    <>
                                      <div className="bq-preview-table-wrap" tabIndex={0}>
                                        <table className="bq-preview-table">
                                          <thead>
                                            <tr>
                                              {previewData.columns.map((col) => (
                                                <th key={col}>{col}</th>
                                              ))}
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {previewData.rows.map((r, rIdx) => (
                                              <tr key={rIdx}>
                                                {r.map((cell, cIdx) =>
                                                  cell === null ? (
                                                    <td key={cIdx} className="is-null">NULL</td>
                                                  ) : (
                                                    <td key={cIdx} className={typeof cell === 'number' ? 'is-num' : undefined}>
                                                      {String(cell)}
                                                    </td>
                                                  ),
                                                )}
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                      <span className="muted-hint">
                                        {plural(previewData.rows.length, 'row')}
                                        {previewData.truncated ? ' (truncated)' : ''} · scroll to see more
                                      </span>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
