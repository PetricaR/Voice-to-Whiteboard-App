/**
 * Shared read-only SQL guardrail & parameter binder used by both the in-browser
 * SQLite-Wasm engine and the server-side enterprise data connectors.
 */

export type SqlParamValue = string | number | boolean | null | readonly (string | number)[];

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
]);

const ALLOWED_START = new Set(['select', 'with', 'values', 'explain']);

interface TokenSpan {
  kind: 'word' | 'semi' | 'other';
  value: string;
  index: number;
}

function scanSqlTokens(sql: string): { tokens: TokenSpan[]; unclosedLiteral?: string } {
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

    if (ch === '-' && next === '-') {
      i += 2;
      while (i < n && sql[i] !== '\n') i++;
      continue;
    }

    if (ch === '/' && next === '*') {
      i += 2;
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      if (i >= n) return { tokens, unclosedLiteral: 'block comment (/*)' };
      i += 2;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      i++;
      while (i < n) {
        if (sql[i] === '\\' && quote !== '"') {
          i += 2;
          continue;
        }
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
            i += 2;
            continue;
          }
          break;
        }
        i++;
      }
      if (i >= n) return { tokens, unclosedLiteral: `quoted literal (${quote})` };
      i++;
      continue;
    }

    if (ch === '[') {
      i++;
      while (i < n && sql[i] !== ']') i++;
      if (i >= n) return { tokens, unclosedLiteral: 'bracketed identifier ([)' };
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
      if (prev !== ':' && prev !== '@' && prev !== '.') {
        tokens.push({ kind: 'word', value: sql.slice(start, i).toLowerCase(), index: start });
      }
      continue;
    }

    tokens.push({ kind: 'other', value: ch, index: i });
    i++;
  }

  return { tokens };
}

export function validateReadOnlySql(
  rawSql: string,
  options: { maxRows?: number } = {},
): SqlValidationResult {
  const maxRows = Math.max(1, Math.min(options.maxRows ?? 1000, 10_000));
  if (typeof rawSql !== 'string' || rawSql.trim() === '') {
    return { ok: false, error: 'SQL query cannot be empty.' };
  }
  if (rawSql.length > 32_000) {
    return { ok: false, error: 'SQL query exceeds maximum length (32 KB).' };
  }

  const { tokens, unclosedLiteral } = scanSqlTokens(rawSql);
  if (unclosedLiteral) {
    return { ok: false, error: `Malformed SQL: unclosed ${unclosedLiteral}.` };
  }

  const words = tokens.filter((t) => t.kind === 'word');
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
    if (FORBIDDEN_KEYWORDS.has(t.value)) {
      return {
        ok: false,
        error: `Read-only SQL guardrail blocked forbidden keyword "${t.value.toUpperCase()}".`,
      };
    }
  }

  const cleaned = rawSql.trim().replace(/;+\s*$/, '').trim();
  const hasLimit = words.some((w) => w.value === 'limit');
  const isExplain = first === 'explain' || first === 'values';
  const finalSql = !hasLimit && !isExplain ? `${cleaned}\nLIMIT ${maxRows}` : cleaned;

  return {
    ok: true,
    sql: finalSql,
    displaySql: cleaned,
  };
}

function escapeSqlScalar(value: string | number | boolean | null): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'NULL';
    return String(value);
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function bindSqlParams(
  sql: string,
  params?: Record<string, SqlParamValue>,
): string {
  if (!params || Object.keys(params).length === 0) return sql;

  let out = '';
  const n = sql.length;
  let i = 0;

  while (i < n) {
    const ch = sql[i];
    const next = i + 1 < n ? sql[i + 1] : '';

    if (ch === '-' && next === '-') {
      const start = i;
      i += 2;
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
      const quote = ch;
      const start = i;
      i++;
      while (i < n) {
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      out += sql.slice(start, i);
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
          out += val.length === 0 ? '(NULL)' : `(${val.map((item) => escapeSqlScalar(item)).join(', ')})`;
        } else {
          out += escapeSqlScalar(val as string | number | boolean | null);
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
