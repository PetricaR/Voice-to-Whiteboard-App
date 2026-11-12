/**
 * Unified SQL Data Engine:
 *   - Runs instant, zero-config SQLite-Wasm (`sql.js`) in the browser & Vitest Node,
 *     preloaded with 4 multi-table enterprise sample datasets.
 *   - Supports drag-and-drop / file upload of `.csv`, `.tsv`, `.json`, `.jsonl`, and
 *     `.parquet` (via `hyparquet`) directly into live queryable SQL tables.
 *   - Transparently delegates remote read-only connector queries (`bigquery`,
 *     `clickhouse`, `postgres`, `rest:*`) to `/api/data/query` on the studio server.
 */
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { parquetReadObjects } from 'hyparquet';
import { SAMPLE_TABLES, type SampleColumnSpec } from './sampleDatasets';
import { bindSqlParams, dialectOfSource, validateReadOnlySql, type SqlParamValue } from './sqlGuard';

export interface DataColumnMeta {
  name: string;
  type: string;
  mode?: string;
  description?: string;
}

export interface DataTableMeta {
  name: string;
  fullName?: string;
  projectId?: string;
  datasetId?: string;
  tableId?: string;
  source: string;
  dataset: string;
  datasetLabel: string;
  description: string;
  rowCount: number;
  sizeBytes?: number | null;
  location?: string | null;
  tableType?: string;
  columns: DataColumnMeta[];
  uploaded?: boolean;
}

/** What a column holds: its few distinct values, or its smallest and largest value. */
export interface ColumnProfile {
  distinct: number;
  values?: (string | number)[];
  min?: string | number;
  max?: string | number;
}

export type TableSchemaInfo = DataTableMeta & {
  sampleRows?: (string | number | boolean | null)[][];
  /** By column name; only for local tables inspected with `profile: true`. */
  columnProfiles?: Record<string, ColumnProfile>;
};

/** Columns with at most this many distinct values are listed value by value. */
const PROFILE_MAX_VALUES = 12;
/** Tables beyond these sizes are not profiled: the scan would be felt in the UI. */
const PROFILE_MAX_ROWS = 250_000;
const PROFILE_MAX_TABLES = 12;

/**
 * Distinct values of low-cardinality columns and the range of the others, so
 * SQL written against the table uses literals that exist ('North America',
 * '2026-10') instead of guessed ones.
 */
function profileLocalTable(db: Database, table: DataTableMeta): Record<string, ColumnProfile> {
  const out: Record<string, ColumnProfile> = {};
  const quote = (id: string) => `"${id.replace(/"/g, '""')}"`;
  const scalar = (v: unknown): string | number | undefined =>
    (typeof v === 'number' ? v : typeof v === 'string' ? (v.length > 40 ? `${v.slice(0, 39)}…` : v) : undefined);
  for (const col of table.columns) {
    try {
      const c = quote(col.name);
      const stats = db.exec(`SELECT COUNT(DISTINCT ${c}), MIN(${c}), MAX(${c}) FROM ${quote(table.name)};`)[0]?.values[0];
      if (!stats) continue;
      const distinct = Number(stats[0]) || 0;
      const profile: ColumnProfile = { distinct };
      const isText = typeof stats[1] === 'string';
      if (isText && distinct > 0 && distinct <= PROFILE_MAX_VALUES) {
        const rows = db.exec(`SELECT DISTINCT ${c} FROM ${quote(table.name)} WHERE ${c} IS NOT NULL ORDER BY 1 LIMIT ${PROFILE_MAX_VALUES};`)[0]?.values ?? [];
        profile.values = rows.map((r) => scalar(r[0])).filter((v): v is string | number => v !== undefined);
      } else {
        const min = scalar(stats[1]);
        const max = scalar(stats[2]);
        if (min !== undefined) profile.min = min;
        if (max !== undefined) profile.max = max;
      }
      out[col.name] = profile;
    } catch {
      // A column that cannot be profiled is described by its type only
    }
  }
  return out;
}

export interface DataSourceInfo {
  id: string;
  label: string;
  kind: 'local' | 'bigquery' | 'clickhouse' | 'postgres' | 'rest';
  status: 'connected' | 'available';
  description: string;
  projectId?: string;
  tableCount?: number;
}

export interface QueryExecutionResult {
  ok: boolean;
  source: string;
  sql: string;
  boundSql: string;
  columns: string[];
  rows: (string | number | boolean | null)[][];
  rowCount: number;
  truncated: boolean;
  durationMs: number;
  executedAt: string;
  error?: string;
}

