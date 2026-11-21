/**
 * The documentation of a page as a book. Its chapters are the page's text and
 * table blocks in reading order; the headings inside a text chapter are its
 * sections. Builds the table of contents (the book's menu), the Markdown
 * export (with embedded Mermaid architecture diagrams), and a self-contained
 * standalone HTML technical reference guide (with embedded vector SVG diagrams).
 */
import { sceneToMermaid, sceneToSvgString } from './diagramSvg';
import {
  findDiagramDirectives,
  normalizeText,
  parseDiagramDirective,
  parseInline,
  parseMarkdown,
  plainInline,
  type CalloutVariant,
} from './markdown';
import { normalize } from './resolve';
import { hasDiagram, type DBlock, type Scene } from './types';

export interface BookSection {
  /** Index of the heading among the headings of the chapter (anchors use it). */
  heading: number;
  level: 1 | 2 | 3;
  text: string;
}

export interface BookChapter {
  id: string;
  /** 1-based number in the book. */
  number: number;
  title: string;
  kind: DBlock['kind'];
  sections: BookSection[];
  /** The text starts with a heading that is the chapter title: shown once, as the title. */
  skipFirstHeading: boolean;
  /** Approximate number of words, for the reading time. */
  words: number;
}

/** Title, sections and size of one chapter. */
export function chapterInfo(b: DBlock, number: number): BookChapter {
  if (b.kind === 'table') {
    const cells = [...(b.columns ?? []), ...(b.rows ?? []).flat()].join(' ');
    return {
      id: b.id, number, kind: 'table', title: b.title?.trim() || 'Table', sections: [], skipFirstHeading: false,
      words: cells.split(/\s+/).filter(Boolean).length,
    };
  }
  const md = parseMarkdown(b.text ?? '');
  const headings = md.flatMap((x) => (x.type === 'heading' ? [x] : []));
  const first = md[0]?.type === 'heading' ? md[0] : undefined;
  const ownTitle = b.title?.trim();
  const skipFirstHeading = first != null && (ownTitle == null || ownTitle === '' ||
    normalize(plainInline(first.text)) === normalize(plainInline(ownTitle)));
  const title = ownTitle || (first != null ? plainInline(first.text) : `Chapter ${number}`);
  const sections: BookSection[] = headings
    .map((h, i) => ({ heading: i, level: h.level, text: plainInline(h.text) }))
    .filter((s) => !(skipFirstHeading && s.heading === 0));
  return {
    id: b.id, number, kind: 'text', title, sections, skipFirstHeading,
    words: normalizeText(b.text ?? '').split(/\s+/).filter(Boolean).length,
  };
}

/** The table of contents of a page's documentation. */
export function bookOutline(scene: Scene): BookChapter[] {
  return scene.blocks.map((b, i) => chapterInfo(b, i + 1));
}

/** True when any chapter explicitly embeds the full (unfocused) architecture diagram. */
export function sceneHasFullDiagramEmbed(scene: Scene): boolean {
  return scene.blocks.some((b) =>
    b.kind === 'text' && findDiagramDirectives(b.text ?? '').some((d) => !d.focus || d.focus.length === 0));
}

/** True when a single block embeds any diagram directive. */
export function blockHasDiagramEmbed(b: DBlock | undefined): boolean {
  return b?.kind === 'text' && findDiagramDirectives(b.text ?? '').length > 0;
}

const escapeCell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** A pipe table. */
export function tableMarkdown(columns: string[], rows: string[][]): string {
  const line = (cells: string[]) => `| ${cells.map(escapeCell).join(' | ')} |`;
  return [line(columns), line(columns.map(() => '---')), ...rows.map(line)].join('\n');
}

function mermaidBlock(scene: Scene, focus?: string[], caption?: string): string {
  const mermaid = sceneToMermaid(scene, focus);
  if (!mermaid) return '';
  const body = `\`\`\`mermaid\n${mermaid}\n\`\`\``;
  return caption ? `${body}\n\n_${caption}_` : body;
}

