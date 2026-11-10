/**
 * Pure TypeScript model, atomic incremental edit engine, and cross-surface
 * storyboard synthesizer for Programmatic Motion Explainers.
 *
 * Instead of black-box generative video models, Gemini Live creates and refines
 * a structured, deterministic MotionSpec (scenes, animated typography, live-bound
 * metric counters, animated charts, flow diagrams, timings, and optional narration)
 * where every word, number, color, or millisecond can be edited directly or by voice.
 */
import type { QueryExecutionResult } from '../data/sqlEngine';
import { formatMetricValue, type DashboardSpec } from './dashboard';
import { resolveRef } from './resolve';
import { COLORS, type ColorName, type Scene } from './types';

export const ASPECT_RATIOS = ['16:9', '9:16', '1:1'] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export const TRANSITION_KINDS = ['fade', 'slide_left', 'slide_up', 'zoom_through', 'cut'] as const;
export type TransitionKind = (typeof TRANSITION_KINDS)[number];

export const EASING_PRESETS = ['spring', 'smooth', 'snappy', 'linear'] as const;
export type EasingPreset = (typeof EASING_PRESETS)[number];

export const MOTION_LAYER_KINDS = [
  'kinetic_text',
  'metric_counter',
  'motion_chart',
  'flow_diagram',
  'callout_card',
  'badge',
] as const;
export type MotionLayerKind = (typeof MOTION_LAYER_KINDS)[number];

export interface MotionChartSeriesItem {
  label: string;
  value: number;
  color?: ColorName;
}

export interface MotionFlowNode {
  id: string;
  label: string;
  color?: ColorName;
}

export interface MotionFlowEdge {
  from: string;
  to: string;
  label?: string;
}

export interface MotionLayer {
  id: string;
  kind: MotionLayerKind;
  /** Millisecond offset inside the scene when this layer begins animating in. */
  enterAtMs: number;
  /** Optional millisecond offset inside the scene when this layer exits. */
  exitAtMs?: number;
  easing: EasingPreset;
  /** Normalized stage coordinates (0..100% of width/height) so layout adapts & drags cleanly. */
  x: number;
  y: number;
  w: number;
  h: number;
  color?: ColorName;

  // Text / Badge / Callout fields
  text?: string;
  subtext?: string;
  align?: 'left' | 'center' | 'right';
  size?: 'sm' | 'md' | 'lg' | 'xl';

  // Metric Counter fields
  value?: number;
  startValue?: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  deltaText?: string;
  /** Optional Dashboard widget ID whose live SQL value updates this counter automatically. */
  bindWidgetId?: string;

  // Motion Chart fields
  chartType?: 'bar' | 'line' | 'donut';
  series?: MotionChartSeriesItem[];
  highlightIndex?: number;
  highlightNote?: string;

  // Flow Diagram fields
  flowNodes?: MotionFlowNode[];
  flowEdges?: MotionFlowEdge[];
}

export interface MotionScene {
  id: string;
  title: string;
  /** Scene duration in milliseconds (1500..25000). */
  durationMs: number;
  transition: TransitionKind;
  accentColor?: ColorName;
  /** Optional spoken/caption narration line displayed as kinetic captions & optional Web Speech narration. */
  narration?: string;
  layers: MotionLayer[];
}

export interface MotionSpec {
  title: string;
  subtitle?: string;
  fps: 30 | 60;
  aspectRatio: AspectRatio;
  showCaptions: boolean;
  scenes: MotionScene[];
}

export interface MotionLayerInput {
  id?: string;
  kind: MotionLayerKind;
  enter_at_ms?: number;
  enterAtMs?: number;
  exit_at_ms?: number;
  exitAtMs?: number;
  easing?: EasingPreset;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  color?: ColorName | 'none';
  text?: string;
  subtext?: string;
  align?: 'left' | 'center' | 'right';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  value?: number;
  start_value?: number;
  startValue?: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  delta_text?: string;
  deltaText?: string;
  bind_widget_id?: string;
  bindWidgetId?: string;
  chart_type?: 'bar' | 'line' | 'donut';
  chartType?: 'bar' | 'line' | 'donut';
  series?: MotionChartSeriesItem[];
  highlight_index?: number;
  highlightIndex?: number;
  highlight_note?: string;
  highlightNote?: string;
  flow_nodes?: MotionFlowNode[];
  flowNodes?: MotionFlowNode[];
  flow_edges?: MotionFlowEdge[];
  flowEdges?: MotionFlowEdge[];
}