let sqlPromise: Promise<SqlJsStatic> | null = null;
let dbInstance: Database | null = null;
let initPromise: Promise<Database> | null = null;

const customTables = new Map<string, DataTableMeta>();
const dataListeners = new Set<() => void>();
let remoteSourcesCache: DataSourceInfo[] | null = null;
const REMOTE_QUERY_DEDUPE_TTL_MS = 1_500;
const remoteInFlight = new Map<string, Promise<QueryExecutionResult>>();
const remoteFreshCache = new Map<string, { expiresAt: number; result: QueryExecutionResult }>();

function sessionGcpTokenHeader(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const tok = window.sessionStorage?.getItem('studio.gcp.access_token')?.trim();
    return tok ? { 'X-GCP-Access-Token': tok } : {};
  } catch {
    return {};
  }
}

export function subscribeDataEngine(listener: () => void): () => void {
  dataListeners.add(listener);
  return () => dataListeners.delete(listener);
}

function notifyDataChanged() {
  for (const l of dataListeners) l();
}

export function invalidateDataSourcesCache() {
  remoteSourcesCache = null;
  remoteFreshCache.clear();
  notifyDataChanged();
}

async function loadSqlJsRuntime(): Promise<SqlJsStatic> {
  if (sqlPromise) return sqlPromise;
  sqlPromise = (async () => {
    const isNode = typeof window === 'undefined' && typeof process !== 'undefined' && Boolean(process.versions?.node);
    if (isNode) {
      const fsMod = await import(/* @vite-ignore */ 'node:' + 'fs');
      const urlMod = await import(/* @vite-ignore */ 'node:' + 'url');
      const wasmPath = urlMod.fileURLToPath(new URL('../../public/sql-wasm.wasm', import.meta.url));
      const wasmBinary = fsMod.readFileSync(wasmPath);
      return initSqlJs({ wasmBinary: wasmBinary.buffer.slice(wasmBinary.byteOffset, wasmBinary.byteOffset + wasmBinary.byteLength) });
    }
    return initSqlJs({
      locateFile: () => '/sql-wasm.wasm',
    });
  })();
  return sqlPromise;
}

function seedSampleTables(db: Database) {
  for (const table of SAMPLE_TABLES) {
    const colsDef = table.columns.map((c) => `"${c.name}" ${c.type}`).join(', ');
    db.run(`CREATE TABLE IF NOT EXISTS "${table.name}" (${colsDef});`);
    const placeholders = table.columns.map(() => '?').join(', ');
    const stmt = db.prepare(`INSERT INTO "${table.name}" VALUES (${placeholders});`);
    db.run('BEGIN TRANSACTION;');
    try {
      for (const row of table.rows) {
        stmt.run(row);
      }
      db.run('COMMIT;');
    } catch (e) {
      db.run('ROLLBACK;');
      throw e;
    } finally {
      stmt.free();
    }
  }
}

export async function getLocalDatabase(): Promise<Database> {
  if (dbInstance) return dbInstance;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const SQL = await loadSqlJsRuntime();
    const db = new SQL.Database();
    seedSampleTables(db);
    dbInstance = db;
    return db;
  })();
  return initPromise;
}

export function sanitizeSqlIdentifier(raw: string, fallback = 'col'): string {
  const cleaned = raw
    .trim()
    .replace(/\.[^.]+$/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!cleaned) return fallback;
  return /^[0-9]/.test(cleaned) ? `t_${cleaned}` : cleaned;
}

/** RFC-4180 compliant CSV / TSV parser supporting quoted multiline cells and escaped quotes. */
export function parseDelimitedText(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, '');
  const n = src.length;

  for (let i = 0; i < n; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((c) => c.trim() !== '') || rows.length === 0) {
        rows.push(row);
      }
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (row.some((c) => c.trim() !== '')) rows.push(row);
  }
  return rows;
}

function inferCellValue(raw: unknown): string | number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'boolean') return raw ? 1 : 0;
  if (typeof raw === 'bigint') return Number(raw);
  if (raw instanceof Date) return raw.toISOString();
  const s = String(raw).trim();
  if (s === '' || /^null$/i.test(s) || /^na$/i.test(s) || /^n\/a$/i.test(s)) return null;
  // Clean currency/comma numbers ONLY if strictly numeric format like 1234.56 or -42
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const num = Number(s);
    if (Number.isFinite(num)) return num;
  }
  return typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
}

