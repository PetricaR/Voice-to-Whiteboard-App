import { describe, expect, it } from 'vitest';
import { prepareDeckQueries, rerunDeckQueries, runDeckQueries } from '../src/agent/deckQueries';
import { DEFAULT_PAGE, buildChartSheets, buildSlidesRequests, createNativePresentation, slideObjectId } from '../src/deck-export/googleSlidesApi';
import { applyDeckEdit, buildDeck, deckQueries, normalizeDeck, syncDeckData, type DeckSpec, type EditDeckRequest } from '../src/engine/deck';
import { emptyScene } from '../src/engine/types';

const BY_REGION = `SELECT region, SUM(mrr_usd) AS mrr_usd FROM monthly_revenue WHERE month = '2026-06' GROUP BY region ORDER BY 2 DESC`;
const TOTAL = `SELECT SUM(mrr_usd) AS mrr_usd FROM monthly_revenue WHERE month = '2026-06'`;

function baseDeck(): DeckSpec {
  const res = buildDeck({
    title: 'Review',
    slides: [
      { layout: 'title', title: 'Review' },
      { layout: 'chart', title: 'Typed chart', chart: { type: 'column', categories: ['A', 'B'], series: [{ name: 'V', values: [1, 2] }] }, notes: 'Say the thing.' },
      { layout: 'closing', title: 'What this means', takeaways: ['One'] },
    ],
  }, { date: 'November 2026' });
  expect(res.ok).toBe(true);
  return res.deck;
}

/** Runs the request's queries the way the dispatcher does, then edits. */
async function liveEdit(deck: DeckSpec, req: EditDeckRequest) {
  const run = await runDeckQueries(prepareDeckQueries(req));
  expect(run.errors).toEqual([]);
  return applyDeckEdit(deck, req, { queryResults: run.results });
}

