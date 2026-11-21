/**
 * Full-fidelity interactive vector architecture figure embedded directly inside
 * the Documentation view (DocView). Renders the real diagram geometry (nested
 * groups, orthogonal routed edges, edge labels, official Google Cloud SVG icons,
 * Material Symbols, provider badges, and flowchart shapes) with optional
 * subsystem focus highlighting and a zoomable lightbox modal.
 */
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  computeDiagramGeometry,
  FLOW_SHAPES,
  resolveFocusSet,
  type DiagramGeometry,
  type FocusSelection,
} from '../engine/diagramSvg';
import type { ColorName, DNode, Scene } from '../engine/types';
import { Icon } from './context';
import { closeTopLayerElement, useDialogLightDismiss } from './domTransitions';
import { resolveGcpIconUrl } from './gcpIcons';
import { ICONS, resolveNodeIcon } from './icons';
import { kindColor } from './theme';

const PROVIDER_BADGE: Record<string, string> = {
  gcp: 'GCP',
  aws: 'AWS',
  azure: 'AZURE',
  k8s: 'K8S',
  onprem: 'ON-PREM',
};

function iconPathOf(node: DNode): string | null {
  const raw = ICONS[resolveNodeIcon(node)];
  const m = /d="([^"]+)"/.exec(raw);
  return m ? m[1] : null;
}

function truncate(s: string, maxChars: number): string {
  return s.length <= maxChars ? s : `${s.slice(0, Math.max(1, maxChars - 1))}…`;
}