function inferColumnType(values: (string | number | null)[]): SampleColumnSpec['type'] {
  let sawNumber = false;
  let allInteger = true;
  for (const v of values) {
    if (v === null) continue;
    if (typeof v === 'number') {
      sawNumber = true;
      if (!Number.isInteger(v)) allInteger = false;
    } else {
      return 'TEXT';
    }
  }
  if (!sawNumber) return 'TEXT';
  return allInteger ? 'INTEGER' : 'REAL';
}

export interface ImportedFileInput {
  name: string;
  text?: string;
  bytes?: Uint8Array;
  tableName?: string;
}

/** Imports a `.csv`, `.tsv`, `.json`, `.jsonl`, or `.parquet` file as a live SQL table. */
export async function importDataFile(rawInput: ImportedFileInput | File): Promise<DataTableMeta> {
  const input: ImportedFileInput = 'arrayBuffer' in rawInput && typeof rawInput.arrayBuffer === 'function'
    ? { name: rawInput.name, bytes: new Uint8Array(await rawInput.arrayBuffer()) }
    : (rawInput as ImportedFileInput);
  const db = await getLocalDatabase();
  const ext = (input.name.split('.').pop() ?? 'csv').toLowerCase();
  const tableName = sanitizeSqlIdentifier(input.tableName ?? input.name, 'uploaded_data');

  let headers: string[] = [];
  let rawRows: (string | number | null)[][] = [];

  if (ext === 'parquet') {
    if (!input.bytes) throw new Error('Parquet import requires binary bytes.');
    const ab = input.bytes.buffer.slice(input.bytes.byteOffset, input.bytes.byteOffset + input.bytes.byteLength) as ArrayBuffer;
    const objects = await parquetReadObjects({ file: ab });
    if (objects.length === 0) throw new Error(`Parquet file "${input.name}" contains 0 rows.`);
    const keys = Object.keys(objects[0]);
    headers = keys;
    rawRows = objects.map((obj) => keys.map((k) => inferCellValue(obj[k])));
  } else if (ext === 'json' || ext === 'jsonl') {
    const txt = (input.text ?? new TextDecoder().decode(input.bytes ?? new Uint8Array())).trim();
    const parsed: Record<string, unknown>[] = ext === 'jsonl'
      ? txt.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
      : (() => {
          const root = JSON.parse(txt);
          if (Array.isArray(root)) return root;
          if (root && typeof root === 'object') {
            const arr = Object.values(root).find(Array.isArray);
            if (arr) return arr as Record<string, unknown>[];
          }
          throw new Error('JSON file must contain an array of row objects.');
        })();
    if (parsed.length === 0) throw new Error(`JSON file "${input.name}" contains 0 rows.`);
    const keys = Array.from(new Set(parsed.slice(0, 50).flatMap((r) => Object.keys(r ?? {}))));
    headers = keys;
    rawRows = parsed.map((obj) => keys.map((k) => inferCellValue(obj?.[k])));
  } else {
    const txt = input.text ?? new TextDecoder().decode(input.bytes ?? new Uint8Array());
    const delimiter = ext === 'tsv' ? '\t' : ',';
    const grid = parseDelimitedText(txt, delimiter);
    if (grid.length < 2) throw new Error(`File "${input.name}" must contain a header row and at least one data row.`);
    headers = grid[0];
    rawRows = grid.slice(1).map((r) => headers.map((_, idx) => inferCellValue(r[idx] ?? null)));
  }

  const usedCols = new Set<string>();
  const colNames = headers.map((h, idx) => {
    let base = sanitizeSqlIdentifier(h, `col_${idx + 1}`);
    let candidate = base;
    let suffix = 2;
    while (usedCols.has(candidate)) candidate = `${base}_${suffix++}`;
    usedCols.add(candidate);
    return candidate;
  });

  const columns: DataColumnMeta[] = colNames.map((name, idx) => ({
    name,
    type: inferColumnType(rawRows.slice(0, 200).map((r) => r[idx])),
    description: headers[idx] !== name ? `Imported from "${headers[idx]}"` : undefined,
  }));

  db.run(`DROP TABLE IF EXISTS "${tableName}";`);
  const colsSql = columns.map((c) => `"${c.name}" ${c.type}`).join(', ');
  db.run(`CREATE TABLE "${tableName}" (${colsSql});`);

  const placeholders = columns.map(() => '?').join(', ');
  const stmt = db.prepare(`INSERT INTO "${tableName}" VALUES (${placeholders});`);
  db.run('BEGIN TRANSACTION;');
  try {
    for (const r of rawRows) stmt.run(r);
    db.run('COMMIT;');
  } catch (e) {
    db.run('ROLLBACK;');
    throw e;
  } finally {
    stmt.free();
  }

  const meta: DataTableMeta = {
    name: tableName,
    source: 'local',
    dataset: 'uploaded_files',
    datasetLabel: 'Uploaded Files',
    description: `User-uploaded dataset from ${input.name} (${rawRows.length} rows).`,
    rowCount: rawRows.length,
    columns,
    uploaded: true,
  };
  customTables.set(tableName, meta);
  notifyDataChanged();
  return meta;
}

