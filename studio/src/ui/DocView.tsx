/**
 * The documentation tab of a page: a publication-grade technical reference
 * guide with chapter-by-chapter and continuous full-guide reading modes.
 * Features a sticky reading-progress & export bar, responsive 3-column
 * editorial layout (left chapters TOC, centered article, right "On this page"
 * + stack rail on wide viewports), embedded full & subsystem-focused vector
 * architecture diagrams, syntax-highlighted code blocks, and print/PDF support.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { googleDocsApi, type GoogleDocsMcpStatus } from '../data/googleDocsClient';
import {
  blockHasDiagramEmbed,
  bookOutline,
  bookToMarkdown,
  bookToStandaloneHtml,
  sceneHasFullDiagramEmbed,
  type BookChapter,
} from '../engine/book';
import { hasDiagram, type DBlock, type Scene } from '../engine/types';
import { addChapter, chapterSource, parseTableSource } from './chapters';
import { Icon, IconButton, useStudio, useWorkspaceRevision } from './context';
import { DiagramFigure } from './DiagramFigure';
import { download, fileName } from './export';
import type { IconName } from './icons';
import { Markdown, TableView } from './Markdown';
import { Thumbnail } from './Thumbnail';
import './docs.css';

const ARTICLE_WIDTH = 780;
const WIDE_RAIL_PX = 1180;
const HIGHLIGHT_MS = 2600;

type Flash = 'added' | 'updated';
type ReadMode = 'chapter' | 'full';

function chapterBadge(block: DBlock, chapter: BookChapter): { label: string; icon: IconName; tone: string } {
  const id = block.id.toLowerCase();
  const title = chapter.title.toLowerCase();
  const body = (block.text ?? '').toLowerCase();
  if (id.startsWith('lld_') || body.includes('## low-level design') || body.includes('## implementation guidelines')) {
    return { label: 'Low-Level Design & Code', icon: 'code', tone: 'blue' };
  }
  if (id === 'overview' || title.includes('overview') || title.includes('topology') || title.includes('introduction')) {
    return { label: 'System Architecture', icon: 'account_tree', tone: 'teal' };
  }
  if (id === 'runtime' || title.includes('runtime') || title.includes('execution flow')) {
    return { label: 'Runtime Flows', icon: 'timeline', tone: 'purple' };
  }
  if (id === 'decisions' || title.includes('decision') || body.includes('## adr-')) {
    return { label: 'Architecture Decisions', icon: 'fact_check', tone: 'purple' };
  }
  if (id === 'risks' || title.includes('risk')) {
    return { label: 'Risk Register', icon: 'shield', tone: 'orange' };
  }
  if (id === 'rollout' || title.includes('roadmap') || title.includes('rollout') || title.includes('next step')) {
    return { label: 'Rollout & Verification', icon: 'rocket_launch', tone: 'green' };
  }
  if (id === 'runbook' || title.includes('runbook')) {
    return { label: 'Operations Runbook', icon: 'build', tone: 'orange' };
  }
  if (id === 'references' || id === 'sources' || title.includes('official google') || title.includes('reference')) {
    return { label: 'Official Google Docs', icon: 'library_books', tone: 'green' };
  }
  if (block.kind === 'table') {
    return { label: 'Reference Matrix', icon: 'table_chart', tone: 'teal' };
  }
  return { label: 'Reference Guide', icon: 'article', tone: 'blue' };
}

function extractStackItems(scene: Scene): { tech: string; nodeId: string; label: string }[] {
  const seen = new Set<string>();
  const out: { tech: string; nodeId: string; label: string }[] = [];
  for (const n of scene.nodes) {
    const tech = n.tech?.trim();
    if (!tech) continue;
    const key = tech.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ tech, nodeId: n.id, label: n.label });
    if (out.length >= 8) break;
  }
  return out;
}

function ChapterEditor({ block, chapter, onDone }: {
  block: DBlock;
  chapter: BookChapter;
  onDone: (v: { title: string; source: string } | null) => void;
}) {
  const [title, setTitle] = useState(block.title ?? chapter.title);
  const [source, setSource] = useState(() => chapterSource(block));
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const table = block.kind === 'table';
  return (
    <div
      className="chapter-editor"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          onDone({ title, source });
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onDone(null);
        }
      }}
    >
      <input
        className="chapter-title-input"
        value={title}
        aria-label="Chapter title"
        placeholder="Chapter title"
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        ref={ref}
        className="chapter-source"
        value={source}
        spellCheck
        aria-label={table ? 'Table rows, cells separated by |, the first line is the header' : 'Chapter text (Markdown)'}
        onChange={(e) => setSource(e.target.value)}
      />
      <div className="chapter-editor-actions">
        <span className="hint">
          {table
            ? 'One row per line, cells separated by |; the first line is the header.'
            : 'Markdown: “## ” section, ```lang code, > [!WARNING] callout, {{diagram}} or {{diagram: id1, id2 | Caption}}.'}
          {' '}⌘↵ saves, Esc cancels.
        </span>
        <button type="button" className="text-btn" onClick={() => onDone(null)}>Cancel</button>
        <button type="button" className="filled-btn" onClick={() => onDone({ title, source })}>Save</button>
      </div>
    </div>
  );
}

/** What the "Full architecture docs" button asks Gemini. */
const FULL_DOC_REQUEST =
  'Write full documentation for this architecture grounded strictly in the latest official Google documentation via Google Developer Knowledge MCP (search_google_docs and get_google_docs): insert the entire architecture diagram, then document each section as low-level design architecture followed by concrete implementation guidelines with production code, verification steps, and official Google documentation links.';
