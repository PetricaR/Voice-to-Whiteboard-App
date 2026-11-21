/**
 * Editable PowerPoint export of a deck (pptxgenjs, in the browser or in Node).
 *
 * The file is a structured deck: one PowerPoint layout per slide layout of the
 * studio (background, title placeholder, slide number), sections (Introduction,
 * Findings, each section slide, Conclusion), real titles (so the outline,
 * accessibility tools and Google Slides see them), native charts with their
 * data, native tables, and speaker notes. Every element comes from
 * engine/deckLayout.ts, the same layout the studio draws.
 */
import JSZip from 'jszip';
import PptxGenJS from 'pptxgenjs';
import { SLIDE_LAYOUTS, type DeckSpec, type SlideLayout } from '../engine/deck';
import {
  SLIDE_H,
  SLIDE_W,
  chartNumberFormat,
  layoutSlide,
  themeOf,
  type ChartEl,
  type DeckTheme,
  type ShapeEl,
  type TableEl,
  type TextEl,
} from '../engine/deckLayout';

type Pres = InstanceType<typeof PptxGenJS>;
type PSlide = ReturnType<Pres['addSlide']>;

const LAYOUT_NAMES: Record<SlideLayout, string> = {
  title: 'Deck Title',
  section: 'Deck Section',
  kpis: 'Deck Metrics',
  chart: 'Deck Chart',
  points: 'Deck Points',
  flow: 'Deck Flow',
  table: 'Deck Table',
  statement: 'Deck Statement',
  closing: 'Deck Closing',
};

const DARK = new Set<SlideLayout>(['title', 'section', 'closing']);

function fontOf(el: TextEl, t: DeckTheme) {
  return el.font === 'head' ? t.headFont : t.bodyFont;
}

/** One PowerPoint layout per slide layout, with the title placeholder where the studio puts the title. */
function defineLayouts(pres: Pres, deck: DeckSpec, t: DeckTheme) {
  for (const layout of SLIDE_LAYOUTS) {
    const sample: DeckSpec = { ...deck, slides: [{ id: 's', layout, title: 'Title' }] };
    const frame = layoutSlide(sample, 0);
    const title = frame.elements.find((e): e is TextEl => e.kind === 'text' && e.role === 'title');
    const objects: NonNullable<Parameters<Pres['defineSlideMaster']>[0]['objects']> = [];
    if (title) {
      objects.push({
        placeholder: {
          options: {
            name: 'title',
            type: 'title',
            x: title.x,
            y: title.y,
            w: title.w,
            h: title.h,
            fontFace: fontOf(title, t),
            color: title.color,
            bold: title.bold === true,
            valign: title.valign ?? 'top',
            align: 'left',
            margin: 0,
          },
          text: '',
        },
      });
    }
    pres.defineSlideMaster({
      title: LAYOUT_NAMES[layout],
      background: { color: frame.background },
      objects,
      ...(DARK.has(layout) || frame.number == null
        ? {}
        : {
            slideNumber: {
              x: frame.number.x,
              y: frame.number.y,
              w: frame.number.w,
              h: frame.number.h,
              fontFace: t.bodyFont,
              fontSize: frame.number.size,
              color: frame.number.color,
              align: 'right',
            },
          }),
    });
  }
}

function runsOf(el: TextEl): PptxGenJS.TextProps[] {
  const out: PptxGenJS.TextProps[] = [];
  el.paras.forEach((p, pi) => {
    p.runs.forEach((r, ri) => {
      const lastRun = ri === p.runs.length - 1;
      out.push({
        text: r.text,
        options: {
          ...(r.bold !== undefined ? { bold: r.bold } : {}),
          ...(r.italic ? { italic: true } : {}),
          ...(r.color ? { color: r.color } : {}),
          ...(r.size ? { fontSize: r.size } : {}),
          ...(p.bullet ? { bullet: { indent: 16 } } : {}),
          ...(lastRun && pi < el.paras.length - 1 ? { breakLine: true } : {}),
        },
      });
    });
  });
  return out;
}