export interface ImportedRowsInput {
  tableName: string;
  columns: string[];
  rows: (string | number | boolean | null)[][];
  dataset?: string;
  datasetLabel?: string;
  description?: string;
  columnTypes?: Record<string, string>;
  columnDescriptions?: Record<string, string>;
}

/**
 * Materializes tabular rows (e.g. loaded from a BigQuery dataset/table preview)
 * into Studio's in-browser SQLite-Wasm (`sql.js`) engine so they can be queried
 * offline, joined with uploaded CSV/Parquet files, or explored via voice.
 */
export async function importRowsIntoLocalTable(input: ImportedRowsInput): Promise<DataTableMeta> {
  const db = await getLocalDatabase();
  const tableName = sanitizeSqlIdentifier(input.tableName, 'bq_table');
  if (input.columns.length === 0) {
    throw new Error(`Cannot import "${input.tableName}" because it has 0 columns.`);
  }

  const usedCols = new Set<string>();
  const colNames = input.columns.map((h, idx) => {
    const base = sanitizeSqlIdentifier(h, `col_${idx + 1}`);
    let candidate = base;
    let suffix = 2;
    while (usedCols.has(candidate)) candidate = `${base}_${suffix++}`;
    usedCols.add(candidate);
    return candidate;
  });

  const normalizedRows: (string | number | null)[][] = input.rows.map((row) =>
    input.columns.map((_, idx) => {
      const v = row[idx];
      if (v === null || v === undefined) return null;
      if (typeof v === 'boolean') return v ? 1 : 0;
      if (typeof v === 'number') return Number.isFinite(v) ? v : null;
      return String(v);
    }),
  );

  const columns: DataColumnMeta[] = colNames.map((name, idx) => {
    const orig = input.columns[idx];
    const bqType = (input.columnTypes?.[orig] ?? '').toUpperCase();
    let sqliteType: SampleColumnSpec['type'];
    if (bqType === 'INT64' || bqType === 'INTEGER' || bqType === 'BOOL' || bqType === 'BOOLEAN') {
      sqliteType = 'INTEGER';
    } else if (bqType === 'FLOAT64' || bqType === 'FLOAT' || bqType === 'NUMERIC' || bqType === 'BIGNUMERIC') {
      sqliteType = 'REAL';
    } else {
      sqliteType = inferColumnType(normalizedRows.slice(0, 200).map((r) => r[idx]));
    }
    return {
      name,
      type: sqliteType,
      description: input.columnDescriptions?.[orig] || (orig !== name ? `Imported from "${orig}"` : undefined),
    };
  });

  db.run(`DROP TABLE IF EXISTS "${tableName}";`);
  const colsSql = columns.map((c) => `"${c.name}" ${c.type}`).join(', ');
  db.run(`CREATE TABLE "${tableName}" (${colsSql});`);

  const placeholders = columns.map(() => '?').join(', ');
  const stmt = db.prepare(`INSERT INTO "${tableName}" VALUES (${placeholders});`);
  db.run('BEGIN TRANSACTION;');
  try {
    for (const r of normalizedRows) stmt.run(r);
    db.run('COMMIT;');
  } catch (e) {
    db.run('ROLLBACK;');
    throw e;
  } finally {
    stmt.free();
  }

  const meta: DataTableMeta = {
    name: tableName,
    source: 'local',
    dataset: input.dataset || 'bigquery_imports',
    datasetLabel: input.datasetLabel || 'BigQuery Imported Tables',
    description: input.description || `Imported BigQuery table (${normalizedRows.length} rows).`,
    rowCount: normalizedRows.length,
    columns,
    uploaded: true,
  };
  customTables.set(tableName, meta);
  notifyDataChanged();
  return meta;
}