const BRIEF_DOC_REQUEST =
  'Write a short summary documentation for this diagram grounded in official Google documentation via Google Developer Knowledge MCP with official reference links.';

function mcpPillMeta(status: GoogleDocsMcpStatus | null): { tone: 'ready' | 'warn' | 'muted'; label: string; title: string } {
  if (status == null) {
    return {
      tone: 'muted',
      label: 'Google Docs MCP',
      title: 'Official Google Developer Knowledge MCP (developerknowledge.googleapis.com/mcp) — open Settings to inspect status',
    };
  }
  if (status.lastErrorCode === 'api-disabled' || status.lastErrorCode === 'auth-required') {
    return {
      tone: 'warn',
      label: status.lastErrorCode === 'api-disabled' ? 'Enable Google Docs API' : 'Google Docs MCP setup',
      title: status.lastError ?? 'Official Google Developer Knowledge MCP needs setup — click to configure in Settings',
    };
  }
  if (status.configured) {
    const via = status.authMode === 'api-key'
      ? 'API key'
      : status.authMode === 'adc'
        ? (status.projectId ? `ADC · ${status.projectId}` : 'ADC')
        : 'OAuth token';
    return {
      tone: 'ready',
      label: status.verified ? 'Official Google Docs MCP' : `Google Docs MCP (${via})`,
      title: `Grounded via official Google Developer Knowledge MCP (${status.endpoint}) using ${via}. Click to test or configure in Settings.`,
    };
  }
  return {
    tone: 'warn',
    label: 'Google Docs MCP setup',
    title: status.setupHint ?? 'Set DEVELOPERKNOWLEDGE_API_KEY or sign in with gcloud ADC — click to configure in Settings',
  };
}