function addText(slide: PSlide, el: TextEl, t: DeckTheme) {
  const common = {
    fontSize: el.size,
    bold: el.bold === true,
    color: el.color,
    align: el.align ?? 'left',
    valign: el.valign ?? 'top',
    margin: 0,
    ...(el.charSpacing ? { charSpacing: el.charSpacing } : {}),
    ...(el.lineSpacing && el.lineSpacing !== 1 ? { lineSpacingMultiple: el.lineSpacing } : {}),
    ...(el.paraSpaceAfter ? { paraSpaceAfter: el.paraSpaceAfter } : {}),
  } as const;
  if (el.role === 'title') {
    slide.addText(runsOf(el), { placeholder: 'title', ...common });
    return;
  }
  slide.addText(runsOf(el), {
    x: el.x,
    y: el.y,
    w: el.w,
    h: el.h,
    fontFace: fontOf(el, t),
    isTextBox: true,
    objectName: el.name,
    ...common,
  });
}

function addShape(pres: Pres, slide: PSlide, el: ShapeEl) {
  const type = el.shape === 'ellipse'
    ? pres.ShapeType.ellipse
    : el.shape === 'roundRect'
      ? pres.ShapeType.roundRect
      : el.shape === 'chevron'
        ? pres.ShapeType.chevron
        : el.shape === 'line'
          ? pres.ShapeType.line
          : pres.ShapeType.rect;
  slide.addShape(type, {
    x: el.x,
    y: el.y,
    w: el.w,
    h: el.h,
    objectName: el.name,
    ...(el.fill ? { fill: { color: el.fill, ...(el.transparency ? { transparency: el.transparency } : {}) } } : {}),
    ...(el.line ? { line: { color: el.line, width: el.lineWidth ?? 1 } } : {}),
    ...(el.shape === 'roundRect' && el.radius ? { rectRadius: el.radius } : {}),
  });
}

function addChart(pres: Pres, slide: PSlide, el: ChartEl, t: DeckTheme, title: string) {
  const c = el.chart;
  // PowerPoint draws the first category of a horizontal bar chart at the bottom: reverse to read top-down
  const flip = c.type === 'bar';
  const order = c.categories.map((_, i) => (flip ? c.categories.length - 1 - i : i));
  const labels = order.map((i) => c.categories[i]);
  const data = c.series.map((s) => ({ name: s.name, labels, values: order.map((i) => s.values[i] ?? 0) }));
  const colors = el.perPoint ? order.map((i) => el.colors[i]) : [...el.colors];
  const code = chartNumberFormat(c);
  const n = c.categories.length;
  const base: PptxGenJS.IChartOpts = {
    x: el.x,
    y: el.y,
    w: el.w,
    h: el.h,
    objectName: el.name,
    altText: `${title} (chart)`,
    chartColors: colors,
    showLegend: c.series.length > 1 || c.type === 'donut',
    legendPos: c.type === 'donut' ? 'r' : 'b',
    legendFontSize: 12,
    legendFontFace: t.bodyFont,
    legendColor: t.muted,
    catAxisLabelColor: t.muted,
    catAxisLabelFontSize: 12,
    catAxisLabelFontFace: t.bodyFont,
    catAxisLineShow: true,
    catAxisLineColor: t.rule,
    valAxisLabelColor: t.muted,
    valAxisLabelFontSize: 11,
    valAxisLabelFontFace: t.bodyFont,
    valAxisLabelFormatCode: code,
    dataLabelColor: t.ink,
    dataLabelFontSize: 12,
    dataLabelFontFace: t.bodyFont,
    dataLabelFormatCode: code,
    catGridLine: { style: 'none' },
  };
  if (c.type === 'donut') {
    slide.addChart(pres.ChartType.doughnut, data, {
      ...base,
      holeSize: 62,
      showPercent: true,
      showValue: false,
      dataLabelColor: 'FFFFFF',
      dataLabelFontSize: 12,
      dataLabelFormatCode: '0%',
      legendFontSize: 13,
    });
    return;
  }
  if (c.type === 'line' || c.type === 'area') {
    slide.addChart(c.type === 'line' ? pres.ChartType.line : pres.ChartType.area, data, {
      ...base,
      valGridLine: { color: 'E6E9EF', size: 0.75 },
      valAxisLineShow: false,
      lineSize: c.type === 'line' ? 2.5 : 1,
      lineDataSymbol: c.type === 'line' && n <= 12 ? 'circle' : 'none',
      lineDataSymbolSize: 7,
      ...(c.type === 'area' ? { chartColorsOpacity: 75 } : {}),
      showValue: c.series.length === 1 && n <= 8,
      dataLabelPosition: 't',
    });
    return;
  }
  const stacked = c.type === 'stacked_column';
  slide.addChart(pres.ChartType.bar, data, {
    ...base,
    barDir: c.type === 'bar' ? 'bar' : 'col',
    ...(stacked ? { barGrouping: 'stacked' } : {}),
    barGapWidthPct: 60,
    valAxisHidden: true,
    valGridLine: { style: 'none' },
    showValue: true,
    // outEnd on a stacked chart corrupts the file
    dataLabelPosition: stacked ? 'ctr' : 'outEnd',
    ...(stacked ? { dataLabelColor: 'FFFFFF' } : {}),
  });
}