export interface MotionSceneInput {
  id?: string;
  title: string;
  duration_ms?: number;
  durationMs?: number;
  transition?: TransitionKind;
  accent_color?: ColorName;
  accentColor?: ColorName;
  narration?: string;
  layers: MotionLayerInput[];
}

export interface CreateMotionRequest {
  title?: string;
  subtitle?: string;
  aspect_ratio?: AspectRatio;
  fps?: 30 | 60;
  show_captions?: boolean;
  /** When true and scenes are omitted, automatically synthesizes a multi-scene storyboard from the current page's dashboard/diagram/docs! */
  from_current_page?: boolean;
  scenes?: MotionSceneInput[];
  new_page?: boolean;
  replace?: boolean;
}

export interface EditMotionRequest {
  summary?: string;
  title?: string;
  subtitle?: string;
  aspect_ratio?: AspectRatio;
  fps?: 30 | 60;
  show_captions?: boolean;
  add_scenes?: (MotionSceneInput & { after?: string })[];
  update_scenes?: {
    id: string;
    title?: string;
    duration_ms?: number;
    durationMs?: number;
    transition?: TransitionKind;
    accent_color?: ColorName | 'none';
    narration?: string;
  }[];
  remove_scenes?: string[];
  reorder_scenes?: string[];
  add_layers?: (MotionLayerInput & { scene_id: string })[];
  update_layers?: (Partial<MotionLayerInput> & { id: string; scene_id?: string })[];
  remove_layers?: string[];
}

export interface MotionOpResult {
  ok: boolean;
  motion: MotionSpec;
  addedScenes: string[];
  updatedScenes: string[];
  removedScenes: string[];
  errors: string[];
  warnings: string[];
  notes: string[];
}

function slug(raw: string, fallback: string): string {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 36);
  return s || fallback;
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export function aspectDimensions(ratio: AspectRatio): { width: number; height: number } {
  switch (ratio) {
    case '9:16':
      return { width: 1080, height: 1920 };
    case '1:1':
      return { width: 1080, height: 1080 };
    default:
      return { width: 1920, height: 1080 };
  }
}

export function totalMotionDurationMs(spec: MotionSpec): number {
  return spec.scenes.reduce((sum, s) => sum + s.durationMs, 0);
}

function defaultLayerBox(kind: MotionLayerKind, index: number): { x: number; y: number; w: number; h: number } {
  switch (kind) {
    case 'badge':
      return { x: 8, y: 10, w: 32, h: 8 };
    case 'kinetic_text':
      return { x: 8, y: index === 0 ? 22 : 52, w: 84, h: 24 };
    case 'metric_counter':
      return { x: 8 + (index % 2) * 44, y: 34, w: 40, h: 36 };
    case 'motion_chart':
      return { x: 8, y: 26, w: 84, h: 58 };
    case 'flow_diagram':
      return { x: 8, y: 28, w: 84, h: 54 };
    case 'callout_card':
      return { x: 12, y: 66, w: 76, h: 18 };
  }
}