function DiagramSvgCanvas({
  geom,
  focus,
  markerPrefix,
  onSelectNode,
  zoom = 1,
  label,
}: {
  geom: DiagramGeometry;
  focus: FocusSelection | null;
  markerPrefix: string;
  onSelectNode?: (nodeId: string) => void;
  zoom?: number;
  label: string;
}) {
  const vb = geom.viewBox;
  const widthPx = Math.round(vb.w * zoom);
  const heightPx = Math.round(vb.h * zoom);

  return (
    <svg
      className="arch-svg"
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      style={zoom !== 1 ? { width: widthPx, height: heightPx, maxWidth: 'none' } : undefined}
      role="img"
      aria-label={label}
    >
      <defs>
        <marker
          id={`${markerPrefix}-arrow`}
          viewBox="0 0 12 12"
          refX="10"
          refY="6"
          markerWidth="10"
          markerHeight="10"
          markerUnits="userSpaceOnUse"
          orient="auto-start-reverse"
        >
          <path d="M1,1.5 L10.5,6 L1,10.5 Z" className="arch-marker" />
        </marker>
        <marker
          id={`${markerPrefix}-arrow-focus`}
          viewBox="0 0 12 12"
          refX="10"
          refY="6"
          markerWidth="10"
          markerHeight="10"
          markerUnits="userSpaceOnUse"
          orient="auto-start-reverse"
        >
          <path d="M1,1.5 L10.5,6 L1,10.5 Z" className="arch-marker-focus" />
        </marker>
      </defs>

      {/* Nested groups (outermost to innermost) */}
      {geom.groups.map(({ group, rect, depth }) => {
        const col: ColorName = group.color ?? (depth === 0 ? 'blue' : depth === 1 ? 'gray' : 'teal');
        const dashed = group.kind === 'subnet' || group.kind === 'boundary' || group.kind === 'zone' || group.kind === 'lane';
        const isFocused = focus == null || focus.groups.has(group.id) || focus.ancestorGroups.has(group.id);
        const directFocus = focus?.groups.has(group.id) ?? false;
        return (
          <g key={group.id} className={`arch-group color-${col}${isFocused ? '' : ' dimmed'}${directFocus ? ' focused' : ''}`}>
            <rect
              x={rect.x}
              y={rect.y}
              width={rect.w}
              height={rect.h}
              rx={12}
              strokeDasharray={dashed ? '6 4' : undefined}
            />
            <text x={rect.x + 14} y={rect.y + 20} className="arch-group-label">
              {group.label}
            </text>
          </g>
        );
      })}

      {/* Routed orthogonal edges */}
      {geom.edges.map(({ edge, route, path }) => {
        const bothFocused = focus != null && focus.nodes.has(edge.from) && focus.nodes.has(edge.to);
        const oneFocused = focus != null && (focus.nodes.has(edge.from) || focus.nodes.has(edge.to));
        const state = focus == null ? 'normal' : bothFocused ? 'focused' : oneFocused ? 'adjacent' : 'dimmed';
        const arrow = edge.arrow ?? 'forward';
        const marker = bothFocused ? `url(#${markerPrefix}-arrow-focus)` : `url(#${markerPrefix}-arrow)`;
        const dash = edge.style === 'dashed' ? '6 4' : edge.style === 'dotted' ? '2 3' : undefined;
        const lbl = edge.label ? truncate(edge.label, 28) : '';
        const pillW = lbl ? Math.max(34, lbl.length * 6.4 + 14) : 0;
        return (
          <g key={edge.id} className={`arch-edge state-${state}`}>
            <path
              d={path}
              fill="none"
              strokeDasharray={dash}
              markerEnd={arrow !== 'none' ? marker : undefined}
              markerStart={arrow === 'both' ? marker : undefined}
            />
            {lbl && (
              <g className="arch-edge-pill">
                <rect
                  x={route.label.x - pillW / 2}
                  y={route.label.y - 9}
                  width={pillW}
                  height={18}
                  rx={9}
                />
                <text x={route.label.x} y={route.label.y + 3.5} textAnchor="middle">
                  {lbl}
                </text>
              </g>
            )}
          </g>
        );
      })}

      {/* Nodes */}
      {geom.nodes.map((node) => {
        const col: ColorName = node.color ?? kindColor(node.kind);
        const flow = FLOW_SHAPES.has(node.kind);
        const isFocused = focus == null || focus.nodes.has(node.id);
        const isRinged = focus != null && focus.nodes.has(node.id);
        const gcpIcon = flow ? null : resolveGcpIconUrl(node);
        const iconPath = !flow && !gcpIcon ? iconPathOf(node) : null;
        const badge = node.provider && node.provider !== 'generic' ? PROVIDER_BADGE[node.provider] : undefined;
        const hasIcon = !flow && (gcpIcon != null || iconPath != null);
        const textX = hasIcon ? node.x + 42 : node.x + 14;
        const availW = node.w - (hasIcon ? 50 : 22) - (badge ? 26 : 0);
        const maxTitleChars = Math.max(9, Math.floor(availW / 7.2));
        const maxSubChars = Math.max(11, Math.floor((node.w - (hasIcon ? 50 : 22)) / 6.0));
        const clickable = onSelectNode != null;

        return (
          <g
            key={node.id}
            className={`arch-node color-${col}${isFocused ? '' : ' dimmed'}${isRinged ? ' focused' : ''}${clickable ? ' clickable' : ''}`}
            onClick={clickable ? () => onSelectNode(node.id) : undefined}
            role={clickable ? 'button' : undefined}
            tabIndex={clickable ? 0 : undefined}
            onKeyDown={clickable ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelectNode(node.id);
              }
            } : undefined}
          >
            <title>{[node.label, node.tech, node.description].filter(Boolean).join(' — ')}</title>
            {node.kind === 'decision' ? (
              <>
                <polygon
                  className="arch-node-box"
                  points={`${node.x + node.w / 2},${node.y} ${node.x + node.w},${node.y + node.h / 2} ${node.x + node.w / 2},${node.y + node.h} ${node.x},${node.y + node.h / 2}`}
                />
                <text x={node.x + node.w / 2} y={node.y + node.h / 2 + 4} textAnchor="middle" className="arch-node-title">
                  {truncate(node.label, Math.max(10, Math.floor((node.w - 36) / 7)))}
                </text>
              </>
            ) : node.kind === 'io' ? (
              <>
                <polygon
                  className="arch-node-box"
                  points={`${node.x + 16},${node.y} ${node.x + node.w},${node.y} ${node.x + node.w - 16},${node.y + node.h} ${node.x},${node.y + node.h}`}
                />
                <text x={node.x + node.w / 2} y={node.y + node.h / 2 + 4} textAnchor="middle" className="arch-node-title">
                  {truncate(node.label, Math.max(10, Math.floor((node.w - 38) / 7)))}
                </text>
              </>
            ) : node.kind === 'start' || node.kind === 'end' || node.kind === 'user' ? (
              <>
                <rect className="arch-node-box" x={node.x} y={node.y} width={node.w} height={node.h} rx={node.h / 2} />
                {hasIcon && (
                  <g>
                    <circle cx={node.x + 22} cy={node.y + node.h / 2} r={13} className="arch-icon-bg" />
                    {gcpIcon ? (
                      <image href={gcpIcon} x={node.x + 12} y={node.y + node.h / 2 - 10} width={20} height={20} />
                    ) : iconPath ? (
                      <svg x={node.x + 13} y={node.y + node.h / 2 - 9} width={18} height={18} viewBox="0 -960 960 960" className="arch-icon-glyph">
                        <path d={iconPath} />
                      </svg>
                    ) : null}
                  </g>
                )}
                <text
                  x={hasIcon ? textX : node.x + node.w / 2}
                  y={node.y + (node.tech ? node.h / 2 - 3 : node.h / 2 + 4)}
                  textAnchor={hasIcon ? 'start' : 'middle'}
                  className="arch-node-title"
                >
                  {truncate(node.label, maxTitleChars)}
                </text>
                {node.tech && (
                  <text
                    x={hasIcon ? textX : node.x + node.w / 2}
                    y={node.y + node.h / 2 + 12}
                    textAnchor={hasIcon ? 'start' : 'middle'}
                    className="arch-node-tech"
                  >
                    {truncate(node.tech, maxSubChars)}
                  </text>
                )}
              </>
            ) : (
              <>
                <rect
                  className="arch-node-box"
                  x={node.x}
                  y={node.y}
                  width={node.w}
                  height={node.h}
                  rx={12}
                  strokeDasharray={node.kind === 'external' ? '5 3' : undefined}
                />
                {!flow && (
                  <rect className="arch-node-bar" x={node.x} y={node.y + 8} width={4} height={Math.max(12, node.h - 16)} rx={2} />
                )}
                {hasIcon && (
                  <g>
                    <rect x={node.x + 11} y={node.y + node.h / 2 - 13} width={26} height={26} rx={7} className="arch-icon-bg" />
                    {gcpIcon ? (
                      <image href={gcpIcon} x={node.x + 14} y={node.y + node.h / 2 - 10} width={20} height={20} />
                    ) : iconPath ? (
                      <svg x={node.x + 15} y={node.y + node.h / 2 - 9} width={18} height={18} viewBox="0 -960 960 960" className="arch-icon-glyph">
                        <path d={iconPath} />
                      </svg>
                    ) : null}
                  </g>
                )}
                <text
                  x={flow ? node.x + node.w / 2 : textX}
                  y={node.y + (node.tech ? node.h / 2 - 4 : node.h / 2 + 4)}
                  textAnchor={flow ? 'middle' : 'start'}
                  className="arch-node-title"
                >
                  {truncate(node.label, maxTitleChars)}
                </text>
                {node.tech && (
                  <text
                    x={flow ? node.x + node.w / 2 : textX}
                    y={node.y + node.h / 2 + 12}
                    textAnchor={flow ? 'middle' : 'start'}
                    className="arch-node-tech"
                  >
                    {truncate(node.tech, maxSubChars)}
                  </text>
                )}
                {badge && (
                  <text x={node.x + node.w - 8} y={node.y + 13} textAnchor="end" className="arch-node-provider">
                    {badge}
                  </text>
                )}
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function DiagramFigureView({
  scene,
  caption,
  focus,
  onOpenDiagram,
}: {
  scene: Scene;
  caption?: string;
  focus?: string[];
  onOpenDiagram?: (focusNodeId?: string) => void;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const geom = useMemo(() => computeDiagramGeometry(scene, 28), [scene]);
  const resolvedFocus = useMemo(() => resolveFocusSet(scene, focus), [scene, focus]);
  const [focusEnabled, setFocusEnabled] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [renderLightboxBody, setRenderLightboxBody] = useState(false);
  const [zoom, setZoom] = useState(1);
  const lightboxRef = useRef<HTMLDialogElement>(null);
  const closeLightbox = useCallback(() => setExpanded(false), []);

  useEffect(() => {
    const el = lightboxRef.current;
    if (!el) return;
    if (expanded) {
      setRenderLightboxBody(true);
      el.removeAttribute('data-closing');
      if (!el.open) {
        try {
          el.showModal();
        } catch {
          el.setAttribute('open', '');
        }
      }
      return;
    }
    if (!el.open) {
      setRenderLightboxBody(false);
      return;
    }
    let cancelled = false;
    void closeTopLayerElement(el, () => {
      if (!cancelled) {
        if (el.open) el.close();
        setRenderLightboxBody(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [expanded]);

  useDialogLightDismiss(lightboxRef, closeLightbox);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        setZoom((z) => Math.min(2.5, +(z + 0.25).toFixed(2)));
      } else if (e.key === '-') {
        e.preventDefault();
        setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)));
      } else if (e.key === '0') {
        e.preventDefault();
        setZoom(1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  if (geom == null) return null;

  const activeFocus = focusEnabled ? resolvedFocus : null;
  const heading = caption ?? `${scene.title || 'System'} — Architecture Diagram`;
  const focusedCount = resolvedFocus?.nodes.size ?? 0;

  return (
    <>
      <figure className="doc-diagram-figure" aria-label={heading}>
        <figcaption className="doc-diagram-head">
          <div className="doc-diagram-title-wrap">
            <Icon name="account_tree" size={16} className="doc-diagram-icon" />
            <span className="doc-diagram-title">{heading}</span>
            <span className="doc-diagram-meta">
              {activeFocus
                ? `${focusedCount} of ${scene.nodes.length} components highlighted`
                : `${scene.nodes.length} ${scene.nodes.length === 1 ? 'component' : 'components'} · ${scene.edges.length} ${scene.edges.length === 1 ? 'connection' : 'connections'}`}
            </span>
          </div>
          <div className="doc-diagram-actions">
            {resolvedFocus != null && (
              <button
                type="button"
                className={`doc-fig-btn${focusEnabled ? ' active' : ''}`}
                onClick={() => setFocusEnabled((v) => !v)}
                title={focusEnabled ? 'Show all components equally' : 'Highlight this section in context'}
              >
                <Icon name="filter_center_focus" size={14} />
                <span>{focusEnabled ? 'Subsystem' : 'Full view'}</span>
              </button>
            )}
            <button
              type="button"
              className="doc-fig-btn"
              onClick={() => { setZoom(1); setExpanded(true); }}
              title="Inspect diagram full-screen"
            >
              <Icon name="fit_screen" size={14} />
              <span>Expand</span>
            </button>
            {onOpenDiagram && (
              <button
                type="button"
                className="doc-fig-btn"
                onClick={() => onOpenDiagram()}
                title="Open interactive diagram canvas"
              >
                <Icon name="open_in_new" size={14} />
                <span>Canvas</span>
              </button>
            )}
          </div>
        </figcaption>
        <div className="doc-diagram-stage">
          <DiagramSvgCanvas
            geom={geom}
            focus={activeFocus}
            markerPrefix={`doc-${uid}`}
            onSelectNode={onOpenDiagram}
            label={heading}
          />
        </div>
        {onOpenDiagram && (
          <div className="doc-diagram-foot">
            <span>Click any component to focus on the canvas · Expand for zoomable inspection</span>
            <span className="doc-diagram-flow-badge">
              {scene.type.toUpperCase()} · {scene.direction === 'LR' ? 'Left → Right' : 'Top → Bottom'}
            </span>
          </div>
        )}
      </figure>

      <dialog
        ref={lightboxRef}
        className="dialog doc-diagram-lightbox"
        closedby="any"
        aria-label={heading}
        onCancel={(e) => {
          e.preventDefault();
          closeLightbox();
        }}
        onClose={() => {
          if (expanded) setExpanded(false);
          setRenderLightboxBody(false);
        }}
      >
        {renderLightboxBody && (
          <div className="doc-diagram-lightbox-panel">
            <header className="doc-diagram-lightbox-head">
              <div className="doc-diagram-title-wrap">
                <Icon name="account_tree" size={18} className="doc-diagram-icon" />
                <span className="doc-diagram-title">{heading}</span>
              </div>
              <div className="doc-diagram-actions">
                <button type="button" className="doc-fig-btn" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} aria-label="Zoom out">
                  <Icon name="zoom_out" size={16} />
                </button>
                <button type="button" className="doc-fig-btn" onClick={() => setZoom(1)} title="Reset zoom">
                  <span>{Math.round(zoom * 100)}%</span>
                </button>
                <button type="button" className="doc-fig-btn" onClick={() => setZoom((z) => Math.min(2.5, +(z + 0.25).toFixed(2)))} aria-label="Zoom in">
                  <Icon name="zoom_in" size={16} />
                </button>
                {onOpenDiagram && (
                  <button type="button" className="doc-fig-btn" onClick={() => { closeLightbox(); onOpenDiagram(); }}>
                    <Icon name="open_in_new" size={14} />
                    <span>Open canvas</span>
                  </button>
                )}
                <button type="button" className="doc-fig-btn" onClick={closeLightbox} aria-label="Close diagram preview">
                  <Icon name="close" size={16} />
                </button>
              </div>
            </header>
            <div className="doc-diagram-lightbox-body">
              <DiagramSvgCanvas
                geom={geom}
                focus={activeFocus}
                markerPrefix={`lb-${uid}`}
                onSelectNode={onOpenDiagram ? (nid) => { closeLightbox(); onOpenDiagram(nid); } : undefined}
                zoom={zoom}
                label={heading}
              />
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}

export const DiagramFigure = memo(DiagramFigureView);
