/**
 * Shared read-only SQL guardrail & parameter binder used by both the in-browser
 * SQLite-Wasm engine and the server-side enterprise data connectors.
 *
 * The guard reads a query the way the target database will: quoting, escapes
 * and comments differ between engines, and a guard that disagrees with the
 * database about where a string ends can be talked into passing a second
 * statement (`'\' ; DROP TABLE t; --'` is one string to BigQuery and a string
 * followed by a statement to SQLite). Where an engine's reading depends on
 * server settings, the ambiguous construct is refused instead of guessed.
 *
 * It is a guardrail, not the security boundary: connectors must also use
 * credentials that can only read.
 */

export type SqlParamValue = string | number | boolean | null | readonly (string | number)[];

/** How the target database tokenizes SQL. */
export type SqlDialect = 'sqlite' | 'bigquery' | 'clickhouse' | 'postgres';

export interface SqlValidationSuccess {
  ok: true;
  /** Cleaned single-statement SQL ready to run (with LIMIT applied if missing). */
  sql: string;
  /** Trimmed SQL without trailing semicolon (for display in Query Inspector). */
  displaySql: string;
}

export interface SqlValidationFailure {
  ok: false;
  error: string;
}

export type SqlValidationResult = SqlValidationSuccess | SqlValidationFailure;

/** The dialect of a studio data source id ("local", "bigquery:<project>", "clickhouse", "postgres", "rest:<name>"). */
export function dialectOfSource(source: string | undefined): SqlDialect {
  const s = (source ?? 'local').trim().toLowerCase();
  if (s === 'bigquery' || s.startsWith('bigquery:')) return 'bigquery';
  if (s === 'clickhouse') return 'clickhouse';
  if (s === 'postgres') return 'postgres';
  return 'sqlite';
}

interface DialectRules {
  /** A backslash escapes the next character inside quotes. */
  backslashEscapes: boolean;
  /** Backslashes in quotes mean different things depending on server settings or a string prefix: refuse them. */
  rejectBackslash: boolean;
  /** `#` starts a comment that runs to the end of the line. */
  hashComments: boolean;
  /** `[name]` is a quoted identifier (elsewhere `[` is an array or an index). */
  bracketIdentifiers: boolean;
  /** `'''…'''` and `"""…"""` strings. */
  tripleQuotes: boolean;
  /** `$$…$$` / `$tag$…$tag$` strings exist and are refused. */
  rejectDollarQuotes: boolean;
  /** `#` is refused outside quotes (its meaning as a comment is version dependent). */
  rejectHash: boolean;
}

const DIALECTS: Record<SqlDialect, DialectRules> = {
  sqlite: {
    backslashEscapes: false, rejectBackslash: false, hashComments: false, bracketIdentifiers: true,
    tripleQuotes: false, rejectDollarQuotes: false, rejectHash: false,
  },
  bigquery: {
    backslashEscapes: true, rejectBackslash: false, hashComments: true, bracketIdentifiers: false,
    tripleQuotes: true, rejectDollarQuotes: false, rejectHash: false,
  },
  clickhouse: {
    backslashEscapes: true, rejectBackslash: false, hashComments: false, bracketIdentifiers: false,
    tripleQuotes: false, rejectDollarQuotes: true, rejectHash: true,
  },
  // E'…' strings and standard_conforming_strings=off give backslashes a second meaning
  postgres: {
    backslashEscapes: false, rejectBackslash: true, hashComments: false, bracketIdentifiers: false,
    tripleQuotes: false, rejectDollarQuotes: true, rejectHash: false,
  },
};

const FORBIDDEN_KEYWORDS = new Set([
  'insert',
  'update',
  'delete',
  'drop',
  'alter',
  'create',
  'truncate',
  'replace',
  'merge',
  'upsert',
  'grant',
  'revoke',
  'attach',
  'detach',
  'pragma',
  'vacuum',
  'reindex',
  'copy',
  'call',
  'exec',
  'execute',
  'install',
  'load',
  'load_extension',
  'export',
  'import',
  // SELECT … INTO creates a table (PostgreSQL, SQL Server)
  'into',
]);

/**
 * Functions that read files, reach other hosts, stall the server or change
 * state from inside a SELECT. Checked only where the name is called.
 */
const FORBIDDEN_FUNCTIONS = new Set([
  // ClickHouse table functions
  'url', 'file', 's3', 'gcs', 'hdfs', 'remote', 'remotesecure', 'cluster', 'mysql', 'postgresql', 'mongodb',
  'jdbc', 'odbc', 'executable', 'input', 'sleep', 'sleepeachrow',
  // PostgreSQL
  'pg_read_file', 'pg_read_binary_file', 'pg_ls_dir', 'pg_stat_file', 'pg_sleep', 'pg_sleep_for', 'pg_sleep_until',
  'pg_terminate_backend', 'pg_cancel_backend', 'pg_reload_conf', 'lo_import', 'lo_export', 'dblink', 'dblink_exec',
  'dblink_connect', 'set_config', 'setval', 'nextval', 'query_to_xml',
  // BigQuery federated queries, SQLite extensions
  'external_query', 'load_extension', 'readfile', 'writefile',
]);