function EmptyBook({ onAdd, mcpStatus }: { onAdd: (kind: 'text' | 'table') => void; mcpStatus: GoogleDocsMcpStatus | null }) {
  const { store, agent, ensureCanTalk, toggleVoice, openSettings } = useStudio();
  const canDocument = hasDiagram(store.scene);
  const mcp = mcpPillMeta(mcpStatus);
  const sendDocRequest = (prompt: string) => {
    if (ensureCanTalk()) agent.sendText(prompt).catch(() => undefined);
  };
  return (
    <div className="doc-empty">
      <div className="doc-empty-badges">
        <div className="doc-empty-badge">
          <Icon name="menu_book" size={16} />
          <span>Architecture Reference Guide</span>
        </div>
        <button type="button" className={`doc-mcp-pill tone-${mcp.tone}`} onClick={openSettings} title={mcp.title}>
          <Icon name={mcp.tone === 'ready' ? 'verified_user' : 'warning'} size={14} />
          <span>{mcp.label}</span>
        </button>
      </div>
      <h1>Document your architecture like a production guide</h1>
      <p>
        Ask Gemini for full documentation and it queries Google’s official Developer Knowledge MCP
        for the latest authoritative Google docs, embeds your live architecture diagram, and documents
        every architectural layer from Low-Level Design mechanics straight into concrete implementation
        guidelines, code snippets, callouts, ADRs, verification steps, and official citations.
      </p>
      <div className="doc-empty-grid" aria-hidden="true">
        <div className="doc-empty-card">
          <Icon name="account_tree" size={18} />
          <strong>Embedded Architecture</strong>
          <span>Full topology &amp; focused subsystem diagrams inline</span>
        </div>
        <div className="doc-empty-card">
          <Icon name="layers" size={18} />
          <strong>Low-Level Design</strong>
          <span>Protocols, pooling, locking, indexes &amp; trade-off tables</span>
        </div>
        <div className="doc-empty-card">
          <Icon name="code" size={18} />
          <strong>Implementation Code</strong>
          <span>Idiomatic SQL, TypeScript, Python &amp; IaC snippets</span>
        </div>
        <div className="doc-empty-card">
          <Icon name="rocket_launch" size={18} />
          <strong>ADRs &amp; Rollout Plan</strong>
          <span>Decision records, risk register &amp; verification stages</span>
        </div>
      </div>
      <div className="doc-empty-actions">
        {canDocument && (
          <>
            <button type="button" className="filled-btn doc-generate" onClick={() => sendDocRequest(FULL_DOC_REQUEST)}>
              <Icon name="article" size={19} /> Full architecture docs
            </button>
            <button type="button" className="tonal-btn" onClick={() => sendDocRequest(BRIEF_DOC_REQUEST)}>
              <Icon name="description" size={18} /> Brief summary
            </button>
          </>
        )}
        <button type="button" className={canDocument ? 'tonal-btn' : 'filled-btn'} onClick={toggleVoice}>
          <Icon name="mic" size={19} /> Start talking
        </button>
        <button type="button" className="text-btn" onClick={() => onAdd('text')}><Icon name="note_add" size={18} /> Write a chapter</button>
        <button type="button" className="text-btn" onClick={() => onAdd('table')}><Icon name="table_chart" size={18} /> Add a table</button>
      </div>
    </div>
  );
}