describe('Live SQL on slides', () => {
  it('adds a chart slide from its own query and tells what it shows', async () => {
    const res = await liveEdit(baseDeck(), { summary: 'add', add_slides: [{ layout: 'chart', title: 'MRR by region', sql: BY_REGION, chart: { type: 'bar', format: 'currency_usd' } }] });
    expect(res.ok).toBe(true);
    const s = res.deck.slides.find((x) => x.id === res.addedSlides[0])!;
    expect(s.query).toMatchObject({ sql: BY_REGION, source: 'local', format: 'currency_usd' });
    expect(s.chart?.type).toBe('bar');
    expect(s.chart?.categories.length).toBeGreaterThan(1);
    expect(s.chart?.series[0].values.every((v) => v > 0)).toBe(true);
    expect(res.notes.some((n) => n.startsWith('From SQL: slide') && n.includes(s.chart!.categories[0]))).toBe(true);
    // Added before the closing slide
    expect(res.deck.slides.at(-1)?.layout).toBe('closing');
  });

  it('changes only the chart type of a query slide, keeping its data', async () => {
    const added = await liveEdit(baseDeck(), { summary: 'add', add_slides: [{ layout: 'chart', title: 'MRR by region', sql: BY_REGION }] });
    const id = added.addedSlides[0];
    const before = added.deck.slides.find((x) => x.id === id)!.chart!;
    const res = applyDeckEdit(added.deck, { summary: 'line', update_slides: [{ id, chart: { type: 'line' } }] });
    const after = res.deck.slides.find((x) => x.id === id)!;
    expect(res.warnings).toEqual([]);
    expect(after.chart?.type).toBe('line');
    expect(after.chart?.categories).toEqual(before.categories);
    expect(after.query?.sql).toBe(BY_REGION);
  });

  it('changes the type of a typed chart too (type only)', () => {
    const deck = baseDeck();
    const res = applyDeckEdit(deck, { summary: 'donut', update_slides: [{ id: '2', chart: { type: 'donut' } }] });
    expect(res.deck.slides[1].chart).toMatchObject({ type: 'donut', categories: ['A', 'B'] });
    expect(res.warnings).toEqual([]);
  });

  it('fills a table and metrics from SQL, and sync runs the queries again', async () => {
    const req: EditDeckRequest = {
      summary: 'add',
      add_slides: [
        { layout: 'table', title: 'Top regions', sql: BY_REGION },
        { layout: 'kpis', title: 'June in one figure', metrics: [{ label: 'June MRR', sql: TOTAL, format: 'currency_usd' }, { label: 'Typed', value: '42' }] },
      ],
    };
    const res = await liveEdit(baseDeck(), req);
    const table = res.deck.slides.find((s) => s.layout === 'table')!;
    const kpis = res.deck.slides.find((s) => s.layout === 'kpis')!;
    expect(table.columns).toEqual(['Region', 'MRR USD']);
    expect(table.rows!.length).toBeGreaterThan(1);
    expect(kpis.metrics![0].value).toMatch(/^\$/);
    expect(kpis.metrics![0].query?.format).toBe('currency_usd');
    expect(kpis.metrics![1]).toMatchObject({ label: 'Typed', value: '42' });
    expect(deckQueries(res.deck)).toHaveLength(2);

    // Stale numbers come back from the queries; words stay
    const stale = structuredClone(res.deck);
    stale.slides.find((s) => s.layout === 'kpis')!.metrics![0].value = '$0';
    stale.slides.find((s) => s.layout === 'table')!.title = 'My own words';
    const run = await rerunDeckQueries(stale);
    const synced = syncDeckData(stale, emptyScene(), {}, run.results);
    const k = synced.deck.slides.find((s) => s.layout === 'kpis')!;
    expect(k.metrics![0].value).toBe(kpis.metrics![0].value);
    expect(synced.deck.slides.find((s) => s.layout === 'table')!.title).toBe('My own words');
    expect(synced.updated).toContain(k.id);
  });

  it('keeps queries through save and load, and removes them on request', async () => {
    const res = await liveEdit(baseDeck(), { summary: 'add', add_slides: [{ layout: 'chart', title: 'By region', sql: BY_REGION }] });
    const loaded = normalizeDeck(JSON.parse(JSON.stringify(res.deck)))!;
    const s = loaded.slides.find((x) => x.query)!;
    expect(s.query?.sql).toBe(BY_REGION);
    expect(s.chart?.categories.length).toBeGreaterThan(1);
    const removed = applyDeckEdit(loaded, { summary: 'own data', update_slides: [{ id: s.id, sql: '' }] });
    const after = removed.deck.slides.find((x) => x.id === s.id)!;
    expect(after.query).toBeUndefined();
    expect(after.chart?.categories).toEqual(s.chart?.categories);
  });

  it('refuses SQL that writes, and names a default source', async () => {
    const req: EditDeckRequest = { summary: 'bad', add_slides: [{ layout: 'chart', title: 'X', sql: 'DELETE FROM monthly_revenue' }] };
    const queries = prepareDeckQueries(req, 'local');
    expect(req.add_slides![0].data_source).toBe('local');
    const run = await runDeckQueries(queries);
    expect(run.errors).toHaveLength(1);
    expect(run.results.size).toBe(0);
  });
});