export interface BookMarkdownOptions {
  /**
   * When true and the page has a diagram that is not already embedded via
   * `{{diagram}}` in any chapter, prepends an `## Architecture Diagram` Mermaid
   * section automatically.
   */
  includeDiagram?: boolean;
}

/**
 * The documentation as one Markdown file: the title of the page, a contents
 * list, then "## n. Chapter" per chapter with its sections one level lower.
 * Any `{{diagram}}` directives expand into Mermaid flowcharts of the diagram.
 */
export function bookToMarkdown(scene: Scene, opts: BookMarkdownOptions = {}): string {
  const chapters = bookOutline(scene);
  const out: string[] = [`# ${scene.title || 'Documentation'}`];
  if (scene.subtitle) out.push(`_${scene.subtitle}_`);
  if (chapters.length > 1) out.push(chapters.map((c) => `${c.number}. ${c.title}`).join('\n'));
  if (opts.includeDiagram && hasDiagram(scene) && !sceneHasFullDiagramEmbed(scene)) {
    const diagram = mermaidBlock(scene, undefined, `${scene.title || 'System'} — Full Architecture`);
    if (diagram) out.push(`## Architecture Diagram\n\n${diagram}`);
  }
  scene.blocks.forEach((b, i) => {
    const c = chapters[i];
    out.push(`## ${c.number}. ${c.title}`);
    if (b.kind === 'table') {
      out.push(tableMarkdown(b.columns ?? [], b.rows ?? []));
      return;
    }
    let lines = normalizeText(b.text ?? '').split('\n');
    if (c.skipFirstHeading) {
      const at = lines.findIndex((l) => l.trim() !== '');
      lines = lines.slice(at + 1);
    }
    // Sections sit under the chapter heading; {{diagram}} expands to Mermaid
    let fenced = false;
    const body = lines.map((l) => {
      const trimmed = l.trim();
      if (trimmed.startsWith('```')) {
        fenced = !fenced;
        return l;
      }
      if (!fenced) {
        const d = parseDiagramDirective(trimmed);
        if (d != null && hasDiagram(scene)) {
          return mermaidBlock(scene, d.focus, d.caption);
        }
        const h = /^(#{1,6})\s+(.*)$/.exec(trimmed);
        if (h) return `${'#'.repeat(Math.min(6, Math.max(3, h[1].length + 1)))} ${h[2]}`;
      }
      return l;
    }).join('\n').trim();
    if (body) out.push(body);
  });
  return out.join('\n\n') + '\n';
}

/* ---------- Standalone HTML Reference Guide Export ---------- */

const escHtml = (s: string) => s
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

function inlineToHtml(text: string): string {
  return parseInline(text).map((s) => {
    const t = escHtml(s.text);
    if (s.href) return `<a href="${escHtml(s.href)}" target="_blank" rel="noopener noreferrer">${t}</a>`;
    if (s.bold) return `<strong>${t}</strong>`;
    if (s.italic) return `<em>${t}</em>`;
    if (s.code) return `<code>${t}</code>`;
    return t;
  }).join('');
}

const CALLOUT_LABELS: Record<CalloutVariant, string> = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
};

function renderTableHtml(columns: string[], rows: string[][]): string {
  const thead = `<thead><tr>${columns.map((c) => `<th>${inlineToHtml(c)}</th>`).join('')}</tr></thead>`;
  const tbody = `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inlineToHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody>`;
  return `<div class="tbl-wrap"><table>${thead}${tbody}</table></div>`;
}

function renderDiagramFigureHtml(scene: Scene, idx: number, caption?: string, focus?: string[]): string {
  if (!hasDiagram(scene)) return '';
  const label = caption ?? `${scene.title || 'System'} — Architecture Diagram`;
  const svg = sceneToSvgString(scene, { focus, idPrefix: `fig-${idx}`, title: label });
  if (!svg) return '';
  return (
    `<figure class="arch-figure">` +
    `<div class="arch-figure-head"><span>${escHtml(label)}</span>` +
    `<span class="arch-figure-meta">${scene.nodes.length} components · ${scene.edges.length} connections</span></div>` +
    `<div class="arch-figure-stage">${svg}</div>` +
    `</figure>`
  );
}