/** Lists all local tables (built-in sample datasets + uploaded files). */
export async function listLocalTables(): Promise<DataTableMeta[]> {
  await getLocalDatabase();
  const sampleMetas: DataTableMeta[] = SAMPLE_TABLES.map((t) => ({
    name: t.name,
    source: 'local',
    dataset: t.dataset,
    datasetLabel: t.datasetLabel,
    description: t.description,
    rowCount: t.rows.length,
    columns: t.columns.map((c) => ({ name: c.name, type: c.type, description: c.description })),
  }));
  return [... Array.from(customTables.values()), ...sampleMetas];
}

/** Fetches server-side enterprise connectors if running against the studio server. */
export async function listAllDataSources(forceRefresh = false): Promise<DataSourceInfo[]> {
  const localTables = await listLocalTables();
  const localInfo: DataSourceInfo = {
    id: 'local',
    label: 'Studio SQLite-Wasm (Sample & Uploaded Data)',
    kind: 'local',
    status: 'connected',
    description: `${localTables.length} tables ready locally (${SAMPLE_TABLES.length} sample + ${customTables.size} uploaded). Supports CSV, TSV, JSON, and Parquet.`,
    tableCount: localTables.length,
  };

  if (typeof window === 'undefined') return [localInfo];
  if (remoteSourcesCache && !forceRefresh) return [localInfo, ...remoteSourcesCache];

  try {
    const res = await fetch('/api/data/sources', { headers: { Accept: 'application/json' } });
    if (res.ok) {
      const data = (await res.json()) as { sources?: DataSourceInfo[] };
      remoteSourcesCache = Array.isArray(data.sources) ? data.sources : [];
      return [localInfo, ...remoteSourcesCache];
    }
  } catch {
    // Offline or standalone test
  }
  return [localInfo];
}

/** Inspects schema + sample rows for a data source (used by Gemini Live `inspect_schema` and UI). */
export async function inspectDataSchema(opts: { source?: string; table?: string; profile?: boolean } = {}): Promise<{
  source: string;
  tables: TableSchemaInfo[];
}> {
  const source = opts.source && opts.source.trim() !== '' ? opts.source.trim() : 'local';
  if (source !== 'local' && typeof window !== 'undefined') {
    const url = `/api/data/schema?source=${encodeURIComponent(source)}${opts.table ? `&table=${encodeURIComponent(opts.table)}` : ''}`;
    const res = await fetch(url, { headers: { Accept: 'application/json', ...sessionGcpTokenHeader() } });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.message ?? `Failed to inspect schema for ${source}`);
    return data;
  }

  const db = await getLocalDatabase();
  const all = await listLocalTables();
  const filtered = opts.table
    ? all.filter((t) => t.name === opts.table || t.dataset === opts.table)
    : all;

  const tables = filtered.map((t) => {
    let sampleRows: (string | number | boolean | null)[][] = [];
    try {
      const exec = db.exec(`SELECT * FROM "${t.name}" LIMIT 3;`);
      if (exec[0]) sampleRows = exec[0].values as (string | number | boolean | null)[][];
    } catch {
      // ignore
    }
    const profiled = opts.profile === true && filtered.length <= PROFILE_MAX_TABLES && t.rowCount <= PROFILE_MAX_ROWS;
    return { ...t, sampleRows, ...(profiled ? { columnProfiles: profileLocalTable(db, t) } : {}) };
  });

  return { source: 'local', tables };
}

/**
 * Runs one statement on the local database with writes switched off, so a
 * query that slipped past the guard still cannot change or drop a table.
 * `prepare` compiles only the first statement; anything after it never runs.
 */
function runReadOnlyStatement(
  db: Database,
  sql: string,
  maxRows: number,
): { columns: string[]; rows: (string | number | boolean | null)[][]; truncated: boolean } {
  db.run('PRAGMA query_only = ON;');
  try {
    const stmt = db.prepare(sql);
    try {
      const columns = stmt.getColumnNames();
      const rows: (string | number | boolean | null)[][] = [];
      let truncated = false;
      while (stmt.step()) {
        if (rows.length >= maxRows) {
          truncated = true;
          break;
        }
        rows.push(stmt.get().map((v) => (v instanceof Uint8Array ? `<${v.length} bytes>` : v)) as (string | number | boolean | null)[]);
      }
      return { columns, rows, truncated };
    } finally {
      stmt.free();
    }
  } finally {
    db.run('PRAGMA query_only = OFF;');
  }
}

