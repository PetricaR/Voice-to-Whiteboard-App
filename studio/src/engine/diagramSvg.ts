/**
 * Pure, deterministic architecture diagram renderers for documentation:
 *  - Shared geometry & edge routing matching the live React Flow canvas
 *  - Subsystem focus resolution (highlight a section's nodes/groups in context)
 *  - Mermaid flowchart export for Markdown (.md)
 *  - Self-contained vector SVG export for standalone HTML documentation
 */
import { normalize } from './resolve';
import { routeEdge, roundedPath, type Pt, type Route } from './routing';
import { groupAndDescendants, groupBounds, groupDepth, sceneBounds } from './scene';
import { hasDiagram, type ColorName, type DEdge, type DGroup, type DNode, type NodeKind, type Rect, type Scene } from './types';

export interface FocusSelection {
  nodes: Set<string>;
  groups: Set<string>;
  /** Ancestor groups kept legible around focused members. */
  ancestorGroups: Set<string>;
}

export interface RoutedDiagramEdge {
  edge: DEdge;
  route: Route;
  path: string;
}

export interface DiagramGeometry {
  bounds: Rect;
  viewBox: Rect;
  groups: { group: DGroup; rect: Rect; depth: number }[];
  nodes: DNode[];
  edges: RoutedDiagramEdge[];
}

export const FLOW_SHAPES = new Set<NodeKind>([
  'process', 'decision', 'start', 'end', 'io', 'document', 'subprocess', 'note',
]);

export function defaultKindColor(kind: NodeKind): ColorName {
  switch (kind) {
    case 'database': case 'storage': case 'analytics': case 'document':
      return 'teal';
    case 'cache':
      return 'green';
    case 'queue': case 'email': case 'decision':
      return 'orange';
    case 'gateway': case 'loadbalancer': case 'network': case 'io':
      return 'purple';
    case 'ai':
      return 'pink';
    case 'security': case 'end':
      return 'red';
    case 'user': case 'client': case 'mobile': case 'external':
      return 'gray';
    case 'start':
      return 'green';
    case 'note':
      return 'yellow';
    default:
      return 'blue';
  }
}

function ancestorGroupIds(scene: Scene, start: string | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let cur = start;
  while (cur != null && !seen.has(cur)) {
    const g = scene.groups.find((x) => x.id === cur);
    if (g == null) break;
    seen.add(g.id);
    out.push(g.id);
    cur = g.parent;
  }
  return out;
}

/**
 * Resolves a list of node/group ids or labels into a focus set.
 * Returns null when no focus was requested or nothing matched (shows full diagram).
 */
export function resolveFocusSet(scene: Scene, focus?: string[]): FocusSelection | null {
  if (!focus || focus.length === 0) return null;
  const nodes = new Set<string>();
  const groups = new Set<string>();
  const ancestorGroups = new Set<string>();

  for (const raw of focus) {
    const key = normalize(raw);
    if (!key) continue;
    const exactNode = scene.nodes.find((n) => n.id === raw || normalize(n.id) === key || normalize(n.label) === key);
    if (exactNode) {
      nodes.add(exactNode.id);
      continue;
    }
    const exactGroup = scene.groups.find((g) => g.id === raw || normalize(g.id) === key || normalize(g.label) === key);
    if (exactGroup) {
      for (const gid of groupAndDescendants(scene, exactGroup.id)) {
        groups.add(gid);
      }
      continue;
    }
    // Partial label/tech fallback when the model used a slightly shortened name
    const looseNodes = scene.nodes.filter((n) => normalize(n.label).includes(key) || normalize(n.tech ?? '').includes(key));
    if (looseNodes.length === 1) {
      nodes.add(looseNodes[0].id);
    }
  }

  for (const n of scene.nodes) {
    if (n.group && groups.has(n.group)) nodes.add(n.id);
  }
  if (nodes.size === 0 && groups.size === 0) return null;

  for (const nid of nodes) {
    const n = scene.nodes.find((x) => x.id === nid);
    for (const gid of ancestorGroupIds(scene, n?.group)) ancestorGroups.add(gid);
  }
  for (const gid of groups) {
    const g = scene.groups.find((x) => x.id === gid);
    for (const pid of ancestorGroupIds(scene, g?.parent)) ancestorGroups.add(pid);
  }
  return { nodes, groups, ancestorGroups };
}

