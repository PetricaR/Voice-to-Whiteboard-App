/**
 * Browser client & sequential per-project sync hook for the BigQuery Data Catalog API.
 *
 * Ported from DS Data Catalog (`catalog_app/frontend/src/api/bq.ts`,
 * `components/SourceSync.tsx`, and `utils/format.ts`).
 */
import { useCallback, useState } from 'react';
import { invalidateDataSourcesCache } from './sqlEngine';

const GCP_TOKEN_SESSION_KEY = 'studio.gcp.access_token';

export interface BqSourceRead {
  id: string;
  project_id: string;
  display_name: string | null;
  dataset_filter: string | null;
  secret_name: string | null;
  is_active: boolean;
  last_synced_at: string | null;
  created_at: string;
}

export interface BqProjectInfo {
  project_id: string;
  display_name: string;
  already_added: boolean;
}

export interface BqColumnSchema {
  name: string;
  data_type: string;
  mode: string;
  description: string | null;
}

export interface BqTableSummary {
  id: string;
  project_id: string;
  dataset_id: string;
  table_id: string;
  full_name: string;
  table_type: string;
  description: string;
  row_count: number | null;
  size_bytes: number | null;
  created_at_bq: string | null;
  modified_at_bq: string | null;
  synced_at: string;
  columns: BqColumnSchema[];
}

export interface BqDatasetRead {
  id: string;
  project_id: string;
  dataset_id: string;
  location: string | null;
  description: string;
  labels: Record<string, string>;
  table_count: number;
  synced_at: string;
  tables: BqTableSummary[];
}

export interface BqSyncResult {
  project_id: string;
  datasets_added: number;
  datasets_updated: number;
  tables_added: number;
  tables_updated: number;
  columns_synced: number;
  errors: string[];
}

export interface BqPreviewEstimate {
  query: string;
  estimated_bytes: number;
  estimated_cost_usd: number;
}

export interface BqPreviewResult {
  query: string;
  columns: string[];
  rows: (string | number | boolean | null)[][];
  row_count: number;
  truncated: boolean;
}

export function getSessionGcpToken(): string {
  try {
    return sessionStorage.getItem(GCP_TOKEN_SESSION_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setSessionGcpToken(token: string): void {
  try {
    const trimmed = token.trim();
    if (trimmed) sessionStorage.setItem(GCP_TOKEN_SESSION_KEY, trimmed);
    else sessionStorage.removeItem(GCP_TOKEN_SESSION_KEY);
  } catch {
    // ignore storage errors
  }
}

async function bqRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getSessionGcpToken();
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { 'X-GCP-Access-Token': token } : {}),
    ...(init.headers as Record<string, string> | undefined),
  };
  const res = await fetch(path, { ...init, headers });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload?.message || payload?.error || `BigQuery API error (${res.status}).`);
  }
  return payload as T;
}

