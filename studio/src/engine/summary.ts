/**
 * Compact text views of the scene for the voice agent: the full state it
 * edits against, and a one-line description of a change for the activity log.
 */
import { describeDashboard } from './dashboard';
import { describeDeck } from './deck';
import { groupDepth } from './scene';
import type { ChangeSet, DBlock, DNode, Scene } from './types';

const q = (s: string) => JSON.stringify(s);

function nodeLine(n: DNode): string {
  const attrs: string[] = [n.kind];
  if (n.tech) attrs.push(`tech ${q(n.tech)}`);
  if (n.provider) attrs.push(n.provider);
  if (n.color) attrs.push(n.color);
  let line = `${n.id} ${q(n.label)} [${attrs.join(', ')}]`;
  if (n.group) line += ` in ${n.group}`;
  if (n.description) line += ` — ${n.description}`;
  return line;
}

/**
 * The diagram as the agent sees it, e.g.
 *   version 4 · architecture · LR · "Checkout"
 *   groups: vpc "Production VPC" (vpc)
 *   nodes: api "API" [service, tech "Cloud Run", gcp] in vpc
 *   edges: api -> db "SQL"
 */
export function describeScene(scene: Scene, selection: string[] = []): string {
  if (
    scene.nodes.length === 0 &&
    scene.groups.length === 0 &&
    scene.blocks.length === 0 &&
    scene.dashboard == null &&
    scene.board == null &&
    scene.deck == null
  ) {
    return `version ${scene.version} · empty canvas (no diagram yet)` + (scene.title ? ` · title ${q(scene.title)}` : '');
  }
  const lines: string[] = [];
  lines.push(`version ${scene.version} · ${scene.type} · ${scene.direction}` +
    (scene.title ? ` · ${q(scene.title)}` : ' · no title') +
    (scene.subtitle ? ` · subtitle ${q(scene.subtitle)}` : '') +
    ` · ${scene.nodes.length} nodes, ${scene.edges.length} edges` +
    (scene.blocks.length > 0 ? `, ${scene.blocks.length} documentation ${scene.blocks.length === 1 ? 'chapter' : 'chapters'}` : '') +
    (scene.dashboard ? `, ${scene.dashboard.widgets.length} dashboard ${scene.dashboard.widgets.length === 1 ? 'widget' : 'widgets'}` : '') +
    (scene.board ? `, ${scene.board.widgets.length} board ${scene.board.widgets.length === 1 ? 'chart' : 'charts'}` : '') +
    (scene.deck ? `, ${scene.deck.slides.length} deck ${scene.deck.slides.length === 1 ? 'slide' : 'slides'}` : ''));
  if (scene.dashboard) {
    lines.push(describeDashboard(scene.dashboard));
  }
  if (scene.board) {
    lines.push(describeDashboard(scene.board, 'board (work in progress; promote_to_dashboard copies charts to the dashboard)'));
  }
  if (scene.deck) {
    lines.push(describeDeck(scene.deck));
  }
  if (scene.groups.length > 0) {
    lines.push('groups:');
    const sorted = scene.groups.toSorted((a, b) => groupDepth(scene, a) - groupDepth(scene, b));
    for (const g of sorted) {
      lines.push(`  ${g.id} ${q(g.label)} (${g.kind})` + (g.parent ? ` in ${g.parent}` : '') + (g.color ? ` ${g.color}` : ''));
    }
  }
  if (scene.nodes.length > 0) {
    lines.push('nodes:');
    for (const n of scene.nodes) {
      lines.push('  ' + nodeLine(n));
    }
  }
  if (scene.edges.length > 0) {
    lines.push('edges:');
    for (const e of scene.edges) {
      const arrow = e.arrow === 'both' ? '<->' : e.arrow === 'none' ? '---' : '->';
      lines.push(`  ${e.from} ${arrow} ${e.to}` + (e.label ? ` ${q(e.label)}` : '') +
        (e.style && e.style !== 'solid' ? ` (${e.style})` : ''));
    }
  }
  if (scene.blocks.length > 0) {
    lines.push('documentation (a book in its own tab, chapters in reading order):');
    const selectedSet = new Set(selection);
    const fullAll = scene.blocks.length <= 3;
    scene.blocks.forEach((b, i) => lines.push(...blockLines(b, i + 1, fullAll || selectedSet.has(b.id))));
  }
  const validSelection = selection.filter((id) =>
    scene.nodes.some((n) => n.id === id) ||
    scene.blocks.some((b) => b.id === id) ||
    (scene.dashboard?.widgets.some((w) => w.id === id) ?? false) ||
    (scene.board?.widgets.some((w) => w.id === id) ?? false) ||
    (scene.deck?.slides.some((s) => s.id === id) ?? false),
  );
  lines.push(validSelection.length > 0 ? `selected: ${validSelection.join(', ')}` : 'selected: nothing');
  return lines.join('\n');
}

