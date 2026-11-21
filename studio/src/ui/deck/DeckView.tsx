/**
 * The Deck tab of a page: a slide presentation built from the page (or by
 * voice), edited here or by voice, presented full screen, and exported to
 * PowerPoint or Google Slides.
 *
 * Slides on the left, the selected slide in the middle with its speaker
 * notes below, and its fields on the right. Every change is one undoable
 * history entry of the page (store.editDeck). Changes said aloud show up on
 * the slide they touched, the way the dashboard shows the widget a voice
 * request changed.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import type { DeckAction } from '../../agent/dispatcher';
import type { QueryExecutionResult } from '../../data/sqlEngine';
import {
  DECK_CHART_TYPES,
  DECK_THEMES,
  LIMITS,
  SLIDE_LAYOUTS,
  type DeckChartType,
  type DeckMetric,
  type DeckSpec,
  type DeckThemeName,
  type EditDeckRequest,
  type Slide,
  type SlideInput,
  type SlideLayout,
} from '../../engine/deck';
import { THEMES } from '../../engine/deckLayout';
import type { EditResult } from '../../engine/ops';
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

const CHART_INFO: Record<DeckChartType, { label: string; icon: IconName; className?: string }> = {
  column: { label: 'Column', icon: 'bar_chart' },
  bar: { label: 'Bar', icon: 'bar_chart', className: 'icon-horizontal' },
  stacked_column: { label: 'Stacked', icon: 'stacked_bar_chart' },
  line: { label: 'Line', icon: 'show_chart' },
  area: { label: 'Area', icon: 'stacked_line_chart' },
  donut: { label: 'Donut', icon: 'donut_large' },
};

/** What to try saying on a slide of each layout. */
const VOICE_TRY: Record<SlideLayout, string[]> = {
  title: ['“Change the subtitle to Q3 board review”', '“Use the ocean theme”'],
  section: ['“Rename this section to Risks”', '“Add a chart slide after this one”'],
  kpis: ['“Add a metric with active customers from the data”', '“Make the change line say vs last quarter”'],
  chart: ['“Show revenue by region for the last 6 months”', '“Make it a line chart”', '“Highlight EMEA”'],
  points: ['“Add a fourth point about hiring”', '“Make the headings shorter”'],
  flow: ['“Add a review step before launch”', '“Turn this into a table”'],
  table: ['“Show the top 5 accounts by MRR”', '“Add a column for owner”'],
  statement: ['“Make this the ask: approve the budget”', '“Shorter, punchier”'],
  closing: ['“Add a next step to share with the board”', '“Three takeaways, not two”'],
};

/** A text field that changes the deck when it is left (or on Enter), not on every key. */
function CommitField({
  label,
  value,
  onCommit,
  multiline,
  placeholder,
  rows = 2,
  className,
  hint,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
  rows?: number;
  className?: string;
  hint?: string;
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
    <label className={`deck-field${className ? ` ${className}` : ''}`}>
      <span className="deck-field-label">{label}</span>
      {multiline ? (
        <textarea value={text} rows={rows} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={onKeyDown} spellCheck={!className?.includes('mono')} />
      ) : (
        <input value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={onKeyDown} />
      )}
      {hint && <small className="deck-field-hint">{hint}</small>}
    </label>
  );
}

