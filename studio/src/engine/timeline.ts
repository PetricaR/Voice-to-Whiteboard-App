/**
 * Deterministic timeline evaluator and 60fps Canvas2D renderer for Programmatic Motion.
 *
 * Used identically by:
 * 1. The live interactive <canvas> preview stage (with hit-box detection for inline editing)
 * 2. The client-side WebCodecs + mp4-muxer frame-by-frame video exporter
 */
import {
  aspectDimensions,
  totalMotionDurationMs,
  type EasingPreset,
  type MotionLayer,
  type MotionLayerKind,
  type MotionScene,
  type MotionSpec,
} from './motion';
import type { ColorName } from './types';

export interface EvaluatedLayer {
  layer: MotionLayer;
  visible: boolean;
  /** 0..1 eased entrance progress. */
  progress: number;
  opacity: number;
  translateX: number;
  translateY: number;
  scale: number;
  currentNumber?: number;
  formattedNumber?: string;
}

export interface EvaluatedMotionFrame {
  totalDurationMs: number;
  clampedTimeMs: number;
  overallProgress: number;
  sceneIndex: number;
  scene: MotionScene;
  prevScene?: MotionScene;
  sceneTimeMs: number;
  sceneProgress: number;
  transitionProgress: number;
  layers: EvaluatedLayer[];
}

export interface LayerHitBox {
  sceneId: string;
  layerId: string;
  kind: MotionLayerKind;
  /** Pixel coordinates on the rendered canvas. */
  px: number;
  py: number;
  pw: number;
  ph: number;
}

export interface MotionPalette {
  bgTop: string;
  bgBottom: string;
  surface: string;
  surfaceHigh: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
}

export const STUDIO_DARK_MOTION_PALETTE: MotionPalette = {
  bgTop: '#0d111a',
  bgBottom: '#131926',
  surface: 'rgba(26, 34, 52, 0.82)',
  surfaceHigh: 'rgba(36, 47, 70, 0.92)',
  border: 'rgba(148, 163, 184, 0.22)',
  textPrimary: '#f8fafc',
  textSecondary: '#94a3b8',
};

const ACCENT_HEX: Record<ColorName, { main: string; soft: string; glow: string }> = {
  blue: { main: '#60a5fa', soft: 'rgba(96, 165, 250, 0.18)', glow: 'rgba(59, 130, 246, 0.26)' },
  teal: { main: '#2dd4bf', soft: 'rgba(45, 212, 191, 0.18)', glow: 'rgba(20, 184, 166, 0.24)' },
  green: { main: '#4ade80', soft: 'rgba(74, 222, 128, 0.18)', glow: 'rgba(34, 197, 94, 0.24)' },
  purple: { main: '#c084fc', soft: 'rgba(192, 132, 252, 0.18)', glow: 'rgba(168, 85, 247, 0.25)' },
  orange: { main: '#fb923c', soft: 'rgba(251, 146, 60, 0.18)', glow: 'rgba(249, 115, 22, 0.24)' },
  red: { main: '#f87171', soft: 'rgba(248, 113, 113, 0.18)', glow: 'rgba(239, 68, 68, 0.24)' },
  pink: { main: '#f472b6', soft: 'rgba(244, 114, 182, 0.18)', glow: 'rgba(236, 72, 153, 0.24)' },
  yellow: { main: '#facc15', soft: 'rgba(250, 204, 21, 0.18)', glow: 'rgba(234, 179, 8, 0.22)' },
  gray: { main: '#94a3b8', soft: 'rgba(148, 163, 184, 0.18)', glow: 'rgba(100, 116, 139, 0.20)' },
};

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

export function applyEasing(tRaw: number, preset: EasingPreset): number {
  const t = clamp01(tRaw);
  switch (preset) {
    case 'linear':
      return t;
    case 'smooth':
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    case 'snappy':
      return 1 - Math.pow(1 - t, 4);
    case 'spring':
    default: {
      if (t === 0 || t === 1) return t;
      // Critically damped spring approximation with subtle overshoot
      const c4 = (2 * Math.PI) / 3.4;
      return clamp01(1 - Math.pow(2, -9 * t) * Math.cos(t * c4));
    }
  }
}

function formatCounter(num: number, layer: MotionLayer): string {
  const dec = layer.decimals ?? (Number.isInteger(layer.value ?? 0) ? 0 : 1);
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  }).format(num);
  return `${layer.prefix ?? ''}${formatted}${layer.suffix ?? ''}`;
}

