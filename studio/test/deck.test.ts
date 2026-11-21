import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { uploadPptxAsSlides } from '../src/deck-export/googleSlides';
import { deckToPptxBytes } from '../src/deck-export/pptx';
import {
  DECK_THEMES,
  SLIDE_LAYOUTS,
  buildDeck,
  chartInsight,
  deckFromMotion,
  normalizeDeck,
  syncDeckData,
  type DeckSpec,
  type SlideInput,
} from '../src/engine/deck';
import { SLIDE_H, SLIDE_W, THEMES, chartNumberFormat, formatChartValue, glyphWidth, layoutSlide, textHeight } from '../src/engine/deckLayout';
import { emptyScene } from '../src/engine/types';
import { Workspace } from '../src/engine/workspace';
import { pagesFromJson } from '../src/ui/export';

const ALL_LAYOUTS: SlideInput[] = [
  { layout: 'title', kicker: 'Board meeting', title: 'Revenue & Retention Review for the Second Half of 2026', subtitle: 'What grew, what slipped, and what we ask for' },
  { layout: 'section', title: 'Where we stand', subtitle: 'The numbers first' },
  {
    layout: 'kpis',
    kicker: 'Headline metrics',
    title: 'MRR reached $674.3K while retention held above 117%',
    metrics: [
      { label: 'Monthly recurring revenue', value: '$674.3K', delta: '+17.6% vs H1', trend: 'up', note: 'October 2026' },
      { label: 'Net dollar retention', value: '117.6%', delta: '+1.2 pts', trend: 'up' },
      { label: 'Churned logos', value: '14', delta: '-3 vs Q2', trend: 'down' },
      { label: 'Active customers', value: '1,689' },
    ],
    takeaways: ['Expansion revenue drives two thirds of the growth', 'Churn is concentrated in accounts younger than 90 days'],
  },
  {
    layout: 'chart',
    kicker: 'Regions',
    title: 'North America leads MRR at $291.4K, 43% of the total',
    chart: { type: 'bar', categories: ['North America', 'EMEA', 'APAC', 'LATAM'], series: [{ name: 'MRR', values: [291379, 209085, 124108, 49709] }], format: 'currency_usd', highlight_index: 0 },
    takeaways: ['EMEA follows at $209.1K', 'The top 3 make up 93% of the total', 'North America is 5.9× LATAM, the smallest at $49.7K'],
    source: 'Source: MRR by Region · studio SQL query',
  },
  {
    layout: 'chart',
    title: 'MRR rose 65% over twelve months',
    chart: { type: 'line', categories: ['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'], series: [{ name: 'MRR', values: [409, 445, 444, 463, 483, 503, 524, 546, 595, 594, 619, 674] }] },
  },
  { layout: 'chart', title: 'Production carries 80% of spend', chart: { type: 'donut', categories: ['Production', 'Staging', 'Dev'], series: [{ name: 'Spend', values: [80, 15, 5] }], format: 'percent' } },
  { layout: 'chart', title: 'Plans by region', chart: { type: 'stacked_column', categories: ['NA', 'EMEA'], series: [{ name: 'Pro', values: [5, 3] }, { name: 'Enterprise', values: [7, 4] }] } },
  {
    layout: 'points',
    title: 'Four moves for the second half',
    points: [
      { title: 'Expand EMEA', text: 'Hire two account executives in DACH to follow the strongest regional growth.' },
      { title: 'Price for seats', text: 'Move enterprise plans to seat bands.' },
      { title: 'Cut churn', text: 'Launch a health score for accounts under 90 days.' },
      { title: 'Instrument usage', text: 'Ship product analytics to BigQuery for weekly reviews.' },
    ],
  },
  { layout: 'points', title: 'Three options', points: [{ title: 'Build', text: 'Own it.' }, { title: 'Buy', text: 'Faster.' }, { title: 'Partner', text: 'Shared risk.' }] },
  { layout: 'flow', title: 'From event to insight in four steps', points: [{ title: 'Web app', text: 'React' }, { title: 'Pub/Sub', text: 'Events' }, { title: 'Dataflow', text: 'Streaming ETL' }, { title: 'BigQuery', text: 'Warehouse' }] },
  { layout: 'table', title: 'Top accounts', columns: ['Account', 'Region', 'ARR'], rows: [['Apex Cloud', 'NA', '$480.0K'], ['NordicFin', 'EMEA', '$415.0K']] },
  { layout: 'statement', kicker: 'The ask', title: 'Fund the EMEA expansion team now to keep retention above 115% through H2', subtitle: 'Decision needed by December 15' },
  { layout: 'closing', title: 'What this means', takeaways: ['Growth is broad-based', 'Retention is the lever'], points: [{ title: 'Approve hiring', text: 'by Dec 15' }] },
];