const ALLOWED_START = new Set(['select', 'with', 'values', 'explain']);

interface TokenSpan {
  kind: 'word' | 'semi' | 'other';
  value: string;
  index: number;
  /** A word written after `.`, `:` or `@`: a column, a cast or a parameter, never a statement keyword. */
  qualified?: boolean;
}

interface ScanResult {
  tokens: TokenSpan[];
  /** Why the query cannot be read unambiguously. */
  problem?: string;
}

/** The index after a quoted literal that opens at `start`, or -1 when it is not closed. */
function endOfQuoted(sql: string, start: number, rules: DialectRules): { end: number; backslash: boolean } {
  const n = sql.length;
  const quote = sql[start];
  let backslash = false;

  if (rules.tripleQuotes && quote !== '`' && sql.startsWith(quote.repeat(3), start)) {
    let i = start + 3;
    while (i < n) {
      if (sql[i] === '\\') {
        backslash = true;
        i += 2;
        continue;
      }
      if (sql.startsWith(quote.repeat(3), i)) return { end: i + 3, backslash };
      i++;
    }
    return { end: -1, backslash };
  }

  let i = start + 1;
  while (i < n) {
    const ch = sql[i];
    if (ch === '\\') {
      backslash = true;
      if (rules.backslashEscapes) {
        i += 2;
        continue;
      }
    }
    if (ch === quote) {
      // A doubled quote stands for the quote itself
      if (sql[i + 1] === quote) {
        i += 2;
        continue;
      }
      return { end: i + 1, backslash };
    }
    i++;
  }
  return { end: -1, backslash };
}

function scanSqlTokens(sql: string, rules: DialectRules): ScanResult {
  const tokens: TokenSpan[] = [];
  const n = sql.length;
  let i = 0;

  while (i < n) {
    const ch = sql[i];
    const next = i + 1 < n ? sql[i + 1] : '';

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if ((ch === '-' && next === '-') || (ch === '#' && rules.hashComments)) {
      while (i < n && sql[i] !== '\n') i++;
      continue;
    }

    if (ch === '#' && rules.rejectHash) {
      return { tokens, problem: 'the "#" character is not allowed outside quotes on this data source' };
    }

    if (ch === '/' && next === '*') {
      i += 2;
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      if (i >= n) return { tokens, problem: 'unclosed block comment (/*)' };
      i += 2;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      const { end, backslash } = endOfQuoted(sql, i, rules);
      if (end < 0) return { tokens, problem: `unclosed quoted literal (${ch})` };
      if (backslash && rules.rejectBackslash) {
        return { tokens, problem: 'backslashes inside quotes are not allowed on this data source (use chr(92) or a LIKE pattern)' };
      }
      i = end;
      continue;
    }

    if (ch === '$' && rules.rejectDollarQuotes && /^\$[A-Za-z_]*\$/.test(sql.slice(i, i + 64))) {
      return { tokens, problem: 'dollar-quoted strings ($$…$$) are not allowed' };
    }

    if (ch === '[' && rules.bracketIdentifiers) {
      i++;
      while (i < n && sql[i] !== ']') i++;
      if (i >= n) return { tokens, problem: 'unclosed bracketed identifier ([)' };
      i++;
      continue;
    }

    if (ch === ';') {
      tokens.push({ kind: 'semi', value: ';', index: i });
      i++;
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      i++;
      while (i < n && /[A-Za-z0-9_$]/.test(sql[i])) i++;
      const prev = start > 0 ? sql[start - 1] : '';
      tokens.push({
        kind: 'word',
        value: sql.slice(start, i).toLowerCase(),
        index: start,
        qualified: prev === ':' || prev === '@' || prev === '.',
      });
      continue;
    }

    tokens.push({ kind: 'other', value: ch, index: i });
    i++;
  }

  return { tokens };
}

