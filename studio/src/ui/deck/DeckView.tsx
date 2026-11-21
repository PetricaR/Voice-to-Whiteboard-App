/**
 * The Deck tab of a page: a slide presentation built from the page (or by
 * voice), edited here or by voice, presented full screen, and exported to
 * PowerPoint or Google Slides.
 *
 * Slides on the left, the selected slide in the middle with its speaker
 * notes below, and its fields on the right. Every change is one undoable
 * history entry of the page (store.editDeck).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { DeckAction } from '../../agent/dispatcher';
import type { QueryExecutionResult } from '../../data/sqlEngine';
import {
  DECK_CHART_TYPES,
  DECK_THEMES,
  LIMITS,
  SLIDE_LAYOUTS,
  type DeckChartType,
  type DeckSpec,
  type DeckThemeName,
  type EditDeckRequest,
  type Slide,
  type SlideInput,
  type SlideLayout,
} from '../../engine/deck';
import { THEMES } from '../../engine/deckLayout';
import { hasDashboard, hasDiagram } from '../../engine/types';
import { Icon, IconButton, useStoreRevision, useStudio } from '../context';
import { usePopoverMenu } from '../domTransitions';
import type { IconName } from '../icons';
import { downloadDeckPptx, openDeckInGoogleSlides, preloadDeckExport } from './deckActions';
import { PresentMode } from './PresentMode';
import { SLIDE_PX, SlideCanvas } from './SlideCanvas';

export interface DeckCommand {
  id: number;
  action: DeckAction;
  slide?: number;
}

type Results = Record<string, QueryExecutionResult | undefined>;

const LAYOUT_INFO: Record<SlideLayout, { label: string; icon: IconName; hint: string }> = {
  title: { label: 'Title', icon: 'title', hint: 'Opening slide' },
  section: { label: 'Section', icon: 'toc', hint: 'Divider between parts' },
  kpis: { label: 'Metrics', icon: 'speed', hint: '2–4 headline figures' },
  chart: { label: 'Chart', icon: 'bar_chart', hint: 'One chart and its takeaways' },
  points: { label: 'Points', icon: 'grid_view', hint: '2–4 findings or options' },
  flow: { label: 'Flow', icon: 'arrow_forward', hint: 'Process or architecture steps' },
  table: { label: 'Table', icon: 'table_chart', hint: 'Up to 8 rows of detail' },
  statement: { label: 'Statement', icon: 'lightbulb', hint: 'One big message or the ask' },
  closing: { label: 'Closing', icon: 'check_circle', hint: 'Takeaways and next steps' },
};

/** A text field that changes the deck when it is left (or on Enter), not on every key. */
function CommitField({
  label,
  value,
  onCommit,
  multiline,
  placeholder,
  rows = 2,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
  rows?: number;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    if (text !== value) onCommit(text);
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Escape') {
      setText(value);
      (e.target as HTMLElement).blur();
    } else if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      (e.target as HTMLElement).blur();
    }
  };
  return (
    <label className="deck-field">
      <span>{label}</span>
      {multiline ? (
        <textarea value={text} rows={rows} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={onKeyDown} />
      ) : (
        <input value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={onKeyDown} />
      )}
    </label>
  );
}

/** A starting point for a new slide of each layout. */
function templateSlide(layout: SlideLayout, deck: DeckSpec, firstChartWidget?: string): SlideInput {
  switch (layout) {
    case 'title':
      return { layout, title: deck.title, subtitle: deck.subtitle };
    case 'section':
      return { layout, title: 'Next part' };
    case 'kpis':
      return { layout, kicker: 'Headline metrics', title: 'Say what the figures mean in one sentence', metrics: [{ label: 'Metric', value: '—' }, { label: 'Metric', value: '—' }, { label: 'Metric', value: '—' }] };
    case 'chart':
      return firstChartWidget
        ? { layout, title: 'Say what this chart shows', widget_id: firstChartWidget }
        : { layout, title: 'Say what this chart shows', chart: { type: 'column', categories: ['A', 'B', 'C'], series: [{ name: 'Value', values: [3, 5, 2] }] } };
    case 'points':
      return { layout, title: 'Three points that support the message', points: [{ title: 'First point', text: 'One sentence.' }, { title: 'Second point', text: 'One sentence.' }, { title: 'Third point', text: 'One sentence.' }] };
    case 'flow':
      return { layout, title: 'How it works, step by step', points: [{ title: 'Step one' }, { title: 'Step two' }, { title: 'Step three' }] };
    case 'table':
      return { layout, title: 'The detail behind the numbers', columns: ['Item', 'Owner', 'Status'], rows: [['First item', 'Team', 'On track'], ['Second item', 'Team', 'At risk']] };
    case 'statement':
      return { layout, kicker: 'The ask', title: 'The one thing the audience should remember' };
    case 'closing':
      return { layout, kicker: 'Key takeaways', title: 'What this means', takeaways: ['First takeaway', 'Second takeaway'] };
  }
}