function Section({ title, icon, children, aside }: { title: string; icon?: IconName; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="deck-section">
      <header className="deck-section-head">
        <h4>{icon && <Icon name={icon} size={16} />}{title}</h4>
        {aside}
      </header>
      <div className="deck-section-body">{children}</div>
    </section>
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

/** Metric inputs that keep each figure's binding (widget or query). */
const metricInputs = (ms: DeckMetric[]) => ms.map(({ widgetId, query, ...m }) => ({ ...m, ...(widgetId ? { widget_id: widgetId } : {}), ...(query ? { query } : {}) }));

type DataMode = 'own' | 'sql' | `widget:${string}`;

/** Where the data of a chart or table slide comes from: typed in, its own SQL, or a dashboard widget. */
function DataSourceField({
  slide,
  widgets,
  edit,
  defaultSource,
  forTable,
}: {
  slide: Slide;
  widgets: { id: string; title: string; kind: string }[];
  edit: (patch: SlideInput, label: string) => void;
  defaultSource: string;
  forTable?: boolean;
}) {
  const mode: DataMode = slide.query ? 'sql' : slide.widgetId ? `widget:${slide.widgetId}` : 'own';
  const [draftSql, setDraftSql] = useState(mode === 'sql');
  useEffect(() => setDraftSql(mode === 'sql'), [slide.id, mode]);
  const choices = widgets.filter((w) => (forTable ? w.kind === 'table' || w.kind !== 'kpi' : w.kind !== 'table'));
  return (
    <>
      <label className="deck-field">
        <span className="deck-field-label">Data</span>
        <select
          value={draftSql ? 'sql' : mode}
          onChange={(e) => {
            const v = e.target.value as DataMode;
            if (v === 'sql') setDraftSql(true);
            else if (v === 'own') {
              setDraftSql(false);
              if (mode !== 'own') edit({ sql: '', widget_id: '' }, forTable ? 'Table with its own data' : 'Chart with its own data');
            } else {
              setDraftSql(false);
              edit({ widget_id: v.slice(7), sql: '', ...(forTable ? {} : { chart: null }) }, forTable ? 'Table from a dashboard widget' : 'Chart from a dashboard widget');
            }
          }}
        >
          <option value="own">Typed in</option>
          <option value="sql">Live SQL query</option>
          {choices.map((w) => <option key={w.id} value={`widget:${w.id}`}>Dashboard: {w.title}</option>)}
        </select>
      </label>
      {draftSql && (
        <div className="deck-sql">
          <CommitField
            label="SQL"
            className="mono"
            multiline
            rows={5}
            value={slide.query?.sql ?? ''}
            placeholder={forTable ? 'SELECT account, region, mrr FROM … ORDER BY mrr DESC LIMIT 8' : 'SELECT region, SUM(mrr) AS mrr FROM … GROUP BY 1 ORDER BY 2 DESC'}
            hint={forTable ? 'Up to 6 columns and 8 rows. ⌘↵ runs it.' : 'A label column, then numeric columns. ⌘↵ runs it.'}
            onCommit={(v) => edit({ sql: v, data_source: slide.query?.source ?? defaultSource }, v.trim() ? 'Ran the slide query' : 'Removed the slide query')}
          />
          <p className="deck-sql-meta">
            <Icon name="database" size={14} /> {slide.query?.source ?? defaultSource}
            {slide.query && <span className="deck-live-pill"><span className="deck-live-dot" aria-hidden="true" />Live · re-runs on Sync</span>}
          </p>
        </div>
      )}
    </>
  );
}

function SlideInspector({
  slide,
  index,
  widgets,
  edit,
  defaultSource,
}: {
  slide: Slide;
  index: number;
  widgets: { id: string; title: string; kind: string }[];
  edit: (patch: SlideInput, label: string) => void;
  defaultSource: string;
}) {
  const layout = slide.layout;
  const lines = (v: string) => v.split('\n').map((l) => l.trim()).filter(Boolean);
  const showPoints = layout === 'points' || layout === 'flow' || layout === 'closing';
  const maxPoints = layout === 'flow' ? LIMITS.flowSteps : layout === 'closing' ? LIMITS.nextSteps : LIMITS.points;
  const chart = slide.chart;
  const singleSeries = chart != null && chart.series.length === 1;
  const metrics = slide.metrics ?? [];
  const setMetric = (i: number, patch: Record<string, unknown>, label: string) =>
    edit({ metrics: metricInputs(metrics).map((x, j) => (j === i ? { ...x, ...patch } : x)) }, label);

  return (
    <div className="deck-inspector-body">
      <Section title="Layout" icon="auto_awesome_mosaic">
        <div className="deck-layout-grid" role="radiogroup" aria-label="Slide layout">
          {SLIDE_LAYOUTS.map((l) => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={l === layout}
              className="deck-layout-tile"
              title={LAYOUT_INFO[l].hint}
              onClick={() => l !== layout && edit({ layout: l }, `Slide ${slide.id}: ${LAYOUT_INFO[l].label} layout`)}
            >
              <Icon name={LAYOUT_INFO[l].icon} size={18} />
              <span>{LAYOUT_INFO[l].label}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Words" icon="title">
        {layout !== 'title' && (
          <CommitField label="Kicker" value={slide.kicker ?? ''} placeholder="e.g. Revenue" onCommit={(v) => edit({ kicker: v }, 'Changed the kicker')} />
        )}
        <CommitField
          label="Title"
          hint={layout === 'title' || layout === 'section' ? undefined : 'The message of the slide, as a sentence.'}
          value={slide.title}
          multiline
          onCommit={(v) => edit({ title: v }, 'Changed the slide title')}
        />
        <CommitField label={layout === 'closing' ? 'Closing line' : 'Subtitle'} value={slide.subtitle ?? ''} onCommit={(v) => edit({ subtitle: v }, 'Changed the subtitle')} />
      </Section>

      {layout === 'kpis' && (
        <Section title="Metrics" icon="speed" aside={<span className="deck-section-count">{metrics.length}/{LIMITS.metrics}</span>}>
          {metrics.map((m, i) => (
            <div key={i} className="deck-card">
              <div className="deck-card-head">
                <span className="deck-card-num" aria-hidden="true">{i + 1}</span>
                {m.query && <span className="deck-live-pill"><span className="deck-live-dot" aria-hidden="true" />SQL</span>}
                {m.widgetId && <span className="deck-live-pill neutral">Dashboard</span>}
                <IconButton icon="delete" label={`Remove metric ${i + 1}`} className="deck-card-remove" onClick={() => edit({ metrics: metricInputs(metrics.filter((_, j) => j !== i)) }, 'Removed a metric')} />
              </div>
              <CommitField label="Label" value={m.label} onCommit={(v) => setMetric(i, { label: v }, 'Changed a metric')} />
              <div className="deck-pair">
                <CommitField label="Figure" value={m.value} onCommit={(v) => setMetric(i, { value: v, query: null, widget_id: undefined }, 'Changed a figure')} />
                <CommitField label="Change" value={m.delta ?? ''} placeholder="+12% vs Q2" onCommit={(v) => setMetric(i, { delta: v, trend: undefined }, 'Changed a metric change')} />
              </div>
              <details className="deck-disclosure" open={m.query != null}>
                <summary>Live figure from SQL</summary>
                <CommitField
                  label="SQL (first row)"
                  className="mono"
                  multiline
                  rows={3}
                  value={m.query?.sql ?? ''}
                  placeholder="SELECT SUM(mrr) FROM …"
                  onCommit={(v) => setMetric(i, { sql: v, data_source: m.query?.source ?? defaultSource, query: undefined }, v.trim() ? 'Ran the metric query' : 'Removed the metric query')}
                />
              </details>
            </div>
          ))}
          {metrics.length < LIMITS.metrics && (
            <button type="button" className="deck-add-row" onClick={() => edit({ metrics: [...metricInputs(metrics), { label: 'Metric', value: '—' }] }, 'Added a metric')}>
              <Icon name="add" size={16} /> Add a metric
            </button>
          )}
        </Section>
      )}

      {layout === 'chart' && (
        <Section title="Chart" icon="bar_chart">
          <DataSourceField slide={slide} widgets={widgets} edit={edit} defaultSource={defaultSource} />
          {chart && (
            <div className="deck-field">
              <span className="deck-field-label" id={`chart-type-${slide.id}`}>Type</span>
              <div className="deck-segmented" role="radiogroup" aria-labelledby={`chart-type-${slide.id}`}>
                {DECK_CHART_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={chart.type === t}
                    title={CHART_INFO[t].label}
                    onClick={() => chart.type !== t && edit({ chart: { type: t } }, `Changed the chart to ${CHART_INFO[t].label.toLowerCase()}`)}
                  >
                    <Icon name={CHART_INFO[t].icon} size={18} className={CHART_INFO[t].className} />
                    <span>{CHART_INFO[t].label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {chart && singleSeries && !slide.widgetId && !slide.query && (
            <CommitField
              label="Values"
              hint="One “label, value” per line."
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
          {chart && !singleSeries && !slide.widgetId && !slide.query && <p className="deck-hint">{chart.series.length} series: ask by voice to change the data.</p>}
          {chart && singleSeries && (chart.type === 'bar' || chart.type === 'column') && (
            <label className="deck-field">
              <span className="deck-field-label">Highlight</span>
              <select
                value={chart.highlight ?? -1}
                onChange={(e) => edit({ chart: { ...(slide.query || slide.widgetId ? { type: chart.type } : chart), highlight_index: Number(e.target.value) < 0 ? undefined : Number(e.target.value) } }, 'Changed the highlighted bar')}
              >
                <option value={-1}>None</option>
                {chart.categories.map((c, i) => <option key={i} value={i}>{c}</option>)}
              </select>
            </label>
          )}
        </Section>
      )}

      {(layout === 'chart' || layout === 'kpis' || layout === 'closing') && (
        <Section title="Takeaways" icon="lightbulb">
          <CommitField
            label="One per line"
            multiline
            rows={layout === 'closing' ? 4 : 3}
            value={(slide.takeaways ?? []).join('\n')}
            onCommit={(v) => edit({ takeaways: lines(v) }, 'Changed the takeaways')}
          />
        </Section>
      )}

      {showPoints && (
        <Section
          title={layout === 'flow' ? 'Steps' : layout === 'closing' ? 'Next steps' : 'Points'}
          icon={layout === 'flow' ? 'arrow_forward' : 'grid_view'}
          aside={<span className="deck-section-count">{slide.points?.length ?? 0}/{maxPoints}</span>}
        >
          {(slide.points ?? []).map((p, i) => (
            <div key={i} className="deck-card">
              <div className="deck-card-head">
                <span className="deck-card-num" aria-hidden="true">{i + 1}</span>
                <IconButton icon="delete" label={`Remove ${layout === 'flow' ? 'step' : 'point'} ${i + 1}`} className="deck-card-remove" onClick={() => edit({ points: (slide.points ?? []).filter((_, j) => j !== i) }, 'Removed a point')} />
              </div>
              <CommitField label={layout === 'flow' ? 'Step' : 'Heading'} value={p.title} onCommit={(v) => edit({ points: (slide.points ?? []).map((x, j) => (j === i ? { ...x, title: v } : x)) }, 'Changed a point')} />
              <CommitField label="Text" value={p.text ?? ''} multiline onCommit={(v) => edit({ points: (slide.points ?? []).map((x, j) => (j === i ? { ...x, text: v } : x)) }, 'Changed a point')} />
            </div>
          ))}
          {(slide.points?.length ?? 0) < maxPoints && (
            <button type="button" className="deck-add-row" onClick={() => edit({ points: [...(slide.points ?? []), { title: layout === 'flow' ? 'New step' : 'New point' }] }, 'Added a point')}>
              <Icon name="add" size={16} /> Add a {layout === 'flow' ? 'step' : layout === 'closing' ? 'next step' : 'point'}
            </button>
          )}
        </Section>
      )}

      {layout === 'table' && (
        <Section title="Table" icon="table_chart">
          <DataSourceField slide={slide} widgets={widgets} edit={edit} defaultSource={defaultSource} forTable />
          {!slide.query && !slide.widgetId && (
            <>
              <CommitField label="Columns" hint="Separated by |" value={(slide.columns ?? []).join(' | ')} onCommit={(v) => edit({ columns: v.split('|').map((c) => c.trim()).filter(Boolean) }, 'Changed the table columns')} />
              <CommitField
                label="Rows"
                hint="One per line, cells separated by |"
                multiline
                rows={6}
                value={(slide.rows ?? []).map((r) => r.join(' | ')).join('\n')}
                onCommit={(v) => edit({ columns: slide.columns, rows: lines(v).map((l) => l.split('|').map((c) => c.trim())) }, 'Changed the table rows')}
              />
            </>
          )}
        </Section>
      )}

      <Section title="Footer" icon="subtitles">
        <CommitField label="Source line" value={slide.source ?? ''} placeholder="Source: …" onCommit={(v) => edit({ source: v }, 'Changed the source line')} />
      </Section>

      <aside className="deck-voice-card" aria-label="Edit by voice">
        <p className="deck-voice-title"><Icon name="mic" size={16} /> Or just say it</p>
        <ul>
          {VOICE_TRY[layout].map((t) => <li key={t}>{t.replace('this', `slide ${index + 1}`)}</li>)}
        </ul>
      </aside>
    </div>
  );
}

/** Picks the deck theme, showing each theme's colors. */
function ThemePicker({ theme, onPick }: { theme: DeckThemeName; onPick: (t: DeckThemeName) => void }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  usePopoverMenu({ open, onOpenChange: setOpen, menuRef: menu, triggerRef: trigger, placement: 'bottom-start' });
  const swatch = (t: DeckThemeName) => {
    const th = THEMES[t];
    return (
      <span className="deck-swatch" aria-hidden="true">
        <i style={{ background: `#${th.dark}` }} />
        <i style={{ background: `#${th.primary}` }} />
        <i style={{ background: `#${th.pop}` }} />
        <i style={{ background: `#${th.soft}` }} />
      </span>
    );
  };
  return (
    <div className="menu-anchor">
      <button ref={trigger} type="button" className="deck-theme-btn" aria-haspopup="menu" aria-expanded={open} aria-label={`Theme: ${THEMES[theme].label}`} onClick={() => setOpen((v) => !v)}>
        {swatch(theme)}
        <span>{THEMES[theme].label}</span>
        <Icon name="keyboard_arrow_down" size={18} />
      </button>
      <div ref={menu} popover="auto" className="menu menu-popover deck-theme-menu" role="menu" aria-label="Deck theme">
        {DECK_THEMES.map((t) => (
          <button key={t} type="button" role="menuitemradio" aria-checked={t === theme} onClick={() => { setOpen(false); if (t !== theme) onPick(t); }}>
            {swatch(t)}
            <span>{THEMES[t].label}</span>
            {t === theme && <Icon name="check" size={18} className="deck-theme-check" />}
          </button>
        ))}
      </div>
    </div>
  );
}

function useSize<T extends HTMLElement>(dep: unknown): [React.RefObject<T | null>, { w: number; h: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [dep]);
  return [ref, size];
}

const readPref = (key: string, fallback: boolean) => {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : v === '1';
  } catch {
    return fallback;
  }
};
const writePref = (key: string, v: boolean) => {
  try {
    localStorage.setItem(key, v ? '1' : '0');
  } catch {
    // storage blocked: the preference lasts for this view only
  }
};

/** How long the notes take to say, at a presenter's pace (~130 words a minute). */
function speakingTime(notes: string | undefined): string | null {
  const words = (notes ?? '').trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return null;
  const s = Math.max(5, Math.round((words / 130) * 60 / 5) * 5);
  return s < 60 ? `~${s} s` : `~${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ''}`;
}

export function DeckView({ dashboardResults, command }: { dashboardResults?: Results; command?: DeckCommand | null }) {
  const { store, notify, googleClientId } = useStudio();
  const revision = useStoreRevision(store);
  const scene = store.scene;
  const deck = scene.deck;
  const [current, setCurrent] = useState(0);
  const [presenting, setPresenting] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1280);
  const [notesOpen, setNotesOpen] = useState(() => readPref('deck.notesOpen', true));
  const [busy, setBusy] = useState<null | 'build' | 'sync' | 'query'>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const addTrigger = useRef<HTMLButtonElement>(null);
  const addMenu = useRef<HTMLDivElement>(null);
  const exportTrigger = useRef<HTMLButtonElement>(null);
  const exportMenu = useRef<HTMLDivElement>(null);
  usePopoverMenu({ open: addOpen, onOpenChange: setAddOpen, menuRef: addMenu, triggerRef: addTrigger, placement: 'bottom-start' });
  usePopoverMenu({ open: exportOpen, onOpenChange: setExportOpen, menuRef: exportMenu, triggerRef: exportTrigger, placement: 'bottom-end' });
  const [stageRef, stage] = useSize<HTMLDivElement>(deck != null);
  const railRef = useRef<HTMLOListElement>(null);
  const [railBox, rail] = useSize<HTMLElement>(deck != null);
  // Thumbnails fill the rail's width; on a phone the rail is a row of small ones
  const thumbW = rail.w === 0 ? 200 : rail.w > 320 ? 128 : Math.max(120, rail.w - 28);

  const count = deck?.slides.length ?? 0;
  const index = Math.max(0, Math.min(count - 1, current));
  const slide = deck?.slides[index];
  const canBuild = hasDashboard(scene) || hasDiagram(scene) || scene.blocks.length > 0;
  const defaultSource = scene.dashboard?.defaultSource ?? 'local';
  const chartWidgets = useMemo(
    () => (scene.dashboard?.widgets ?? []).filter((w) => w.kind !== 'kpi').map((w) => ({ id: w.id, title: w.title, kind: w.kind })),
    [scene.dashboard],
  );
  const widgetBound = deck?.slides.some((s) => s.widgetId != null || s.metrics?.some((m) => m.widgetId != null)) ?? false;
  const queryBound = deck?.slides.some((s) => s.query != null || s.metrics?.some((m) => m.query != null)) ?? false;
  const canSync = queryBound || (widgetBound && hasDashboard(scene));

  // The slides the latest change touched, and whether it came from the voice agent
  const recent = useMemo(() => {
    const lc = store.lastChange;
    const entry = store.history[store.historyIndex];
    if (!lc || !deck || Date.now() - lc.time > 4000) return null;
    const ids = new Set([...lc.changes.addedSlides, ...lc.changes.updatedSlides]);
    // The user's own edits are where they are looking; a voice change is shown where it landed
    if (ids.size === 0 || entry == null || entry.source === 'manual') return null;
    return { ids, voice: true, label: entry.label, time: lc.time };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);
  const [pulse, setPulse] = useState<typeof recent>(null);
  useEffect(() => {
    if (!recent) return;
    setPulse(recent);
    const t = window.setTimeout(() => setPulse(null), 2600);
    return () => window.clearTimeout(t);
  }, [recent]);

  useEffect(() => preloadDeckExport(googleClientId != null), [googleClientId]);

  /** The dashboard's results: those on screen, or run now. */
  const results = useCallback(async (): Promise<Results | undefined> => {
    const d = store.scene.dashboard;
    if (d == null) return undefined;
    if (dashboardResults && d.widgets.every((w) => dashboardResults[w.id] != null)) return dashboardResults;
    const { computeDashboardResults } = await import('../../agent/dispatcher');
    return computeDashboardResults(d);
  }, [store, dashboardResults]);

  const edit = useCallback(async (req: EditDeckRequest, label: string, withResults = false): Promise<EditResult | null> => {
    const { prepareDeckQueries, runDeckQueries } = await import('../../agent/deckQueries');
    const queries = prepareDeckQueries(req, store.scene.dashboard?.defaultSource ?? 'local');
    let queryResults;
    if (queries.length > 0) {
      setBusy('query');
      try {
        const run = await runDeckQueries(queries, store.scene.dashboard);
        if (run.errors.length > 0) {
          notify(run.errors.join(' '));
          return null;
        }
        queryResults = run.results;
      } finally {
        setBusy(null);
      }
    }
    const res = store.editDeck(req, { source: 'manual', label }, withResults ? await results() : undefined, queryResults);
    if (!res.ok) notify(res.errors.join(' '));
    else if (res.warnings.length > 0 && queries.length > 0) notify(res.warnings[0]);
    return res;
  }, [store, notify, results]);

  const editSlide = useCallback((patch: SlideInput, label: string) => {
    if (!slide) return;
    void edit({ update_slides: [{ ...patch, id: slide.id }] }, label, patch.widget_id != null && patch.widget_id !== '');
  }, [edit, slide]);

  const build = async () => {
    setBusy('build');
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
      setBusy(null);
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
    const d = store.scene.deck;
    if (!d) return;
    setBusy('sync');
    try {
      const { rerunDeckQueries } = await import('../../agent/deckQueries');
      const [r, run] = await Promise.all([results(), rerunDeckQueries(d, store.scene.dashboard)]);
      const res = store.syncDeck(r ?? {}, { source: 'manual', label: 'Synced the deck with its data' }, run.results);
      const updated = res.changes.updatedSlides.length;
      notify(run.errors[0] ?? res.notes[0] ?? `Updated the numbers on ${updated} ${updated === 1 ? 'slide' : 'slides'}.`);
    } finally {
      setBusy(null);
    }
  };

  const addSlide = (layout: SlideLayout) => {
    if (!deck) return;
    setAddOpen(false);
    const after = deck.slides[index]?.layout === 'closing' && index > 0 ? deck.slides[index - 1].id : deck.slides[index]?.id;
    const tpl = templateSlide(layout, deck, chartWidgets.find((w) => w.kind !== 'table')?.id);
    void edit({ add_slides: [{ ...tpl, after }] }, `Added a ${LAYOUT_INFO[layout].label.toLowerCase()} slide`, tpl.widget_id != null).then((res) => {
      const id = res?.ok ? res.changes.addedSlides[0] : undefined;
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
    const { id: _id, widgetId, metrics, chart, query, ...rest } = s;
    void edit({
      add_slides: [{
        ...rest,
        after: s.id,
        ...(widgetId ? { widget_id: widgetId } : {}),
        ...(query ? { query } : {}),
        ...(metrics ? { metrics: metricInputs(metrics) } : {}),
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

  const toggleNotes = () => {
    setNotesOpen((v) => {
      writePref('deck.notesOpen', !v);
      return !v;
    });
  };

  if (!deck || !slide) {
    const parts: { icon: IconName; text: string }[] = [
      { icon: 'title', text: 'Title and executive summary' },
      { icon: 'speed', text: 'Headline metrics from live SQL' },
      { icon: 'bar_chart', text: 'One chart per finding, titled with what it shows' },
      { icon: 'arrow_forward', text: 'The architecture flow' },
      { icon: 'check_circle', text: 'Takeaways, next steps and speaker notes' },
    ];
    return (
      <section className="surface-empty-view deck-empty">
        <div className="surface-empty-card deck-empty-card">
          <div className="deck-empty-art" aria-hidden="true">
            <span className="deck-empty-sheet back" />
            <span className="deck-empty-sheet mid" />
            <span className="deck-empty-sheet front"><Icon name="slideshow" size={30} /></span>
          </div>
          <h2>Turn this page into a presentation</h2>
          <p>A professional deck in seconds, every figure from its SQL query. Present it here, or export it to PowerPoint or Google Slides.</p>
          <ul className="deck-empty-list">
            {parts.map((p) => <li key={p.text}><Icon name={p.icon} size={18} />{p.text}</li>)}
          </ul>
          <div className="surface-empty-actions">
            <button type="button" className="filled-btn" disabled={!canBuild || busy != null} onClick={() => void build()}>
              <Icon name="slideshow" size={18} /> Build deck from this page
            </button>
            <button type="button" className="tonal-btn" onClick={blank}>
              <Icon name="add" size={18} /> Start a blank deck
            </button>
          </div>
          <p className="deck-empty-voice">
            <Icon name="mic" size={16} />
            {canBuild ? <span>Or say “make a deck of this page”.</span> : <span>Nothing to build from yet: start blank, or say “make a 6-slide pitch about …”.</span>}
          </p>
        </div>
      </section>
    );
  }

  // The slide fits the stage both ways (the bar under it included)
  const slideW = Math.max(200, Math.min(stage.w - 56, ((stage.h - 76) * SLIDE_PX.w) / SLIDE_PX.h));
  const live = pulse != null && pulse.ids.has(slide.id);
  const talk = speakingTime(slide.notes);

  return (
    <div className={`deck-view${inspectorOpen ? ' with-inspector' : ''}`} aria-busy={busy != null}>
      <header className="deck-toolbar">
        <div className="deck-toolbar-left">
          <ThemePicker theme={deck.theme} onPick={(t) => void edit({ theme: t }, `Theme: ${THEMES[t].label}`)} />
          <span className="deck-count">{count} {count === 1 ? 'slide' : 'slides'}</span>
          {busy && (
            <span className="deck-busy" role="status">
              <span className="deck-spinner" aria-hidden="true" />
              {busy === 'build' ? 'Building…' : busy === 'sync' ? 'Syncing…' : 'Running the query…'}
            </span>
          )}
        </div>
        <div className="deck-toolbar-right">
          {canSync && (
            <button type="button" className="text-btn small" disabled={busy != null} onClick={() => void sync()} title="Run every query again and refresh the numbers; your words stay">
              <Icon name="refresh" size={16} /> <span className="deck-btn-label">Sync data</span>
            </button>
          )}
          {canBuild && (
            <button type="button" className="text-btn small" disabled={busy != null} onClick={() => void build()} title="Build the deck again from the page (undo brings this one back)">
              <Icon name="auto_awesome_mosaic" size={16} /> <span className="deck-btn-label">Rebuild</span>
            </button>
          )}
          <span className="deck-toolbar-sep" aria-hidden="true" />
          <button
            type="button"
            className={`tonal-btn small${inspectorOpen ? ' active' : ''}`}
            aria-expanded={inspectorOpen}
            aria-controls="deck-inspector"
            onClick={() => setInspectorOpen((v) => !v)}
          >
            <Icon name="tune" size={16} /> <span className="deck-btn-label">Edit slide</span>
          </button>
          <div className="menu-anchor">
            <button ref={exportTrigger} type="button" className="tonal-btn small" aria-haspopup="menu" aria-expanded={exportOpen} onClick={() => setExportOpen((v) => !v)}>
              <Icon name="download" size={16} /> <span className="deck-btn-label">Export</span>
            </button>
            <div ref={exportMenu} popover="auto" className="menu menu-popover menu-end" role="menu" aria-label="Export the deck">
              <button type="button" role="menuitem" onClick={() => { setExportOpen(false); void downloadDeckPptx(deck, notify); }}>
                <Icon name="slideshow" size={20} />
                <span>PowerPoint (.pptx)<small>Editable slides, native charts, speaker notes</small></span>
              </button>
              <button type="button" role="menuitem" onClick={() => { setExportOpen(false); void openDeckInGoogleSlides(deck, googleClientId, notify); }}>
                <Icon name="add_to_drive" size={20} />
                <span>Google Slides<small>{googleClientId ? 'Native slides, linked charts, speaker notes, in your Drive' : 'Needs GOOGLE_CLIENT_ID on the studio server'}</small></span>
              </button>
            </div>
          </div>
          <button type="button" className="filled-btn small" onClick={() => setPresenting(true)}>
            <Icon name="co_present" size={16} /> <span className="deck-btn-label">Present</span>
          </button>
        </div>
      </header>

      <div className="deck-main">
        <nav ref={railBox} className="deck-rail" aria-label="Slides">
          <ol ref={railRef}>
            {deck.slides.map((s, i) => (
              <li key={s.id} className={`${i === index ? 'current' : ''}${pulse?.ids.has(s.id) ? ' just-changed' : ''}`.trim() || undefined}>
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
                  <SlideCanvas deck={deck} index={i} width={thumbW} />
                  <span className="deck-thumb-num" aria-hidden="true">{i + 1}</span>
                  {(s.query || s.metrics?.some((m) => m.query)) && <span className="deck-thumb-live" aria-hidden="true" title="Live SQL"><span className="deck-live-dot" /></span>}
                </button>
                <div className="deck-thumb-actions" role="toolbar" aria-label={`Slide ${i + 1} actions`}>
                  <IconButton icon="keyboard_arrow_up" label="Move up (Alt+↑)" disabled={i === 0} onClick={() => move(i, i - 1)} />
                  <IconButton icon="keyboard_arrow_down" label="Move down (Alt+↓)" disabled={i === count - 1} onClick={() => move(i, i + 1)} />
                  <IconButton icon="content_copy" label="Duplicate" onClick={() => duplicate(i)} />
                  <IconButton icon="delete" label="Remove slide" disabled={count <= 1} onClick={() => remove(i)} />
                </div>
              </li>
            ))}
          </ol>
          <div className="menu-anchor deck-add">
            <button ref={addTrigger} type="button" className="deck-add-btn" aria-haspopup="menu" aria-expanded={addOpen} onClick={() => setAddOpen((v) => !v)}>
              <Icon name="add" size={18} /> Add slide
            </button>
            <div ref={addMenu} popover="auto" className="menu menu-popover deck-add-menu" role="menu" aria-label="Add a slide">
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
            <div className="deck-stage-inner">
              {stage.w > 0 && (
                <div className={`deck-stage-frame${live ? ' just-changed' : ''}`} key={live ? `live-${pulse?.time}` : 'still'}>
                  <SlideCanvas deck={deck} index={index} width={slideW} className="deck-stage-slide" />
                  {live && pulse?.voice && (
                    <span className="deck-voice-badge" role="status">
                      <Icon name="graphic_eq" size={14} /> {pulse.label || 'Updated by voice'}
                    </span>
                  )}
                </div>
              )}
              <div className="deck-stage-bar" style={{ width: stage.w > 0 ? slideW : undefined }}>
                <span className="deck-layout-chip">
                  <Icon name={LAYOUT_INFO[slide.layout].icon} size={14} /> {LAYOUT_INFO[slide.layout].label}
                  {slide.query && <span className="deck-live-pill"><span className="deck-live-dot" aria-hidden="true" />Live SQL</span>}
                  {slide.widgetId && <span className="deck-live-pill neutral"><Icon name="dashboard" size={12} />Dashboard</span>}
                </span>
                <span className="deck-pager">
                  <IconButton icon="chevron_left" label="Previous slide" disabled={index === 0} onClick={() => setCurrent(index - 1)} />
                  <span className="deck-pager-count" aria-live="polite">{index + 1} <span>/ {count}</span></span>
                  <IconButton icon="chevron_right" label="Next slide" disabled={index >= count - 1} onClick={() => setCurrent(index + 1)} />
                </span>
              </div>
            </div>
          </div>
          <div className={`deck-notes${notesOpen ? ' open' : ''}`}>
            <button type="button" className="deck-notes-head" aria-expanded={notesOpen} aria-controls="deck-notes-body" onClick={toggleNotes}>
              <Icon name="speaker_notes" size={16} />
              <span>Speaker notes</span>
              {talk && <span className="deck-notes-time">{talk}</span>}
              <Icon name={notesOpen ? 'keyboard_arrow_down' : 'keyboard_arrow_up'} size={18} className="deck-notes-caret" />
            </button>
            {notesOpen && (
              <div id="deck-notes-body" className="deck-notes-body">
                <CommitField
                  label={`Notes for slide ${index + 1}`}
                  value={slide.notes ?? ''}
                  multiline
                  rows={3}
                  placeholder="What to say on this slide…"
                  onCommit={(v) => editSlide({ notes: v }, 'Changed the speaker notes')}
                />
              </div>
            )}
          </div>
        </section>

        {inspectorOpen && <div className="deck-inspector-scrim" aria-hidden="true" onClick={() => setInspectorOpen(false)} />}
        <aside id="deck-inspector" className={`deck-inspector${inspectorOpen ? ' open' : ''}`} aria-label="Slide fields" hidden={!inspectorOpen}>
          <div className="deck-inspector-head">
            <div>
              <p className="deck-inspector-eyebrow">Slide {index + 1} of {count}</p>
              <h3>{LAYOUT_INFO[slide.layout].label}</h3>
            </div>
            <IconButton icon="close" label="Close" onClick={() => setInspectorOpen(false)} />
          </div>
          <SlideInspector key={slide.id} slide={slide} index={index} widgets={chartWidgets} edit={editSlide} defaultSource={defaultSource} />
        </aside>
      </div>

      {presenting && <PresentMode deck={deck} index={index} setIndex={setCurrent} onExit={() => setPresenting(false)} />}
    </div>
  );
}
