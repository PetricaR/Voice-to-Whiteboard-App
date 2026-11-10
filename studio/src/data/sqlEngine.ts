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
import { bindSqlParams, validateReadOnlySql, type SqlParamValue } from './sqlGuard';

export interface DataColumnMeta {
  name: string;
  type: string;
  description?: string;
}

export interface DataTableMeta {
  name: string;
  source: string;
  dataset: string;
  datasetLabel: string;
  description: string;
  rowCount: number;
  columns: DataColumnMeta[];
  uploaded?: boolean;
}

export type TableSchemaInfo = DataTableMeta & {
  sampleRows?: (string | number | boolean | null)[][];
};

export interface DataSourceInfo {
  id: string;
  label: string;
  kind: 'local' | 'bigquery' | 'clickhouse' | 'postgres' | 'rest';
  status: 'connected' | 'available';
  description: string;
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

export function subscribeDataEngine(listener: () => void): () => void {
  dataListeners.add(listener);
  return () => dataListeners.delete(listener);
}

function notifyDataChanged() {
  for (const l of dataListeners) l();
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
export async function inspectDataSchema(opts: { source?: string; table?: string } = {}): Promise<{
  source: string;
  tables: (DataTableMeta & { sampleRows?: (string | number | boolean | null)[][] })[];
}> {
  const source = opts.source && opts.source.trim() !== '' ? opts.source.trim() : 'local';
  if (source !== 'local' && typeof window !== 'undefined') {
    const url = `/api/data/schema?source=${encodeURIComponent(source)}${opts.table ? `&table=${encodeURIComponent(opts.table)}` : ''}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
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
    return { ...t, sampleRows };
  });

  return { source: 'local', tables };
}

/** Executes a read-only SQL query against either the local SQLite-Wasm engine or a server connector. */
export async function executeSqlQuery(
  rawSql: string,
  options: {
    source?: string;
    params?: Record<string, SqlParamValue>;
    maxRows?: number;
  } = {},
): Promise<QueryExecutionResult> {
  const source = options.source && options.source.trim() !== '' ? options.source.trim() : 'local';
  const maxRows = Math.max(1, Math.min(options.maxRows ?? 1000, 5000));
  const executedAt = new Date().toISOString();
  const started = performance.now();

  const boundRaw = bindSqlParams(rawSql, options.params);
  const check = validateReadOnlySql(boundRaw, { maxRows });
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
    try {
      const res = await fetch('/api/data/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      return payload as QueryExecutionResult;
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
    }
  }

  try {
    const db = await getLocalDatabase();
    const res = db.exec(check.sql);
    const durationMs = Math.round((performance.now() - started) * 10) / 10;
    if (!res || res.length === 0) {
      return {
        ok: true,
        source: 'local',
        sql: check.displaySql,
        boundSql: check.displaySql,
        columns: [],
        rows: [],
        rowCount: 0,
        truncated: false,
        durationMs,
        executedAt,
      };
    }
    const first = res[0];
    const allRows = first.values as (string | number | boolean | null)[][];
    const truncated = allRows.length > maxRows;
    const rows = truncated ? allRows.slice(0, maxRows) : allRows;
    return {
      ok: true,
      source: 'local',
      sql: check.displaySql,
      boundSql: check.displaySql,
      columns: first.columns,
      rows,
      rowCount: rows.length,
      truncated,
      durationMs,
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