export function evaluateSceneLayers(scene: MotionScene, sceneTimeMs: number): EvaluatedLayer[] {
  return scene.layers.map((layer) => {
    if (sceneTimeMs < layer.enterAtMs) {
      return {
        layer,
        visible: false,
        progress: 0,
        opacity: 0,
        translateX: 0,
        translateY: 28,
        scale: 0.96,
      };
    }
    if (layer.exitAtMs !== undefined && sceneTimeMs > layer.exitAtMs + 320) {
      return {
        layer,
        visible: false,
        progress: 1,
        opacity: 0,
        translateX: 0,
        translateY: -18,
        scale: 0.98,
      };
    }

    const enterDur = layer.kind === 'metric_counter' || layer.kind === 'motion_chart' ? 920 : 620;
    const rawIn = (sceneTimeMs - layer.enterAtMs) / enterDur;
    const progress = applyEasing(rawIn, layer.easing);

    let exitFactor = 1;
    if (layer.exitAtMs !== undefined && sceneTimeMs > layer.exitAtMs) {
      exitFactor = 1 - clamp01((sceneTimeMs - layer.exitAtMs) / 320);
    }

    const opacity = clamp01(rawIn * 2.2) * exitFactor;
    const translateY = (1 - progress) * 26 - (1 - exitFactor) * 16;
    const scale = (0.95 + 0.05 * progress) * (0.98 + 0.02 * exitFactor);

    let currentNumber: number | undefined;
    let formattedNumber: string | undefined;
    if (layer.kind === 'metric_counter') {
      const start = layer.startValue ?? 0;
      const target = layer.value ?? 0;
      currentNumber = start + (target - start) * progress;
      formattedNumber = formatCounter(currentNumber, layer);
    }

    return {
      layer,
      visible: opacity > 0.01,
      progress,
      opacity,
      translateX: 0,
      translateY,
      scale,
      currentNumber,
      formattedNumber,
    };
  });
}

/** Pure deterministic evaluation of a MotionSpec at any millisecond timestamp. */
export function evaluateMotionAt(spec: MotionSpec, timeMs: number): EvaluatedMotionFrame {
  const totalDurationMs = Math.max(1, totalMotionDurationMs(spec));
  const clampedTimeMs = Math.max(0, Math.min(totalDurationMs, timeMs));
  const scenes = spec.scenes;
  if (scenes.length === 0) {
    const fallbackScene: MotionScene = { id: 'empty', title: 'Empty', durationMs: 3000, transition: 'fade', layers: [] };
    return {
      totalDurationMs,
      clampedTimeMs: 0,
      overallProgress: 0,
      sceneIndex: 0,
      scene: fallbackScene,
      sceneTimeMs: 0,
      sceneProgress: 0,
      transitionProgress: 1,
      layers: [],
    };
  }

  let acc = 0;
  let sceneIndex = scenes.length - 1;
  let sceneTimeMs = scenes[sceneIndex].durationMs;
  for (let i = 0; i < scenes.length; i++) {
    const nextAcc = acc + scenes[i].durationMs;
    if (clampedTimeMs < nextAcc || i === scenes.length - 1) {
      sceneIndex = i;
      sceneTimeMs = clampedTimeMs - acc;
      break;
    }
    acc = nextAcc;
  }

  const scene = scenes[sceneIndex];
  const prevScene = sceneIndex > 0 ? scenes[sceneIndex - 1] : undefined;
  const transitionWindow = sceneIndex === 0 || scene.transition === 'cut' ? 1 : 460;
  const transitionProgress = sceneIndex === 0 || scene.transition === 'cut'
    ? 1
    : applyEasing(sceneTimeMs / transitionWindow, 'smooth');

  return {
    totalDurationMs,
    clampedTimeMs,
    overallProgress: clampedTimeMs / totalDurationMs,
    sceneIndex,
    scene,
    prevScene: transitionProgress < 1 ? prevScene : undefined,
    sceneTimeMs,
    sceneProgress: clamp01(sceneTimeMs / Math.max(1, scene.durationMs)),
    transitionProgress,
    layers: evaluateSceneLayers(scene, sceneTimeMs),
  };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines = 4): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let cur = words[0];
  for (let i = 1; i < words.length; i++) {
    const candidate = `${cur} ${words[i]}`;
    if (ctx.measureText(candidate).width <= maxWidth) {
      cur = candidate;
    } else {
      lines.push(cur);
      cur = words[i];
      if (lines.length >= maxLines - 1) break;
    }
  }
  lines.push(cur);
  return lines.slice(0, maxLines);
}