export function validateReadOnlySql(
  rawSql: string,
  options: { maxRows?: number; dialect?: SqlDialect } = {},
): SqlValidationResult {
  const maxRows = Math.max(1, Math.min(options.maxRows ?? 1000, 10_000));
  const rules = DIALECTS[options.dialect ?? 'sqlite'];
  if (typeof rawSql !== 'string' || rawSql.trim() === '') {
    return { ok: false, error: 'SQL query cannot be empty.' };
  }
  if (rawSql.length > 32_000) {
    return { ok: false, error: 'SQL query exceeds maximum length (32 KB).' };
  }
  if (rawSql.includes('\0')) {
    return { ok: false, error: 'Malformed SQL: contains a NUL character.' };
  }

  const { tokens, problem } = scanSqlTokens(rawSql, rules);
  if (problem) {
    return { ok: false, error: `Malformed SQL: ${problem}.` };
  }

  const words = tokens.filter((t) => t.kind === 'word' && !t.qualified);
  if (words.length === 0) {
    return { ok: false, error: 'SQL query contains no executable SELECT statement.' };
  }

  const semiIdx = tokens.findIndex((t) => t.kind === 'semi');
  if (semiIdx >= 0 && semiIdx < tokens.length - 1) {
    return { ok: false, error: 'Multiple SQL statements are not allowed; run one read-only SELECT query per widget.' };
  }

  const first = words[0].value;
  if (!ALLOWED_START.has(first)) {
    return {
      ok: false,
      error: `Only read-only SELECT / WITH queries are allowed (got "${first.toUpperCase()}").`,
    };
  }

  for (const t of words) {
    // REPLACE(text, from, to) is the string function, not the statement
    if (t.value === 'replace' && tokens[tokens.indexOf(t) + 1]?.value === '(') continue;
    if (FORBIDDEN_KEYWORDS.has(t.value)) {
      return {
        ok: false,
        error: `Read-only SQL guardrail blocked forbidden keyword "${t.value.toUpperCase()}".`,
      };
    }
  }

  for (let k = 0; k < tokens.length - 1; k++) {
    const t = tokens[k];
    if (t.kind === 'word' && tokens[k + 1].value === '(' && FORBIDDEN_FUNCTIONS.has(t.value)) {
      return { ok: false, error: `Read-only SQL guardrail blocked the function "${t.value}()".` };
    }
  }

  const cleaned = rawSql.trim().replace(/;+\s*$/, '').trim();
  let parenDepth = 0;
  let hasTopLevelLimit = false;
  for (const t of tokens) {
    if (t.kind === 'other' && t.value === '(') parenDepth++;
    else if (t.kind === 'other' && t.value === ')') parenDepth = Math.max(0, parenDepth - 1);
    else if (parenDepth === 0 && t.kind === 'word' && !t.qualified && (t.value === 'limit' || t.value === 'fetch')) {
      hasTopLevelLimit = true;
    }
  }
  const isExplain = first === 'explain' || first === 'values';
  const finalSql = !hasTopLevelLimit && !isExplain ? `${cleaned}\nLIMIT ${maxRows}` : cleaned;

  return {
    ok: true,
    sql: finalSql,
    displaySql: cleaned,
  };
}

function escapeSqlScalar(value: string | number | boolean | null, rules: DialectRules): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'NULL';
    return String(value);
  }
  const text = String(value).replace(/\0/g, '');
  // Where a backslash escapes, a value ending in one would swallow the closing quote
  const escaped = rules.backslashEscapes ? text.replace(/\\/g, '\\\\').replace(/'/g, "\\'") : text.replace(/'/g, "''");
  return `'${escaped}'`;
}

/**
 * Replaces `:name` placeholders with escaped literals, leaving quoted text and
 * comments alone. The result must still pass `validateReadOnlySql`.
 */
export function bindSqlParams(
  sql: string,
  params?: Record<string, SqlParamValue>,
  dialect: SqlDialect = 'sqlite',
): string {
  if (!params || Object.keys(params).length === 0) return sql;
  const rules = DIALECTS[dialect];

  let out = '';
  const n = sql.length;
  let i = 0;

  while (i < n) {
    const ch = sql[i];
    const next = i + 1 < n ? sql[i + 1] : '';

    if ((ch === '-' && next === '-') || (ch === '#' && rules.hashComments)) {
      const start = i;
      while (i < n && sql[i] !== '\n') i++;
      out += sql.slice(start, i);
      continue;
    }

    if (ch === '/' && next === '*') {
      const start = i;
      i += 2;
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i = Math.min(n, i + 2);
      out += sql.slice(start, i);
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      const { end } = endOfQuoted(sql, i, rules);
      const stop = end < 0 ? n : end;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }

    if (ch === ':' && next !== ':' && (i === 0 || sql[i - 1] !== ':') && /[A-Za-z_]/.test(next)) {
      const start = i + 1;
      let end = start + 1;
      while (end < n && /[A-Za-z0-9_]/.test(sql[end])) end++;
      const name = sql.slice(start, end);
      if (Object.prototype.hasOwnProperty.call(params, name)) {
        const val = params[name];
        if (Array.isArray(val)) {
          out += val.length === 0 ? '(NULL)' : `(${val.map((item) => escapeSqlScalar(item, rules)).join(', ')})`;
        } else {
          out += escapeSqlScalar(val as string | number | boolean | null, rules);
        }
        i = end;
        continue;
      }
    }

    out += ch;
    i++;
  }

  return out;
}