function SlideInspector({
  slide,
  deck,
  widgets,
  edit,
}: {
  slide: Slide;
  deck: DeckSpec;
  widgets: { id: string; title: string; kind: string }[];
  edit: (patch: SlideInput, label: string) => void;
}) {
  const layout = slide.layout;
  const lines = (v: string) => v.split('\n').map((l) => l.trim()).filter(Boolean);
  const showPoints = layout === 'points' || layout === 'flow' || layout === 'closing';
  const maxPoints = layout === 'flow' ? LIMITS.flowSteps : layout === 'closing' ? LIMITS.nextSteps : LIMITS.points;
  const chart = slide.chart;
  const singleSeries = chart != null && chart.series.length === 1;

  return (
    <div className="deck-inspector-body">
      <label className="deck-field">
        <span>Layout</span>
        <select value={layout} onChange={(e) => edit({ layout: e.target.value as SlideLayout }, `Slide ${slide.id}: ${LAYOUT_INFO[e.target.value as SlideLayout].label} layout`)}>
          {SLIDE_LAYOUTS.map((l) => <option key={l} value={l}>{LAYOUT_INFO[l].label} — {LAYOUT_INFO[l].hint}</option>)}
        </select>
      </label>
      {layout !== 'title' && (
        <CommitField label="Kicker" value={slide.kicker ?? ''} placeholder="e.g. Revenue" onCommit={(v) => edit({ kicker: v }, 'Changed the kicker')} />
      )}
      <CommitField
        label={layout === 'title' || layout === 'section' ? 'Title' : 'Title (the message, as a sentence)'}
        value={slide.title}
        multiline
        onCommit={(v) => edit({ title: v }, 'Changed the slide title')}
      />
      <CommitField label={layout === 'closing' ? 'Closing line' : 'Subtitle'} value={slide.subtitle ?? ''} onCommit={(v) => edit({ subtitle: v }, 'Changed the subtitle')} />

      {layout === 'kpis' && (
        <fieldset className="deck-fieldset">
          <legend>Metrics</legend>
          {(slide.metrics ?? []).map((m, i) => (
            <div key={i} className="deck-row">
              <CommitField label="Label" value={m.label} onCommit={(v) => edit({ metrics: (slide.metrics ?? []).map((x, j) => (j === i ? { ...x, label: v, widget_id: x.widgetId } : { ...x, widget_id: x.widgetId })) }, 'Changed a metric')} />
              <CommitField label="Figure" value={m.value} onCommit={(v) => edit({ metrics: (slide.metrics ?? []).map((x, j) => (j === i ? { ...x, value: v, widget_id: x.widgetId } : { ...x, widget_id: x.widgetId })) }, 'Changed a figure')} />
              <CommitField label="Change" value={m.delta ?? ''} placeholder="+12% vs Q2" onCommit={(v) => edit({ metrics: (slide.metrics ?? []).map((x, j) => (j === i ? { ...x, delta: v, trend: undefined, widget_id: x.widgetId } : { ...x, widget_id: x.widgetId })) }, 'Changed a metric change')} />
              <IconButton icon="delete" label="Remove this metric" onClick={() => edit({ metrics: (slide.metrics ?? []).filter((_, j) => j !== i).map((x) => ({ ...x, widget_id: x.widgetId })) }, 'Removed a metric')} />
            </div>
          ))}
          {(slide.metrics?.length ?? 0) < LIMITS.metrics && (
            <button type="button" className="text-btn small" onClick={() => edit({ metrics: [...(slide.metrics ?? []).map((x) => ({ ...x, widget_id: x.widgetId })), { label: 'Metric', value: '—' }] }, 'Added a metric')}>
              <Icon name="add" size={16} /> Metric
            </button>
          )}
        </fieldset>
      )}

      {layout === 'chart' && (
        <fieldset className="deck-fieldset">
          <legend>Chart</legend>
          <label className="deck-field">
            <span>Data</span>
            <select
              value={slide.widgetId ?? ''}
              onChange={(e) => edit(e.target.value ? { widget_id: e.target.value, chart: null } : { widget_id: '' }, e.target.value ? 'Chart from a dashboard widget' : 'Chart with its own data')}
            >
              <option value="">Its own data</option>
              {widgets.map((w) => <option key={w.id} value={w.id}>Dashboard: {w.title}</option>)}
            </select>
          </label>
          {chart && (
            <label className="deck-field">
              <span>Type</span>
              <select
                value={chart.type}
                onChange={(e) => edit({ chart: { ...chart, type: e.target.value as DeckChartType, highlight_index: chart.highlight } }, 'Changed the chart type')}
              >
                {DECK_CHART_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
              </select>
            </label>
          )}
          {chart && singleSeries && !slide.widgetId && (
            <CommitField
              label="Values (one “label, value” per line)"
              multiline
              rows={5}
              value={chart.categories.map((c, i) => `${c}, ${chart.series[0].values[i] ?? 0}`).join('\n')}
              onCommit={(v) => {
                const rows = lines(v).map((l) => {
                  const k = l.lastIndexOf(',');
                  return k > 0 ? [l.slice(0, k).trim(), Number(l.slice(k + 1).replace(/[^\d.-]/g, '')) || 0] as const : [l, 0] as const;
                });
                edit({ chart: { ...chart, categories: rows.map((r) => r[0]), series: [{ name: chart.series[0].name, values: rows.map((r) => r[1]) }], highlight_index: undefined } }, 'Changed the chart data');
              }}
            />
          )}
          {chart && !singleSeries && !slide.widgetId && <p className="deck-hint">{chart.series.length} series — ask by voice to change the data.</p>}
          {chart && chart.series.length === 1 && (chart.type === 'bar' || chart.type === 'column') && (
            <label className="deck-field">
              <span>Highlight</span>
              <select
                value={chart.highlight ?? -1}
                onChange={(e) => edit({ chart: { ...chart, highlight_index: Number(e.target.value) < 0 ? undefined : Number(e.target.value) } }, 'Changed the highlighted bar')}
              >
                <option value={-1}>None</option>
                {chart.categories.map((c, i) => <option key={i} value={i}>{c}</option>)}
              </select>
            </label>
          )}
        </fieldset>
      )}

      {(layout === 'chart' || layout === 'kpis' || layout === 'closing') && (
        <CommitField
          label={layout === 'closing' ? 'Takeaways (one per line)' : 'Takeaways (one per line)'}
          multiline
          rows={layout === 'closing' ? 4 : 3}
          value={(slide.takeaways ?? []).join('\n')}
          onCommit={(v) => edit({ takeaways: lines(v) }, 'Changed the takeaways')}
        />
      )}

      {showPoints && (
        <fieldset className="deck-fieldset">
          <legend>{layout === 'flow' ? 'Steps' : layout === 'closing' ? 'Next steps' : 'Points'}</legend>
          {(slide.points ?? []).map((p, i) => (
            <div key={i} className="deck-row stacked">
              <CommitField label={layout === 'flow' ? `Step ${i + 1}` : `Heading ${i + 1}`} value={p.title} onCommit={(v) => edit({ points: (slide.points ?? []).map((x, j) => (j === i ? { ...x, title: v } : x)) }, 'Changed a point')} />
              <CommitField label="Text" value={p.text ?? ''} multiline onCommit={(v) => edit({ points: (slide.points ?? []).map((x, j) => (j === i ? { ...x, text: v } : x)) }, 'Changed a point')} />
              <IconButton icon="delete" label="Remove" onClick={() => edit({ points: (slide.points ?? []).filter((_, j) => j !== i) }, 'Removed a point')} />
            </div>
          ))}
          {(slide.points?.length ?? 0) < maxPoints && (
            <button type="button" className="text-btn small" onClick={() => edit({ points: [...(slide.points ?? []), { title: layout === 'flow' ? 'New step' : 'New point' }] }, 'Added a point')}>
              <Icon name="add" size={16} /> {layout === 'flow' ? 'Step' : layout === 'closing' ? 'Next step' : 'Point'}
            </button>
          )}
        </fieldset>
      )}

      {layout === 'table' && (
        <fieldset className="deck-fieldset">
          <legend>Table</legend>
          <CommitField label="Columns (separated by |)" value={(slide.columns ?? []).join(' | ')} onCommit={(v) => edit({ columns: v.split('|').map((c) => c.trim()).filter(Boolean) }, 'Changed the table columns')} />
          <CommitField
            label="Rows (one per line, cells separated by |)"
            multiline
            rows={6}
            value={(slide.rows ?? []).map((r) => r.join(' | ')).join('\n')}
            onCommit={(v) => edit({ columns: slide.columns, rows: lines(v).map((l) => l.split('|').map((c) => c.trim())) }, 'Changed the table rows')}
          />
        </fieldset>
      )}

      <CommitField label="Source (footer)" value={slide.source ?? ''} placeholder="Source: …" onCommit={(v) => edit({ source: v }, 'Changed the source line')} />
      <p className="deck-hint">Theme: {THEMES[deck.theme].label}. Every field can also be changed by voice: “make slide {deck.slides.indexOf(slide) + 1} a bar chart”.</p>
    </div>
  );
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export function DeckView({ dashboardResults, command }: { dashboardResults?: Results; command?: DeckCommand | null }) {
  const { store, notify, googleClientId } = useStudio();
  useStoreRevision(store);
  const scene = store.scene;
  const deck = scene.deck;
  const [current, setCurrent] = useState(0);
  const [presenting, setPresenting] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1280);
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const addTrigger = useRef<HTMLButtonElement>(null);
  const addMenu = useRef<HTMLDivElement>(null);
  const exportTrigger = useRef<HTMLButtonElement>(null);
  const exportMenu = useRef<HTMLDivElement>(null);
  usePopoverMenu({ open: addOpen, onOpenChange: setAddOpen, menuRef: addMenu, triggerRef: addTrigger, placement: 'bottom-start' });
  usePopoverMenu({ open: exportOpen, onOpenChange: setExportOpen, menuRef: exportMenu, triggerRef: exportTrigger, placement: 'bottom-end' });
  const [stageRef, stageW] = useWidth<HTMLDivElement>();
  const [stageH, setStageH] = useState(0);
  const railRef = useRef<HTMLOListElement>(null);

  const count = deck?.slides.length ?? 0;
  const index = Math.max(0, Math.min(count - 1, current));
  const slide = deck?.slides[index];
  const canBuild = hasDashboard(scene) || hasDiagram(scene) || scene.blocks.length > 0;
  const chartWidgets = useMemo(
    () => (scene.dashboard?.widgets ?? []).filter((w) => w.kind !== 'kpi').map((w) => ({ id: w.id, title: w.title, kind: w.kind })),
    [scene.dashboard],
  );
  const bound = deck?.slides.some((s) => s.widgetId != null || s.metrics?.some((m) => m.widgetId != null)) ?? false;

  useEffect(() => preloadDeckExport(googleClientId != null), [googleClientId]);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStageH(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [stageRef, deck != null]);

  /** The dashboard's results: those on screen, or run now. */
  const results = useCallback(async (): Promise<Results | undefined> => {
    const d = store.scene.dashboard;
    if (d == null) return undefined;
    if (dashboardResults && d.widgets.every((w) => dashboardResults[w.id] != null)) return dashboardResults;
    const { computeDashboardResults } = await import('../../agent/dispatcher');
    return computeDashboardResults(d);
  }, [store, dashboardResults]);

  const edit = useCallback(async (req: EditDeckRequest, label: string, withResults = false) => {
    const res = store.editDeck(req, { source: 'manual', label }, withResults ? await results() : undefined);
    if (!res.ok) notify(res.errors.join(' '));
    return res;
  }, [store, notify, results]);

  const editSlide = useCallback((patch: SlideInput, label: string) => {
    if (!slide) return;
    void edit({ update_slides: [{ ...patch, id: slide.id }] }, label, patch.widget_id != null && patch.widget_id !== '');
  }, [edit, slide]);

  const build = async () => {
    setBusy(true);
    try {
      const res = store.createDeck(
        { from_current_page: true, replace: true, ...(deck ? { theme: deck.theme, author: deck.author } : {}) },
        { source: 'manual', label: deck ? 'Rebuilt the deck from the page' : 'Built a deck from the page' },
        await results(),
      );
      if (!res.ok) notify(res.errors.join(' '));
      else {
        setCurrent(0);
        notify(`Built ${store.scene.deck?.slides.length ?? 0} slides from this page. Every figure comes from its SQL.`);
      }
    } finally {
      setBusy(false);
    }
  };

  const blank = () => {
    const title = scene.title || 'Untitled presentation';
    store.createDeck(
      { title, slides: [{ layout: 'title', title }, { layout: 'closing', kicker: 'Key takeaways', title: 'What this means', takeaways: ['First takeaway'] }] },
      { source: 'manual', label: 'Started a deck' },
    );
    setCurrent(0);
  };

  const sync = async () => {
    setBusy(true);
    try {
      const r = await results();
      const res = store.syncDeck(r ?? {}, { source: 'manual', label: 'Synced the deck with the dashboard' });
      notify(res.notes[0] ?? `Updated the numbers on ${res.changes.updatedSlides.length} ${res.changes.updatedSlides.length === 1 ? 'slide' : 'slides'}.`);
    } finally {
      setBusy(false);
    }
  };

  const addSlide = (layout: SlideLayout) => {
    if (!deck) return;
    setAddOpen(false);
    const after = deck.slides[index]?.layout === 'closing' && index > 0 ? deck.slides[index - 1].id : deck.slides[index]?.id;
    const tpl = templateSlide(layout, deck, chartWidgets.find((w) => w.kind !== 'table')?.id);
    void edit({ add_slides: [{ ...tpl, after }] }, `Added a ${LAYOUT_INFO[layout].label.toLowerCase()} slide`, tpl.widget_id != null).then((res) => {
      const id = res.ok ? res.changes.addedSlides[0] : undefined;
      const at = id ? store.scene.deck?.slides.findIndex((s) => s.id === id) ?? -1 : -1;
      if (at >= 0) setCurrent(at);
    });
  };

  const move = (from: number, to: number) => {
    if (!deck || to < 0 || to >= deck.slides.length) return;
    const ids = deck.slides.map((s) => s.id);
    const [id] = ids.splice(from, 1);
    ids.splice(to, 0, id);
    void edit({ reorder_slides: ids }, 'Moved a slide');
    setCurrent(to);
  };

  const duplicate = (i: number) => {
    if (!deck) return;
    const s = deck.slides[i];
    const { id: _id, widgetId, metrics, chart, ...rest } = s;
    void edit({
      add_slides: [{
        ...rest,
        after: s.id,
        ...(widgetId ? { widget_id: widgetId } : {}),
        ...(metrics ? { metrics: metrics.map((m) => ({ ...m, widget_id: m.widgetId })) } : {}),
        ...(chart ? { chart: { ...chart, highlight_index: chart.highlight } } : {}),
      }],
    }, 'Duplicated a slide').then(() => setCurrent(i + 1));
  };

  const remove = (i: number) => {
    if (!deck) return;
    void edit({ remove_slides: [deck.slides[i].id] }, 'Removed a slide');
    setCurrent(Math.max(0, Math.min(i, deck.slides.length - 2)));
  };

  // Commands of the voice agent (control_deck)
  const deckRef = useRef(deck);
  deckRef.current = deck;
  useEffect(() => {
    const d = deckRef.current;
    if (!command || !d) return;
    const last = d.slides.length - 1;
    switch (command.action) {
      case 'present':
        setCurrent(command.slide ?? 0);
        setPresenting(true);
        break;
      case 'next':
        setCurrent((c) => Math.min(last, c + 1));
        break;
      case 'previous':
        setCurrent((c) => Math.max(0, c - 1));
        break;
      case 'go_to':
        setCurrent(Math.max(0, Math.min(last, command.slide ?? 0)));
        break;
      case 'exit':
        setPresenting(false);
        break;
      case 'export_pptx':
        void downloadDeckPptx(d, notify);
        break;
      case 'export_google_slides':
        // Google asks for access in a popup, which only a click may open
        notify('Save this deck to your Google Drive as Google Slides?', {
          label: 'Open in Google Slides',
          run: () => void openDeckInGoogleSlides(deckRef.current ?? d, googleClientId, notify),
        });
        break;
    }
  }, [command?.id]);

  // Keep the selected thumbnail in view
  useEffect(() => {
    railRef.current?.querySelector<HTMLElement>(`[data-slide-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  if (!deck || !slide) {
    return (
      <section className="surface-empty-view deck-empty">
        <div className="surface-empty-card">
          <Icon name="slideshow" size={34} />
          <h2>Turn this page into a presentation</h2>
          <p>
            Builds a professional deck from the page: a title, an executive summary, the headline metrics, one slide per chart with a
            title that says what it shows, the architecture flow and the takeaways — every figure from its SQL query. Present it here,
            or export it to PowerPoint or Google Slides.
          </p>
          <div className="surface-empty-actions">
            <button type="button" className="filled-btn" disabled={!canBuild || busy} onClick={() => void build()}>
              <Icon name="slideshow" size={18} /> Build deck from this page
            </button>
            <button type="button" className="tonal-btn" onClick={blank}>
              <Icon name="add" size={18} /> Start a blank deck
            </button>
          </div>
          {!canBuild && <p className="deck-hint">This page has no dashboard, diagram or documentation yet: build one first, or start a blank deck and ask “make a 6-slide pitch about …”.</p>}
        </div>
      </section>
    );
  }

  // The slide fits the stage both ways
  const slideW = Math.max(200, Math.min(stageW - 48, ((stageH - 40) * SLIDE_PX.w) / SLIDE_PX.h));

  return (
    <div className={`deck-view${inspectorOpen ? ' with-inspector' : ''}`}>
      <header className="deck-toolbar">
        <div className="deck-toolbar-left">
          <span className="deck-count">{count} {count === 1 ? 'slide' : 'slides'}</span>
          <label className="dash-filter-chip" title="Theme">
            <Icon name="palette" size={15} />
            <select
              aria-label="Deck theme"
              value={deck.theme}
              onChange={(e) => void edit({ theme: e.target.value as DeckThemeName }, `Theme: ${THEMES[e.target.value as DeckThemeName].label}`)}
            >
              {DECK_THEMES.map((t) => <option key={t} value={t}>{THEMES[t].label}</option>)}
            </select>
          </label>
        </div>
        <div className="deck-toolbar-right">
          {bound && hasDashboard(scene) && (
            <button type="button" className="tonal-btn small" disabled={busy} onClick={() => void sync()} title="Refresh the numbers from the dashboard; your words stay">
              <Icon name="refresh" size={16} /> Sync data
            </button>
          )}
          {canBuild && (
            <button type="button" className="tonal-btn small" disabled={busy} onClick={() => void build()} title="Build the deck again from the page (undo brings this one back)">
              <Icon name="auto_awesome_mosaic" size={16} /> Rebuild
            </button>
          )}
          <button
            type="button"
            className={`tonal-btn small${inspectorOpen ? ' active' : ''}`}
            aria-expanded={inspectorOpen}
            aria-controls="deck-inspector"
            onClick={() => setInspectorOpen((v) => !v)}
          >
            <Icon name="tune" size={16} /> Edit slide
          </button>
          <div className="menu-anchor">
            <button ref={exportTrigger} type="button" className="tonal-btn small" aria-haspopup="menu" aria-expanded={exportOpen} onClick={() => setExportOpen((v) => !v)}>
              <Icon name="download" size={16} /> Export
            </button>
            <div ref={exportMenu} popover="auto" className="menu menu-popover menu-end" role="menu" aria-label="Export the deck">
              <button type="button" role="menuitem" onClick={() => { setExportOpen(false); void downloadDeckPptx(deck, notify); }}>
                <Icon name="slideshow" size={20} />
                <span>PowerPoint (.pptx)<small>Editable slides, native charts, speaker notes</small></span>
              </button>
              <button type="button" role="menuitem" onClick={() => { setExportOpen(false); void openDeckInGoogleSlides(deck, googleClientId, notify); }}>
                <Icon name="add_to_drive" size={20} />
                <span>Open in Google Slides<small>{googleClientId ? 'Saved to your Google Drive' : 'Needs GOOGLE_CLIENT_ID on the studio server'}</small></span>
              </button>
            </div>
          </div>
          <button type="button" className="filled-btn small" onClick={() => setPresenting(true)}>
            <Icon name="co_present" size={16} /> Present
          </button>
        </div>
      </header>

      <div className="deck-main">
        <nav className="deck-rail" aria-label="Slides">
          <ol ref={railRef}>
            {deck.slides.map((s, i) => (
              <li key={s.id} className={i === index ? 'current' : undefined}>
                <span className="deck-rail-num" aria-hidden="true">{i + 1}</span>
                <button
                  type="button"
                  className="deck-thumb"
                  data-slide-index={i}
                  aria-current={i === index ? 'true' : undefined}
                  aria-label={`Slide ${i + 1}: ${s.title}`}
                  onClick={() => setCurrent(i)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                      e.preventDefault();
                      const to = Math.max(0, Math.min(count - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
                      if (e.altKey) move(i, to);
                      else setCurrent(to);
                      railRef.current?.querySelector<HTMLElement>(`[data-slide-index="${to}"]`)?.focus();
                    } else if ((e.key === 'Delete' || e.key === 'Backspace') && count > 1) {
                      e.preventDefault();
                      remove(i);
                    }
                  }}
                >
                  <SlideCanvas deck={deck} index={i} width={168} />
                </button>
                {i === index && (
                  <div className="deck-thumb-actions">
                    <IconButton icon="keyboard_arrow_up" label="Move up (Alt+↑)" disabled={i === 0} onClick={() => move(i, i - 1)} />
                    <IconButton icon="keyboard_arrow_down" label="Move down (Alt+↓)" disabled={i === count - 1} onClick={() => move(i, i + 1)} />
                    <IconButton icon="content_copy" label="Duplicate" onClick={() => duplicate(i)} />
                    <IconButton icon="delete" label="Remove slide" disabled={count <= 1} onClick={() => remove(i)} />
                  </div>
                )}
              </li>
            ))}
          </ol>
          <div className="menu-anchor deck-add">
            <button ref={addTrigger} type="button" className="tonal-btn small" aria-haspopup="menu" aria-expanded={addOpen} onClick={() => setAddOpen((v) => !v)}>
              <Icon name="add" size={16} /> Slide
            </button>
            <div ref={addMenu} popover="auto" className="menu menu-popover" role="menu" aria-label="Add a slide">
              {SLIDE_LAYOUTS.map((l) => (
                <button key={l} type="button" role="menuitem" onClick={() => addSlide(l)}>
                  <Icon name={LAYOUT_INFO[l].icon} size={20} />
                  <span>{LAYOUT_INFO[l].label}<small>{LAYOUT_INFO[l].hint}</small></span>
                </button>
              ))}
            </div>
          </div>
        </nav>

        <section className="deck-stage-col" aria-label={`Slide ${index + 1} of ${count}`}>
          <div ref={stageRef} className="deck-stage">
            {stageW > 0 && <SlideCanvas deck={deck} index={index} width={slideW} className="deck-stage-slide" />}
          </div>
          <div className="deck-notes">
            <CommitField
              label={`Speaker notes · slide ${index + 1}`}
              value={slide.notes ?? ''}
              multiline
              rows={3}
              placeholder="What to say on this slide…"
              onCommit={(v) => editSlide({ notes: v }, 'Changed the speaker notes')}
            />
          </div>
        </section>

        {inspectorOpen && <div className="deck-inspector-scrim" aria-hidden="true" onClick={() => setInspectorOpen(false)} />}
        <aside id="deck-inspector" className={`deck-inspector${inspectorOpen ? ' open' : ''}`} aria-label="Slide fields" hidden={!inspectorOpen}>
          <div className="deck-inspector-head">
            <h3>Slide {index + 1} · {LAYOUT_INFO[slide.layout].label}</h3>
            <IconButton icon="close" label="Close" onClick={() => setInspectorOpen(false)} />
          </div>
          <SlideInspector key={slide.id} slide={slide} deck={deck} widgets={chartWidgets} edit={editSlide} />
        </aside>
      </div>

      {presenting && <PresentMode deck={deck} index={index} setIndex={setCurrent} onExit={() => setPresenting(false)} />}
    </div>
  );
}
