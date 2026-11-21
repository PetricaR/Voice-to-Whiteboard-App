/**
 * A native Google Slides presentation of a deck, built with the Google Slides
 * API (and the Sheets API for its charts), instead of a converted .pptx.
 *
 * What that gives over the conversion: real Slides text boxes, shapes and
 * tables with the deck's fonts and colors; charts that are Google Sheets
 * charts LINKED into the slides (the data lives in a spreadsheet next to the
 * presentation, so the numbers can be edited and the charts updated in
 * Slides); speaker notes; alt text on charts. Everything comes from
 * engine/deckLayout.ts, the same layout the studio draws and the PowerPoint
 * export writes.
 *
 * Reference: https://developers.google.com/workspace/slides/api/reference/rest
 *  - presentations.create ignores everything but the title: a new
 *    presentation is 10" × 5.625" (16:9), so the 13.333" × 7.5" layout is
 *    scaled to the page size the API reports (sizes and font sizes alike).
 *  - Object ids are ours (5–50 chars, [a-zA-Z0-9_][a-zA-Z0-9_-:]*), so one
 *    batchUpdate can create an element and style it.
 *  - The speaker-notes shape id is only known after a read (presentations.get),
 *    so notes go in a second batch.
 *  - Scopes: drive.file covers presentations.create/batchUpdate/get,
 *    spreadsheets.create/batchUpdate and createSheetsChart for files this app
 *    created; the Google Slides API (and Sheets API, for charts) must be
 *    enabled for the OAuth client's project.
 *  - Quota: 60 write requests per minute per user; a batchUpdate is one write.
 */
import type { DeckChart, DeckSpec } from '../engine/deck';
import {
  SLIDE_H,
  SLIDE_W,
  layoutSlide,
  themeOf,
  type ChartEl,
  type DeckTheme,
  type El,
  type ShapeEl,
  type TableEl,
  type TextEl,
} from '../engine/deckLayout';

const EMU_PER_IN = 914_400;
/** Google Slides refuses table columns narrower than 32 pt. */
const MIN_COLUMN_EMU = 406_400;
/** Requests per batchUpdate: well under any payload limit, few writes per deck. */
const BATCH = 400;

export type SlidesRequest = Record<string, unknown>;

/** Where the data of each chart is in the spreadsheet: chart id by slide index. */
export type LinkedCharts = Map<number, number>;

export interface PageSizeEmu {
  width: number;
  height: number;
}

/** The default page of a new presentation (10" × 5.625"). */
export const DEFAULT_PAGE: PageSizeEmu = { width: 9_144_000, height: 5_143_500 };

const rgb = (hex: string) => {
  const n = Number.parseInt(hex.replace('#', '').slice(0, 6), 16);
  return { red: ((n >> 16) & 255) / 255, green: ((n >> 8) & 255) / 255, blue: (n & 255) / 255 };
};
const solid = (hex: string, alpha?: number) => ({ color: { rgbColor: rgb(hex) }, ...(alpha !== undefined && alpha < 1 ? { alpha } : {}) });
const pt = (magnitude: number) => ({ magnitude: Math.round(magnitude * 100) / 100, unit: 'PT' });

/** Object ids: 5–50 chars, start with [a-zA-Z0-9_]. */
export const slideObjectId = (i: number) => `deck_s${i}`;
const elementId = (i: number, j: number, part = '') => `deck_s${i}_e${j}${part}`;

interface Ctx {
  /** Inches of the layout → EMU of the page. */
  emu: (inches: number) => number;
  /** Font points of the layout → points on the page. */
  fpt: (points: number) => number;
  theme: DeckTheme;
}

function contextFor(deck: DeckSpec, page: PageSizeEmu): Ctx {
  const scale = Math.min(page.width / (SLIDE_W * EMU_PER_IN), page.height / (SLIDE_H * EMU_PER_IN));
  return {
    emu: (inches) => Math.round(inches * EMU_PER_IN * scale),
    fpt: (points) => points * scale,
    theme: themeOf(deck),
  };
}

function elementProperties(slideId: string, el: { x: number; y: number; w: number; h: number }, c: Ctx) {
  return {
    pageObjectId: slideId,
    size: { width: { magnitude: Math.max(1, c.emu(el.w)), unit: 'EMU' }, height: { magnitude: Math.max(1, c.emu(el.h)), unit: 'EMU' } },
    transform: { scaleX: 1, scaleY: 1, translateX: c.emu(el.x), translateY: c.emu(el.y), unit: 'EMU' },
  };
}