/** Computes exact group boxes, routed orthogonal edges, and padded viewBox. */
export function computeDiagramGeometry(scene: Scene, pad = 28): DiagramGeometry | null {
  if (!hasDiagram(scene)) return null;
  const bounds = sceneBounds(scene);
  if (bounds == null) return null;

  const gBounds = groupBounds(scene);
  const groups = scene.groups
    .toSorted((a, b) => groupDepth(scene, a) - groupDepth(scene, b))
    .flatMap((group) => {
      const rect = gBounds.get(group.id);
      return rect ? [{ group, rect, depth: groupDepth(scene, group) }] : [];
    });

  const rects = new Map(scene.nodes.map((n) => [n.id, { x: n.x, y: n.y, w: n.w, h: n.h }]));
  const groupRects = groups.map((g) => g.rect);
  const centered = new Set(scene.nodes.filter((n) => n.kind === 'decision').map((n) => n.id));
  const pairs = new Map<string, string[]>();
  for (const e of scene.edges) {
    const key = [e.from, e.to].sort().join('|');
    pairs.set(key, [...(pairs.get(key) ?? []), e.id]);
  }

  const edges: RoutedDiagramEdge[] = [];
  const used = new Map<string, number>();
  const routed: Pt[][] = [];
  const labels: Pt[] = [];
  let minX = bounds.x;
  let minY = bounds.y;
  let maxX = bounds.x + bounds.w;
  let maxY = bounds.y + bounds.h;

  for (const e of scene.edges) {
    const s = rects.get(e.from);
    const t = rects.get(e.to);
    if (s == null || t == null) continue;
    const obstacles = [...rects].filter(([id]) => id !== e.from && id !== e.to).map(([, r]) => r);
    const siblings = pairs.get([e.from, e.to].sort().join('|'))!;
    const shift = (siblings.indexOf(e.id) - (siblings.length - 1) / 2) * 16;
    const route = routeEdge(
      s,
      t,
      obstacles,
      shift,
      { used, from: e.from, to: e.to },
      {
        sourceCentered: centered.has(e.from),
        targetCentered: centered.has(e.to),
        groups: groupRects,
        routed,
        labels,
      },
    );
    routed.push(route.points);
    if (e.label) labels.push(route.label);
    for (const p of route.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    edges.push({ edge: e, route, path: roundedPath(route.points) });
  }

  // De-overlap edge label pills so closely fanned connections stay readable
  const placedPills: { x: number; y: number; w: number; h: number }[] = [];
  for (const item of edges) {
    if (!item.edge.label) continue;
    const text = item.edge.label.length <= 28 ? item.edge.label : `${item.edge.label.slice(0, 27)}…`;
    const w = Math.max(34, text.length * 6.4 + 14);
    const h = 20;
    let { x, y } = item.route.label;
    const collides = (cx: number, cy: number) => placedPills.some((p) =>
      Math.abs(cx - p.x) < (w + p.w) / 2 + 4 && Math.abs(cy - p.y) < (h + p.h) / 2 + 3);
    if (collides(x, y)) {
      const base = y;
      for (const delta of [22, -22, 44, -44, 66, -66]) {
        if (!collides(x, base + delta)) {
          y = base + delta;
          break;
        }
      }
      item.route = { ...item.route, label: { x, y } };
    }
    placedPills.push({ x, y, w, h });
    if (x - w / 2 < minX) minX = x - w / 2;
    if (x + w / 2 > maxX) maxX = x + w / 2;
    if (y - h / 2 < minY) minY = y - h / 2;
    if (y + h / 2 > maxY) maxY = y + h / 2;
  }

  const viewBox: Rect = {
    x: minX - pad,
    y: minY - pad,
    w: Math.max(120, maxX - minX + pad * 2),
    h: Math.max(80, maxY - minY + pad * 2),
  };

  return { bounds, viewBox, groups, nodes: scene.nodes, edges };
}

/* ---------- Mermaid Export ---------- */

const mermaidId = (prefix: string, id: string) => `${prefix}_${id.replace(/[^a-zA-Z0-9_]/g, '_')}`;
const mermaidText = (s: string) => s.replace(/"/g, "'").replace(/\r?\n/g, ' ').trim();

function mermaidNodeDecl(n: DNode): string {
  const id = mermaidId('n', n.id);
  const label = mermaidText(n.label);
  const tech = n.tech ? mermaidText(n.tech) : '';
  const body = tech ? `${label}<br/><i>${tech}</i>` : label;
  switch (n.kind) {
    case 'database':
    case 'cache':
      return `${id}[("${body}")]`;
    case 'decision':
      return `${id}{"${label}"}`;
    case 'start':
    case 'end':
    case 'user':
      return `${id}(["${body}"])`;
    case 'queue':
      return `${id}[["${body}"]]`;
    default:
      return `${id}["${body}"]`;
  }
}

function mermaidEdgeLine(e: DEdge): string {
  const from = mermaidId('n', e.from);
  const to = mermaidId('n', e.to);
  const lbl = e.label ? mermaidText(e.label) : '';
  const dashed = e.style === 'dashed' || e.style === 'dotted';
  if (e.arrow === 'none') {
    const conn = dashed ? '-.-' : '---';
    return lbl ? `${from} ${conn}|"${lbl}"| ${to}` : `${from} ${conn} ${to}`;
  }
  if (e.arrow === 'both') {
    const conn = dashed ? '<-.->' : '<-->';
    return lbl ? `${from} ${conn}|"${lbl}"| ${to}` : `${from} ${conn} ${to}`;
  }
  const conn = dashed ? '-.->' : '-->';
  return lbl ? `${from} ${conn}|"${lbl}"| ${to}` : `${from} ${conn} ${to}`;
}

/** Converts a diagram Scene into a clean, nested Mermaid flowchart block. */
export function sceneToMermaid(scene: Scene, focus?: string[]): string {
  if (!hasDiagram(scene)) return '';
  const dir = scene.direction === 'TB' ? 'TB' : 'LR';
  const lines: string[] = [`flowchart ${dir}`];
  const emittedNodes = new Set<string>();
  const emittedGroups = new Set<string>();

  const emitGroup = (g: DGroup, indent: string) => {
    if (emittedGroups.has(g.id)) return;
    emittedGroups.add(g.id);
    lines.push(`${indent}subgraph ${mermaidId('g', g.id)}["${mermaidText(g.label)}"]`);
    for (const child of scene.groups.filter((c) => c.parent === g.id)) {
      emitGroup(child, indent + '  ');
    }
    for (const n of scene.nodes.filter((x) => x.group === g.id)) {
      lines.push(`${indent}  ${mermaidNodeDecl(n)}`);
      emittedNodes.add(n.id);
    }
    lines.push(`${indent}end`);
  };

  for (const g of scene.groups.filter((x) => !x.parent || !scene.groups.some((p) => p.id === x.parent))) {
    emitGroup(g, '  ');
  }
  for (const n of scene.nodes) {
    if (!emittedNodes.has(n.id)) lines.push(`  ${mermaidNodeDecl(n)}`);
  }
  for (const e of scene.edges) {
    lines.push(`  ${mermaidEdgeLine(e)}`);
  }

  const focused = resolveFocusSet(scene, focus);
  if (focused && focused.nodes.size > 0) {
    lines.push('  classDef focus stroke:#1a73e8,stroke-width:3px;');
    lines.push(`  class ${[...focused.nodes].map((id) => mermaidId('n', id)).join(',')} focus;`);
  }
  return lines.join('\n');
}

/* ---------- Self-Contained Standalone SVG Export ---------- */

const esc = (s: string) => s
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const SVG_PALETTE: Record<ColorName, { fill: string; stroke: string; text: string; tint: string }> = {
  blue: { fill: '#e8f0fe', stroke: '#1a73e8', text: '#174ea6', tint: '#f4f8ff' },
  green: { fill: '#e6f4ea', stroke: '#1e8e3e', text: '#137333', tint: '#f3faf5' },
  orange: { fill: '#fef3e0', stroke: '#e37400', text: '#b06000', tint: '#fff9f0' },
  red: { fill: '#fce8e6', stroke: '#d93025', text: '#a50e0e', tint: '#fff5f4' },
  purple: { fill: '#f3e8fd', stroke: '#8430ce', text: '#681da8', tint: '#faf5ff' },
  teal: { fill: '#e4f7fb', stroke: '#00838f', text: '#006064', tint: '#f2fbfd' },
  pink: { fill: '#fde7f3', stroke: '#d01884', text: '#9c166b', tint: '#fff5fa' },
  yellow: { fill: '#fef7e0', stroke: '#f29900', text: '#8d5b00', tint: '#fffdf2' },
  gray: { fill: '#f1f3f4', stroke: '#5f6368', text: '#3c4043', tint: '#f8f9fa' },
};

function truncate(s: string, maxChars: number): string {
  return s.length <= maxChars ? s : `${s.slice(0, Math.max(1, maxChars - 1))}…`;
}

/**
 * Generates a clean, self-contained vector SVG string of the entire architecture
 * (or subsystem-focused view) suitable for embedding directly in standalone HTML docs.
 */
export function sceneToSvgString(
  scene: Scene,
  opts: { focus?: string[]; idPrefix?: string; title?: string } = {},
): string {
  const geom = computeDiagramGeometry(scene, 28);
  if (geom == null) return '';

  const prefix = opts.idPrefix ?? 'arch';
  const focus = resolveFocusSet(scene, opts.focus);
  const vb = geom.viewBox;
  const parts: string[] = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}" ` +
    `width="100%" role="img" aria-label="${esc(opts.title ?? scene.title ?? 'Architecture diagram')}" ` +
    `style="display:block;max-width:100%;height:auto;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;">`,
  );

  parts.push(
    `<defs>` +
    `<marker id="${prefix}-arrow" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto-start-reverse">` +
    `<path d="M1,1.5 L10.5,6 L1,10.5 Z" fill="#5f6368"/></marker>` +
    `<marker id="${prefix}-arrow-focus" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto-start-reverse">` +
    `<path d="M1,1.5 L10.5,6 L1,10.5 Z" fill="#1a73e8"/></marker>` +
    `</defs>`,
  );

  // Groups (outermost to innermost)
  for (const { group, rect, depth } of geom.groups) {
    const col: ColorName = group.color ?? (depth === 0 ? 'blue' : depth === 1 ? 'gray' : 'teal');
    const p = SVG_PALETTE[col];
    const dashed = group.kind === 'subnet' || group.kind === 'boundary' || group.kind === 'zone' || group.kind === 'lane';
    const isFocused = focus == null || focus.groups.has(group.id) || focus.ancestorGroups.has(group.id);
    const opacity = isFocused ? 1 : 0.3;
    parts.push(
      `<g opacity="${opacity}">` +
      `<rect x="${rect.x}" y="${rect.y}" width="${rect.w}" height="${rect.h}" rx="12" ` +
      `fill="${p.tint}" stroke="${p.stroke}" stroke-width="${focus?.groups.has(group.id) ? 2 : 1.25}"` +
      `${dashed ? ' stroke-dasharray="6 4"' : ''}/>` +
      `<text x="${rect.x + 14}" y="${rect.y + 20}" fill="${p.text}" font-size="11.5" font-weight="600">${esc(group.label)}</text>` +
      `</g>`,
    );
  }

  // Edges
  for (const { edge, route, path } of geom.edges) {
    const bothFocused = focus != null && focus.nodes.has(edge.from) && focus.nodes.has(edge.to);
    const oneFocused = focus != null && (focus.nodes.has(edge.from) || focus.nodes.has(edge.to));
    const opacity = focus == null ? 1 : bothFocused ? 1 : oneFocused ? 0.65 : 0.18;
    const stroke = bothFocused ? '#1a73e8' : '#5f6368';
    const markerId = bothFocused ? `${prefix}-arrow-focus` : `${prefix}-arrow`;
    const arrow = edge.arrow ?? 'forward';
    const dash = edge.style === 'dashed' ? ' stroke-dasharray="6 4"' : edge.style === 'dotted' ? ' stroke-dasharray="2 3"' : '';
    const mEnd = arrow !== 'none' ? ` marker-end="url(#${markerId})"` : '';
    const mStart = arrow === 'both' ? ` marker-start="url(#${markerId})"` : '';
    parts.push(
      `<g opacity="${opacity}">` +
      `<path d="${path}" fill="none" stroke="${stroke}" stroke-width="${bothFocused ? 2.2 : 1.5}"${dash}${mStart}${mEnd}/>`,
    );
    if (edge.label) {
      const labelText = truncate(edge.label, 28);
      const pillW = Math.max(32, labelText.length * 6.4 + 14);
      const pillH = 18;
      parts.push(
        `<rect x="${route.label.x - pillW / 2}" y="${route.label.y - pillH / 2}" width="${pillW}" height="${pillH}" rx="9" ` +
        `fill="#ffffff" stroke="#dadce0" stroke-width="1"/>` +
        `<text x="${route.label.x}" y="${route.label.y + 3.5}" text-anchor="middle" fill="#3c4043" font-size="10.5" font-weight="500">${esc(labelText)}</text>`,
      );
    }
    parts.push('</g>');
  }

  // Nodes
  for (const n of geom.nodes) {
    const col: ColorName = n.color ?? defaultKindColor(n.kind);
    const p = SVG_PALETTE[col];
    const isFocused = focus == null || focus.nodes.has(n.id);
    const isRinged = focus != null && focus.nodes.has(n.id);
    const opacity = isFocused ? 1 : 0.25;
    const strokeW = isRinged ? 2.4 : 1.3;
    const stroke = isRinged ? '#1a73e8' : p.stroke;
    const maxTitleChars = Math.max(12, Math.floor((n.w - 24) / 7.2));
    const maxSubChars = Math.max(14, Math.floor((n.w - 24) / 6.1));

    parts.push(`<g opacity="${opacity}">`);
    if (n.kind === 'decision') {
      const cx = n.x + n.w / 2;
      const cy = n.y + n.h / 2;
      parts.push(
        `<polygon points="${cx},${n.y} ${n.x + n.w},${cy} ${cx},${n.y + n.h} ${n.x},${cy}" ` +
        `fill="${p.fill}" stroke="${stroke}" stroke-width="${strokeW}"/>` +
        `<text x="${cx}" y="${cy + 4}" text-anchor="middle" fill="${p.text}" font-size="12" font-weight="600">${esc(truncate(n.label, maxTitleChars))}</text>`,
      );
    } else if (n.kind === 'start' || n.kind === 'end' || n.kind === 'user') {
      const rx = Math.round(n.h / 2);
      parts.push(
        `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="${rx}" fill="${p.fill}" stroke="${stroke}" stroke-width="${strokeW}"/>` +
        `<text x="${n.x + n.w / 2}" y="${n.y + n.h / 2 + (n.tech ? -3 : 4)}" text-anchor="middle" fill="${p.text}" font-size="12.5" font-weight="600">${esc(truncate(n.label, maxTitleChars))}</text>` +
        (n.tech ? `<text x="${n.x + n.w / 2}" y="${n.y + n.h / 2 + 12}" text-anchor="middle" fill="#5f6368" font-size="10.5">${esc(truncate(n.tech, maxSubChars))}</text>` : ''),
      );
    } else {
      const dashed = n.kind === 'external' ? ' stroke-dasharray="5 3"' : '';
      parts.push(
        `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="12" fill="${p.fill}" stroke="${stroke}" stroke-width="${strokeW}"${dashed}/>` +
        `<rect x="${n.x}" y="${n.y}" width="5" height="${n.h}" rx="2.5" fill="${p.stroke}"/>` +
        `<text x="${n.x + 14}" y="${n.y + (n.tech ? n.h / 2 - 4 : n.h / 2 + 4)}" fill="${p.text}" font-size="12.5" font-weight="600">${esc(truncate(n.label, maxTitleChars))}</text>` +
        (n.tech ? `<text x="${n.x + 14}" y="${n.y + n.h / 2 + 13}" fill="#5f6368" font-size="10.5">${esc(truncate(n.tech, maxSubChars))}</text>` : '') +
        (n.provider && n.provider !== 'generic'
          ? `<text x="${n.x + n.w - 10}" y="${n.y + 14}" text-anchor="end" fill="${p.stroke}" font-size="9" font-weight="700" opacity="0.85">${esc(n.provider === 'k8s' ? 'K8S' : n.provider.toUpperCase())}</text>`
          : ''),
      );
    }
    parts.push('</g>');
  }

  parts.push('</svg>');
  return parts.join('');
}