/** Executes a read-only SQL query against either the local SQLite-Wasm engine or a server connector. */
export async function executeSqlQuery(
  rawSql: string,
  options: {
    source?: string;
    params?: Record<string, SqlParamValue>;
    maxRows?: number;
    bypassCache?: boolean;
  } = {},
): Promise<QueryExecutionResult> {
  const source = options.source && options.source.trim() !== '' ? options.source.trim() : 'local';
  const maxRows = Math.max(1, Math.min(options.maxRows ?? 1000, 5000));
  const executedAt = new Date().toISOString();
  const started = performance.now();

  const dialect = dialectOfSource(source);
  const boundRaw = bindSqlParams(rawSql, options.params, dialect);
  const check = validateReadOnlySql(boundRaw, { maxRows, dialect });
  if (!check.ok) {
    return {
      ok: false,
      source,
      sql: rawSql.trim(),
      boundSql: boundRaw.trim(),
      columns: [],
      rows: [],
      rowCount: 0,
      truncated: false,
      durationMs: Math.round((performance.now() - started) * 10) / 10,
      executedAt,
      error: check.error,
    };
  }

  if (source !== 'local') {
    if (typeof window === 'undefined') {
      return {
        ok: false,
        source,
        sql: check.displaySql,
        boundSql: check.sql,
        columns: [],
        rows: [],
        rowCount: 0,
        truncated: false,
        durationMs: 0,
        executedAt,
        error: `Remote source "${source}" is only reachable through the studio server.`,
      };
    }
    const authHeader = sessionGcpTokenHeader();
    const cacheKey = `${source}\0${maxRows}\0${authHeader['X-GCP-Access-Token'] ?? ''}\0${check.sql}`;
    if (!options.bypassCache) {
      const fresh = remoteFreshCache.get(cacheKey);
      if (fresh && fresh.expiresAt > Date.now()) return fresh.result;
      const inflight = remoteInFlight.get(cacheKey);
      if (inflight) return inflight;
    }

    const requestPromise = (async (): Promise<QueryExecutionResult> => {
      try {
        const res = await fetch('/api/data/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader },
          body: JSON.stringify({ source, sql: rawSql, params: options.params, maxRows }),
        });
        const payload = await res.json();
        if (!res.ok || !payload.ok) {
          return {
            ok: false,
            source,
            sql: check.displaySql,
            boundSql: payload?.boundSql ?? check.sql,
            columns: [],
            rows: [],
            rowCount: 0,
            truncated: false,
            durationMs: Math.round((performance.now() - started) * 10) / 10,
            executedAt,
            error: payload?.message ?? payload?.error ?? `Query on ${source} failed (${res.status}).`,
          };
        }
        const okResult = payload as QueryExecutionResult;
        remoteFreshCache.set(cacheKey, { expiresAt: Date.now() + REMOTE_QUERY_DEDUPE_TTL_MS, result: okResult });
        return okResult;
      } catch (e) {
        return {
          ok: false,
          source,
          sql: check.displaySql,
          boundSql: check.sql,
          columns: [],
          rows: [],
          rowCount: 0,
          truncated: false,
          durationMs: Math.round((performance.now() - started) * 10) / 10,
          executedAt,
          error: e instanceof Error ? e.message : String(e),
        };
      } finally {
        remoteInFlight.delete(cacheKey);
      }
    })();

    remoteInFlight.set(cacheKey, requestPromise);
    return requestPromise;
  }

  try {
    const db = await getLocalDatabase();
    const { columns, rows, truncated } = runReadOnlyStatement(db, check.sql, maxRows);
    return {
      ok: true,
      source: 'local',
      sql: check.displaySql,
      boundSql: check.displaySql,
      columns,
      rows,
      rowCount: rows.length,
      truncated,
      durationMs: Math.round((performance.now() - started) * 10) / 10,
      executedAt,
    };
  } catch (e) {
    return {
      ok: false,
      source: 'local',
      sql: check.displaySql,
      boundSql: check.displaySql,
      columns: [],
      rows: [],
      rowCount: 0,
      truncated: false,
      durationMs: Math.round((performance.now() - started) * 10) / 10,
      executedAt,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