export function DocView() {
  const { workspace, store, agent, notify, openSettings } = useStudio();
  useWorkspaceRevision(workspace);
  const page = workspace.active;
  const scene = store.scene;
  const chapters = useMemo(() => bookOutline(scene), [scene]);
  const current = chapters.find((c) => c.id === page.chapter) ?? chapters[0];
  const index = current != null ? chapters.indexOf(current) : -1;
  const block = current != null ? scene.blocks.find((b) => b.id === current.id) : undefined;
  const prev = index > 0 ? chapters[index - 1] : undefined;
  const next = index >= 0 && index < chapters.length - 1 ? chapters[index + 1] : undefined;
  const words = chapters.reduce((n, c) => n + c.words, 0);
  const diagramExists = hasDiagram(scene);
  const hasFullEmbed = useMemo(() => sceneHasFullDiagramEmbed(scene), [scene]);
  const stackItems = useMemo(() => extractStackItems(scene), [scene]);

  const [readMode, setReadMode] = useState<ReadMode>('chapter');
  const [visibleChapter, setVisibleChapter] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [section, setSection] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [flash, setFlash] = useState<Map<string, Flash>>(new Map());
  const [tocOpen, setTocOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [progress, setProgress] = useState(0);
  const [copiedMd, setCopiedMd] = useState(false);
  const [wideRail, setWideRail] = useState(false);
  const [mcpStatus, setMcpStatus] = useState<GoogleDocsMcpStatus | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);

  // Check official Google Developer Knowledge MCP status on mount
  useEffect(() => {
    let active = true;
    googleDocsApi.status().then((s) => {
      if (active) setMcpStatus(s);
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  // Measure the doc view container to enable the right-hand "On this page" rail on wide layouts
  useEffect(() => {
    const el = rootRef.current;
    if (el == null || typeof ResizeObserver === 'undefined') return;
    const update = () => setWideRail(el.clientWidth >= WIDE_RAIL_PX);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [chapters.length]);

  const openDiagram = useCallback((focusNodeId?: string) => {
    workspace.showView('diagram');
    if (focusNodeId) {
      store.setSelection([focusNodeId]);
      requestAnimationFrame(() => {
        agent.view?.focus([focusNodeId]);
      });
    }
  }, [workspace, store, agent]);

  const open = useCallback((id: string, anchor?: string) => {
    workspace.showView('doc', { chapter: id });
    setPending(anchor ?? (readMode === 'full' ? `doc-ch-${id}` : null));
    setTocOpen(false);
  }, [workspace, readMode]);

  // The open chapter is also the selection ("rewrite this chapter")
  useEffect(() => {
    if (current != null && page.chapter !== current.id) workspace.showView('doc', { chapter: current.id });
  }, [current, page, workspace]);

  // A new chapter starts at its top; a section/chapter link scrolls to it
  useEffect(() => {
    const main = mainRef.current;
    if (main == null) return;
    if (pending != null) {
      document.getElementById(pending)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      if (!pending.startsWith('doc-ch-')) setSection(pending);
      setPending(null);
    } else if (readMode === 'chapter') {
      main.scrollTo({ top: 0 });
      setSection(null);
      setProgress(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, pending, readMode]);

  // Highlight what was just written; a chapter added by hand opens in the editor
  const last = store.lastChange;
  useEffect(() => {
    if (last == null || Date.now() - last.time > 1500) return;
    const m = new Map<string, Flash>();
    last.changes.updatedBlocks.forEach((id) => m.set(id, 'updated'));
    last.changes.addedBlocks.forEach((id) => m.set(id, 'added'));
    if (m.size === 0) return;
    const entry = store.history[store.historyIndex];
    if (entry?.source === 'manual' && last.changes.addedBlocks.length === 1 && entry.changes === last.changes) {
      setEditing(last.changes.addedBlocks[0]);
    }
    setFlash(m);
    const t = setTimeout(() => setFlash(new Map()), HIGHLIGHT_MS);
    return () => clearTimeout(t);
  }, [last, store]);

  // ← and → turn the pages in chapter mode, Enter edits the open chapter
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229 || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable="true"], dialog, [role="tab"], [role="menu"]')) return;
      if (readMode === 'chapter' && e.key === 'ArrowLeft' && prev != null) {
        e.preventDefault();
        open(prev.id);
      } else if (readMode === 'chapter' && e.key === 'ArrowRight' && next != null) {
        e.preventDefault();
        open(next.id);
      } else if (e.key === 'Enter' && current != null && editing == null && !target.closest('button, a')) {
        e.preventDefault();
        setEditing(current.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next, current, editing, open, readMode]);

  // Scroll-spy for reading progress, active chapter (in full guide), and active section
  const onScroll = useCallback(() => {
    const main = mainRef.current;
    if (main == null || current == null) return;
    const maxScroll = Math.max(0, main.scrollHeight - main.clientHeight);
    setProgress(maxScroll > 16 ? Math.min(1, Math.max(0, main.scrollTop / maxScroll)) : 0);
    const top = main.getBoundingClientRect().top + 124;
    if (readMode === 'full') {
      let activeCh: string | null = chapters[0]?.id ?? null;
      for (const sec of main.querySelectorAll<HTMLElement>('.doc-full-chapter')) {
        if (sec.getBoundingClientRect().top <= top + 24) {
          activeCh = sec.dataset.chapterId ?? activeCh;
        }
      }
      setVisibleChapter(activeCh);
    }
    const selector = readMode === 'full'
      ? '.doc-article [id*="-h"]'
      : `.doc-article [id^="${CSS.escape(current.id)}-h"]`;
    let active: string | null = null;
    for (const h of main.querySelectorAll<HTMLElement>(selector)) {
      if (h.getBoundingClientRect().top <= top) active = h.id;
    }
    setSection(active);
  }, [current, readMode, chapters]);

  const add = (kind: 'text' | 'table') => {
    addChapter(workspace, store, kind);
  };

  const move = (c: BookChapter, delta: -1 | 1) => {
    const i = chapters.indexOf(c);
    const after = delta < 0 ? (i >= 2 ? chapters[i - 2].id : 'start') : chapters[i + 1]?.id;
    if (after == null) return;
    store.edit({ write_blocks: [{ id: c.id, after }] }, { source: 'manual', label: `Moved “${c.title}” ${delta < 0 ? 'up' : 'down'}` });
  };

  const remove = (c: BookChapter) => {
    const idx = chapters.indexOf(c);
    const neighbour = chapters[idx + 1] ?? chapters[idx - 1];
    const r = store.edit({ remove_blocks: [c.id] }, { source: 'manual', label: `Deleted the chapter “${c.title}”` });
    if (!r.ok) return;
    if (neighbour != null) workspace.showView('doc', { chapter: neighbour.id });
    notify(`Deleted “${c.title}”`, { label: 'Undo', run: () => store.undo() });
  };

  const save = (b: DBlock, c: BookChapter, v: { title: string; source: string } | null) => {
    setEditing(null);
    if (v == null) return;
    const title = v.title.trim() || undefined;
    const label = `Edited “${title ?? c.title}”`;
    if (b.kind === 'text') {
      if (v.source.trim() === '') {
        notify('A chapter needs some text. To remove it, delete it.');
        return;
      }
      if (v.source === b.text && (title == null || title === b.title)) return;
      store.edit({ write_blocks: [{ id: b.id, kind: 'text', title, text: v.source }] }, { source: 'manual', label });
    } else {
      const t = parseTableSource(v.source);
      if (t == null) {
        notify('A table needs at least its header line.');
        return;
      }
      const r = store.edit({ write_blocks: [{ id: b.id, kind: 'table', title, columns: t.columns, rows: t.rows }] }, { source: 'manual', label });
      if (!r.ok) notify(r.errors[0]);
    }
  };

  const copyMarkdown = () => {
    const md = bookToMarkdown(scene, { includeDiagram: true });
    if (!navigator.clipboard?.writeText) {
      download(fileName(scene, 'md').replace(/\.md$/, '-documentation.md'), md, 'text/markdown');
      return;
    }
    navigator.clipboard.writeText(md).then(() => {
      setCopiedMd(true);
      notify('Copied full documentation Markdown (with Mermaid diagrams)');
      setTimeout(() => setCopiedMd(false), 1800);
    }).catch(() => undefined);
  };

  const exportHtml = () => {
    const name = fileName(scene, 'html').replace(/\.html$/, '-documentation.html');
    download(name, bookToStandaloneHtml(scene), 'text/html');
    notify('Exported standalone HTML reference guide');
  };

  const printDoc = () => {
    window.print();
  };

  const filteredChapters = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return chapters;
    return chapters.filter((c) =>
      c.title.toLowerCase().includes(q) ||
      c.sections.some((s) => s.text.toLowerCase().includes(q)),
    );
  }, [chapters, filter]);

  if (current == null || block == null) {
    return (
      <div ref={rootRef} className="doc-view empty" role="region" aria-label="Documentation">
        <div className="doc-main" ref={mainRef}>
          <EmptyBook onAdd={add} mcpStatus={mcpStatus} />
        </div>
      </div>
    );
  }

  const activeChapter = readMode === 'full'
    ? (chapters.find((c) => c.id === visibleChapter) ?? chapters[0])
    : current;
  const flashOf = flash.get(current.id);
  const autoEmbedInChapter1 = diagramExists && index === 0 && !blockHasDiagramEmbed(block);
  const showRightRail = wideRail && (activeChapter.sections.length > 0 || stackItems.length > 0);
  const currentBadge = chapterBadge(block, current);
  const currentReadMins = Math.max(1, Math.round(current.words / 200));
  const mcp = mcpPillMeta(mcpStatus);

  const renderSectionList = (c: BookChapter, extraClass = '') => {
    if (c.sections.length === 0) return null;
    let n = 0;
    return (
      <ol className={`toc-sections ${extraClass}`.trim()} aria-label={`Sections of ${c.title}`}>
        {c.sections.map((s) => {
          const anchor = `${c.id}-h${s.heading}`;
          const numbered = s.level <= 2;
          if (numbered) n++;
          return (
            <li key={anchor}>
              <button
                type="button"
                className={`toc-section level-${numbered ? 2 : 3}${section === anchor ? ' active' : ''}`}
                aria-current={section === anchor ? 'location' : undefined}
                onClick={() => open(c.id, anchor)}
              >
                {numbered && <span className="toc-num">{c.number}.{n}</span>}
                <span className="toc-title">{s.text}</span>
              </button>
            </li>
          );
        })}
      </ol>
    );
  };

  const renderChapterBody = (b: DBlock, c: BookChapter, showAutoDiagram: boolean) => (
    <>
      {editing === c.id ? (
        <ChapterEditor key={c.id} block={b} chapter={c} onDone={(v) => save(b, c, v)} />
      ) : (
        <>
          {showAutoDiagram && (
            <DiagramFigure
              scene={scene}
              caption={`${scene.title || 'System'} — Full Architecture`}
              onOpenDiagram={openDiagram}
            />
          )}
          {b.kind === 'table' ? (
            <div className="md">
              <TableView columns={b.columns ?? []} rows={b.rows ?? []} maxWidth={ARTICLE_WIDTH} />
            </div>
          ) : (
            <Markdown
              text={b.text ?? ''}
              width={ARTICLE_WIDTH}
              anchor={c.id}
              skipFirstHeading={c.skipFirstHeading}
              scene={scene}
              onOpenDiagram={openDiagram}
              chapterNumber={c.number}
            />
          )}
        </>
      )}
    </>
  );

  return (
    <div
      ref={rootRef}
      className={`doc-view${showRightRail ? ' with-rail' : ''}`}
      role="region"
      aria-label="Documentation"
      data-toc-open={tocOpen || undefined}
    >
      <nav className="doc-toc" aria-label="Contents">
        <div className="doc-cover">
          {diagramExists && (
            <button type="button" className="doc-cover-figure" onClick={() => openDiagram()}
              aria-label="Show the diagram" data-tooltip="Open diagram canvas">
              <Thumbnail scene={scene} />
              <span className="doc-cover-open"><Icon name="account_tree" size={14} /> Diagram</span>
            </button>
          )}
          <div className="doc-cover-text">
            <span className="doc-eyebrow">Reference guide</span>
            <h2 className="doc-book-title">{scene.title || 'Untitled diagram'}</h2>
            <span className="doc-book-meta">
              {chapters.length} {chapters.length === 1 ? 'chapter' : 'chapters'} · {Math.max(1, Math.round(words / 200))} min read
            </span>
          </div>
          {chapters.length > 1 && (
            <div className="doc-mode-switch" role="group" aria-label="Reading mode">
              <button
                type="button"
                className={`doc-mode-btn${readMode === 'chapter' ? ' active' : ''}`}
                aria-pressed={readMode === 'chapter'}
                onClick={() => setReadMode('chapter')}
              >
                Chapters
              </button>
              <button
                type="button"
                className={`doc-mode-btn${readMode === 'full' ? ' active' : ''}`}
                aria-pressed={readMode === 'full'}
                onClick={() => {
                  setReadMode('full');
                  setVisibleChapter(chapters[0]?.id ?? null);
                  setSection(null);
                  setProgress(0);
                  mainRef.current?.scrollTo({ top: 0 });
                }}
              >
                Full guide
              </button>
            </div>
          )}
        </div>

        {chapters.length >= 3 && (
          <search className="doc-toc-search">
            <Icon name="find_in_page" size={15} className="doc-toc-search-icon" />
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter chapters…"
              aria-label="Filter chapters"
            />
            {filter && (
              <button type="button" className="doc-toc-search-clear" aria-label="Clear filter" onClick={() => setFilter('')}>
                <Icon name="close" size={14} />
              </button>
            )}
          </search>
        )}

        <div className="doc-toc-head" id="doc-contents">
          <span>Contents</span>
          <span className="doc-toc-count">{filteredChapters.length}</span>
        </div>
        <ol className="doc-toc-list" aria-labelledby="doc-contents">
          {filteredChapters.map((c) => {
            const active = c.id === activeChapter.id;
            const showInlineSections = !showRightRail && (readMode === 'full' ? c.sections.length > 0 : (active && c.sections.length > 0));
            return (
              <li key={c.id}>
                <button
                  type="button"
                  className={`toc-chapter${active ? ' active' : ''}${flash.has(c.id) ? ' flash' : ''}`}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => open(c.id)}
                >
                  <span className="toc-num">{c.number}</span>
                  <span className="toc-title">{c.title}</span>
                  {c.kind === 'table' && <Icon name="table_chart" size={15} className="toc-kind" />}
                </button>
                {showInlineSections && renderSectionList(c)}
              </li>
            );
          })}
          {filteredChapters.length === 0 && (
            <li className="doc-toc-empty">No matching chapters</li>
          )}
        </ol>
        <div className="doc-toc-actions">
          <button type="button" className="text-btn" onClick={() => add('text')}><Icon name="note_add" size={17} /> Chapter</button>
          <button type="button" className="text-btn" onClick={() => add('table')}><Icon name="table_chart" size={17} /> Table</button>
        </div>
      </nav>
      {tocOpen && <div className="doc-scrim" onClick={() => setTocOpen(false)} aria-hidden="true" />}

      <div className="doc-stage">
        <header className="doc-topbar" aria-label="Document toolbar">
          <div className="doc-topbar-left">
            <button type="button" className="doc-toc-toggle tonal-btn" aria-expanded={tocOpen} onClick={() => setTocOpen(!tocOpen)}>
              <Icon name="toc" size={17} /> Contents
            </button>
            <div className="doc-crumb" title={`${scene.title || 'Documentation'} / ${activeChapter.title}`}>
              <span className="doc-crumb-book">{scene.title || 'Documentation'}</span>
              <span className="doc-crumb-sep" aria-hidden="true">/</span>
              <span className="doc-crumb-ch">
                {readMode === 'full' ? 'Full guide' : `${activeChapter.number}. ${activeChapter.title}`}
              </span>
            </div>
          </div>
          <div className="doc-topbar-actions">
            <button type="button" className={`doc-mcp-pill compact tone-${mcp.tone}`} onClick={openSettings} title={mcp.title} aria-label={mcp.label}>
              <Icon name={mcp.tone === 'ready' ? 'verified_user' : 'warning'} size={13} />
              <span>{mcp.label}</span>
            </button>
            <button type="button" className={`doc-util-btn${copiedMd ? ' copied' : ''}`} onClick={copyMarkdown} title="Copy full Markdown with Mermaid diagrams">
              <Icon name={copiedMd ? 'check' : 'content_copy'} size={14} />
              <span>{copiedMd ? 'Copied' : 'Copy MD'}</span>
            </button>
            <button type="button" className="doc-util-btn" onClick={exportHtml} title="Download standalone HTML guide with embedded SVG diagrams">
              <Icon name="download" size={14} />
              <span>HTML</span>
            </button>
            <button type="button" className="doc-util-btn" onClick={printDoc} title="Print or save as PDF">
              <Icon name="article" size={14} />
              <span>Print</span>
            </button>
          </div>
          <div className="doc-progress-track" aria-hidden="true">
            <div className="doc-progress-bar" style={{ transform: `scaleX(${progress.toFixed(4)})` }} />
          </div>
        </header>

        <div className="doc-main" ref={mainRef} onScroll={onScroll}>
          <div className="doc-main-inner">
            {readMode === 'full' ? (
              <article className="doc-article doc-article-full" aria-labelledby="doc-full-title">
                <header className="doc-full-hero">
                  <div className="doc-meta-row">
                    <span className="doc-pill pill-blue">
                      <Icon name="menu_book" size={13} />
                      Architecture &amp; Low-Level Guide
                    </span>
                    <span className="doc-meta-dot">·</span>
                    <span className="doc-meta-item">{chapters.length} {chapters.length === 1 ? 'chapter' : 'chapters'}</span>
                    <span className="doc-meta-dot">·</span>
                    <span className="doc-meta-item">{Math.max(1, Math.round(words / 200))} min read</span>
                    {diagramExists && (
                      <>
                        <span className="doc-meta-dot">·</span>
                        <span className="doc-meta-item">{scene.nodes.length} components</span>
                      </>
                    )}
                  </div>
                  <h1 id="doc-full-title" className="chapter-title doc-hero-title">{scene.title || 'Architecture Documentation'}</h1>
                  {scene.subtitle && <p className="doc-full-subtitle">{scene.subtitle}</p>}
                  {stackItems.length > 0 && (
                    <div className="doc-stack-chips" aria-label="Technologies in architecture">
                      {stackItems.map((item) => (
                        <button
                          key={item.tech}
                          type="button"
                          className="doc-stack-chip"
                          title={`Inspect ${item.label} (${item.tech}) on canvas`}
                          onClick={() => openDiagram(item.nodeId)}
                        >
                          {item.tech}
                        </button>
                      ))}
                    </div>
                  )}
                </header>
                {diagramExists && !hasFullEmbed && (
                  <DiagramFigure
                    scene={scene}
                    caption={`${scene.title || 'System'} — Full Architecture`}
                    onOpenDiagram={openDiagram}
                  />
                )}
                {chapters.map((c, ci) => {
                  const b = scene.blocks.find((x) => x.id === c.id);
                  if (b == null) return null;
                  const chFlash = flash.get(c.id);
                  const badge = chapterBadge(b, c);
                  return (
                    <section
                      key={c.id}
                      id={`doc-ch-${c.id}`}
                      data-chapter-id={c.id}
                      className={`doc-full-chapter${chFlash ? ` flash-${chFlash}` : ''}`}
                    >
                      <header className="chapter-head">
                        <div className="chapter-head-top">
                          <div className="doc-meta-row">
                            <span className="doc-chapter-num-chip">Chapter {c.number}</span>
                            <span className={`doc-pill pill-${badge.tone}`}>
                              <Icon name={badge.icon} size={13} />
                              {badge.label}
                            </span>
                            <span className="doc-meta-item">{Math.max(1, Math.round(c.words / 200))} min</span>
                          </div>
                          {editing !== c.id && (
                            <div className="chapter-actions" role="toolbar" aria-label={`Actions for ${c.title}`}>
                              <IconButton icon="edit" label="Edit the chapter" onClick={() => setEditing(c.id)} />
                              <IconButton icon="arrow_upward" label="Move up" disabled={ci === 0} onClick={() => move(c, -1)} />
                              <IconButton icon="arrow_downward" label="Move down" disabled={ci === chapters.length - 1} onClick={() => move(c, 1)} />
                              <IconButton icon="delete" label="Delete the chapter" onClick={() => remove(c)} />
                            </div>
                          )}
                        </div>
                        <h2 className="chapter-title chapter-title-full">{c.number}. {c.title}</h2>
                      </header>
                      {renderChapterBody(b, c, false)}
                    </section>
                  );
                })}
              </article>
            ) : (
              <article
                key={current.id}
                className={`doc-article${flashOf ? ` flash-${flashOf}` : ''}`}
                aria-labelledby="chapter-title"
              >
                <header className="chapter-head">
                  <div className="chapter-head-top">
                    <div className="doc-meta-row">
                      <span className="doc-chapter-num-chip">Chapter {current.number} of {chapters.length}</span>
                      <span className={`doc-pill pill-${currentBadge.tone}`}>
                        <Icon name={currentBadge.icon} size={13} />
                        {currentBadge.label}
                      </span>
                      <span className="doc-meta-dot">·</span>
                      <span className="doc-meta-item">{currentReadMins} min read</span>
                    </div>
                    {editing !== current.id && (
                      <div className="chapter-actions" role="toolbar" aria-label="Chapter actions">
                        <IconButton icon="edit" label="Edit the chapter" shortcut="Enter" onClick={() => setEditing(current.id)} />
                        <IconButton icon="arrow_upward" label="Move up" disabled={prev == null} onClick={() => move(current, -1)} />
                        <IconButton icon="arrow_downward" label="Move down" disabled={next == null} onClick={() => move(current, 1)} />
                        <IconButton icon="delete" label="Delete the chapter" onClick={() => remove(current)} />
                      </div>
                    )}
                  </div>
                  <h1 id="chapter-title" className="chapter-title">{current.title}</h1>
                  {index === 0 && stackItems.length > 0 && (
                    <div className="doc-stack-chips" aria-label="Technologies in architecture">
                      {stackItems.map((item) => (
                        <button
                          key={item.tech}
                          type="button"
                          className="doc-stack-chip"
                          title={`Inspect ${item.label} (${item.tech}) on canvas`}
                          onClick={() => openDiagram(item.nodeId)}
                        >
                          {item.tech}
                        </button>
                      ))}
                    </div>
                  )}
                </header>
                {renderChapterBody(block, current, autoEmbedInChapter1)}
                <footer className="chapter-nav" aria-label="Turn the page">
                  {prev != null ? (
                    <button type="button" className="chapter-link prev" onClick={() => open(prev.id)}>
                      <span className="chapter-link-label"><Icon name="arrow_back" size={15} /> Previous chapter</span>
                      <span className="chapter-link-title">{prev.number}. {prev.title}</span>
                    </button>
                  ) : <span />}
                  {next != null && (
                    <button type="button" className="chapter-link next" onClick={() => open(next.id)}>
                      <span className="chapter-link-label">Next chapter <Icon name="arrow_forward" size={15} /></span>
                      <span className="chapter-link-title">{next.number}. {next.title}</span>
                    </button>
                  )}
                </footer>
              </article>
            )}

            {showRightRail && (
              <aside className="doc-rail" aria-label="On this page">
                {activeChapter.sections.length > 0 && (
                  <div className="doc-rail-card">
                    <div className="doc-rail-head">On this page</div>
                    {renderSectionList(activeChapter, 'rail-sections')}
                  </div>
                )}
                {stackItems.length > 0 && (
                  <div className="doc-rail-card">
                    <div className="doc-rail-head">Components</div>
                    <div className="doc-rail-stack">
                      {stackItems.map((item) => (
                        <button
                          key={item.nodeId}
                          type="button"
                          className="doc-rail-comp"
                          onClick={() => openDiagram(item.nodeId)}
                          title={`Focus ${item.label} on canvas`}
                        >
                          <span className="doc-rail-comp-name">{item.label}</span>
                          <span className="doc-rail-comp-tech">{item.tech}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </aside>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