function textRequests(id: string, slideId: string, el: TextEl, c: Ctx): SlidesRequest[] {
  const paras = el.paras.map((p) => p.runs.map((r) => r.text).join(''));
  const text = paras.join('\n');
  if (text.trim() === '') return [];
  const font = el.font === 'head' ? c.theme.headFont : c.theme.bodyFont;
  const out: SlidesRequest[] = [
    { createShape: { objectId: id, shapeType: 'TEXT_BOX', elementProperties: elementProperties(slideId, el, c) } },
    { insertText: { objectId: id, insertionIndex: 0, text } },
    {
      updateTextStyle: {
        objectId: id,
        textRange: { type: 'ALL' },
        style: { fontFamily: font, fontSize: pt(c.fpt(el.size)), bold: el.bold === true, foregroundColor: { opaqueColor: { rgbColor: rgb(el.color) } } },
        fields: 'fontFamily,fontSize,bold,foregroundColor',
      },
    },
    {
      updateParagraphStyle: {
        objectId: id,
        textRange: { type: 'ALL' },
        style: {
          alignment: el.align === 'center' ? 'CENTER' : el.align === 'right' ? 'END' : 'START',
          lineSpacing: Math.round((el.lineSpacing ?? 1) * 100),
          spaceAbove: pt(0),
          spaceBelow: pt(c.fpt(el.paraSpaceAfter ?? 0)),
        },
        fields: 'alignment,lineSpacing,spaceAbove,spaceBelow',
      },
    },
    {
      updateShapeProperties: {
        objectId: id,
        shapeProperties: { contentAlignment: el.valign === 'middle' ? 'MIDDLE' : el.valign === 'bottom' ? 'BOTTOM' : 'TOP' },
        fields: 'contentAlignment',
      },
    },
  ];
  // Runs that differ from the box (a bold lead-in, a colored delta, a bigger figure)
  let at = 0;
  el.paras.forEach((p, pi) => {
    const paraStart = at;
    for (const r of p.runs) {
      const end = at + r.text.length;
      const style: Record<string, unknown> = {};
      const fields: string[] = [];
      if (r.bold !== undefined && r.bold !== (el.bold === true)) {
        style.bold = r.bold;
        fields.push('bold');
      }
      if (r.italic) {
        style.italic = true;
        fields.push('italic');
      }
      if (r.color && r.color !== el.color) {
        style.foregroundColor = { opaqueColor: { rgbColor: rgb(r.color) } };
        fields.push('foregroundColor');
      }
      if (r.size && r.size !== el.size) {
        style.fontSize = pt(c.fpt(r.size));
        fields.push('fontSize');
      }
      if (fields.length > 0 && end > at) {
        out.push({ updateTextStyle: { objectId: id, textRange: { type: 'FIXED_RANGE', startIndex: at, endIndex: end }, style, fields: fields.join(',') } });
      }
      at = end;
    }
    if (p.bullet && at > paraStart) {
      out.push({ createParagraphBullets: { objectId: id, textRange: { type: 'FIXED_RANGE', startIndex: paraStart, endIndex: at }, bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE' } });
    }
    if (pi < el.paras.length - 1) at += 1; // the newline
  });
  return out;
}

function shapeRequests(id: string, slideId: string, el: ShapeEl, c: Ctx): SlidesRequest[] {
  const shapeType = el.shape === 'ellipse' ? 'ELLIPSE' : el.shape === 'roundRect' ? 'ROUND_RECTANGLE' : el.shape === 'chevron' ? 'CHEVRON' : 'RECTANGLE';
  const alpha = el.transparency ? 1 - el.transparency / 100 : undefined;
  const props: Record<string, unknown> = {
    shapeBackgroundFill: el.fill ? { solidFill: solid(el.fill, alpha) } : { propertyState: 'NOT_RENDERED' },
    outline: el.line
      ? { outlineFill: { solidFill: solid(el.line) }, weight: pt(c.fpt(el.lineWidth ?? 1)), propertyState: 'RENDERED' }
      : { propertyState: 'NOT_RENDERED' },
  };
  return [
    { createShape: { objectId: id, shapeType, elementProperties: elementProperties(slideId, el, c) } },
    { updateShapeProperties: { objectId: id, shapeProperties: props, fields: el.fill ? 'shapeBackgroundFill.solidFill,outline' : 'shapeBackgroundFill.propertyState,outline' } },
  ];
}

function tableRequests(id: string, slideId: string, el: TableEl, c: Ctx): SlidesRequest[] {
  const t = c.theme;
  const rows = el.rows.length + 1;
  const cols = el.columns.length;
  if (cols === 0) return [];
  const h = el.rowH * rows;
  const out: SlidesRequest[] = [
    { createTable: { objectId: id, elementProperties: elementProperties(slideId, { ...el, h }, c), rows, columns: cols } },
  ];
  el.colW.slice(0, cols).forEach((w, i) => {
    out.push({ updateTableColumnProperties: { objectId: id, columnIndices: [i], tableColumnProperties: { columnWidth: { magnitude: Math.max(MIN_COLUMN_EMU, c.emu(w)), unit: 'EMU' } }, fields: 'columnWidth' } });
  });
  out.push({ updateTableRowProperties: { objectId: id, rowIndices: Array.from({ length: rows }, (_, i) => i), tableRowProperties: { minRowHeight: { magnitude: c.emu(el.rowH), unit: 'EMU' } }, fields: 'minRowHeight' } });
  // Header in the theme's dark color, zebra rows, thin horizontal rules only
  out.push({ updateTableCellProperties: { objectId: id, tableRange: { location: { rowIndex: 0, columnIndex: 0 }, rowSpan: 1, columnSpan: cols }, tableCellProperties: { tableCellBackgroundFill: { solidFill: solid(t.dark) }, contentAlignment: 'MIDDLE' }, fields: 'tableCellBackgroundFill.solidFill,contentAlignment' } });
  if (el.rows.length > 0) {
    out.push({ updateTableCellProperties: { objectId: id, tableRange: { location: { rowIndex: 1, columnIndex: 0 }, rowSpan: el.rows.length, columnSpan: cols }, tableCellProperties: { tableCellBackgroundFill: { solidFill: solid('FFFFFF') }, contentAlignment: 'MIDDLE' }, fields: 'tableCellBackgroundFill.solidFill,contentAlignment' } });
  }
  for (let r = 2; r < rows; r += 2) {
    out.push({ updateTableCellProperties: { objectId: id, tableRange: { location: { rowIndex: r, columnIndex: 0 }, rowSpan: 1, columnSpan: cols }, tableCellProperties: { tableCellBackgroundFill: { solidFill: solid(t.soft) } }, fields: 'tableCellBackgroundFill.solidFill' } });
  }
  const all = { location: { rowIndex: 0, columnIndex: 0 }, rowSpan: rows, columnSpan: cols };
  out.push({ updateTableBorderProperties: { objectId: id, tableRange: all, borderPosition: 'ALL', tableBorderProperties: { tableBorderFill: { solidFill: solid(t.rule) }, weight: pt(0.75), dashStyle: 'SOLID' }, fields: 'tableBorderFill.solidFill,weight,dashStyle' } });
  for (const borderPosition of ['INNER_VERTICAL', 'LEFT', 'RIGHT']) {
    out.push({ updateTableBorderProperties: { objectId: id, tableRange: all, borderPosition, tableBorderProperties: { tableBorderFill: { solidFill: solid('FFFFFF', 0) } }, fields: 'tableBorderFill.solidFill' } });
  }
  const cell = (r: number, ci: number, text: string, header: boolean) => {
    if (text === '') return;
    const loc = { rowIndex: r, columnIndex: ci };
    out.push({ insertText: { objectId: id, cellLocation: loc, insertionIndex: 0, text } });
    out.push({
      updateTextStyle: {
        objectId: id,
        cellLocation: loc,
        textRange: { type: 'ALL' },
        style: { fontFamily: t.bodyFont, fontSize: pt(c.fpt(el.size)), bold: header, foregroundColor: { opaqueColor: { rgbColor: rgb(header ? 'FFFFFF' : t.ink) } } },
        fields: 'fontFamily,fontSize,bold,foregroundColor',
      },
    });
    if (el.numeric[ci]) {
      out.push({ updateParagraphStyle: { objectId: id, cellLocation: loc, textRange: { type: 'ALL' }, style: { alignment: 'END' }, fields: 'alignment' } });
    }
  };
  el.columns.forEach((col, ci) => cell(0, ci, col, true));
  el.rows.forEach((row, ri) => el.columns.forEach((_, ci) => cell(ri + 1, ci, row[ci] ?? '', false)));
  return out;
}

/** A chart that could not be linked from Sheets: its numbers as a native table. */
function chartAsTable(el: ChartEl): TableEl {
  const c = el.chart;
  const cats = c.categories.slice(0, 8);
  const columns = ['', ...c.series.map((s) => s.name)].slice(0, 6);
  const rows = cats.map((cat, i) => [cat, ...c.series.slice(0, 5).map((s) => String(s.values[i] ?? ''))]);
  const rowH = Math.min(0.5, el.h / (rows.length + 1));
  return { kind: 'table', name: el.name, x: el.x, y: el.y, w: el.w, h: el.h, columns, rows, colW: columns.map(() => el.w / columns.length), rowH, numeric: columns.map((_, i) => i > 0), size: 12 };
}

function elementRequests(i: number, j: number, el: El, c: Ctx, charts: { spreadsheetId?: string; linked: LinkedCharts }, title: string): SlidesRequest[] {
  const slideId = slideObjectId(i);
  const id = elementId(i, j);
  switch (el.kind) {
    case 'text':
      return textRequests(id, slideId, el, c);
    case 'shape':
      return shapeRequests(id, slideId, el, c);
    case 'table':
      return tableRequests(id, slideId, el, c);
    case 'chart': {
      const chartId = charts.linked.get(i);
      if (charts.spreadsheetId && chartId != null) {
        return [
          { createSheetsChart: { objectId: id, spreadsheetId: charts.spreadsheetId, chartId, linkingMode: 'LINKED', elementProperties: elementProperties(slideId, el, c) } },
          { updatePageElementAltText: { objectId: id, title: `${title} (chart)`, description: describeChart(el.chart) } },
        ];
      }
      return tableRequests(id, slideId, chartAsTable(el), c);
    }
  }
}

function describeChart(c: DeckChart): string {
  const s = c.series[0];
  const pairs = c.categories.slice(0, 12).map((cat, i) => `${cat}: ${s?.values[i] ?? ''}`).join('; ');
  return `${c.type.replace('_', ' ')} chart of ${c.series.map((x) => x.name).join(', ')}. ${pairs}`.slice(0, 1000);
}

/**
 * Every request that draws the deck on a presentation whose page is `page`,
 * after `removeIds` (the presentation's own first slide) are deleted.
 * Pure: the same deck gives the same requests.
 */
export function buildSlidesRequests(
  deck: DeckSpec,
  page: PageSizeEmu = DEFAULT_PAGE,
  charts: { spreadsheetId?: string; linked: LinkedCharts } = { linked: new Map() },
  removeIds: string[] = [],
): SlidesRequest[] {
  const c = contextFor(deck, page);
  const out: SlidesRequest[] = [];
  deck.slides.forEach((s, i) => {
    const slideId = slideObjectId(i);
    const frame = layoutSlide(deck, i);
    out.push({ createSlide: { objectId: slideId, insertionIndex: i, slideLayoutReference: { predefinedLayout: 'BLANK' } } });
    out.push({ updatePageProperties: { objectId: slideId, pageProperties: { pageBackgroundFill: { solidFill: solid(frame.background) } }, fields: 'pageBackgroundFill.solidFill.color' } });
    frame.elements.forEach((el, j) => out.push(...elementRequests(i, j, el, c, charts, s.title)));
    if (frame.number) {
      const n = frame.number;
      const numberEl: TextEl = {
        kind: 'text', name: 'Slide number', x: n.x, y: n.y, w: n.w, h: n.h, size: n.size, color: n.color, font: 'body', align: 'right', valign: 'middle',
        paras: [{ runs: [{ text: String(n.value) }] }],
      };
      out.push(...textRequests(elementId(i, frame.elements.length, 'n'), slideId, numberEl, c));
    }
  });
  for (const id of removeIds) out.push({ deleteObject: { objectId: id } });
  return out;
}

/** The chart data of a deck as sheets (one per chart slide) and the AddChart requests that chart them. */
export function buildChartSheets(deck: DeckSpec): { slideIndex: number; sheet: Record<string, unknown>; addChart: Record<string, unknown> }[] {
  const t = themeOf(deck);
  const out: { slideIndex: number; sheet: Record<string, unknown>; addChart: Record<string, unknown> }[] = [];
  deck.slides.forEach((_s, i) => {
    const el = layoutSlide(deck, i).elements.find((e): e is ChartEl => e.kind === 'chart');
    if (!el) return;
    const c = el.chart;
    const sheetId = 1000 + i;
    const n = c.categories.length;
    const cellOf = (v: string | number) => (typeof v === 'number' ? { userEnteredValue: { numberValue: v } } : { userEnteredValue: { stringValue: v } });
    const rowData = [
      { values: [cellOf(''), ...c.series.map((x) => cellOf(x.name))] },
      ...c.categories.map((cat, r) => ({ values: [cellOf(cat), ...c.series.map((x) => cellOf(x.values[r] ?? 0))] })),
    ];
    const range = (col: number) => ({ sourceRange: { sources: [{ sheetId, startRowIndex: 0, endRowIndex: n + 1, startColumnIndex: col, endColumnIndex: col + 1 }] } });
    const sheet = {
      properties: { sheetId, title: `Slide ${i + 1}`.slice(0, 90), gridProperties: { rowCount: Math.max(n + 1, 20), columnCount: Math.max(c.series.length + 1, 5) } },
      data: [{ startRow: 0, startColumn: 0, rowData }],
    };
    const font = t.bodyFont;
    const spec: Record<string, unknown> = c.type === 'donut'
      ? { fontName: font, pieChart: { legendPosition: 'RIGHT_LEGEND', domain: range(0), series: range(1), pieHole: 0.6 } }
      : {
          fontName: font,
          basicChart: {
            chartType: c.type === 'bar' ? 'BAR' : c.type === 'line' ? 'LINE' : c.type === 'area' ? 'AREA' : 'COLUMN',
            ...(c.type === 'stacked_column' ? { stackedType: 'STACKED' } : {}),
            legendPosition: c.series.length > 1 ? 'BOTTOM_LEGEND' : 'NO_LEGEND',
            headerCount: 1,
            domains: [{ domain: range(0) }],
            series: c.series.map((_, k) => ({
              series: range(k + 1),
              targetAxis: c.type === 'bar' ? 'BOTTOM_AXIS' : 'LEFT_AXIS',
              colorStyle: { rgbColor: rgb(el.perPoint ? t.secondary : el.colors[k] ?? t.primary) },
            })),
          },
        };
    out.push({ slideIndex: i, sheet, addChart: { addChart: { chart: { spec, position: { newSheet: true } } } } });
  });
  return out;
}

export class SlidesApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: 'api-disabled' | 'denied' | 'failed', readonly api: 'slides' | 'sheets') {
    super(message);
  }
}

async function call<T>(fetchImpl: typeof fetch, token: string, url: string, api: 'slides' | 'sheets', body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new SlidesApiError(`Google ${api === 'slides' ? 'Slides' : 'Sheets'} cannot be reached; check the connection.`, 0, 'failed', api);
  }
  const text = await res.text();
  if (!res.ok) {
    const name = api === 'slides' ? 'Google Slides API' : 'Google Sheets API';
    if (res.status === 403 && /accessNotConfigured|has not been used|is disabled|SERVICE_DISABLED/i.test(text)) {
      throw new SlidesApiError(`The ${name} is not enabled for this studio’s OAuth client (APIs & Services → Library → ${name}).`, 403, 'api-disabled', api);
    }
    let detail = text.slice(0, 200);
    try {
      detail = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? detail;
    } catch {
      // not JSON
    }
    throw new SlidesApiError(`${name} refused the request (${res.status}: ${detail}).`, res.status, res.status === 401 || res.status === 403 ? 'denied' : 'failed', api);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

const SLIDES = 'https://slides.googleapis.com/v1/presentations';
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';

export interface NativePresentation {
  id: string;
  name: string;
  webViewLink: string;
  /** The spreadsheet holding the chart data, when the charts are linked. */
  spreadsheetId?: string;
  /** Why the charts are tables instead of linked charts, if they are. */
  chartNote?: string;
}

/** Puts the chart data in a new spreadsheet and charts it there. */
async function createChartSpreadsheet(deck: DeckSpec, token: string, fetchImpl: typeof fetch): Promise<{ spreadsheetId: string; linked: LinkedCharts } | null> {
  const sheets = buildChartSheets(deck);
  if (sheets.length === 0) return null;
  const created = await call<{ spreadsheetId: string }>(fetchImpl, token, SHEETS, 'sheets', {
    properties: { title: `${deck.title || 'Presentation'} · chart data` },
    sheets: sheets.map((x) => x.sheet),
  });
  const reply = await call<{ replies?: { addChart?: { chart?: { chartId?: number } } }[] }>(
    fetchImpl, token, `${SHEETS}/${created.spreadsheetId}:batchUpdate`, 'sheets', { requests: sheets.map((x) => x.addChart) },
  );
  const linked: LinkedCharts = new Map();
  sheets.forEach((x, k) => {
    const id = reply.replies?.[k]?.addChart?.chart?.chartId;
    if (typeof id === 'number') linked.set(x.slideIndex, id);
  });
  return { spreadsheetId: created.spreadsheetId, linked };
}

/**
 * Builds the deck as a native Google Slides presentation in the user's Drive.
 * The charts are linked Sheets charts when the Sheets API answers; otherwise
 * their numbers are tables and `chartNote` says why.
 */
export async function createNativePresentation(deck: DeckSpec, token: string, fetchImpl: typeof fetch = fetch): Promise<NativePresentation> {
  const name = deck.title || 'Presentation';
  const pres = await call<{ presentationId: string; pageSize?: { width?: { magnitude?: number }; height?: { magnitude?: number } }; slides?: { objectId: string }[] }>(
    fetchImpl, token, SLIDES, 'slides', { title: name },
  );
  const page: PageSizeEmu = {
    width: pres.pageSize?.width?.magnitude ?? DEFAULT_PAGE.width,
    height: pres.pageSize?.height?.magnitude ?? DEFAULT_PAGE.height,
  };

  let charts: { spreadsheetId?: string; linked: LinkedCharts } = { linked: new Map() };
  let chartNote: string | undefined;
  try {
    const made = await createChartSpreadsheet(deck, token, fetchImpl);
    if (made) charts = made;
  } catch (e) {
    chartNote = e instanceof SlidesApiError && e.code === 'api-disabled'
      ? 'Charts are tables: enable the Google Sheets API for linked, editable charts.'
      : `Charts are tables: the chart data could not be put in Google Sheets (${e instanceof Error ? e.message : String(e)}).`;
  }

  const requests = buildSlidesRequests(deck, page, charts, (pres.slides ?? []).map((s) => s.objectId));
  for (let k = 0; k < requests.length; k += BATCH) {
    await call(fetchImpl, token, `${SLIDES}/${pres.presentationId}:batchUpdate`, 'slides', { requests: requests.slice(k, k + BATCH) });
  }

  // Speaker notes: their shape ids are known only now
  if (deck.slides.some((s) => s.notes)) {
    const got = await call<{ slides?: { objectId: string; slideProperties?: { notesPage?: { notesProperties?: { speakerNotesObjectId?: string } } } }[] }>(
      fetchImpl, token, `${SLIDES}/${pres.presentationId}?fields=slides(objectId,slideProperties(notesPage(notesProperties(speakerNotesObjectId))))`, 'slides',
    );
    const notesId = new Map((got.slides ?? []).map((s) => [s.objectId, s.slideProperties?.notesPage?.notesProperties?.speakerNotesObjectId]));
    const notes: SlidesRequest[] = [];
    deck.slides.forEach((s, i) => {
      const id = notesId.get(slideObjectId(i));
      if (s.notes && id) notes.push({ insertText: { objectId: id, insertionIndex: 0, text: s.notes } });
    });
    if (notes.length > 0) await call(fetchImpl, token, `${SLIDES}/${pres.presentationId}:batchUpdate`, 'slides', { requests: notes });
  }

  return {
    id: pres.presentationId,
    name,
    webViewLink: `https://docs.google.com/presentation/d/${pres.presentationId}/edit`,
    ...(charts.spreadsheetId ? { spreadsheetId: charts.spreadsheetId } : {}),
    ...(chartNote ? { chartNote } : {}),
  };
}