function sampleDeck(theme: DeckSpec['theme'] = 'midnight'): DeckSpec {
  const res = buildDeck({ title: 'Review', theme, author: 'Revenue Ops', slides: ALL_LAYOUTS.map((s) => ({ ...s, notes: `Say: ${s.title}` })) }, { date: 'November 2026' });
  expect(res.ok).toBe(true);
  return res.deck;
}

describe('Deck layout', () => {
  it('keeps every element of every layout and theme on the slide, with readable text', () => {
    for (const theme of DECK_THEMES) {
      const deck = sampleDeck(theme);
      expect(new Set(deck.slides.map((s) => s.layout))).toEqual(new Set(SLIDE_LAYOUTS));
      deck.slides.forEach((s, i) => {
        const frame = layoutSlide(deck, i);
        for (const el of frame.elements) {
          if (el.name.startsWith('Decor')) continue;
          const where = `${theme} slide ${i + 1} (${s.layout}) ${el.name}`;
          expect(el.x, where).toBeGreaterThanOrEqual(0.5);
          expect(el.y, where).toBeGreaterThanOrEqual(0.4);
          expect(el.x + el.w, where).toBeLessThanOrEqual(SLIDE_W - 0.5 + 1e-6);
          expect(el.y + el.h, where).toBeLessThanOrEqual(SLIDE_H - 0.15 + 1e-6);
          if (el.kind === 'text') {
            expect(el.size, where).toBeGreaterThanOrEqual(10);
            if (!el.name.startsWith('Source') && !el.name.includes('label')) {
              // The estimated text fits its box (the fitter's job)
              const gw = glyphWidth(el.font, THEMES[theme], el.bold === true);
              const h = textHeight(el.paras.map((p) => p.runs.map((r) => r.text).join('')), el.w, el.size, gw, el.lineSpacing ?? 1, el.paraSpaceAfter ?? 0);
              expect(h, where).toBeLessThanOrEqual(el.h + 0.05);
            }
          }
        }
        // Content titles share one position
        const title = frame.elements.find((e) => e.kind === 'text' && e.role === 'title');
        expect(title, `slide ${i + 1} has a title`).toBeTruthy();
      });
      const contentTitles = deck.slides
        .map((s, i) => ({ s, t: layoutSlide(deck, i).elements.find((e) => e.kind === 'text' && e.role === 'title')! }))
        .filter(({ s }) => ['kpis', 'chart', 'points', 'flow', 'table'].includes(s.layout));
      expect(new Set(contentTitles.map(({ t }) => `${t.x},${t.y}`)).size).toBe(1);
    }
  });

  it('formats chart labels like the PowerPoint number format', () => {
    const usd = { format: 'currency_usd' as const, series: [{ name: 'a', values: [291379, 49709] }] };
    expect(chartNumberFormat(usd)).toBe('$#,##0.0,"K"');
    expect(formatChartValue(291379, usd)).toBe('$291.4K');
    const big = { format: 'currency_eur' as const, series: [{ name: 'a', values: [2_500_000] }] };
    expect(chartNumberFormat(big)).toBe('"€"#,##0.0,,"M"');
    expect(formatChartValue(2_500_000, big)).toBe('€2.5M');
    expect(formatChartValue(116.7, { format: 'percent', series: [] })).toBe('116.7%');
    expect(formatChartValue(1689, { series: [{ name: 'a', values: [1689] }] })).toBe('1,689');
  });

  it('writes chart titles that say what the chart shows', () => {
    const ranking = chartInsight('MRR by Region', { type: 'bar', categories: ['NA', 'EMEA', 'APAC', 'LATAM'], series: [{ name: 'MRR', values: [300, 200, 100, 50] }], format: 'currency_usd' });
    expect(ranking.headline).toBe('NA leads MRR by Region at $300, 46% of the total');
    expect(ranking.takeaways[0]).toBe('EMEA follows at $200');
    const trend = chartInsight('Monthly MRR', { type: 'line', categories: ['Jan', 'Feb', 'Mar'], series: [{ name: 'MRR', values: [100, 90, 150] }] });
    expect(trend.headline).toBe('Monthly MRR rose 50% from Jan to Mar');
    const rate = chartInsight('Win rate', { type: 'line', categories: ['Q1', 'Q2'], series: [{ name: 'Rate', values: [20, 25.5] }], format: 'percent' });
    expect(rate.headline).toBe('Win rate rose 5.5 points to 25.5%');
  });
});