function normalizeLayer(input: MotionLayerInput, usedIds: Set<string>, index: number): MotionLayer {
  const kind: MotionLayerKind = MOTION_LAYER_KINDS.includes(input.kind) ? input.kind : 'kinetic_text';
  const baseId = slug(input.id || input.text || kind, `${kind}_${index + 1}`);
  let id = baseId;
  let n = 2;
  while (usedIds.has(id)) id = `${baseId}_${n++}`;
  usedIds.add(id);

  const def = defaultLayerBox(kind, index);
  const enterAtMs = clamp(Math.round(input.enterAtMs ?? input.enter_at_ms ?? index * 220), 0, 20_000);
  const rawExit = input.exitAtMs ?? input.exit_at_ms;
  const color = input.color && input.color !== 'none' && COLORS.includes(input.color) ? input.color : undefined;
  const startVal = input.startValue ?? input.start_value;
  const deltaText = input.deltaText ?? input.delta_text;
  const bindWidgetId = input.bindWidgetId ?? input.bind_widget_id;
  const chartType = input.chartType ?? input.chart_type;
  const highlightIndex = input.highlightIndex ?? input.highlight_index;
  const highlightNote = input.highlightNote ?? input.highlight_note;
  const flowNodes = input.flowNodes ?? input.flow_nodes;
  const flowEdges = input.flowEdges ?? input.flow_edges;

  return {
    id,
    kind,
    enterAtMs,
    ...(typeof rawExit === 'number' && rawExit > enterAtMs ? { exitAtMs: Math.round(rawExit) } : {}),
    easing: input.easing && EASING_PRESETS.includes(input.easing) ? input.easing : 'spring',
    x: clamp(typeof input.x === 'number' ? input.x : def.x, 0, 95),
    y: clamp(typeof input.y === 'number' ? input.y : def.y, 0, 95),
    w: clamp(typeof input.w === 'number' ? input.w : def.w, 8, 100),
    h: clamp(typeof input.h === 'number' ? input.h : def.h, 6, 100),
    ...(color ? { color } : {}),
    ...(input.text !== undefined ? { text: String(input.text) } : {}),
    ...(input.subtext !== undefined ? { subtext: String(input.subtext) } : {}),
    ...(input.align ? { align: input.align } : {}),
    ...(input.size ? { size: input.size } : {}),
    ...(typeof input.value === 'number' ? { value: input.value } : {}),
    ...(typeof startVal === 'number' ? { startValue: startVal } : {}),
    ...(input.prefix !== undefined ? { prefix: String(input.prefix) } : {}),
    ...(input.suffix !== undefined ? { suffix: String(input.suffix) } : {}),
    ...(typeof input.decimals === 'number' ? { decimals: clamp(Math.round(input.decimals), 0, 4) } : {}),
    ...(deltaText !== undefined ? { deltaText: String(deltaText) } : {}),
    ...(bindWidgetId ? { bindWidgetId } : {}),
    ...(chartType ? { chartType } : {}),
    ...(Array.isArray(input.series)
      ? {
          series: input.series.map((s) => ({
            label: String(s.label),
            value: Number(s.value) || 0,
            ...(s.color && COLORS.includes(s.color) ? { color: s.color } : {}),
          })),
        }
      : {}),
    ...(typeof highlightIndex === 'number' ? { highlightIndex } : {}),
    ...(highlightNote ? { highlightNote } : {}),
    ...(Array.isArray(flowNodes) ? { flowNodes: flowNodes.map((fn) => ({ ...fn })) } : {}),
    ...(Array.isArray(flowEdges) ? { flowEdges: flowEdges.map((fe) => ({ ...fe })) } : {}),
  };
}

function normalizeSceneInput(input: MotionSceneInput, usedSceneIds: Set<string>, usedLayerIds: Set<string>, index: number): MotionScene {
  const baseId = slug(input.id || input.title, `scene_${index + 1}`);
  let id = baseId;
  let n = 2;
  while (usedSceneIds.has(id)) id = `${baseId}_${n++}`;
  usedSceneIds.add(id);

  const dur = input.durationMs ?? input.duration_ms ?? 4500;
  const accent = input.accentColor ?? input.accent_color;
  return {
    id,
    title: input.title?.trim() || `Scene ${index + 1}`,
    durationMs: clamp(Math.round(dur), 1500, 25_000),
    transition: input.transition && TRANSITION_KINDS.includes(input.transition) ? input.transition : 'fade',
    ...(accent && COLORS.includes(accent) ? { accentColor: accent } : {}),
    ...(input.narration?.trim() ? { narration: input.narration.trim() } : {}),
    layers: (input.layers ?? []).map((l, li) => normalizeLayer(l, usedLayerIds, li)),
  };
}

export function cloneMotion(m: MotionSpec): MotionSpec {
  return {
    ...m,
    scenes: m.scenes.map((s) => ({
      ...s,
      layers: s.layers.map((l) => ({
        ...l,
        series: l.series ? l.series.map((it) => ({ ...it })) : undefined,
        flowNodes: l.flowNodes ? l.flowNodes.map((n) => ({ ...n })) : undefined,
        flowEdges: l.flowEdges ? l.flowEdges.map((e) => ({ ...e })) : undefined,
      })),
    })),
  };
}

export function normalizeMotion(raw: any): MotionSpec | undefined {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.scenes)) return undefined;
  const usedS = new Set<string>();
  const usedL = new Set<string>();
  const scenes = raw.scenes
    .filter((s: any) => s && typeof s === 'object')
    .map((s: any, i: number) => normalizeSceneInput(s, usedS, usedL, i));
  if (scenes.length === 0) return undefined;
  return {
    title: typeof raw.title === 'string' && raw.title ? raw.title : 'Motion Explainer',
    ...(typeof raw.subtitle === 'string' && raw.subtitle ? { subtitle: raw.subtitle } : {}),
    fps: raw.fps === 60 ? 60 : 30,
    aspectRatio: ASPECT_RATIOS.includes(raw.aspectRatio) ? raw.aspectRatio : '16:9',
    showCaptions: raw.showCaptions !== false,
    scenes,
  };
}

