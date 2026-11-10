/** A small picture of a diagram (groups, nodes and connections) for the history panel and the documentation cover. */
import { memo } from 'react';
import { center, groupBounds, groupDepth, sceneBounds } from '../engine/scene';
import type { Scene } from '../engine/types';
import { kindColor } from './theme';

function ThumbnailView({ scene }: { scene: Scene }) {
  const b = sceneBounds(scene);
  if (b == null) {
    if (scene.dashboard && scene.dashboard.widgets.length > 0) {
      return (
        <svg className="thumbnail" viewBox="0 0 120 80" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <rect className="th-node color-blue" x="8" y="8" width="32" height="22" rx="5" />
          <rect className="th-node color-teal" x="44" y="8" width="32" height="22" rx="5" />
          <rect className="th-node color-green" x="80" y="8" width="32" height="22" rx="5" />
          <rect className="th-group color-blue" x="8" y="36" width="68" height="36" rx="6" />
          <rect className="th-node color-purple" x="80" y="36" width="32" height="36" rx="6" />
        </svg>
      );
    }
    if (scene.motion && scene.motion.scenes.length > 0) {
      return (
        <svg className="thumbnail" viewBox="0 0 120 80" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <rect className="th-group color-purple" x="8" y="8" width="104" height="50" rx="7" />
          <polygon points="54,24 54,42 70,33" fill="var(--primary)" opacity="0.85" />
          <rect className="th-node color-blue" x="8" y="64" width="32" height="8" rx="4" />
          <rect className="th-node color-teal" x="44" y="64" width="36" height="8" rx="4" />
          <rect className="th-node color-orange" x="84" y="64" width="28" height="8" rx="4" />
        </svg>
      );
    }
    return <span className="thumbnail empty" aria-hidden="true" />;
  }
  const pad = Math.max(b.w, b.h) * 0.04 + 8;
  const view = `${b.x - pad} ${b.y - pad} ${b.w + 2 * pad} ${b.h + 2 * pad}`;
  const groups = groupBounds(scene);
  const byId = new Map(scene.nodes.map((n) => [n.id, n]));
  const sorted = [...scene.groups].sort((x, y) => groupDepth(scene, x) - groupDepth(scene, y));
  return (
    <svg className="thumbnail" viewBox={view} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {sorted.map((g) => {
        const r = groups.get(g.id);
        return r && <rect key={g.id} className={`th-group color-${g.color ?? 'blue'}`} x={r.x} y={r.y} width={r.w} height={r.h} rx={12} />;
      })}
      {scene.edges.map((e) => {
        const s = byId.get(e.from);
        const t = byId.get(e.to);
        if (s == null || t == null) return null;
        const a = center(s);
        const c = center(t);
        return <line key={e.id} className="th-edge" x1={a.x} y1={a.y} x2={c.x} y2={c.y} />;
      })}
      {scene.nodes.map((n) => (
        <rect key={n.id} className={`th-node color-${n.color ?? kindColor(n.kind)}`} x={n.x} y={n.y} width={n.w} height={n.h}
          rx={n.kind === 'start' || n.kind === 'end' || n.kind === 'user' ? n.h / 2 : 12} />
      ))}
    </svg>
  );
}

export const Thumbnail = memo(ThumbnailView);