const MAX_TEXT = 4000;
const MAX_TABLE_ROWS = 40;

/**
 * A chapter summary for the agent: full body for the selected chapter (and when
 * the book has at most 3 chapters) so rewrites are exact, and a compact outline
 * for other chapters in long books so multi-chapter generation stays lean.
 */
function blockLines(b: DBlock, n: number, full: boolean): string[] {
  const head = `  ${n}. ${b.id} ${b.kind}` + (b.title ? ` ${q(b.title)}` : '') + (b.color ? ` ${b.color}` : '');
  if (b.kind === 'table') {
    const rows = b.rows ?? [];
    if (!full) {
      return [`${head} · columns ${(b.columns ?? []).map(q).join(', ')} · ${rows.length} rows`];
    }
    const out = [`${head} · columns ${(b.columns ?? []).map(q).join(', ')} · ${rows.length} rows:`];
    for (const r of rows.slice(0, MAX_TABLE_ROWS)) out.push(`    | ${r.join(' | ')} |`);
    if (rows.length > MAX_TABLE_ROWS) out.push(`    … ${rows.length - MAX_TABLE_ROWS} more rows`);
    return out;
  }
  const text = b.text ?? '';
  if (!full) {
    const headings = text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^#{1,3}\s+/.test(l))
      .slice(0, 8);
    const words = text.split(/\s+/).filter(Boolean).length;
    const summary = headings.length > 0 ? ` · ${words} words · sections: ${headings.join(' / ')}` : ` · ${words} words`;
    return [`${head}${summary}`];
  }
  const shown = text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + ` … (${text.length - MAX_TEXT} more characters)` : text;
  return [`${head}:`, ...shown.split('\n').map((l) => '    ' + l)];
}

/** Short human description of a change, e.g. "+2 nodes, −1 connection". */
export function describeChanges(c: ChangeSet): string {
  const parts: string[] = [];
  const add = (n: number, one: string, many: string, sign: string) => {
    if (n > 0) parts.push(`${sign}${n} ${n === 1 ? one : many}`);
  };
  add(c.addedNodes.length, 'node', 'nodes', '+');
  add(c.addedEdges.length, 'connection', 'connections', '+');
  add(c.addedGroups.length, 'group', 'groups', '+');
  add(c.addedBlocks.length, 'chapter', 'chapters', '+');
  add(c.addedWidgets.length, 'widget', 'widgets', '+');
  add(c.addedSlides.length, 'slide', 'slides', '+');
  add(
    c.updatedNodes.length +
      c.updatedEdges.length +
      c.updatedGroups.length +
      c.updatedBlocks.length +
      c.updatedWidgets.length +
      c.updatedSlides.length,
    'change',
    'changes',
    '~',
  );
  add(c.removedNodes.length, 'node', 'nodes', '−');
  add(c.removedEdges.length, 'connection', 'connections', '−');
  add(c.removedGroups.length, 'group', 'groups', '−');
  add(c.removedBlocks.length, 'chapter', 'chapters', '−');
  add(c.removedWidgets.length, 'widget', 'widgets', '−');
  add(c.removedSlides.length, 'slide', 'slides', '−');
  if (parts.length === 0 && c.movedNodes.length > 0) parts.push(`moved ${c.movedNodes.length}`);
  return parts.length > 0 ? parts.join(', ') : 'no change';
}

export function isEmptyChange(c: ChangeSet): boolean {
  return Object.values(c).every((list) => list.length === 0);
}
