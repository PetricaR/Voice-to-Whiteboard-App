/**
 * Reads the cells of an imported file the way a person reads the spreadsheet
 * it came from: which character separates the columns, and, column by column,
 * whether the text is a number ("1.234,56", "$1,234.50", "12%"), a date
 * ("14.03.2026", "3/14/2026", "14 Mar 2026") or a yes/no flag.
 *
 * Values are stored typed (numbers, ISO dates, 1/0), so SQL written against
 * the table can aggregate and order them without string surgery.
 */

export type Cell = string | number | null;

export interface ColumnReading {
  kind: 'text' | 'number' | 'date' | 'datetime' | 'flag';
  /** "percent", or a currency code such as "USD", "EUR", "RON". */
  unit?: string;
  /** How the text was read, for the column description. */
  note?: string;
}

const DELIMITERS = [',', ';', '\t', '|'] as const;
const SNIFF_LINES = 30;

/** Separators outside quotes, per line. */
function countOutsideQuotes(line: string): Record<string, number> {
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0, '|': 0 };
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') i++;
      else inQuotes = !inQuotes;
    } else if (!inQuotes && ch in counts) {
      counts[ch]++;
    }
  }
  return counts;
}

/**
 * The column separator of a delimited text file: the character that appears
 * the same number of times on (nearly) every line. A European export uses
 * ";" because "," is its decimal mark.
 */