function addTable(slide: PSlide, el: TableEl, t: DeckTheme) {
  const rule = { type: 'solid' as const, pt: 0.75, color: t.rule };
  const none = { type: 'none' as const };
  const header: PptxGenJS.TableCell[] = el.columns.map((c, i) => ({
    text: c,
    options: { bold: true, color: 'FFFFFF', fill: { color: t.dark }, align: el.numeric[i] ? 'right' : 'left', border: [none, none, none, none] },
  }));
  const body: PptxGenJS.TableCell[][] = el.rows.map((r, ri) =>
    el.columns.map((_, i) => ({
      text: r[i] ?? '',
      options: {
        color: t.ink,
        align: el.numeric[i] ? 'right' : 'left',
        ...(ri % 2 === 1 ? { fill: { color: t.soft } } : {}),
        border: [none, none, rule, none],
      },
    })));
  slide.addTable([header, ...body], {
    x: el.x,
    y: el.y,
    w: el.w,
    colW: el.colW,
    rowH: el.rowH,
    fontFace: t.bodyFont,
    fontSize: el.size,
    valign: 'middle',
    margin: [0.05, 0.12, 0.05, 0.12],
    autoPage: false,
    objectName: el.name,
  });
}

function sectionOf(layout: SlideLayout, current: string | null, title: string): string {
  if (layout === 'section') return title;
  if (layout === 'closing') return 'Conclusion';
  if (current == null) return 'Introduction';
  if (current === 'Introduction' && layout !== 'title' && layout !== 'statement') return 'Findings';
  return current;
}

/** Builds the PowerPoint presentation of a deck. */
export function buildPptx(deck: DeckSpec): Pres {
  const t = themeOf(deck);
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE';
  pres.title = deck.title;
  pres.subject = deck.subtitle ?? deck.title;
  pres.author = deck.author ?? 'Voice Whiteboard Studio';
  pres.theme = { headFontFace: t.headFont, bodyFontFace: t.bodyFont };
  defineLayouts(pres, deck, t);

  let section: string | null = null;
  deck.slides.forEach((s, i) => {
    const next = sectionOf(s.layout, section, s.title);
    if (next !== section) {
      pres.addSection({ title: next.slice(0, 60) });
      section = next;
    }
    const slide = pres.addSlide({ masterName: LAYOUT_NAMES[s.layout], sectionTitle: section! });
    const frame = layoutSlide(deck, i);
    for (const el of frame.elements) {
      if (el.kind === 'text') addText(slide, el, t);
      else if (el.kind === 'shape') addShape(pres, slide, el);
      else if (el.kind === 'chart') addChart(pres, slide, el, t, s.title);
      else addTable(slide, el, t);
    }
    if (s.notes) slide.addNotes(s.notes);
  });
  return pres;
}

export const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/**
 * The file without the folder entries pptxgenjs writes into the ZIP: cloud
 * services (Google Drive among them) fail to open or convert such files.
 */
async function packed<T extends 'blob' | 'uint8array'>(deck: DeckSpec, type: T): Promise<T extends 'blob' ? Blob : Uint8Array> {
  const raw = (await buildPptx(deck).write({ outputType: 'arraybuffer' })) as ArrayBuffer;
  const src = await JSZip.loadAsync(raw);
  const out = new JSZip();
  for (const [name, file] of Object.entries(src.files)) {
    if (file.dir) continue;
    out.file(name, await file.async('uint8array'), { createFolders: false, date: file.date });
  }
  return out.generateAsync({ type, mimeType: PPTX_MIME, compression: 'DEFLATE' }) as Promise<T extends 'blob' ? Blob : Uint8Array>;
}

/** The deck as a .pptx file (browser). */
export function deckToPptxBlob(deck: DeckSpec): Promise<Blob> {
  return packed(deck, 'blob');
}

/** The deck as .pptx bytes (Node, tests). */
export function deckToPptxBytes(deck: DeckSpec): Promise<Uint8Array> {
  return packed(deck, 'uint8array');
}

/** Slide size of the export, for checks. */
export const PPTX_SIZE_IN = { w: SLIDE_W, h: SLIDE_H };