export const bqApi = {
  listProjects: () => bqRequest<BqProjectInfo[]>('/api/data/bq/projects'),

  listSources: () => bqRequest<BqSourceRead[]>('/api/data/bq/sources'),

  addSource: (body: {
    project_id: string;
    display_name?: string | null;
    dataset_filter?: string | null;
    secret_name?: string | null;
  }) =>
    bqRequest<BqSourceRead>('/api/data/bq/sources', {
      method: 'POST',
      body: JSON.stringify(body),
    }).then((src) => {
      invalidateDataSourcesCache();
      return src;
    }),

  updateSource: (
    id: string,
    body: {
      display_name?: string | null;
      dataset_filter?: string | null;
      secret_name?: string | null;
      is_active?: boolean;
    },
  ) =>
    bqRequest<BqSourceRead>(`/api/data/bq/sources/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }).then((src) => {
      invalidateDataSourcesCache();
      return src;
    }),

  deleteSource: (id: string, purge = false) =>
    bqRequest<{ ok: boolean }>(`/api/data/bq/sources/${encodeURIComponent(id)}${purge ? '?purge=1' : ''}`, {
      method: 'DELETE',
    }).then((r) => {
      invalidateDataSourcesCache();
      return r;
    }),

  sync: (body: {
    project_id: string;
    secret_name?: string | null;
    secret_version?: string;
    dataset_filter?: string | null;
  }) =>
    bqRequest<BqSyncResult>('/api/data/bq/sync', {
      method: 'POST',
      body: JSON.stringify(body),
    }).then((r) => {
      invalidateDataSourcesCache();
      return r;
    }),

  syncAll: () =>
    bqRequest<BqSyncResult[]>('/api/data/bq/sync/all', {
      method: 'POST',
    }).then((r) => {
      invalidateDataSourcesCache();
      return r;
    }),

  syncSource: (id: string) =>
    bqRequest<BqSyncResult>(`/api/data/bq/sync/source/${encodeURIComponent(id)}`, {
      method: 'POST',
    }).then((r) => {
      invalidateDataSourcesCache();
      return r;
    }),

  listDatasets: (opts: { project_id?: string; search?: string } = {}) => {
    const qs = new URLSearchParams();
    if (opts.project_id) qs.set('project_id', opts.project_id);
    if (opts.search) qs.set('search', opts.search);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return bqRequest<{ datasets: BqDatasetRead[] }>(`/api/data/bq/datasets${suffix}`);
  },

  estimatePreview: (opts: { project_id: string; dataset_id: string; table_id: string; limit?: number }) => {
    const qs = new URLSearchParams({
      project_id: opts.project_id,
      dataset_id: opts.dataset_id,
      table_id: opts.table_id,
    });
    if (opts.limit) qs.set('limit', String(opts.limit));
    return bqRequest<BqPreviewEstimate>(`/api/data/bq/preview?${qs.toString()}`);
  },

  runPreview: (opts: {
    project_id: string;
    dataset_id: string;
    table_id: string;
    limit?: number;
    sample?: boolean;
  }) =>
    bqRequest<BqPreviewResult>('/api/data/bq/preview/run', {
      method: 'POST',
      body: JSON.stringify(opts),
    }),
};

export interface SyncProgressItem {
  key: string;
  label: string;
  sublabel?: string;
  status: 'pending' | 'running' | 'ok' | 'partial' | 'error';
  result?: BqSyncResult;
  error?: string;
}

/**
 * Sequential per-project sync state hook ported from DS Data Catalog's `SourceSync.tsx`.
 */
export function useSourceSync(onDone?: () => void) {
  const [items, setItems] = useState<SyncProgressItem[]>([]);
  const [syncing, setSyncing] = useState(false);

  const patchItem = (key: string, patch: Partial<SyncProgressItem>) =>
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));

  const syncSources = useCallback(
    async (sources: BqSourceRead[]) => {
      if (sources.length === 0) return;
      setSyncing(true);
      setItems(
        sources.map((s) => ({
          key: s.id,
          label: s.display_name || s.project_id,
          sublabel: s.display_name ? s.project_id : undefined,
          status: 'pending',
        })),
      );

      for (const s of sources) {
        patchItem(s.id, { status: 'running' });
        try {
          const res = await bqApi.syncSource(s.id);
          const hasErrors = res.errors.length > 0;
          const syncedAny = res.datasets_added + res.datasets_updated + res.tables_added + res.tables_updated > 0;
          patchItem(s.id, {
            status: !hasErrors ? 'ok' : syncedAny ? 'partial' : 'error',
            result: res,
            error: hasErrors ? res.errors.join(' · ') : undefined,
          });
        } catch (err) {
          patchItem(s.id, {
            status: 'error',
            error: err instanceof Error ? err.message : 'Sync failed',
          });
        }
      }

      setSyncing(false);
      onDone?.();
    },
    [onDone],
  );

  const syncAdHoc = useCallback(
    async (params: { project_id: string; dataset_filter?: string | null; secret_name?: string | null }) => {
      const key = params.project_id.trim();
      if (!key) return;
      setSyncing(true);
      setItems([{ key, label: key, status: 'running' }]);
      try {
        const res = await bqApi.sync(params);
        const hasErrors = res.errors.length > 0;
        const syncedAny = res.datasets_added + res.datasets_updated + res.tables_added + res.tables_updated > 0;
        patchItem(key, {
          status: !hasErrors ? 'ok' : syncedAny ? 'partial' : 'error',
          result: res,
          error: hasErrors ? res.errors.join(' · ') : undefined,
        });
      } catch (err) {
        patchItem(key, {
          status: 'error',
          error: err instanceof Error ? err.message : 'Sync failed',
        });
      }
      setSyncing(false);
      onDone?.();
    },
    [onDone],
  );

  const clear = useCallback(() => setItems([]), []);

  return { items, syncing, syncSources, syncAdHoc, clear };
}

export function compactNumber(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return '—';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / 1024 ** exp;
  return `${val >= 10 || exp === 0 ? val.toFixed(0) : val.toFixed(1)} ${units[exp]}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function plural(count: number, singular: string, pluralWord = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralWord}`;
}