/**
 * Synthesizes a multi-scene, data-grounded Motion Explainer directly from the
 * active page's Dashboard (with live query results), Whiteboard Diagram, or Docs.
 */
export function generateMotionFromPage(
  pageScene: Scene,
  dashboardResults: Record<string, QueryExecutionResult | undefined> = {},
  opts: { title?: string; aspectRatio?: AspectRatio } = {},
): MotionSpec {
  const dash: DashboardSpec | undefined = pageScene.dashboard;
  const title = opts.title?.trim() || dash?.title || pageScene.title || 'Executive Walkthrough';
  const aspectRatio = opts.aspectRatio ?? '16:9';
  const scenesInput: MotionSceneInput[] = [];

  // Scene 1: Title / Hook Card
  scenesInput.push({
    id: 'intro_hook',
    title: 'Opening Hook',
    durationMs: 4000,
    transition: 'fade',
    accentColor: 'blue',
    narration: `${title} — key live performance highlights and takeaways.`,
    layers: [
      { id: 'intro_badge', kind: 'badge', text: 'LIVE WALKTHROUGH', x: 8, y: 18, w: 28, h: 7, color: 'blue', enterAtMs: 0 },
      {
        id: 'intro_headline',
        kind: 'kinetic_text',
        text: title,
        subtext: dash?.subtitle || pageScene.subtitle || 'Programmatic code-driven explainer grounded in workspace data',
        size: 'xl',
        x: 8,
        y: 30,
        w: 84,
        h: 40,
        enterAtMs: 180,
      },
    ],
  });

  // Scene 2: KPI Roll-up (if Dashboard has KPI widgets)
  if (dash) {
    const kpis = dash.widgets.filter((w) => w.kind === 'kpi').slice(0, 2);
    if (kpis.length > 0) {
      const kpiLayers: MotionLayerInput[] = [
        { id: 'kpi_header', kind: 'kinetic_text', text: 'Headline Metrics', size: 'md', x: 8, y: 12, w: 84, h: 12, enterAtMs: 0 },
      ];
      kpis.forEach((w, idx) => {
        const res = dashboardResults[w.id];
        const rawVal = res?.rows?.[0]?.[Math.max(0, (res.columns.length ?? 1) - 1)];
        const numericVal = typeof rawVal === 'number' ? rawVal : Number(rawVal) || 0;
        const isUsd = w.format === 'currency_usd';
        const isPct = w.format === 'percent';
        const displayNum = isUsd && Math.abs(numericVal) >= 1_000_000
          ? Math.round((numericVal / 1_000_000) * 100) / 100
          : isUsd && Math.abs(numericVal) >= 10_000
            ? Math.round((numericVal / 1_000) * 10) / 10
            : numericVal;
        const suffix = isUsd
          ? (Math.abs(numericVal) >= 1_000_000 ? 'M' : Math.abs(numericVal) >= 10_000 ? 'K' : '')
          : isPct ? '%' : (w.unit ? ` ${w.unit}` : '');
        kpiLayers.push({
          id: `counter_${w.id}`,
          kind: 'metric_counter',
          text: w.title,
          subtext: w.subtitle ?? `Source: ${w.source}`,
          value: displayNum,
          startValue: 0,
          prefix: isUsd ? '$' : w.format === 'currency_eur' ? '€' : '',
          suffix,
          decimals: !Number.isInteger(displayNum) ? 1 : 0,
          bindWidgetId: w.id,
          color: idx === 0 ? 'blue' : 'teal',
          x: kpis.length === 1 ? 8 : 8 + idx * 44,
          y: 30,
          w: kpis.length === 1 ? 84 : 40,
          h: 44,
          enterAtMs: 220 + idx * 260,
        });
      });
      scenesInput.push({
        id: 'kpi_highlights',
        title: 'Key Metrics Roll-up',
        durationMs: 4800,
        transition: 'slide_left',
        accentColor: 'teal',
        narration: `Core metrics across ${kpis.map((k) => k.title).join(' and ')}.`,
        layers: kpiLayers,
      });
    }

    // Scene 3: Primary Chart Deep-Dive
    const chartW = dash.widgets.find((w) => w.kind !== 'kpi' && w.kind !== 'table');
    if (chartW) {
      const res = dashboardResults[chartW.id];
      const rows = (res?.rows ?? []).slice(0, 6);
      const series: MotionChartSeriesItem[] = rows.length > 0
        ? rows.map((r, i) => ({
            label: String(r[0] ?? `Item ${i + 1}`),
            value: Number(r[1] ?? r[0] ?? 0) || 0,
            color: (['blue', 'teal', 'purple', 'green', 'orange', 'pink'] as ColorName[])[i % 6],
          }))
        : [
            { label: 'North America', value: 480, color: 'blue' },
            { label: 'EMEA', value: 365, color: 'teal' },
            { label: 'APAC', value: 240, color: 'purple' },
            { label: 'LATAM', value: 135, color: 'orange' },
          ];
      let maxIdx = 0;
      series.forEach((s, idx) => { if (s.value > series[maxIdx].value) maxIdx = idx; });
      const topItem = series[maxIdx];
      scenesInput.push({
        id: 'chart_breakdown',
        title: chartW.title,
        durationMs: 5200,
        transition: 'slide_up',
        accentColor: 'purple',
        narration: `${chartW.title}: ${topItem ? `${topItem.label} leads at ${formatMetricValue(topItem.value, chartW.format)}.` : 'Visualizing performance distribution.'}`,
        layers: [
          {
            id: 'chart_heading',
            kind: 'kinetic_text',
            text: chartW.title,
            subtext: chartW.subtitle ?? 'Live SQL Breakdown',
            size: 'md',
            x: 8,
            y: 10,
            w: 84,
            h: 14,
            enterAtMs: 0,
          },
          {
            id: `anim_${chartW.id}`,
            kind: 'motion_chart',
            chartType: chartW.kind === 'line' || chartW.kind === 'area' ? 'line' : chartW.kind === 'pie' || chartW.kind === 'donut' ? 'donut' : 'bar',
            series,
            highlightIndex: maxIdx,
            highlightNote: topItem ? `Top driver: ${topItem.label}` : undefined,
            x: 8,
            y: 26,
            w: 84,
            h: 58,
            enterAtMs: 240,
          },
        ],
      });
    }
  }

  // Optional Architecture / Flow Scene if the page has Diagram nodes!
  if (pageScene.nodes.length > 0) {
    const picked = pageScene.nodes.slice(0, 5);
    const pickedIds = new Set(picked.map((n) => n.id));
    scenesInput.push({
      id: 'architecture_flow',
      title: 'System & Data Flow',
      durationMs: 4800,
      transition: 'zoom_through',
      accentColor: 'green',
      narration: `End-to-end flow across ${picked.map((n) => n.label).join(', ')}.`,
      layers: [
        { id: 'flow_title', kind: 'kinetic_text', text: pageScene.title || 'Architecture Flow', size: 'md', x: 8, y: 10, w: 84, h: 12, enterAtMs: 0 },
        {
          id: 'flow_graph',
          kind: 'flow_diagram',
          flowNodes: picked.map((n) => ({ id: n.id, label: n.label, color: n.color ?? 'blue' })),
          flowEdges: pageScene.edges
            .filter((e) => pickedIds.has(e.from) && pickedIds.has(e.to))
            .map((e) => ({ from: e.from, to: e.to, label: e.label })),
          x: 8,
          y: 28,
          w: 84,
          h: 52,
          enterAtMs: 200,
        },
      ],
    });
  }

  // Closing Takeaway Scene
  const docSummary = pageScene.blocks.find((b) => b.kind === 'text')?.text?.split('\n').find((l) => l.trim() && !l.startsWith('#'))?.replace(/[*_`]/g, '');
  scenesInput.push({
    id: 'closing_summary',
    title: 'Executive Takeaway',
    durationMs: 4200,
    transition: 'fade',
    accentColor: 'orange',
    narration: docSummary || 'All metrics verified against live SQL queries and ready for action.',
    layers: [
      { id: 'outro_badge', kind: 'badge', text: 'KEY TAKEAWAY', color: 'orange', x: 8, y: 20, w: 26, h: 7, enterAtMs: 0 },
      {
        id: 'outro_headline',
        kind: 'kinetic_text',
        text: docSummary ? docSummary.slice(0, 110) : 'Verified Live Data, Ready to Share',
        subtext: 'Every figure is backed by auditable SQL queries in Voice Whiteboard Studio.',
        size: 'lg',
        x: 8,
        y: 32,
        w: 84,
        h: 34,
        enterAtMs: 200,
      },
    ],
  });

  const usedS = new Set<string>();
  const usedL = new Set<string>();
  return {
    title,
    subtitle: dash?.subtitle ?? pageScene.subtitle,
    fps: 30,
    aspectRatio,
    showCaptions: true,
    scenes: scenesInput.map((s, idx) => normalizeSceneInput(s, usedS, usedL, idx)),
  };
}

export function buildMotion(
  req: CreateMotionRequest,
  context?: { pageScene?: Scene; dashboardResults?: Record<string, QueryExecutionResult | undefined> },
): MotionOpResult {
  if ((!req.scenes || req.scenes.length === 0) && context?.pageScene) {
    const synthesized = generateMotionFromPage(context.pageScene, context.dashboardResults, {
      title: req.title,
      aspectRatio: req.aspect_ratio,
    });
    if (req.fps === 60) synthesized.fps = 60;
    if (req.show_captions === false) synthesized.showCaptions = false;
    return {
      ok: true,
      motion: synthesized,
      addedScenes: synthesized.scenes.map((s) => s.id),
      updatedScenes: [],
      removedScenes: [],
      errors: [],
      warnings: [],
      notes: ['Synthesized multi-scene explainer from active workspace page.'],
    };
  }

  if (!Array.isArray(req.scenes) || req.scenes.length === 0) {
    return {
      ok: false,
      motion: { title: '', fps: 30, aspectRatio: '16:9', showCaptions: true, scenes: [] },
      addedScenes: [],
      updatedScenes: [],
      removedScenes: [],
      errors: ['create_motion requires at least 1 scene (or from_current_page: true).'],
      warnings: [],
      notes: [],
    };
  }

  const usedS = new Set<string>();
  const usedL = new Set<string>();
  const scenes = req.scenes.map((s, idx) => normalizeSceneInput(s, usedS, usedL, idx));
  const motion: MotionSpec = {
    title: req.title?.trim() || 'Animated Explainer',
    ...(req.subtitle?.trim() ? { subtitle: req.subtitle.trim() } : {}),
    fps: req.fps === 60 ? 60 : 30,
    aspectRatio: req.aspect_ratio && ASPECT_RATIOS.includes(req.aspect_ratio) ? req.aspect_ratio : '16:9',
    showCaptions: req.show_captions !== false,
    scenes,
  };

  return {
    ok: true,
    motion,
    addedScenes: scenes.map((s) => s.id),
    updatedScenes: [],
    removedScenes: [],
    errors: [],
    warnings: [],
    notes: [],
  };
}

function resolveSceneRef(ref: string, scenes: MotionScene[]) {
  const numMatch = /^(?:scene\s*)?(\d+)$/i.exec(ref.trim());
  if (numMatch) {
    const idx = Number(numMatch[1]) - 1;
    if (idx >= 0 && idx < scenes.length) return { item: scenes[idx], note: `"${ref}" → ${scenes[idx].id}` };
  }
  const r = resolveRef(ref, scenes.map((s) => ({ id: s.id, label: s.title, scene: s })), 'scene');
  return { item: r.item?.scene, note: r.note, error: r.error };
}

export function applyMotionEdit(prev: MotionSpec, req: EditMotionRequest): MotionOpResult {
  const next = cloneMotion(prev);
  const errors: string[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];
  const addedScenes: string[] = [];
  const updatedScenes: string[] = [];
  const removedScenes: string[] = [];

  if (typeof req.title === 'string' && req.title.trim()) next.title = req.title.trim();
  if (typeof req.subtitle === 'string') {
    if (req.subtitle.trim() === '') delete next.subtitle;
    else next.subtitle = req.subtitle.trim();
  }
  if (req.aspect_ratio && ASPECT_RATIOS.includes(req.aspect_ratio)) next.aspectRatio = req.aspect_ratio;
  if (req.fps === 30 || req.fps === 60) next.fps = req.fps;
  if (typeof req.show_captions === 'boolean') next.showCaptions = req.show_captions;

  // Remove scenes
  for (const sRef of req.remove_scenes ?? []) {
    if (next.scenes.length <= 1) {
      errors.push('Cannot remove the last remaining scene in a motion composition.');
      break;
    }
    const r = resolveSceneRef(sRef, next.scenes);
    if (!r.item) {
      errors.push(r.error ?? `No scene matching "${sRef}".`);
      continue;
    }
    if (r.note) notes.push(r.note);
    next.scenes = next.scenes.filter((s) => s.id !== r.item!.id);
    removedScenes.push(r.item.id);
  }

  // Update scenes
  for (const sPatch of req.update_scenes ?? []) {
    const r = resolveSceneRef(sPatch.id, next.scenes);
    if (!r.item) {
      errors.push(r.error ?? `No scene matching "${sPatch.id}".`);
      continue;
    }
    if (r.note) notes.push(r.note);
    const s = r.item;
    if (sPatch.title !== undefined && sPatch.title.trim()) s.title = sPatch.title.trim();
    const dur = sPatch.durationMs ?? sPatch.duration_ms;
    if (typeof dur === 'number') s.durationMs = clamp(Math.round(dur), 1500, 25_000);
    if (sPatch.transition && TRANSITION_KINDS.includes(sPatch.transition)) s.transition = sPatch.transition;
    if (sPatch.accent_color !== undefined) {
      if (sPatch.accent_color === 'none') delete s.accentColor;
      else if (COLORS.includes(sPatch.accent_color)) s.accentColor = sPatch.accent_color;
    }
    if (sPatch.narration !== undefined) {
      if (sPatch.narration.trim() === '') delete s.narration;
      else s.narration = sPatch.narration.trim();
    }
    if (!updatedScenes.includes(s.id)) updatedScenes.push(s.id);
  }

  // Add scenes
  const usedS = new Set(next.scenes.map((s) => s.id));
  const usedL = new Set(next.scenes.flatMap((s) => s.layers.map((l) => l.id)));
  for (const sAdd of req.add_scenes ?? []) {
    const created = normalizeSceneInput(sAdd, usedS, usedL, next.scenes.length);
    if (sAdd.after === 'start') {
      next.scenes.unshift(created);
    } else if (sAdd.after) {
      const idx = next.scenes.findIndex((x) => x.id === sAdd.after);
      if (idx >= 0) next.scenes.splice(idx + 1, 0, created);
      else next.scenes.push(created);
    } else {
      next.scenes.push(created);
    }
    addedScenes.push(created.id);
  }

  // Reorder scenes
  if (Array.isArray(req.reorder_scenes) && req.reorder_scenes.length > 0) {
    const byId = new Map(next.scenes.map((s) => [s.id, s]));
    const ordered: MotionScene[] = [];
    for (const id of req.reorder_scenes) {
      const s = byId.get(id);
      if (s) {
        ordered.push(s);
        byId.delete(id);
      }
    }
    for (const rest of byId.values()) ordered.push(rest);
    next.scenes = ordered;
  }

  // Remove layers
  for (const lRef of req.remove_layers ?? []) {
    let removed = false;
    for (const s of next.scenes) {
      const before = s.layers.length;
      s.layers = s.layers.filter((l) => l.id !== lRef);
      if (s.layers.length < before) {
        removed = true;
        if (!updatedScenes.includes(s.id)) updatedScenes.push(s.id);
      }
    }
    if (!removed) warnings.push(`Layer "${lRef}" was not found.`);
  }

  // Update layers
  const allLayers = () => next.scenes.flatMap((s) => s.layers.map((l) => ({ id: l.id, label: l.text ?? l.id, kind: l.kind, scene: s, layer: l })));
  for (const lPatch of req.update_layers ?? []) {
    const candidates = lPatch.scene_id
      ? allLayers().filter((item) => item.scene.id === lPatch.scene_id)
      : allLayers();
    const res = resolveRef(lPatch.id, candidates, 'layer');
    if (!res.item) {
      errors.push(res.error ?? `No motion layer matching "${lPatch.id}".`);
      continue;
    }
    if (res.note) notes.push(res.note);
    const { layer: l, scene: s } = res.item;
    if (lPatch.text !== undefined) l.text = String(lPatch.text);
    if (lPatch.subtext !== undefined) l.subtext = String(lPatch.subtext);
    if (lPatch.align !== undefined) l.align = lPatch.align;
    if (lPatch.size !== undefined) l.size = lPatch.size;
    if (typeof lPatch.x === 'number') l.x = clamp(lPatch.x, 0, 95);
    if (typeof lPatch.y === 'number') l.y = clamp(lPatch.y, 0, 95);
    if (typeof lPatch.w === 'number') l.w = clamp(lPatch.w, 8, 100);
    if (typeof lPatch.h === 'number') l.h = clamp(lPatch.h, 6, 100);
    const enterMs = lPatch.enterAtMs ?? lPatch.enter_at_ms;
    if (typeof enterMs === 'number') l.enterAtMs = clamp(Math.round(enterMs), 0, s.durationMs);
    const exitMs = lPatch.exitAtMs ?? lPatch.exit_at_ms;
    if (typeof exitMs === 'number') l.exitAtMs = Math.round(exitMs);
    if (lPatch.easing && EASING_PRESETS.includes(lPatch.easing)) l.easing = lPatch.easing;
    if (typeof lPatch.value === 'number') l.value = lPatch.value;
    const startVal = lPatch.startValue ?? lPatch.start_value;
    if (typeof startVal === 'number') l.startValue = startVal;
    if (lPatch.prefix !== undefined) l.prefix = lPatch.prefix;
    if (lPatch.suffix !== undefined) l.suffix = lPatch.suffix;
    if (typeof lPatch.decimals === 'number') l.decimals = clamp(Math.round(lPatch.decimals), 0, 4);
    const dTxt = lPatch.deltaText ?? lPatch.delta_text;
    if (dTxt !== undefined) l.deltaText = dTxt;
    if (Array.isArray(lPatch.series)) l.series = lPatch.series.map((it) => ({ ...it }));
    const hiIdx = lPatch.highlightIndex ?? lPatch.highlight_index;
    if (typeof hiIdx === 'number') l.highlightIndex = hiIdx;
    const hiNote = lPatch.highlightNote ?? lPatch.highlight_note;
    if (hiNote !== undefined) l.highlightNote = hiNote;
    if (lPatch.color !== undefined) {
      if (lPatch.color === 'none') delete l.color;
      else if (COLORS.includes(lPatch.color)) l.color = lPatch.color;
    }
    if (!updatedScenes.includes(s.id)) updatedScenes.push(s.id);
  }

  // Add layers
  for (const lAdd of req.add_layers ?? []) {
    const r = resolveSceneRef(lAdd.scene_id, next.scenes);
    if (!r.item) {
      errors.push(r.error ?? `Cannot add layer: no scene "${lAdd.scene_id}".`);
      continue;
    }
    const created = normalizeLayer(lAdd, usedL, r.item.layers.length);
    r.item.layers.push(created);
    if (!updatedScenes.includes(r.item.id)) updatedScenes.push(r.item.id);
  }

  if (errors.length > 0) {
    return {
      ok: false,
      motion: prev,
      addedScenes: [],
      updatedScenes: [],
      removedScenes: [],
      errors,
      warnings,
      notes,
    };
  }

  return {
    ok: true,
    motion: next,
    addedScenes,
    updatedScenes,
    removedScenes,
    errors: [],
    warnings,
    notes,
  };
}

/** Compact summary of the Motion Composition returned to Gemini Live on every tool call. */
export function describeMotion(m: MotionSpec): string {
  const totalSec = (totalMotionDurationMs(m) / 1000).toFixed(1);
  const lines: string[] = [];
  lines.push(
    `motion: ${JSON.stringify(m.title)} · ${m.aspectRatio} · ${m.fps}fps · ${m.scenes.length} scenes · ${totalSec}s total`,
  );
  m.scenes.forEach((s, idx) => {
    lines.push(
      `  ${idx + 1}. ${s.id} ${JSON.stringify(s.title)} (${(s.durationMs / 1000).toFixed(1)}s, ${s.transition})` +
      (s.narration ? ` — narration: ${JSON.stringify(s.narration)}` : ''),
    );
    for (const l of s.layers) {
      const detail = l.kind === 'metric_counter'
        ? `${l.prefix ?? ''}${l.value ?? 0}${l.suffix ?? ''} (${JSON.stringify(l.text ?? '')})`
        : l.kind === 'motion_chart'
          ? `${l.chartType ?? 'bar'} (${(l.series ?? []).length} items)`
          : l.kind === 'flow_diagram'
            ? `flow (${(l.flowNodes ?? []).length} nodes)`
            : JSON.stringify((l.text ?? '').slice(0, 60));
      lines.push(`     - ${l.id} [${l.kind} @${l.enterAtMs}ms]: ${detail}`);
    }
  });
  return lines.join('\n');
}