describe('PowerPoint export', () => {
  it('writes a structured, editable .pptx: real titles, native charts and tables, notes, no folder entries', async () => {
    const deck = sampleDeck('forest');
    const bytes = await deckToPptxBytes(deck);
    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files);
    expect(names.some((n) => zip.files[n].dir)).toBe(false);
    expect(names[0]).toBe('[Content_Types].xml');
    const slides = names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    expect(slides).toHaveLength(deck.slides.length);
    expect(names.filter((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n))).toHaveLength(4);
    expect(names.filter((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n))).toHaveLength(deck.slides.length);
    const layouts = names.filter((n) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(n));
    expect(layouts.length).toBeGreaterThanOrEqual(SLIDE_LAYOUTS.length);

    const slide4 = await zip.file('ppt/slides/slide4.xml')!.async('string');
    // The title is a title placeholder, so the outline and Google Slides see it
    expect(slide4).toMatch(/<p:ph[^>]*type="title"/);
    expect(slide4).toContain('North America leads MRR at $291.4K');
    expect(slide4).not.toMatch(/srgbClr val="#/);
    const table = await zip.file('ppt/slides/slide11.xml')!.async('string');
    expect(table).toContain('<a:tbl>');
    expect(table).toContain('Apex Cloud');
    const presentation = await zip.file('ppt/presentation.xml')!.async('string');
    expect(presentation).toContain('cx="12192000"');
    expect(presentation).toMatch(/Introduction|Findings|Conclusion/);
    const theme = await zip.file('ppt/theme/theme1.xml')!.async('string');
    expect(theme).toContain('Georgia');
  });
});