/**
 * Exports the full documentation book + embedded vector SVG architecture
 * diagrams as a single self-contained HTML engineering reference guide.
 */
export function bookToStandaloneHtml(scene: Scene): string {
  const chapters = bookOutline(scene);
  const words = chapters.reduce((n, c) => n + c.words, 0);
  const readMins = Math.max(1, Math.round(words / 200));
  const title = scene.title || 'Architecture Documentation';
  let figIndex = 0;

  const tocHtml = chapters.map((c) => {
    let secNum = 0;
    const sub = c.sections.length > 0
      ? `<ol class="toc-sub">${c.sections.map((s) => {
          const numbered = s.level <= 2;
          if (numbered) secNum++;
          const anchor = `${c.id}-h${s.heading}`;
          return `<li><a href="#${escHtml(anchor)}">${numbered ? `<span class="num">${c.number}.${secNum}</span> ` : ''}${escHtml(s.text)}</a></li>`;
        }).join('')}</ol>`
      : '';
    return `<li><a class="toc-ch" href="#ch-${escHtml(c.id)}"><span class="num">${c.number}.</span> ${escHtml(c.title)}</a>${sub}</li>`;
  }).join('');

  const topDiagram = hasDiagram(scene) && !sceneHasFullDiagramEmbed(scene)
    ? renderDiagramFigureHtml(scene, ++figIndex, `${title} — Full System Architecture`)
    : '';

  const chaptersHtml = scene.blocks.map((b, i) => {
    const c = chapters[i];
    let bodyHtml = '';
    if (b.kind === 'table') {
      bodyHtml = renderTableHtml(b.columns ?? [], b.rows ?? []);
    } else {
      let headingIdx = 0;
      const blocks = parseMarkdown(b.text ?? '');
      bodyHtml = blocks.map((blk, bi) => {
        switch (blk.type) {
          case 'heading': {
            const n = headingIdx++;
            if (c.skipFirstHeading && bi === 0) return '';
            const tag = `h${Math.min(5, blk.level + 2)}`;
            return `<${tag} id="${escHtml(`${c.id}-h${n}`)}">${inlineToHtml(blk.text)}</${tag}>`;
          }
          case 'paragraph':
            return `<p>${inlineToHtml(blk.text)}</p>`;
          case 'quote': {
            const cls = blk.variant ? `callout callout-${blk.variant}` : 'callout';
            const badge = blk.variant ? `<div class="callout-title">${CALLOUT_LABELS[blk.variant]}</div>` : '';
            return `<blockquote class="${cls}">${badge}<p>${inlineToHtml(blk.text)}</p></blockquote>`;
          }
          case 'code': {
            const lang = blk.lang ?? 'code';
            const lines = blk.text.split('\n');
            const numbered = lines.map((line, li) =>
              `<span class="code-line"><span class="ln">${li + 1}</span><span class="lc">${escHtml(line) || ' '}</span></span>`,
            ).join('\n');
            return (
              `<figure class="code-block">` +
              `<div class="code-head"><span class="code-lang">${escHtml(lang)}</span>` +
              `<button type="button" class="copy-btn" data-copy>Copy</button></div>` +
              `<pre><code>${numbered}</code></pre>` +
              `</figure>`
            );
          }
          case 'rule':
            return '<hr />';
          case 'list': {
            const tag = blk.ordered ? 'ol' : 'ul';
            return `<${tag}>${blk.items.map((it) => `<li${it.depth > 0 ? ` style="margin-left:${it.depth * 18}px"` : ''}>${inlineToHtml(it.text)}</li>`).join('')}</${tag}>`;
          }
          case 'table':
            return renderTableHtml(blk.header, blk.rows);
          case 'diagram':
            return renderDiagramFigureHtml(scene, ++figIndex, blk.caption, blk.focus);
        }
      }).join('\n');
    }
    return (
      `<section class="chapter" id="ch-${escHtml(c.id)}">` +
      `<div class="eyebrow">Chapter ${c.number} of ${chapters.length}</div>` +
      `<h2>${c.number}. ${escHtml(c.title)}</h2>` +
      `${bodyHtml}` +
      `</section>`
    );
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escHtml(title)} — Architecture &amp; Implementation Guide</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #ffffff; --surface: #f8f9fa; --surface-2: #f1f3f4; --border: #dadce0;
    --text: #1f1f1f; --muted: #5f6368; --primary: #1a73e8;
    --warn-bg: #fef7e0; --warn-border: #e37400; --warn-text: #7a4200;
    --imp-bg: #f3e8fd; --imp-border: #8430ce; --imp-text: #4a148c;
    --note-bg: #e8f0fe; --note-border: #1a73e8; --note-text: #174ea6;
    --tip-bg: #e6f4ea; --tip-border: #1e8e3e; --tip-text: #137333;
    --code-bg: #0f172a; --code-head: #1e293b; --code-text: #e2e8f0; --code-ln: #64748b;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #111318; --surface: #181b22; --surface-2: #222630; --border: #2f3542;
      --text: #e8eaed; --muted: #9aa0a6; --primary: #8ab4f8;
      --warn-bg: #2e2412; --warn-border: #fbbc04; --warn-text: #fde293;
      --imp-bg: #261b33; --imp-border: #c58af9; --imp-text: #e9d2fd;
      --note-bg: #17253b; --note-border: #8ab4f8; --note-text: #d2e3fc;
      --tip-bg: #13291b; --tip-border: #81c995; --tip-text: #ceead6;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.68 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
  .layout { display: grid; grid-template-columns: 280px minmax(0, 1fr); max-width: 1220px; margin: 0 auto; }
  aside { position: sticky; top: 0; height: 100vh; overflow-y: auto; padding: 28px 20px; border-right: 1px solid var(--border); background: var(--surface); }
  aside h3 { margin: 0 0 12px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
  aside ol { margin: 0; padding: 0; list-style: none; }
  aside a { display: block; padding: 5px 8px; border-radius: 6px; color: var(--muted); text-decoration: none; font-size: 13.5px; line-height: 1.4; }
  aside a:hover { background: var(--surface-2); color: var(--text); }
  aside .toc-ch { font-weight: 600; color: var(--text); margin-top: 6px; }
  aside .toc-sub { margin-left: 12px; padding-left: 10px; border-left: 1px solid var(--border); }
  aside .num { color: var(--primary); font-variant-numeric: tabular-nums; }
  main { padding: 40px 48px 96px; max-width: 880px; width: 100%; margin: 0 auto; }
  .doc-header { padding-bottom: 24px; margin-bottom: 32px; border-bottom: 1px solid var(--border); }
  .eyebrow { font-size: 11.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--primary); }
  h1 { margin: 6px 0 8px; font-size: 34px; line-height: 1.2; letter-spacing: -0.02em; }
  .subtitle { margin: 0 0 12px; font-size: 17px; color: var(--muted); }
  .meta { font-size: 13px; color: var(--muted); }
  .chapter { margin: 44px 0; padding-top: 24px; border-top: 1px solid var(--border); }
  .chapter:first-of-type { border-top: none; padding-top: 0; margin-top: 24px; }
  h2 { margin: 6px 0 16px; font-size: 26px; line-height: 1.3; }
  h3 { margin: 28px 0 10px; font-size: 20px; line-height: 1.35; }
  h4 { margin: 22px 0 8px; font-size: 16.5px; }
  p { margin: 0 0 16px; }
  ul, ol { margin: 0 0 16px; padding-left: 24px; }
  li { margin-bottom: 6px; }
  main a { color: var(--primary); text-decoration: underline; text-underline-offset: 2px; }
  main a:hover { opacity: 0.85; }
  code { padding: 2px 5px; border-radius: 4px; background: var(--surface-2); font: 13.5px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; }
  .callout { margin: 20px 0; padding: 14px 18px; border-left: 4px solid var(--note-border); border-radius: 0 10px 10px 0; background: var(--note-bg); color: var(--note-text); }
  .callout p { margin: 0; }
  .callout-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 6px; }
  .callout-warning, .callout-caution { border-left-color: var(--warn-border); background: var(--warn-bg); color: var(--warn-text); }
  .callout-important { border-left-color: var(--imp-border); background: var(--imp-bg); color: var(--imp-text); }
  .callout-tip { border-left-color: var(--tip-border); background: var(--tip-bg); color: var(--tip-text); }
  .code-block { margin: 20px 0; border-radius: 10px; overflow: hidden; border: 1px solid var(--border); background: var(--code-bg); }
  .code-head { display: flex; justify-content: space-between; align-items: center; padding: 8px 14px; background: var(--code-head); color: #cbd5e1; font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
  .code-lang { text-transform: lowercase; font-weight: 600; }
  .copy-btn { border: 1px solid #475569; background: transparent; color: #e2e8f0; border-radius: 6px; padding: 3px 10px; font-size: 11.5px; cursor: pointer; }
  .copy-btn:hover { background: #334155; }
  .code-block pre { margin: 0; padding: 14px 16px; overflow-x: auto; color: var(--code-text); font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; }
  .code-block pre code { padding: 0; background: transparent; color: inherit; }
  .code-line { display: flex; gap: 14px; }
  .ln { flex: 0 0 28px; text-align: right; color: var(--code-ln); user-select: none; }
  .lc { white-space: pre; }
  .tbl-wrap { overflow-x: auto; margin: 18px 0; border: 1px solid var(--border); border-radius: 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; line-height: 1.5; }
  th, td { padding: 10px 14px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
  th { background: var(--surface); font-weight: 600; }
  tbody tr:last-child td { border-bottom: none; }
  .arch-figure { margin: 24px 0; border: 1px solid var(--border); border-radius: 12px; overflow: hidden; background: var(--surface); }
  .arch-figure-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--border); font-size: 13px; font-weight: 600; }
  .arch-figure-meta { font-weight: 400; color: var(--muted); font-size: 12px; }
  .arch-figure-stage { padding: 18px; background: #ffffff; overflow-x: auto; }
  hr { border: none; height: 1px; background: var(--border); margin: 28px 0; }
  @media (max-width: 900px) { .layout { grid-template-columns: 1fr; } aside { position: static; height: auto; border-right: none; border-bottom: 1px solid var(--border); } main { padding: 24px 20px 64px; } }
</style>
</head>
<body>
<div class="layout">
  <aside>
    <h3>On this page</h3>
    <ol>${tocHtml}</ol>
  </aside>
  <main>
    <header class="doc-header">
      <div class="eyebrow">Architecture &amp; Low-Level Implementation Guide</div>
      <h1>${escHtml(title)}</h1>
      ${scene.subtitle ? `<p class="subtitle">${escHtml(scene.subtitle)}</p>` : ''}
      <div class="meta">${chapters.length} ${chapters.length === 1 ? 'chapter' : 'chapters'} · ${readMins} min read${hasDiagram(scene) ? ` · ${scene.nodes.length} components · ${scene.edges.length} connections` : ''}</div>
    </header>
    ${topDiagram}
    ${chaptersHtml}
  </main>
</div>
<script>
document.querySelectorAll('[data-copy]').forEach(function(btn) {
  btn.addEventListener('click', function() {
    var fig = btn.closest('.code-block');
    var lines = Array.from(fig.querySelectorAll('.lc')).map(function(el) { return el.textContent; }).join('\\n');
    navigator.clipboard && navigator.clipboard.writeText(lines).then(function() {
      var prev = btn.textContent; btn.textContent = 'Copied';
      setTimeout(function() { btn.textContent = prev; }, 1600);
    });
  });
});
</script>
</body>
</html>`;
}