describe('Google Slides API build', () => {
  const ID = /^[a-zA-Z0-9_][a-zA-Z0-9_\-:]{4,49}$/;

  it('draws every slide with valid requests scaled to the page', async () => {
    const deck = (await liveEdit(baseDeck(), { summary: 'add', add_slides: [{ layout: 'table', title: 'Regions', sql: BY_REGION }] })).deck;
    const reqs = buildSlidesRequests(deck, DEFAULT_PAGE, { linked: new Map() }, ['p']);
    for (const r of reqs) expect(Object.keys(r)).toHaveLength(1);
    const slides = reqs.filter((r) => 'createSlide' in r);
    expect(slides).toHaveLength(deck.slides.length);
    // The presentation's own blank slide goes last
    expect(reqs.at(-1)).toEqual({ deleteObject: { objectId: 'p' } });
    for (const r of reqs) {
      const body = Object.values(r)[0] as { objectId?: string; elementProperties?: { size: { width: { magnitude: number } }; transform: { translateX: number; translateY: number } } };
      if (body.objectId && !('deleteObject' in r)) expect(body.objectId).toMatch(ID);
      const ep = body.elementProperties;
      // Content stays on the page (decorative circles may bleed off the edge)
      const content = 'createTable' in r || ('createShape' in r && (r.createShape as { shapeType: string }).shapeType === 'TEXT_BOX');
      if (ep && content) {
        expect(ep.transform.translateX + ep.size.width.magnitude).toBeLessThanOrEqual(DEFAULT_PAGE.width + 1);
        expect(ep.transform.translateY).toBeLessThanOrEqual(DEFAULT_PAGE.height);
      }
    }
    // A chart without a linked Sheets chart is drawn as a table of its numbers
    const chartSlide = deck.slides.findIndex((s) => s.layout === 'chart');
    expect(reqs.some((r) => 'createTable' in r && (r.createTable as { elementProperties: { pageObjectId: string } }).elementProperties.pageObjectId === slideObjectId(chartSlide))).toBe(true);
    // Fonts scale with the page (10" wide instead of 13.333")
    const sizes = reqs.flatMap((r) => ('updateTextStyle' in r ? [((r.updateTextStyle as { style: { fontSize?: { magnitude: number } } }).style.fontSize?.magnitude ?? 0)] : []));
    expect(Math.max(...sizes)).toBeLessThan(48);
  });

  it('links Sheets charts and builds their data sheets', () => {
    const deck = baseDeck();
    const sheets = buildChartSheets(deck);
    expect(sheets).toHaveLength(1);
    expect(sheets[0].slideIndex).toBe(1);
    expect(JSON.stringify(sheets[0].addChart)).toContain('"chartType":"COLUMN"');
    const reqs = buildSlidesRequests(deck, DEFAULT_PAGE, { spreadsheetId: 'sheet1', linked: new Map([[1, 77]]) });
    const linked = reqs.find((r) => 'createSheetsChart' in r)!.createSheetsChart as Record<string, unknown>;
    expect(linked).toMatchObject({ spreadsheetId: 'sheet1', chartId: 77, linkingMode: 'LINKED' });
    expect(reqs.some((r) => 'updatePageElementAltText' in r)).toBe(true);
  });

  it('creates the presentation, the chart sheet and the speaker notes in order', async () => {
    const deck = baseDeck();
    const calls: { url: string; body?: { requests?: Record<string, unknown>[]; title?: string } }[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, body });
      const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
      if (url === 'https://slides.googleapis.com/v1/presentations') return json({ presentationId: 'P1', pageSize: { width: { magnitude: DEFAULT_PAGE.width }, height: { magnitude: DEFAULT_PAGE.height } }, slides: [{ objectId: 'p' }] });
      if (url === 'https://sheets.googleapis.com/v4/spreadsheets') return json({ spreadsheetId: 'S1' });
      if (url.endsWith('S1:batchUpdate')) return json({ replies: [{ addChart: { chart: { chartId: 9 } } }] });
      if (url.includes('P1?fields=')) return json({ slides: deck.slides.map((_, i) => ({ objectId: slideObjectId(i), slideProperties: { notesPage: { notesProperties: { speakerNotesObjectId: `n${i}` } } } })) });
      return json({});
    }) as typeof fetch;
    const made = await createNativePresentation(deck, 'tok', fake);
    expect(made).toMatchObject({ id: 'P1', spreadsheetId: 'S1', webViewLink: 'https://docs.google.com/presentation/d/P1/edit' });
    expect(made.chartNote).toBeUndefined();
    const draw = calls.find((c) => c.url.endsWith('P1:batchUpdate'))!;
    expect(draw.body!.requests!.some((r) => 'createSheetsChart' in r && (r.createSheetsChart as { chartId: number }).chartId === 9)).toBe(true);
    const notes = calls.filter((c) => c.url.endsWith('P1:batchUpdate')).at(-1)!;
    expect(notes.body!.requests).toEqual([{ insertText: { objectId: 'n1', insertionIndex: 0, text: 'Say the thing.' } }]);
  });

  it('draws charts as tables when the Sheets API is off', async () => {
    const deck = baseDeck();
    const fake = (async (url: string) => {
      if (url === 'https://sheets.googleapis.com/v4/spreadsheets') {
        return new Response(JSON.stringify({ error: { message: 'Google Sheets API has not been used in project 1 before or it is disabled.', status: 'PERMISSION_DENIED' } }), { status: 403 });
      }
      if (url === 'https://slides.googleapis.com/v1/presentations') return new Response(JSON.stringify({ presentationId: 'P2', slides: [] }), { status: 200 });
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    const made = await createNativePresentation(deck, 'tok', fake);
    expect(made.chartNote).toMatch(/enable the Google Sheets API/);
  });
});
