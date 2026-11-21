/**
 * Renders the Markdown subset of text blocks (engine/markdown.ts) as React
 * elements, never as HTML strings, so text from the model cannot inject markup.
 * Supports language-tagged code blocks with line numbers, rich token coloring &
 * copy button, typed callout admonitions, pipe tables, section anchors, and
 * embedded architecture diagrams ({{diagram}}).
 */
import { Fragment, useState, type ReactNode } from 'react';
import { tableSize } from '../engine/blocks';
import { parseInline, parseMarkdown, type CalloutVariant } from '../engine/markdown';
import { hasDiagram, type Scene } from '../engine/types';
import { Icon } from './context';
import { DiagramFigure } from './DiagramFigure';
import type { IconName } from './icons';

export function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((s, i) => s.href ? (
        <a key={i} className="md-link" href={s.href} target="_blank" rel="noopener noreferrer">
          <span>{s.text}</span>
          <Icon name="open_in_new" size={12} className="md-link-ext" />
        </a>
      ) : s.bold ? <strong key={i}>{s.text}</strong>
        : s.italic ? <em key={i}>{s.text}</em>
        : s.code ? <code key={i}>{s.text}</code>
        : <Fragment key={i}>{s.text}</Fragment>)}
    </>
  );
}

/** A table with proportional column widths and clean horizontal overflow handling. */
export function TableView({ columns, rows, maxWidth }: { columns: string[]; rows: string[][]; maxWidth: number }) {
  const { colWidths } = tableSize(columns, rows, maxWidth);
  const total = colWidths.reduce((a, b) => a + b, 0) || 1;
  return (
    <div className="md-table-wrap" tabIndex={0} role="region" aria-label="Data table">
      <table className="md-table">
        <colgroup>
          {colWidths.map((w, i) => (
            <col key={i} style={{ width: `${((w / total) * 100).toFixed(1)}%` }} />
          ))}
        </colgroup>
        <thead>
          <tr>{columns.map((c, i) => <th key={i} scope="col"><Inline text={c} /></th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j}><Inline text={c} /></td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- Lightweight, XSS-safe React Syntax Highlighter ---------- */

const CODE_KEYWORDS = new Set([
  // TypeScript / JS / Go / Python / Terraform / YAML / Lua
  'import', 'from', 'export', 'default', 'async', 'await', 'function', 'return', 'const', 'let', 'var',
  'type', 'interface', 'class', 'extends', 'new', 'if', 'else', 'for', 'of', 'in', 'while', 'try', 'catch',
  'finally', 'throw', 'true', 'false', 'null', 'undefined', 'def', 'with', 'as', 'pass', 'raise', 'None',
  'True', 'False', 'local', 'then', 'end', 'resource', 'module', 'variable', 'output', 'provider', 'locals',
  'yield', 'lambda', 'not', 'and', 'or', 'elif', 'continue', 'break', 'switch', 'case', 'typeof', 'void',
  // SQL
  'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'ON', 'GROUP', 'ORDER', 'BY', 'LIMIT',
  'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE', 'ALTER', 'DROP', 'TABLE', 'INDEX',
  'ROLE', 'POLICY', 'GRANT', 'TO', 'USING', 'WITH', 'CHECK', 'ENABLE', 'FORCE', 'ROW', 'LEVEL', 'SECURITY',
  'AS', 'PERMISSIVE', 'FOR', 'ALL', 'NOT', 'NULL', 'PRIMARY', 'KEY', 'DEFAULT', 'BEGIN',
  'COMMIT', 'ROLLBACK', 'LOCAL', 'AND', 'OR', 'CASE', 'WHEN', 'THEN', 'END', 'PARTITION', 'HASH',
  'NOLOGIN', 'NOBYPASSRLS', 'SCHEMA', 'EXPLAIN', 'ANALYZE', 'CONCURRENTLY', 'UNIQUE', 'REFERENCES',
  'select', 'from', 'where', 'create', 'alter', 'table', 'index', 'role', 'policy', 'grant', 'using',
]);

const CODE_TYPES = new Set([
  'UUID', 'TEXT', 'INTEGER', 'INT', 'BIGINT', 'BOOLEAN', 'BOOL', 'JSONB', 'JSON', 'TIMESTAMP', 'TIMESTAMPTZ',
  'NUMERIC', 'VARCHAR', 'BYTEA', 'uuid', 'text', 'vector', 'btree', 'alloydb_scann', 'jsonb', 'boolean',
  'Promise', 'Record', 'Array', 'Map', 'Set', 'Error', 'Buffer', 'String', 'Number', 'Boolean',
  'Content', 'GoogleGenAI', 'Firestore', 'CloudTasksClient', 'OAuth2Client', 'NextRequest', 'NextResponse',
  'FastAPI', 'Request', 'HTTPException', 'Depends', 'str', 'int', 'float', 'bool', 'dict', 'list',
]);

type TokenKind = 'plain' | 'com' | 'str' | 'kw' | 'type' | 'fn' | 'num' | 'dec';

function tokenizeLine(line: string, lang?: string): { kind: TokenKind; text: string }[] {
  const isSql = lang === 'sql' || lang === 'postgresql' || lang === 'postgres';
  const isHashComment = lang === 'python' || lang === 'py' || lang === 'yaml' || lang === 'yml' ||
    lang === 'bash' || lang === 'sh' || lang === 'shell' || lang === 'hcl' || lang === 'terraform' || lang === 'tf';

  // Split trailing single-line comment safely outside quotes
  let commentAt = -1;
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === '\\' && i + 1 < line.length) { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if ((isSql && ch === '-' && line[i + 1] === '-') ||
        (!isSql && !isHashComment && ch === '/' && line[i + 1] === '/') ||
        (isHashComment && ch === '#')) {
      commentAt = i;
      break;
    }
  }

  const codePart = commentAt >= 0 ? line.slice(0, commentAt) : line;
  const commentPart = commentAt >= 0 ? line.slice(commentAt) : '';
  const tokens: { kind: TokenKind; text: string }[] = [];
  const re = /('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|@[A-Za-z_][A-Za-z0-9_]*|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*\b)/g;
  let last = 0;
  for (let m = re.exec(codePart); m != null; m = re.exec(codePart)) {
    if (m.index > last) tokens.push({ kind: 'plain', text: codePart.slice(last, m.index) });
    const t = m[0];
    const nextChar = codePart[m.index + t.length];
    if (t[0] === '\'' || t[0] === '"' || t[0] === '`') {
      tokens.push({ kind: 'str', text: t });
    } else if (t[0] === '@') {
      tokens.push({ kind: 'dec', text: t });
    } else if (/^\d/.test(t)) {
      tokens.push({ kind: 'num', text: t });
    } else if (CODE_KEYWORDS.has(t)) {
      tokens.push({ kind: 'kw', text: t });
    } else if (CODE_TYPES.has(t)) {
      tokens.push({ kind: 'type', text: t });
    } else if (nextChar === '(') {
      tokens.push({ kind: 'fn', text: t });
    } else {
      tokens.push({ kind: 'plain', text: t });
    }
    last = m.index + t.length;
  }
  if (last < codePart.length) tokens.push({ kind: 'plain', text: codePart.slice(last) });
  if (commentPart) tokens.push({ kind: 'com', text: commentPart });
  return tokens;
}

function CodeBlockView({ text, lang }: { text: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  const lines = text.split('\n');

  const copy = () => {
    if (!navigator.clipboard?.writeText) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }).catch(() => undefined);
  };

  return (
    <figure className="md-code-figure">
      <div className="md-code-head">
        <div className="md-code-meta">
          <Icon name="code" size={14} className="md-code-icon" />
          <span className="md-code-lang">{lang || 'code'}</span>
          <span className="md-code-lines">{lines.length} {lines.length === 1 ? 'line' : 'lines'}</span>
        </div>
        <button type="button" className={`md-code-copy${copied ? ' copied' : ''}`} onClick={copy} aria-label="Copy code snippet">
          <Icon name={copied ? 'check' : 'content_copy'} size={13} />
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre className="md-code" tabIndex={0} role="region" aria-label={`${lang || 'Code'} snippet`}>
        <code>
          {lines.map((line, idx) => (
            <span key={idx} className="md-code-line">
              <span className="md-code-ln" aria-hidden="true">{idx + 1}</span>
              <span className="md-code-src">
                {line === '' ? ' ' : tokenizeLine(line, lang).map((tok, ti) =>
                  tok.kind === 'plain'
                    ? <Fragment key={ti}>{tok.text}</Fragment>
                    : <span key={ti} className={`tok-${tok.kind}`}>{tok.text}</span>)}
              </span>
            </span>
          ))}
        </code>
      </pre>
    </figure>
  );
}

const CALLOUT_META: Record<CalloutVariant, { label: string; icon: IconName }> = {
  note: { label: 'Note', icon: 'info' },
  tip: { label: 'Tip', icon: 'lightbulb' },
  important: { label: 'Important', icon: 'info' },
  warning: { label: 'Warning', icon: 'warning' },
  caution: { label: 'Caution', icon: 'error' },
};

export function Markdown({
  text,
  width,
  anchor,
  skipFirstHeading = false,
  scene,
  onOpenDiagram,
  chapterNumber,
}: {
  text: string;
  width: number;
  /** Prefix of the heading ids (`${anchor}-h${n}`, n counts the headings), for a table of contents. */
  anchor?: string;
  /** Leaves out a leading heading that is already shown as the title. */
  skipFirstHeading?: boolean;
  /** Active diagram scene, used when rendering inline `{{diagram}}` embeds. */
  scene?: Scene;
  /** Callback when the user clicks to open/focus the embedded diagram canvas. */
  onOpenDiagram?: (focusNodeId?: string) => void;
  /** Optional 1-based chapter number for numbered section badges (e.g. 2.1, 2.2). */
  chapterNumber?: number;
}) {
  const out: ReactNode[] = [];
  let heading = 0;
  let sectionNum = 0;
  parseMarkdown(text).forEach((b, i) => {
    switch (b.type) {
      case 'heading': {
        const n = heading++;
        if (skipFirstHeading && i === 0) break;
        const id = anchor != null ? `${anchor}-h${n}` : undefined;
        const Tag = (`h${b.level + 2}`) as 'h3' | 'h4' | 'h5';
        const showNum = chapterNumber != null && b.level <= 2;
        if (showNum) sectionNum++;
        out.push(
          <Tag key={i} id={id} className={`md-h${b.level}${i > 0 && b.level <= 2 ? ' md-h-divided' : ''}`}>
            {showNum && <span className="md-sec-num" aria-hidden="true">{chapterNumber}.{sectionNum}</span>}
            <span className="md-h-text"><Inline text={b.text} /></span>
            {id != null && (
              <button
                type="button"
                className="md-h-anchor"
                aria-label={`Scroll to ${b.text}`}
                onClick={() => document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' })}
              >
                #
              </button>
            )}
          </Tag>,
        );
        break;
      }
      case 'paragraph':
        out.push(<p key={i} className="md-p"><Inline text={b.text} /></p>);
        break;
      case 'quote': {
        const meta = b.variant ? CALLOUT_META[b.variant] : null;
        out.push(
          <blockquote key={i} className={`md-quote${b.variant ? ` md-callout md-callout-${b.variant}` : ''}`}>
            {meta && (
              <div className="md-callout-head">
                <Icon name={meta.icon} size={15} />
                <span>{meta.label}</span>
              </div>
            )}
            <div className="md-callout-body"><Inline text={b.text} /></div>
          </blockquote>,
        );
        break;
      }
      case 'code':
        out.push(<CodeBlockView key={i} text={b.text} lang={b.lang} />);
        break;
      case 'rule':
        out.push(<hr key={i} className="md-hr" />);
        break;
      case 'list': {
        const Tag = b.ordered ? 'ol' : 'ul';
        out.push(
          <Tag key={i} className={b.ordered ? 'md-ol' : 'md-ul'}>
            {b.items.map((it, j) => (
              <li key={j} style={it.depth > 0 ? { marginLeft: it.depth * 16 } : undefined}><Inline text={it.text} /></li>
            ))}
          </Tag>,
        );
        break;
      }
      case 'table':
        out.push(<TableView key={i} columns={b.header} rows={b.rows} maxWidth={width} />);
        break;
      case 'diagram':
        if (scene && hasDiagram(scene)) {
          out.push(
            <DiagramFigure
              key={i}
              scene={scene}
              caption={b.caption}
              focus={b.focus}
              onOpenDiagram={onOpenDiagram}
            />,
          );
        }
        break;
    }
  });
  return <div className="md">{out}</div>;
}