describe('Earlier versions', () => {
  const motion = {
    title: 'FinOps Reel',
    aspectRatio: '16:9',
    scenes: [
      { id: 'intro', title: 'Hook', narration: 'Spend is down.', layers: [{ kind: 'badge', text: 'LIVE' }, { kind: 'kinetic_text', text: 'Cloud spend fell 12%', subtext: 'Q3 2026' }] },
      { id: 'kpis', title: 'KPIs', layers: [{ kind: 'metric_counter', text: 'Monthly spend', value: 182.4, prefix: '$', suffix: 'K', decimals: 1, deltaText: '-12%' }] },
      { id: 'chart', title: 'By service', layers: [{ kind: 'motion_chart', chartType: 'bar', series: [{ label: 'BigQuery', value: 80 }, { label: 'GKE', value: 60 }] }] },
      { id: 'flow', title: 'Flow', layers: [{ kind: 'flow_diagram', flowNodes: [{ id: 'a', label: 'Billing export' }, { id: 'b', label: 'BigQuery' }] }] },
    ],
  };

  it('opens a saved Motion explainer as a deck', () => {
    const deck = deckFromMotion(motion)!;
    expect(deck.slides.map((s) => s.layout)).toEqual(['title', 'kpis', 'chart', 'flow']);
    expect(deck.slides[0].title).toBe('Cloud spend fell 12%');
    expect(deck.slides[0].notes).toBe('Spend is down.');
    expect(deck.slides[1].metrics?.[0]).toMatchObject({ label: 'Monthly spend', value: '$182.4K', delta: '-12%', trend: 'down' });
    expect(deck.slides[2].chart?.categories).toEqual(['BigQuery', 'GKE']);
  });

  it('migrates pages and the motion view of a saved workspace', () => {
    const pages = pagesFromJson(JSON.stringify({ version: 1, pages: [{ ...emptyScene(), title: 'Ops', motion }] }));
    expect(pages?.[0].deck?.slides).toHaveLength(4);
    const ws = new Workspace({ version: 2, pages: [{ id: 'page_1', scene: pages![0], view: 'motion' as never }], active: 'page_1', library: [] });
    expect(ws.view).toBe('deck');
  });

  it('normalizes a stored deck and drops what does not fit', () => {
    const d = normalizeDeck({ title: 'X', theme: 'unknown', slides: [{ layout: 'chart', title: 'T', chart: { type: 'donut', categories: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], series: [{ name: 'v', values: [1, 2, 3, 4, 5, 6, 7] }] } }] })!;
    expect(d.theme).toBe('midnight');
    expect(d.slides[0].chart?.categories).toHaveLength(6);
    expect(normalizeDeck({ slides: [] })).toBeUndefined();
  });
});

describe('Sync with the dashboard', () => {
  it('refreshes bound numbers and keeps the words', () => {
    const scene = {
      ...emptyScene(),
      dashboard: {
        title: 'D', defaultSource: 'local', refreshSeconds: 0, filters: [],
        widgets: [{ id: 'w', title: 'By region', kind: 'bar' as const, source: 'local', sql: 'SELECT 1', colSpan: 6 as const, format: 'currency_usd' as const }],
      },
    };
    const deck = buildDeck({ slides: [{ id: 'c', layout: 'chart', title: 'My own words', widget_id: 'w', chart: { type: 'column', categories: ['A'], series: [{ name: 'v', values: [1] }] } }] }).deck;
    const result = { ok: true, source: 'local', sql: '', boundSql: '', columns: ['region', 'mrr'], rows: [['NA', 10], ['EMEA', 20]], rowCount: 2, truncated: false, durationMs: 1, executedAt: '' };
    const { deck: next, updated } = syncDeckData(deck, scene, { w: result });
    expect(updated).toEqual(['c']);
    expect(next.slides[0].title).toBe('My own words');
    expect(next.slides[0].chart?.type).toBe('column');
    expect(next.slides[0].chart?.series[0].values).toEqual([10, 20]);
  });
});

describe('Google Slides upload', () => {
  it('uploads the .pptx to Drive as a Google Slides presentation (multipart, drive.file token)', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fake = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ id: 'abc', name: 'Review', webViewLink: 'https://docs.google.com/presentation/d/abc/edit' }), { status: 200 });
    }) as unknown as typeof fetch;
    const file = await uploadPptxAsSlides(new Blob(['PK']), 'Review', 'token-1', fake);
    expect(file.webViewLink).toContain('/presentation/d/abc');
    expect(seen!.url).toContain('upload/drive/v3/files?uploadType=multipart');
    const headers = seen!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer token-1');
    expect(headers['Content-Type']).toMatch(/^multipart\/related; boundary=/);
    const body = await (seen!.init.body as Blob).text();
    expect(body).toContain('"mimeType":"application/vnd.google-apps.presentation"');
    expect(body).toContain('application/vnd.openxmlformats-officedocument.presentationml.presentation');
  });

  it('explains a disabled Drive API', async () => {
    const fake = (async () => new Response(JSON.stringify({ error: { message: 'Google Drive API has not been used in project 1 before or it is disabled.' } }), { status: 403 })) as unknown as typeof fetch;
    await expect(uploadPptxAsSlides(new Blob(['PK']), 'R', 't', fake)).rejects.toThrow(/Enable it in the Google Cloud console/);
  });
});