function drawLayer(
  ctx: CanvasRenderingContext2D,
  ev: EvaluatedLayer,
  stageW: number,
  stageH: number,
  sceneAccent: ColorName,
  palette: MotionPalette,
  selectedLayerId?: string,
): { px: number; py: number; pw: number; ph: number } {
  const { layer } = ev;
  const px = (layer.x / 100) * stageW;
  const py = (layer.y / 100) * stageH;
  const pw = (layer.w / 100) * stageW;
  const ph = (layer.h / 100) * stageH;

  if (!ev.visible) return { px, py, pw, ph };

  const scaleUnit = Math.min(stageW, stageH) / 1080;
  const accent = ACCENT_HEX[layer.color ?? sceneAccent] ?? ACCENT_HEX.blue;

  ctx.save();
  ctx.globalAlpha *= ev.opacity;
  const cx = px + pw / 2;
  const cy = py + ph / 2;
  ctx.translate(cx + ev.translateX * scaleUnit, cy + ev.translateY * scaleUnit);
  ctx.scale(ev.scale, ev.scale);
  ctx.translate(-cx, -cy);

  switch (layer.kind) {
    case 'badge': {
      const fontSize = Math.round(21 * scaleUnit);
      ctx.font = `700 ${fontSize}px "Inter", system-ui, -apple-system, sans-serif`;
      const label = (layer.text || 'HIGHLIGHT').toUpperCase();
      const padX = 22 * scaleUnit;
      const pillW = Math.min(pw, Math.max(120 * scaleUnit, ctx.measureText(label).width + padX * 2));
      const pillH = Math.min(ph, 46 * scaleUnit);
      roundRect(ctx, px, py, pillW, pillH, pillH / 2);
      ctx.fillStyle = accent.soft;
      ctx.fill();
      ctx.lineWidth = 1.5 * scaleUnit;
      ctx.strokeStyle = accent.main;
      ctx.stroke();

      ctx.fillStyle = accent.main;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(label, px + padX, py + pillH / 2 + 1);
      break;
    }

    case 'kinetic_text': {
      const sizeMap = { sm: 32, md: 46, lg: 62, xl: 78 };
      const headSize = Math.round(sizeMap[layer.size ?? 'lg'] * scaleUnit);
      const align = layer.align ?? 'left';
      const anchorX = align === 'center' ? px + pw / 2 : align === 'right' ? px + pw : px;

      ctx.font = `700 ${headSize}px "Inter", system-ui, -apple-system, sans-serif`;
      ctx.fillStyle = palette.textPrimary;
      ctx.textAlign = align;
      ctx.textBaseline = 'top';

      const headLines = wrapLines(ctx, layer.text ?? '', pw, 3);
      let cursorY = py;
      for (const line of headLines) {
        ctx.fillText(line, anchorX, cursorY);
        cursorY += headSize * 1.16;
      }

      if (layer.subtext) {
        const subSize = Math.round(Math.max(22, headSize * 0.44));
        ctx.font = `400 ${subSize}px "Inter", system-ui, -apple-system, sans-serif`;
        ctx.fillStyle = palette.textSecondary;
        cursorY += 12 * scaleUnit;
        const subLines = wrapLines(ctx, layer.subtext, pw, 3);
        for (const sl of subLines) {
          ctx.fillText(sl, anchorX, cursorY);
          cursorY += subSize * 1.38;
        }
      }
      break;
    }

    case 'metric_counter': {
      roundRect(ctx, px, py, pw, ph, 28 * scaleUnit);
      ctx.fillStyle = palette.surface;
      ctx.fill();
      ctx.lineWidth = 1.5 * scaleUnit;
      ctx.strokeStyle = accent.main;
      ctx.stroke();

      // Top accent bar
      roundRect(ctx, px + 28 * scaleUnit, py + 24 * scaleUnit, 56 * scaleUnit, 6 * scaleUnit, 3 * scaleUnit);
      ctx.fillStyle = accent.main;
      ctx.fill();

      const labelSize = Math.round(26 * scaleUnit);
      ctx.font = `600 ${labelSize}px "Inter", system-ui, -apple-system, sans-serif`;
      ctx.fillStyle = palette.textSecondary;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(layer.text ?? 'Metric', px + 28 * scaleUnit, py + 48 * scaleUnit);

      const numSize = Math.round(Math.min(92 * scaleUnit, ph * 0.34));
      ctx.font = `800 ${numSize}px "Inter", system-ui, -apple-system, sans-serif`;
      ctx.fillStyle = palette.textPrimary;
      ctx.fillText(ev.formattedNumber ?? '0', px + 28 * scaleUnit, py + 92 * scaleUnit);

      if (layer.deltaText) {
        const dSize = Math.round(22 * scaleUnit);
        ctx.font = `600 ${dSize}px "Inter", system-ui, -apple-system, sans-serif`;
        ctx.fillStyle = accent.main;
        ctx.fillText(layer.deltaText, px + 28 * scaleUnit, py + ph - 74 * scaleUnit);
      }
      if (layer.subtext) {
        const sSize = Math.round(20 * scaleUnit);
        ctx.font = `400 ${sSize}px "Inter", system-ui, -apple-system, sans-serif`;
        ctx.fillStyle = palette.textSecondary;
        ctx.fillText(layer.subtext, px + 28 * scaleUnit, py + ph - 42 * scaleUnit);
      }
      break;
    }

    case 'motion_chart': {
      roundRect(ctx, px, py, pw, ph, 28 * scaleUnit);
      ctx.fillStyle = palette.surface;
      ctx.fill();
      ctx.lineWidth = 1.5 * scaleUnit;
      ctx.strokeStyle = palette.border;
      ctx.stroke();

      const items = layer.series && layer.series.length > 0
        ? layer.series
        : [{ label: 'Q1', value: 120 }, { label: 'Q2', value: 185 }, { label: 'Q3', value: 260 }];
      const maxVal = Math.max(1, ...items.map((it) => Math.abs(it.value)));
      const innerX = px + 42 * scaleUnit;
      const innerY = py + 44 * scaleUnit;
      const innerW = pw - 84 * scaleUnit;
      const innerH = ph - 110 * scaleUnit;

      if (layer.chartType === 'donut') {
        const total = Math.max(1, items.reduce((s, it) => s + Math.max(0, it.value), 0));
        const rOuter = Math.min(innerW, innerH) * 0.42;
        const rInner = rOuter * 0.6;
        const dcx = px + pw * 0.36;
        const dcy = py + ph * 0.52;
        let angle = -Math.PI / 2;
        const maxSweep = Math.PI * 2 * ev.progress;

        items.forEach((it, idx) => {
          const slice = (Math.max(0, it.value) / total) * maxSweep;
          const col = ACCENT_HEX[it.color ?? (['blue', 'teal', 'purple', 'green', 'orange', 'pink'][idx % 6] as ColorName)].main;
          ctx.beginPath();
          ctx.arc(dcx, dcy, rOuter, angle, angle + slice);
          ctx.arc(dcx, dcy, rInner, angle + slice, angle, true);
          ctx.closePath();
          ctx.fillStyle = col;
          ctx.fill();
          angle += slice;

          // Legend on right
          const ly = innerY + idx * 48 * scaleUnit;
          ctx.fillStyle = col;
          roundRect(ctx, px + pw * 0.62, ly, 18 * scaleUnit, 18 * scaleUnit, 5 * scaleUnit);
          ctx.fill();
          ctx.font = `600 ${Math.round(22 * scaleUnit)}px "Inter", system-ui, sans-serif`;
          ctx.fillStyle = palette.textPrimary;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.fillText(`${it.label} (${Math.round((it.value / total) * 100)}%)`, px + pw * 0.62 + 28 * scaleUnit, ly - 2);
        });
      } else if (layer.chartType === 'line') {
        const pts = items.map((it, idx) => ({
          x: innerX + (items.length === 1 ? innerW / 2 : (idx / (items.length - 1)) * innerW),
          y: innerY + innerH - (Math.max(0, it.value) / maxVal) * innerH * ev.progress,
          it,
          idx,
        }));
        // Grid lines
        ctx.strokeStyle = palette.border;
        ctx.lineWidth = 1 * scaleUnit;
        for (let g = 0; g <= 3; g++) {
          const gy = innerY + (g / 3) * innerH;
          ctx.beginPath();
          ctx.moveTo(innerX, gy);
          ctx.lineTo(innerX + innerW, gy);
          ctx.stroke();
        }
        // Line path
        ctx.beginPath();
        pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.strokeStyle = accent.main;
        ctx.lineWidth = 5 * scaleUnit;
        ctx.lineJoin = 'round';
        ctx.stroke();

        pts.forEach((p) => {
          const isHi = p.idx === layer.highlightIndex;
          ctx.beginPath();
          ctx.arc(p.x, p.y, (isHi ? 10 : 6.5) * scaleUnit, 0, Math.PI * 2);
          ctx.fillStyle = isHi ? '#facc15' : accent.main;
          ctx.fill();

          ctx.font = `500 ${Math.round(20 * scaleUnit)}px "Inter", system-ui, sans-serif`;
          ctx.fillStyle = palette.textSecondary;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(p.it.label.slice(0, 14), p.x, innerY + innerH + 16 * scaleUnit);
        });
      } else {
        // Animated Bar Chart
        const gap = 24 * scaleUnit;
        const barW = Math.max(24 * scaleUnit, (innerW - gap * (items.length - 1)) / items.length);
        items.forEach((it, idx) => {
          const stagger = clamp01((ev.progress * 1.25) - idx * 0.07);
          const bh = Math.max(6 * scaleUnit, (Math.max(0, it.value) / maxVal) * innerH * stagger);
          const bx = innerX + idx * (barW + gap);
          const by = innerY + innerH - bh;
          const isHi = idx === layer.highlightIndex;
          const barCol = ACCENT_HEX[it.color ?? (isHi ? 'blue' : 'teal')]?.main ?? accent.main;

          roundRect(ctx, bx, by, barW, bh, 12 * scaleUnit);
          ctx.fillStyle = barCol;
          ctx.fill();
          if (isHi) {
            ctx.lineWidth = 2.5 * scaleUnit;
            ctx.strokeStyle = '#f8fafc';
            ctx.stroke();
          }

          // Value above bar
          ctx.font = `700 ${Math.round(21 * scaleUnit)}px "Inter", system-ui, sans-serif`;
          ctx.fillStyle = palette.textPrimary;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(
            new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(it.value * stagger),
            bx + barW / 2,
            by - 8 * scaleUnit,
          );

          // X label
          ctx.font = `500 ${Math.round(20 * scaleUnit)}px "Inter", system-ui, sans-serif`;
          ctx.fillStyle = palette.textSecondary;
          ctx.textBaseline = 'top';
          ctx.fillText(it.label.slice(0, 14), bx + barW / 2, innerY + innerH + 14 * scaleUnit);
        });
      }

      if (layer.highlightNote) {
        const noteSize = Math.round(20 * scaleUnit);
        ctx.font = `600 ${noteSize}px "Inter", system-ui, sans-serif`;
        const textW = ctx.measureText(layer.highlightNote).width + 32 * scaleUnit;
        const nx = px + pw - textW - 28 * scaleUnit;
        const ny = py + 20 * scaleUnit;
        roundRect(ctx, nx, ny, textW, 38 * scaleUnit, 19 * scaleUnit);
        ctx.fillStyle = accent.soft;
        ctx.fill();
        ctx.fillStyle = accent.main;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(layer.highlightNote, nx + 16 * scaleUnit, ny + 19 * scaleUnit);
      }
      break;
    }

    case 'flow_diagram': {
      const nodes = layer.flowNodes && layer.flowNodes.length > 0
        ? layer.flowNodes
        : [{ id: 'a', label: 'Ingest' }, { id: 'b', label: 'SQL Engine' }, { id: 'c', label: 'Live Dashboard' }];
      const gap = 36 * scaleUnit;
      const boxW = Math.max(120 * scaleUnit, (pw - gap * (nodes.length - 1)) / nodes.length);
      const boxH = Math.min(130 * scaleUnit, ph * 0.48);
      const centerY = py + ph / 2;

      const positions = new Map<string, { x: number; y: number; w: number; h: number }>();
      nodes.forEach((n, idx) => {
        const nx = px + idx * (boxW + gap);
        const ny = centerY - boxH / 2;
        positions.set(n.id, { x: nx, y: ny, w: boxW, h: boxH });
      });

      // Draw connecting arrows + animated signal pulse
      const edges = layer.flowEdges && layer.flowEdges.length > 0
        ? layer.flowEdges
        : nodes.slice(0, -1).map((n, idx) => ({ from: n.id, to: nodes[idx + 1].id }));

      edges.forEach((e) => {
        const from = positions.get(e.from);
        const to = positions.get(e.to);
        if (!from || !to) return;
        const x1 = from.x + from.w;
        const y1 = from.y + from.h / 2;
        const x2 = to.x;
        const y2 = to.y + to.h / 2;

        ctx.strokeStyle = accent.main;
        ctx.lineWidth = 3 * scaleUnit;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        // Pulse dot
        const pulseT = (ev.progress * 2) % 1;
        const dotX = x1 + (x2 - x1) * pulseT;
        const dotY = y1 + (y2 - y1) * pulseT;
        ctx.beginPath();
        ctx.arc(dotX, dotY, 6 * scaleUnit, 0, Math.PI * 2);
        ctx.fillStyle = '#f8fafc';
        ctx.fill();
      });

      nodes.forEach((n, idx) => {
        const pos = positions.get(n.id)!;
        const nCol = ACCENT_HEX[n.color ?? (['blue', 'teal', 'purple', 'green', 'orange'][idx % 5] as ColorName)];
        roundRect(ctx, pos.x, pos.y, pos.w, pos.h, 20 * scaleUnit);
        ctx.fillStyle = palette.surfaceHigh;
        ctx.fill();
        ctx.lineWidth = 2 * scaleUnit;
        ctx.strokeStyle = nCol.main;
        ctx.stroke();

        ctx.font = `700 ${Math.round(23 * scaleUnit)}px "Inter", system-ui, sans-serif`;
        ctx.fillStyle = palette.textPrimary;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const wrapped = wrapLines(ctx, n.label, pos.w - 24 * scaleUnit, 2);
        wrapped.forEach((ln, li) => {
          const offset = (li - (wrapped.length - 1) / 2) * 28 * scaleUnit;
          ctx.fillText(ln, pos.x + pos.w / 2, pos.y + pos.h / 2 + offset);
        });
      });
      break;
    }

    case 'callout_card': {
      roundRect(ctx, px, py, pw, ph, 22 * scaleUnit);
      ctx.fillStyle = palette.surfaceHigh;
      ctx.fill();
      ctx.lineWidth = 2 * scaleUnit;
      ctx.strokeStyle = accent.main;
      ctx.stroke();

      ctx.font = `700 ${Math.round(28 * scaleUnit)}px "Inter", system-ui, sans-serif`;
      ctx.fillStyle = palette.textPrimary;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(layer.text ?? 'Insight', px + 28 * scaleUnit, py + 24 * scaleUnit);

      if (layer.subtext) {
        ctx.font = `400 ${Math.round(22 * scaleUnit)}px "Inter", system-ui, sans-serif`;
        ctx.fillStyle = palette.textSecondary;
        const lines = wrapLines(ctx, layer.subtext, pw - 56 * scaleUnit, 2);
        lines.forEach((ln, idx) => {
          ctx.fillText(ln, px + 28 * scaleUnit, py + 66 * scaleUnit + idx * 30 * scaleUnit);
        });
      }
      break;
    }
  }

  // Selection outline for inline stage inspection
  if (selectedLayerId && selectedLayerId === layer.id) {
    roundRect(ctx, px - 6, py - 6, pw + 12, ph + 12, 16 * scaleUnit);
    ctx.lineWidth = 2.5 * scaleUnit;
    ctx.setLineDash([8 * scaleUnit, 6 * scaleUnit]);
    ctx.strokeStyle = '#60a5fa';
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.restore();
  return { px, py, pw, ph };
}

/**
 * Renders an exact deterministic frame of `spec` at `timeMs` onto `ctx` and
 * returns interactive hit-boxes for every active layer on the stage.
 */
export function renderMotionFrame(
  ctx: CanvasRenderingContext2D,
  spec: MotionSpec,
  timeMs: number,
  opts: {
    palette?: MotionPalette;
    selectedLayerId?: string;
    width?: number;
    height?: number;
  } = {},
): { evaluated: EvaluatedMotionFrame; hitBoxes: LayerHitBox[] } {
  const dims = aspectDimensions(spec.aspectRatio);
  const stageW = opts.width ?? ctx.canvas.width ?? dims.width;
  const stageH = opts.height ?? ctx.canvas.height ?? dims.height;
  const palette = opts.palette ?? STUDIO_DARK_MOTION_PALETTE;
  const evaluated = evaluateMotionAt(spec, timeMs);
  const scaleUnit = Math.min(stageW, stageH) / 1080;

  // 1. Studio backdrop gradient
  const grad = ctx.createLinearGradient(0, 0, stageW, stageH);
  grad.addColorStop(0, palette.bgTop);
  grad.addColorStop(1, palette.bgBottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, stageW, stageH);

  // 2. Ambient radial glow keyed to scene accentColor
  const sceneAccent = evaluated.scene.accentColor ?? 'blue';
  const glowColor = ACCENT_HEX[sceneAccent]?.glow ?? ACCENT_HEX.blue.glow;
  const radial = ctx.createRadialGradient(stageW * 0.78, stageH * 0.22, 10, stageW * 0.78, stageH * 0.22, stageW * 0.65);
  radial.addColorStop(0, glowColor);
  radial.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, stageW, stageH);

  // 3. Scene transition transform
  ctx.save();
  const tp = evaluated.transitionProgress;
  if (tp < 1) {
    switch (evaluated.scene.transition) {
      case 'slide_left':
        ctx.translate((1 - tp) * stageW * 0.16, 0);
        ctx.globalAlpha = tp;
        break;
      case 'slide_up':
        ctx.translate(0, (1 - tp) * stageH * 0.14);
        ctx.globalAlpha = tp;
        break;
      case 'zoom_through': {
        const s = 0.92 + 0.08 * tp;
        ctx.translate(stageW / 2, stageH / 2);
        ctx.scale(s, s);
        ctx.translate(-stageW / 2, -stageH / 2);
        ctx.globalAlpha = tp;
        break;
      }
      case 'fade':
      default:
        ctx.globalAlpha = tp;
        break;
    }
  }

  // 4. Draw layers & collect hit-boxes
  const hitBoxes: LayerHitBox[] = [];
  for (const ev of evaluated.layers) {
    const box = drawLayer(ctx, ev, stageW, stageH, sceneAccent, palette, opts.selectedLayerId);
    hitBoxes.push({
      sceneId: evaluated.scene.id,
      layerId: ev.layer.id,
      kind: ev.layer.kind,
      ...box,
    });
  }
  ctx.restore();

  // 5. Optional kinetic captions bar
  if (spec.showCaptions && evaluated.scene.narration) {
    const capFont = Math.round(24 * scaleUnit);
    ctx.save();
    ctx.font = `500 ${capFont}px "Inter", system-ui, sans-serif`;
    const maxCapW = stageW * 0.82;
    const capLines = wrapLines(ctx, evaluated.scene.narration, maxCapW - 48 * scaleUnit, 2);
    const pillH = (capLines.length * 32 + 24) * scaleUnit;
    const pillW = Math.min(maxCapW, Math.max(...capLines.map((l) => ctx.measureText(l).width)) + 56 * scaleUnit);
    const cx = (stageW - pillW) / 2;
    const cy = stageH - pillH - 36 * scaleUnit;

    roundRect(ctx, cx, cy, pillW, pillH, 16 * scaleUnit);
    ctx.fillStyle = 'rgba(9, 13, 22, 0.82)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
    ctx.lineWidth = 1 * scaleUnit;
    ctx.stroke();

    ctx.fillStyle = '#f1f5f9';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    capLines.forEach((ln, idx) => {
      ctx.fillText(ln, stageW / 2, cy + (12 + idx * 32) * scaleUnit);
    });
    ctx.restore();
  }

  // 6. Sleek bottom timeline progress bar
  ctx.save();
  ctx.fillStyle = 'rgba(148, 163, 184, 0.18)';
  ctx.fillRect(0, stageH - 6 * scaleUnit, stageW, 6 * scaleUnit);
  ctx.fillStyle = ACCENT_HEX[sceneAccent]?.main ?? '#60a5fa';
  ctx.fillRect(0, stageH - 6 * scaleUnit, stageW * evaluated.overallProgress, 6 * scaleUnit);
  ctx.restore();

  return { evaluated, hitBoxes };
}