export function sniffDelimiter(text: string, fallback = ','): string {
  const lines = text.replace(/^﻿/, '').split(/\r\n|\n|\r/).filter((l) => l.trim() !== '').slice(0, SNIFF_LINES);
  if (lines.length === 0) return fallback;
  const perLine = lines.map(countOutsideQuotes);
  let best = fallback;
  let bestScore = 0;
  for (const d of DELIMITERS) {
    const header = perLine[0][d];
    if (header === 0) continue;
    // Lines with as many separators as the header: a decimal comma or a comma inside free text varies
    const agreeing = perLine.filter((c) => c[d] === header).length;
    const consistency = agreeing / perLine.length;
    if (consistency < 0.6) continue;
    const score = header * consistency;
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

const NULL_TOKEN = /^(null|na|n\/a|nan|#n\/a|#na|#null!|-|--|—)$/i;

function toScalar(raw: unknown): string | number | boolean | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'bigint') return Number(raw);
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw.toISOString();
  if (typeof raw === 'object') return JSON.stringify(raw);
  const s = String(raw).trim();
  return s === '' || NULL_TOKEN.test(s) ? null : s;
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

interface NumberShape {
  /** The value when "." is the decimal mark, and when "," is. */
  dot?: number;
  comma?: number;
  percent: boolean;
  currency?: string;
  /** "007": a code, not a quantity. */
  code: boolean;
}

const CURRENCY_TOKENS: [RegExp, string][] = [
  [/^(?:US\$|\$|USD)/i, 'USD'],
  [/^(?:€|EUR)/i, 'EUR'],
  [/^(?:£|GBP)/i, 'GBP'],
  [/^(?:RON|LEI)/i, 'RON'],
  [/^(?:CHF)/i, 'CHF'],
  [/^(?:¥|JPY)/i, 'JPY'],
];
const CURRENCY_SUFFIX: [RegExp, string][] = [
  [/(?:US\$|\$|USD)$/i, 'USD'],
  [/(?:€|EUR)$/i, 'EUR'],
  [/(?:£|GBP)$/i, 'GBP'],
  [/(?:RON|LEI)$/i, 'RON'],
  [/(?:CHF)$/i, 'CHF'],
  [/(?:¥|JPY)$/i, 'JPY'],
];

const INT = /^\d+$/;
const DOT_DECIMAL = /^\d*\.\d+$/;
const COMMA_DECIMAL = /^\d+,\d+$/;
const EXPONENT = /^\d+(?:\.\d+)?[eE][+-]?\d+$/;
const GROUPED_COMMA = /^[1-9]\d{0,2}(?:,\d{3})+(\.\d+)?$/;
const GROUPED_DOT = /^[1-9]\d{0,2}(?:\.\d{3})+(,\d+)?$/;
const GROUPED_SPACE = /^[1-9]\d{0,2}(?: \d{3})+(?:([.,])(\d+))?$/;
const GROUPED_APOSTROPHE = /^[1-9]\d{0,2}(?:'\d{3})+(\.\d+)?$/;

/** Reads one text cell as a number under each decimal convention it fits; null when it is not a number. */
function numberShape(text: string): NumberShape | null {
  let t = text.replace(/[   ]/g, ' ').replace(/−/g, '-').trim();
  if (t === '' || t.length > 40) return null;
  let negative = false;
  let percent = false;
  let plus = false;
  let currency: string | undefined;
  const paren = /^\((.+)\)$/.exec(t);
  if (paren) {
    negative = true;
    t = paren[1].trim();
  }
  // Signs, a currency and a percent sign around the digits, in any order
  for (let changed = true; changed;) {
    changed = false;
    if (/^[+-]/.test(t)) {
      if (t[0] === '-') negative = !negative;
      else plus = true;
      t = t.slice(1).trim();
      changed = true;
    }
    if (t.endsWith('%')) {
      percent = true;
      t = t.slice(0, -1).trim();
      changed = true;
    }
    for (const [re, code] of CURRENCY_TOKENS) {
      const m = re.exec(t);
      if (m && currency === undefined) {
        currency = code;
        t = t.slice(m[0].length).trim();
        changed = true;
      }
    }
    for (const [re, code] of CURRENCY_SUFFIX) {
      const m = re.exec(t);
      if (m && currency === undefined && m.index > 0) {
        currency = code;
        t = t.slice(0, m.index).trim();
        changed = true;
      }
    }
  }
  if (t === '') return null;
  const sign = negative ? -1 : 1;
  const shape: NumberShape = { percent, currency, code: false };
  const num = (s: string) => sign * Number(s);

  if (INT.test(t)) {
    if (t.length > 15) return null;
    shape.code = t.length > 1 && t[0] === '0';
    shape.dot = shape.comma = num(t);
  } else if (EXPONENT.test(t)) {
    shape.dot = num(t);
  } else if (GROUPED_COMMA.test(t)) {
    shape.dot = num(t.replace(/,/g, ''));
    // "1,234" is also 1.234 with a decimal comma
    if (COMMA_DECIMAL.test(t)) shape.comma = num(t.replace(',', '.'));
  } else if (GROUPED_DOT.test(t)) {
    shape.comma = num(t.replace(/\./g, '').replace(',', '.'));
    // "1.234" is also 1.234 with a decimal point
    if (DOT_DECIMAL.test(t)) shape.dot = num(t);
  } else if (DOT_DECIMAL.test(t)) {
    shape.code = /^0\d/.test(t);
    shape.dot = num(t);
  } else if (COMMA_DECIMAL.test(t)) {
    shape.code = /^0\d/.test(t);
    shape.comma = num(t.replace(',', '.'));
  } else if (GROUPED_APOSTROPHE.test(t)) {
    shape.dot = num(t.replace(/'/g, ''));
  } else {
    const spaced = GROUPED_SPACE.exec(t);
    // "+40 721 234 567" is a phone number
    if (!spaced || plus) return null;
    const whole = t.replace(/ /g, '').replace(/[.,]\d+$/, '');
    const value = num(spaced[2] ? `${whole}.${spaced[2]}` : whole);
    if (spaced[1] !== ',') shape.dot = value;
    if (spaced[1] !== '.') shape.comma = value;
  }
  if (shape.dot === undefined && shape.comma === undefined) return null;
  if ((shape.dot !== undefined && !Number.isFinite(shape.dot)) || (shape.comma !== undefined && !Number.isFinite(shape.comma))) return null;
  return shape;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?\s*(?:Z|UTC|[+-]\d{2}:?\d{2})?$/;
const YMD_SLASH = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
const NUMERIC_DATE = /^(\d{1,2})([./-])(\d{1,2})\2(\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*([AaPp])\.?[Mm]?\.?)?$/;
const NUMERIC_DATE_24H = /^(\d{1,2})([./-])(\d{1,2})\2(\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?$/;
const DAY_MONTHNAME = /^(\d{1,2})[ .-]+([A-Za-zăâîșşțţ]{3,10})\.?[ ,.-]+(\d{4})$/;
const MONTHNAME_DAY = /^([A-Za-zăâîșşțţ]{3,10})\.? +(\d{1,2})(?:st|nd|rd|th)?,? +(\d{4})$/;

const MONTHS: Record<string, number> = {};
[
  ['jan', 'january', 'ian', 'ianuarie'], ['feb', 'february', 'februarie'], ['mar', 'march', 'martie'],
  ['apr', 'april', 'aprilie'], ['may', 'mai'], ['jun', 'june', 'iun', 'iunie'], ['jul', 'july', 'iul', 'iulie'],
  ['aug', 'august'], ['sep', 'sept', 'september', 'septembrie'], ['oct', 'october', 'octombrie'],
  ['nov', 'november', 'noi', 'noiembrie'], ['dec', 'december', 'decembrie'],
].forEach((names, i) => names.forEach((n) => { MONTHS[n] = i + 1; }));

const pad2 = (n: number) => String(n).padStart(2, '0');

function validDate(y: number, m: number, d: number): boolean {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function isoOf(y: number, m: number, d: number, time?: { h: number; min: number; s: number }): string | null {
  if (!validDate(y, m, d)) return null;
  const date = `${y}-${pad2(m)}-${pad2(d)}`;
  if (!time) return date;
  if (time.h > 23 || time.min > 59 || time.s > 59) return null;
  return `${date} ${pad2(time.h)}:${pad2(time.min)}:${pad2(time.s)}`;
}

interface DateShape {
  /** Already ISO: kept as written. */
  iso?: boolean;
  /** The ISO value when its order is not in doubt (year first, or a month name). */
  value?: string;
  /** "14.03.2026": the two readings of a numeric day/month pair (null when impossible). */
  dmy?: string | null;
  mdy?: string | null;
  separator?: string;
  hasTime: boolean;
}

function dateShape(text: string): DateShape | null {
  if (ISO_DATE.test(text)) return { iso: true, hasTime: false };
  if (ISO_DATETIME.test(text)) {
    // SQLite reads "…Z" and "…+02:00" but not the "UTC" BigQuery writes
    const utc = /\s*UTC$/.exec(text);
    return utc ? { value: text.slice(0, utc.index), hasTime: true } : { iso: true, hasTime: true };
  }
  let m = YMD_SLASH.exec(text);
  if (m) {
    const time = m[4] !== undefined ? { h: Number(m[4]), min: Number(m[5]), s: Number(m[6] ?? 0) } : undefined;
    const value = isoOf(Number(m[1]), Number(m[2]), Number(m[3]), time);
    return value ? { value, hasTime: time !== undefined } : null;
  }
  m = NUMERIC_DATE.exec(text) ?? NUMERIC_DATE_24H.exec(text);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[3]);
    const y = Number(m[4]);
    let time: { h: number; min: number; s: number } | undefined;
    if (m[5] !== undefined) {
      let h = Number(m[5]);
      const meridiem = m[8]?.toLowerCase();
      if (meridiem === 'p' && h < 12) h += 12;
      if (meridiem === 'a' && h === 12) h = 0;
      time = { h, min: Number(m[6]), s: Number(m[7] ?? 0) };
    }
    const dmy = isoOf(y, b, a, time);
    const mdy = isoOf(y, a, b, time);
    if (!dmy && !mdy) return null;
    return { dmy, mdy, separator: m[2], hasTime: time !== undefined };
  }
  m = DAY_MONTHNAME.exec(text);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    const value = month ? isoOf(Number(m[3]), month, Number(m[1])) : null;
    return value ? { value, hasTime: false } : null;
  }
  m = MONTHNAME_DAY.exec(text);
  if (m) {
    const month = MONTHS[m[1].toLowerCase()];
    const value = month ? isoOf(Number(m[3]), month, Number(m[2])) : null;
    return value ? { value, hasTime: false } : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

const FLAG_WORDS: [string, string][] = [['true', 'false'], ['yes', 'no'], ['y', 'n'], ['da', 'nu']];

/** Headers of columns whose digits are a code, never a quantity. */
const CODE_HEADER = /(phone|telefon|mobile|fax|zip|postal|postcode|iban|swift|cnp|cui|ean|barcode|isbn|sku)/i;
const PROBE_CELLS = 24;

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

interface ColumnDraft {
  values: (string | number | boolean | null)[];
  strings: string[];
  numbers: NumberShape[] | null;
  dates: DateShape[] | null;
  flag: [string, string] | null;
  typed: 'number' | 'boolean' | 'mixed' | 'string' | 'empty';
}

function draftColumn(values: (string | number | boolean | null)[], header: string): ColumnDraft {
  const present = values.filter((v) => v !== null);
  const strings = present.filter((v): v is string => typeof v === 'string');
  const draft: ColumnDraft = { values, strings, numbers: null, dates: null, flag: null, typed: 'string' };
  if (present.length === 0) {
    draft.typed = 'empty';
    return draft;
  }
  if (strings.length === 0) {
    draft.typed = present.every((v) => typeof v === 'boolean') ? 'boolean' : 'number';
    return draft;
  }
  if (strings.length < present.length) {
    // Numbers next to text: numbers only if every text cell is one too
    draft.typed = 'mixed';
  }
  // The first cells rule most columns out before every cell is read
  const head = strings.slice(0, PROBE_CELLS);
  if (draft.typed === 'string') {
    const lower = new Set(strings.map((s) => s.toLowerCase()));
    draft.flag = FLAG_WORDS.find(([yes, no]) =>
      [...lower].every((v) => v === yes || v === no) && (yes === 'true' || (lower.has(yes) && lower.has(no)))) ?? null;
    if (draft.flag) return draft;
    if (head.every((s) => dateShape(s) !== null)) {
      const dates = strings.map(dateShape);
      if (dates.every((d): d is DateShape => d !== null)) {
        draft.dates = dates;
        return draft;
      }
    }
  }
  if (!CODE_HEADER.test(header) && head.every((s) => numberShape(s) !== null)) {
    const numbers = strings.map(numberShape);
    if (numbers.every((n): n is NumberShape => n !== null) && !numbers.some((n) => n.code)) draft.numbers = numbers;
  }
  return draft;
}

/**
 * Reads every column of a file as typed values. `rows` are the data rows
 * (cells as parsed from the file, or values of JSON/Parquet objects).
 * `decimalComma` says the file comes from a locale that writes 1.234,56
 * (a ";" separated export); columns that settle the question themselves win.
 */
export function readColumns(
  rows: unknown[][],
  headers: string[],
  opts: { decimalComma?: boolean } = {},
): { rows: Cell[][]; readings: ColumnReading[] } {
  const width = headers.length;
  const scalars = rows.map((r) => headers.map((_, c) => toScalar(r[c])));
  const drafts = headers.map((h, c) => draftColumn(scalars.map((r) => r[c]), h));

  // The decimal mark of the file: columns that can only be read one way decide for the others
  let dotOnly = 0;
  let commaOnly = 0;
  for (const d of drafts) {
    if (!d.numbers) continue;
    const dot = d.numbers.every((n) => n.dot !== undefined);
    const comma = d.numbers.every((n) => n.comma !== undefined);
    if (dot && !comma) dotOnly++;
    if (comma && !dot) commaOnly++;
  }
  const preferComma = commaOnly > dotOnly || (commaOnly === dotOnly && dotOnly === 0 && opts.decimalComma === true);

  // The day/month order of the file, from the columns that show a day above 12
  let dayFirst = 0;
  let monthFirst = 0;
  for (const d of drafts) {
    if (!d.dates) continue;
    const pairs = d.dates.filter((x) => x.dmy !== undefined || x.mdy !== undefined);
    if (pairs.length === 0) continue;
    if (pairs.every((x) => x.dmy) && pairs.some((x) => !x.mdy)) dayFirst++;
    if (pairs.every((x) => x.mdy) && pairs.some((x) => !x.dmy)) monthFirst++;
  }

  const readings: ColumnReading[] = [];
  const columns: Cell[][] = [];
  for (let c = 0; c < width; c++) {
    const d = drafts[c];
    const fallback = (): Cell[] => d.values.map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v));

    if (d.typed === 'empty' || d.typed === 'number') {
      readings.push({ kind: d.typed === 'number' ? 'number' : 'text' });
      columns.push(fallback());
      continue;
    }
    if (d.typed === 'boolean') {
      readings.push({ kind: 'flag', note: '1 = true, 0 = false' });
      columns.push(fallback());
      continue;
    }
    if (d.flag) {
      const [yes, no] = d.flag;
      const spelled = (word: string) => d.strings.find((s) => s.toLowerCase() === word) ?? word;
      readings.push({ kind: 'flag', note: `1 = "${spelled(yes)}", 0 = "${spelled(no)}"` });
      columns.push(d.values.map((v) => (v === null ? null : String(v).toLowerCase() === yes ? 1 : 0)));
      continue;
    }
    if (d.dates) {
      const pairs = d.dates.filter((x) => x.dmy !== undefined || x.mdy !== undefined);
      const canDmy = pairs.every((x) => x.dmy);
      const canMdy = pairs.every((x) => x.mdy);
      if (pairs.length === 0 || canDmy || canMdy) {
        const separator = pairs[0]?.separator;
        // A day above 12 settles it; otherwise the other date columns, then the locale of the file
        const useDmy = canDmy && (!canMdy || (dayFirst !== monthFirst ? dayFirst > monthFirst : separator === '.' || separator === '-' || preferComma));
        const hasTime = d.dates.some((x) => x.hasTime);
        const allIso = d.dates.every((x) => x.iso);
        let i = 0;
        columns.push(d.values.map((v) => {
          if (v === null) return null;
          const shape = d.dates![i++];
          if (shape.iso) return String(v);
          return shape.value ?? (useDmy ? shape.dmy! : shape.mdy!);
        }));
        readings.push({
          kind: hasTime ? 'datetime' : 'date',
          ...(allIso ? {} : { note: pairs.length > 0 ? `dates read as ${useDmy ? 'day/month/year' : 'month/day/year'}` : 'dates converted to ISO' }),
        });
        continue;
      }
    }
    if (d.numbers) {
      const dot = d.numbers.every((n) => n.dot !== undefined);
      const comma = d.numbers.every((n) => n.comma !== undefined);
      if (dot || comma) {
        const useComma = comma && (!dot || preferComma);
        const currencies = new Set(d.numbers.map((n) => n.currency).filter((x): x is string => x !== undefined));
        const percent = d.numbers.some((n) => n.percent);
        const unit = percent ? 'percent' : currencies.size === 1 ? [...currencies][0] : undefined;
        const decorated = percent || currencies.size > 0 || d.strings.some((s) => !/^-?\d+(\.\d+)?$/.test(s));
        let i = 0;
        columns.push(d.values.map((v) => {
          if (v === null) return null;
          if (typeof v !== 'string') return typeof v === 'boolean' ? (v ? 1 : 0) : v;
          const shape = d.numbers![i++];
          return (useComma ? shape.comma : shape.dot) as number;
        }));
        readings.push({
          kind: 'number',
          ...(unit ? { unit } : {}),
          ...(decorated ? { note: percent ? 'percent values' : unit ? `amounts in ${unit}` : `numbers read with a decimal ${useComma ? 'comma' : 'point'}` } : {}),
        });
        continue;
      }
    }
    readings.push({ kind: 'text' });
    columns.push(fallback());
  }

  return {
    rows: scalars.map((_, r) => columns.map((col) => col[r])),
    readings,
  };
}
