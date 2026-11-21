/**
 * What a table means, worked out from its values rather than its SQL types:
 * which column is time and at what grain, which numbers are measures and
 * whether they add up, which are flags, codes or identifiers, what one row
 * stands for, and which dimensions actually explain the numbers.
 *
 * A chart is only as good as this reading: summing a price, averaging an id,
 * counting rows that are spread evenly or drawing 15-minute data as three
 * daily bars are all mistakes of understanding, not of drawing.
 *
 * Pure: it takes rows and returns the profile, so it serves local tables,
 * samples of warehouse tables, and (without rows) a schema alone.
 */
import type { SqlDialect } from './sqlGuard';
import { epochMsOfIso } from './timeValues';

export type ProfileCell = string | number | boolean | null;

export type ColumnRole = 'time' | 'measure' | 'dimension' | 'flag' | 'id' | 'text' | 'constant' | 'empty';
export type CalendarPart = 'year' | 'quarter' | 'month' | 'week' | 'weekday' | 'day' | 'hour' | 'slot';
export type TimeFormat = 'datetime' | 'date' | 'month' | 'quarter' | 'week' | 'year';
export type TimeBucket = 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';
export type TableKind = 'time_series' | 'events' | 'entities' | 'records' | 'empty';
export type MeasureNature = 'amount' | 'count' | 'stock' | 'level' | 'rate' | 'price' | 'score' | 'duration' | 'statistic';
export type MeasureFormat = 'currency_usd' | 'currency_eur' | 'currency_gbp' | 'percent' | 'compact' | 'number' | 'ms' | 'bytes';

export interface TimeInsight {
  format: TimeFormat;
  from: string;
  to: string;
  /** Distinct moments in the data. */
  periods: number;
  /** Seconds between consecutive moments, when they come at a regular pace. */
  stepSeconds?: number;
  /** "15 min", "day", "month"…, or "irregular" for event timestamps. */
  grain: string;
  /** Days between the first and the last moment. */
  spanDays?: number;
  /** When the row was loaded or scored, not when the fact happened. */
  audit?: boolean;
  /** A date that describes the row (renewal, due date), not the moment it happened. */
  attribute?: boolean;
}

export interface MeasureInsight {
  /** How rows combine: amounts and counts add up; rates, prices and levels are averaged. */
  aggregate: 'sum' | 'avg';
  nature: MeasureNature;
  /** True when no name or unit says how it combines and the shape of the table decided. */
  guessed?: boolean;
  /** "USD", "percent", "fraction" (0–1), "ms", "MW"… */
  unit?: string;
  format?: MeasureFormat;
  min: number;
  max: number;
  mean: number;
  median: number;
  /** The value 95% of the rows stay under: where the long tail starts. */
  p95: number;
  /** Sum over the profiled rows (additive measures only). */
  total?: number;
  zeroPct: number;
  negative: boolean;
  /** A level at one moment (MRR, stock, active users): add it across categories, never across periods. */
  snapshot?: boolean;
  /** A long tail: the mean is far from the median. */
  skewed?: boolean;
}

export interface ColumnInsight {
  name: string;
  type: string;
  description?: string;
  role: ColumnRole;
  nullPct: number;
  distinct: number;
  /** No value repeats. */
  unique?: boolean;
  time?: TimeInsight;
  /** A part of a date held as its own column (hour of day, weekday, month number). */
  calendar?: CalendarPart;
  measure?: MeasureInsight;
  /** Every distinct value, when there are few. */
  values?: (string | number)[];
  /** The most frequent values with their share of the rows, in percent. */
  top?: { value: string | number; pct: number }[];
  min?: string | number;
  max?: string | number;
  /** The value that means "yes" and the share of rows that have it. */
  flag?: { on: string | number; pct: number };
  /** Another flag that says yes on exactly the same rows. */
  twinOf?: string;
  geo?: 'country' | 'region' | 'city' | 'latitude' | 'longitude';
  /** Needs quoting in SQL (a reserved word). */
  reserved?: boolean;
  note?: string;
}

/** How much a dimension separates the rows: by their count, and by each leading measure. */
export interface BreakdownStrength {
  dimension: string;
  groups: number;
  /** 0 when every group has the same number of rows, towards 1 when a few groups hold most rows. */
  unevenness: number;
  /** Share of a measure's variance that the groups explain (0–1), by measure name. */
  explains: Record<string, number>;
}

export interface TableProfile {
  name: string;
  /** How to write the table in SQL of its source. */
  sqlRef: string;
  dialect: SqlDialect;
  rowCount: number;
  /** Rows the profile was computed on. */
  profiledRows: number;
  kind: TableKind;
  /** The columns that together identify one row. */
  grain?: string[];
  /** One sentence a person would say about the table. */
  about: string;
  /** The column that orders the facts in time. */
  timeColumn?: string;
  /** The bucket that gives a readable trend, and its SQL expression. */
  bucket?: { unit: TimeBucket | 'raw'; sql: string; points: number };
  /** The name that labels one row of an entity table (account, product). */
  labelColumn?: string;
  columns: ColumnInsight[];
  /** Measures, most telling first. */
  measures: string[];
  /** Dimensions worth breaking down by, best first. */
  dimensions: string[];
  flags: string[];
  breakdowns: BreakdownStrength[];
  /**
   * How much the hour of the day and the day of the week shape the data: the share of the leading
   * measure's variance they explain, and how unevenly the rows fall on them (0–1).
   */
  rhythm?: { hour?: { explains: number; unevenness: number }; weekday?: { explains: number; unevenness: number } };
  /** Strongest linear relationships between measures. */
  correlations: { a: string; b: string; r: number }[];
  /** Measures that mean the same thing as actual / forecast / target (name stems that differ only by such a word). */
  pairs: { stem: string; members: { column: string; label: string }[] }[];
  /** What a builder must know before charting. */
  notes: string[];
  /** The warehouse table these rows are a part of. */
  partOf?: { table: string; rowCount: number };
}

export interface ProfileInput {
  name: string;
  dialect: SqlDialect;
  /** SQL reference of the table; the quoted name by default. */
  sqlRef?: string;
  columns: { name: string; type: string; description?: string; unit?: string }[];
  /** The rows to read (all of them, or a sample); may be empty for a schema-only profile. */
  rows: ProfileCell[][];
  /** Rows in the table. */
  rowCount: number;
  /**
   * Exact figures computed by the database, by column name; they replace the ones read from a sample.
   * `moments` are the first distinct values of a time column in order, from which its pace is read.
   */
  exact?: Record<string, { distinct?: number; min?: string | number; max?: string | number; values?: (string | number)[]; moments?: string[] }>;
  partOf?: { table: string; rowCount: number };
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

const RESERVED = new Set([
  'add', 'all', 'alter', 'and', 'as', 'asc', 'between', 'by', 'case', 'check', 'column', 'create', 'cross', 'current',
  'default', 'delete', 'desc', 'distinct', 'drop', 'else', 'end', 'except', 'exists', 'from', 'full', 'group', 'having',
  'if', 'in', 'index', 'inner', 'insert', 'intersect', 'into', 'is', 'join', 'left', 'like', 'limit', 'natural', 'not',
  'null', 'on', 'or', 'order', 'outer', 'primary', 'references', 'right', 'select', 'set', 'table', 'then', 'to',
  'transaction', 'union', 'unique', 'update', 'using', 'values', 'when', 'where', 'window', 'with',
]);

/** Reserved by the warehouses but plain column names in SQLite. */
const WAREHOUSE_RESERVED = new Set([
  'interval', 'range', 'rows', 'partition', 'over', 'hash', 'grant', 'lookup', 'array', 'struct', 'any', 'some', 'at',
  'cast', 'contains', 'enum', 'extract', 'false', 'true', 'fetch', 'for', 'groups', 'ignore', 'merge', 'new', 'no', 'of',
  'within', 'qualify', 'lateral', 'escape', 'define', 'cube', 'rollup', 'recursive', 'unnest', 'proto', 'respect',
]);

const PLAIN_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Whether a name must be quoted to be used in SQL of this dialect. */
export function needsQuoting(name: string, dialect: SqlDialect): boolean {
  if (!PLAIN_IDENT.test(name)) return true;
  const lower = name.toLowerCase();
  return RESERVED.has(lower) || (dialect !== 'sqlite' && WAREHOUSE_RESERVED.has(lower));
}

/** A column or table name as SQL of the dialect writes it. */
export function quoteIdent(name: string, dialect: SqlDialect): string {
  if (!needsQuoting(name, dialect)) return name;
  return dialect === 'bigquery' ? `\`${name.replace(/`/g, '')}\`` : `"${name.replace(/"/g, '""')}"`;
}

/** "grossForecastConsumption", "net_revenue_usd", "wind__speed_100m" → lower-case words. */
export function nameTokens(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const has = (tokens: string[], words: readonly string[]) => tokens.some((t) => words.includes(t));

const AUDIT_WORDS = ['ingested', 'ingestion', 'loaded', 'inserted', 'updated', 'modified', 'synced', 'processed', 'scored', 'refreshed', 'etl', 'exported', 'imported', 'extracted', 'fetched', 'logged'];
const ATTRIBUTE_DATE_WORDS = ['renewal', 'expiry', 'expires', 'expiration', 'expire', 'due', 'birth', 'dob', 'birthday', 'hire', 'hired', 'deadline', 'founded', 'start', 'end', 'valid', 'until'];

const CALENDAR_NAMES: [RegExp, CalendarPart, number, number][] = [
  [/^(hour|hr|hour_of_day|hod|ora)$/, 'hour', 0, 24],
  [/^(dow|weekday|day_of_week|dayofweek|wday)$/, 'weekday', 0, 7],
  [/^(month|mon|month_num|month_number|month_of_year|luna)$/, 'month', 1, 12],
  [/^(quarter|qtr|trimestru)$/, 'quarter', 1, 4],
  [/^(week|woy|week_of_year|weekofyear|iso_week|week_num|saptamana)$/, 'week', 1, 53],
  [/^(day|dom|day_of_month|dayofmonth|zi)$/, 'day', 1, 31],
  [/^(year|yr|fiscal_year|an)$/, 'year', 1900, 2200],
  [/^(interval|slot|settlement_period|block|half_hour|quarter_hour|isp|time_slot)$/, 'slot', 0, 288],
];

const WEEKDAY_NAMES = new Set(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'luni', 'marti', 'marți', 'miercuri', 'joi', 'vineri', 'sambata', 'sâmbătă', 'duminica', 'duminică']);
const MONTH_NAMES = new Set(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec', 'january', 'february', 'march', 'april', 'june', 'july', 'august', 'september', 'october', 'november', 'december']);

const ID_SUFFIX = ['id', 'uuid', 'guid', 'key', 'hash', 'sku', 'ean', 'upc', 'isbn', 'token'];
const FLAG_PREFIX = ['is', 'has', 'was', 'can', 'should', 'did'];
const CODE_WORDS = ['status', 'code', 'version', 'level', 'tier', 'class', 'type', 'group', 'category', 'zip', 'postal', 'postcode', 'priority', 'stage', 'grade', 'bucket', 'segment', 'cluster', 'label', 'sign', 'binary', 'order', 'step', 'rank', 'position'];

const GEO_WORDS: [readonly string[], NonNullable<ColumnInsight['geo']>][] = [
  [['country', 'nation', 'tara', 'țară'], 'country'],
  [['region', 'state', 'province', 'county', 'judet', 'județ', 'continent', 'territory'], 'region'],
  [['city', 'town', 'oras', 'oraș', 'localitate', 'municipality'], 'city'],
  [['lat', 'latitude'], 'latitude'],
  [['lon', 'lng', 'longitude'], 'longitude'],
];

/** Features engineered from other columns: real, but not what a first dashboard is about. */
const DERIVED_WORDS = ['lag', 'lagged', 'roll', 'rolling', 'ewm', 'ema', 'sma', 'diff', 'sin', 'cos', 'std', 'stddev', 'shift', 'prev', 'zscore', 'norm', 'normalized', 'scaled', 'encoded', 'onehot', 'smoothed', 'raw', 'squared', 'log', 'interaction'];
const HEADLINE_WORDS = ['revenue', 'sales', 'amount', 'mrr', 'arr', 'profit', 'cost', 'spend', 'orders', 'gmv', 'bookings', 'volume', 'price', 'load', 'consumption', 'production', 'demand', 'imbalance', 'forecast', 'actual', 'realized', 'pred', 'predicted', 'total', 'users', 'customers', 'requests', 'latency', 'score', 'quantity', 'qty', 'units'];
/** Sizes of a payload: measured on every row, rarely what the table is about. */
const TECHNICAL_WORDS = ['bytes', 'size', 'length', 'offset', 'checksum'];

/** Whether a measure is what its table is about (revenue of orders) rather than a property of each row (bytes of a request). */
export function isHeadlineMeasure(c: ColumnInsight): boolean {
  const tokens = nameTokens(c.name);
  return c.measure !== undefined && !has(tokens, TECHNICAL_WORDS) && (c.measure.nature === 'amount' || c.measure.nature === 'stock' || has(tokens, HEADLINE_WORDS));
}
const DIMENSION_WORDS = ['category', 'region', 'country', 'channel', 'segment', 'plan', 'product', 'type', 'status', 'model', 'source', 'department', 'team', 'brand', 'store', 'city', 'service', 'route', 'family', 'tier', 'stage', 'device', 'platform', 'industry', 'provider', 'kind', 'method', 'surface', 'environment'];

// ---------------------------------------------------------------------------
// Scanning the values of one column
// ---------------------------------------------------------------------------

const COUNT_CAP = 3000;

interface Scan {
  present: number;
  nulls: number;
  /** Occurrences per value; null once there are too many distinct values to count. */
  counts: Map<string | number, number> | null;
  distinct: number;
  numbers: number[];
  strings: number;
  booleans: number;
  integers: boolean;
  totalLength: number;
  sampleStrings: string[];
  /** Every distinct value. */
  seen: Set<string | number>;
}

function scanColumn(rows: ProfileCell[][], idx: number): Scan {
  const scan: Scan = {
    present: 0, nulls: 0, counts: new Map(), distinct: 0, numbers: [], strings: 0, booleans: 0, integers: true, totalLength: 0, sampleStrings: [],
    seen: new Set<string | number>(),
  };
  const seen = scan.seen;
  const step = Math.max(1, Math.floor(rows.length / 60));
  for (let r = 0; r < rows.length; r++) {
    let v = rows[r][idx];
    if (v === null || v === undefined || v === '') {
      scan.nulls++;
      continue;
    }
    scan.present++;
    if (typeof v === 'boolean') {
      scan.booleans++;
      v = v ? 1 : 0;
    }
    if (typeof v === 'number') {
      scan.numbers.push(v);
      if (!Number.isInteger(v)) scan.integers = false;
    } else {
      scan.strings++;
      scan.totalLength += v.length;
      if (r % step === 0 && scan.sampleStrings.length < 80) scan.sampleStrings.push(v);
    }
    seen.add(v);
    if (scan.counts) {
      scan.counts.set(v, (scan.counts.get(v) ?? 0) + 1);
      if (scan.counts.size > COUNT_CAP) scan.counts = null;
    }
  }
  scan.distinct = seen.size;
  return scan;
}

const TIME_FORMATS: [TimeFormat, RegExp][] = [
  ['datetime', /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/],
  ['date', /^\d{4}-\d{2}-\d{2}$/],
  ['month', /^\d{4}-\d{2}$/],
  ['quarter', /^\d{4}-?Q[1-4]$/i],
  ['week', /^\d{4}-?W\d{1,2}$/i],
];

function timeFormatOf(samples: string[]): TimeFormat | null {
  if (samples.length === 0) return null;
  for (const [format, re] of TIME_FORMATS) {
    if (samples.every((s) => re.test(s.trim()))) return format;
  }
  return null;
}

function grainLabel(step: number): string {
  if (step < 1.5) return 'second';
  if (step < 3600) {
    const m = Math.round(step / 60);
    return m <= 1 ? 'minute' : `${m} min`;
  }
  if (step < 86_400) {
    const h = Math.round(step / 3600);
    return h <= 1 ? 'hour' : `${h} hours`;
  }
  if (step < 86_400 * 6.5) {
    const d = Math.round(step / 86_400);
    return d <= 1 ? 'day' : `${d} days`;
  }
  if (step < 86_400 * 10) return 'week';
  if (step < 86_400 * 45) return 'month';
  if (step < 86_400 * 120) return 'quarter';
  return 'year';
}

const FORMAT_GRAIN: Partial<Record<TimeFormat, string>> = { month: 'month', quarter: 'quarter', week: 'week', year: 'year' };
const FORMAT_STEP: Partial<Record<TimeFormat, number>> = { month: 86_400 * 30.4, quarter: 86_400 * 91.3, week: 86_400 * 7, year: 86_400 * 365.25 };

/** The pace of the moments in a time column: the usual gap between two consecutive ones. */
function paceOf(format: TimeFormat, distinctValues: string[]): { stepSeconds?: number; grain: string } {
  if (FORMAT_GRAIN[format]) return { stepSeconds: FORMAT_STEP[format], grain: FORMAT_GRAIN[format]! };
  const ms = distinctValues.map(epochMsOfIso).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (ms.length < 3) return { grain: format === 'date' ? 'day' : 'irregular', ...(format === 'date' ? { stepSeconds: 86_400 } : {}) };
  const gaps: number[] = [];
  for (let i = 1; i < ms.length; i++) gaps.push((ms[i] - ms[i - 1]) / 1000);
  const sorted = gaps.toSorted((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (median <= 0) return { grain: 'irregular' };
  const regular = gaps.filter((g) => Math.abs(g - median) <= median * 0.03).length / gaps.length;
  // Dates always fall on days; timestamps of events come at no pace at all
  if (regular < 0.6 && format === 'datetime') return { grain: 'irregular' };
  return { stepSeconds: median, grain: grainLabel(median) };
}

// ---------------------------------------------------------------------------
// Measures
// ---------------------------------------------------------------------------

const round = (v: number, digits = 4): number => {
  if (!Number.isFinite(v) || v === 0) return 0;
  const magnitude = Math.floor(Math.log10(Math.abs(v)));
  const factor = 10 ** Math.max(0, digits - 1 - magnitude);
  return Math.round(v * factor) / factor;
};

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const CURRENCY_FORMAT: Record<string, MeasureFormat> = { USD: 'currency_usd', EUR: 'currency_eur', GBP: 'currency_gbp' };

function currencyOf(tokens: string[], description: string, unit: string | undefined): string | undefined {
  if (unit && unit !== 'percent') return unit;
  if (has(tokens, ['usd', 'dollars', 'dollar'])) return 'USD';
  if (has(tokens, ['eur', 'euro', 'euros'])) return 'EUR';
  if (has(tokens, ['gbp', 'pounds'])) return 'GBP';
  if (has(tokens, ['ron', 'lei'])) return 'RON';
  if (has(tokens, ['chf'])) return 'CHF';
  const d = description;
  if (/\bUSD\b|\$/.test(d)) return 'USD';
  if (/\bEUR\b|€/.test(d)) return 'EUR';
  if (/\bGBP\b|£/.test(d)) return 'GBP';
  if (/\b(RON|lei)\b/i.test(d)) return 'RON';
  return undefined;
}

/** Words that name a share of a whole or a probability. */
const SHARE_WORDS = ['share', 'prob', 'probability', 'proba', 'likelihood', 'confidence', 'accuracy', 'acc', 'auc', 'wauc', 'precision', 'recall', 'f1', 'brier', 'ece', 'r2', 'corr', 'correlation', 'utilization', 'occupancy', 'ctr', 'cvr', 'churn', 'retention', 'ndr', 'nrr', 'grr'];
/** Words that make a "rate" a percentage (error rate, conversion rate) rather than a speed or a price. */
const RATE_CONTEXT_WORDS = ['error', 'conversion', 'return', 'success', 'failure', 'click', 'open', 'bounce', 'defect', 'growth', 'tax', 'discount', 'interest', 'win', 'loss', 'fill', 'hit', 'miss', 'completion', 'attendance', 'margin', 'yield', 'response', 'refund', 'cancel', 'cancellation', 'vat'];
const RATE_WORDS = ['pct', 'percent', 'percentage', 'rate', 'ratio', 'margin', 'yield', ...SHARE_WORDS];
const STATISTIC_WORDS = ['avg', 'average', 'mean', 'median', 'p10', 'p25', 'p50', 'p75', 'p90', 'p95', 'p99', 'max', 'std', 'stddev', 'variance', 'quantile', 'percentile', 'lo90', 'hi90', 'lower', 'upper', 'threshold', 'dispersion'];
const PRICE_WORDS = ['price', 'aov', 'arpu', 'arpa', 'ltv', 'cac', 'cpc', 'cpm', 'cpa', 'wage', 'tariff'];
const SCORE_WORDS = ['score', 'rating', 'index', 'nps', 'csat', 'stars', 'composite', 'sentiment'];
const DURATION_WORDS = ['ms', 'millis', 'milliseconds', 'sec', 'secs', 'seconds', 'minutes', 'mins', 'hours', 'hrs', 'days', 'duration', 'latency', 'elapsed', 'age', 'tenure', 'ttl', 'delay', 'wait', 'mttr', 'mtbf', 'uptime', 'downtime'];
const LEVEL_WORDS = ['mw', 'kw', 'gw', 'temperature', 'temp', 'humidity', 'pressure', 'speed', 'wind', 'irradiance', 'radiation', 'cloud', 'voltage', 'frequency', 'level', 'capacity', 'load', 'demand', 'imbalance', 'altitude', 'elevation', 'height', 'depth', 'weight', 'gusts', 'direction', 'cape', 'forecast'];
const ENERGY_WORDS = ['mwh', 'kwh', 'gwh', 'wh'];
const STOCK_WORDS = ['mrr', 'arr', 'balance', 'stock', 'inventory', 'headcount', 'active', 'outstanding', 'backlog', 'wip', 'subscribers', 'members', 'seats'];
/** What was added to or lost from a stock in a period is a flow: it adds up over time. */
const FLOW_WORDS = ['new', 'added', 'expansion', 'churned', 'lost', 'gained', 'contraction', 'net', 'delta', 'change', 'increase', 'decrease', 'upsell', 'downgrade'];
/** Positions on a scale (a day offset, a sequence number): numbers, but not quantities. */
const ORDINAL_WORDS = ['day', 'date', 'time', 'ts', 'epoch', 'start', 'end', 'offset', 'index', 'idx', 'seq', 'sequence', 'position'];
const OHLC_WORDS = ['open', 'high', 'low', 'close'];
const COUNT_WORDS = ['count', 'cnt', 'qty', 'quantity', 'units', 'orders', 'customers', 'users', 'visits', 'sessions', 'clicks', 'views', 'impressions', 'requests', 'errors', 'items', 'tickets', 'calls', 'messages', 'events', 'transactions', 'downloads', 'installs', 'signups', 'leads', 'n', 'num', 'number', 'attempts', 'bytes', 'rows', 'records', 'pageviews', 'conversions', 'purchases', 'returns', 'shipments', 'incidents', 'deals', 'millions', 'thousands'];
const AMOUNT_WORDS = ['revenue', 'sales', 'amount', 'cost', 'spend', 'budget', 'profit', 'fee', 'tax', 'payment', 'income', 'expense', 'expenses', 'gmv', 'bookings', 'billings', 'value', 'discount', 'refund', 'commission', 'total', 'volume', 'usd', 'eur', 'gbp', 'ron', 'lei', 'chf', 'payroll', 'salary', 'weighted'];

function measureInsight(
  col: ProfileInput['columns'][number],
  numbers: number[],
  present: number,
  seriesLike: boolean,
): MeasureInsight {
  const sorted = numbers.toSorted((a, b) => a - b);
  const sum = numbers.reduce((a, b) => a + b, 0);
  const min = sorted[0] ?? 0;
  const max = sorted[sorted.length - 1] ?? 0;
  const mean = numbers.length > 0 ? sum / numbers.length : 0;
  const median = quantile(sorted, 0.5);
  const iqr = quantile(sorted, 0.75) - quantile(sorted, 0.25);
  const zeros = numbers.filter((v) => v === 0).length;

  const tokens = nameTokens(col.name);
  const description = col.description ?? '';
  const last = tokens[tokens.length - 1] ?? '';
  const currency = currencyOf(tokens, description, col.unit);
  const known = numbers.length > 0;
  const within01 = known && min >= 0 && max <= 1;
  // "12%" in the file, "Discount %" in its header, or a name that says percent
  const percentWritten = col.unit === 'percent' || /%/.test(description.split('·')[0] ?? '') || has(tokens, ['pct', 'percent', 'percentage']);
  const shareWord = has(tokens, SHARE_WORDS);
  // "heart_rate", "exchange_rate" and a "margin" in euros are not shares of a whole
  const rateWord = has(tokens, ['rate', 'ratio', 'margin', 'yield']) && (!known || (min >= -100 && max <= 100));

  let nature: MeasureNature;
  let aggregate: 'sum' | 'avg';
  let unit: string | undefined;
  let format: MeasureFormat | undefined;
  let snapshot = false;
  let guessed = false;

  if (percentWritten || shareWord || rateWord) {
    nature = 'rate';
    aggregate = 'avg';
    // A share written 0–1 is a fraction: it becomes a percentage only when multiplied by 100
    unit = percentWritten ? 'percent'
      : within01 ? 'fraction'
        : (shareWord || has(tokens, RATE_CONTEXT_WORDS)) && known && min >= -100 && max <= 100 ? 'percent'
          : undefined;
    format = unit === 'percent' ? 'percent' : undefined;
  } else if (last === 'min' || last === 'mins' || has(tokens, DURATION_WORDS)) {
    nature = 'duration';
    aggregate = 'avg';
    unit = has(tokens, ['ms', 'millis', 'milliseconds']) ? 'ms'
      : has(tokens, ['sec', 'secs', 'seconds']) ? 'seconds'
        : last === 'min' || last === 'mins' || has(tokens, ['minutes']) ? 'minutes'
          : has(tokens, ['hours', 'hrs']) ? 'hours'
            : has(tokens, ['days']) ? 'days' : undefined;
    format = unit === 'ms' ? 'ms' : undefined;
  } else if (has(tokens, STATISTIC_WORDS) || tokens[0] === 'min' || tokens[0] === 'max') {
    nature = 'statistic';
    aggregate = 'avg';
  } else if (has(tokens, PRICE_WORDS) || (OHLC_WORDS.includes(tokens[0] ?? '') && tokens.length <= 2)) {
    nature = 'price';
    aggregate = 'avg';
    unit = currency;
  } else if (has(tokens, SCORE_WORDS)) {
    nature = 'score';
    aggregate = 'avg';
  } else if (has(tokens, ENERGY_WORDS)) {
    nature = 'amount';
    aggregate = 'sum';
    unit = tokens.find((t) => ENERGY_WORDS.includes(t))!.replace('wh', 'Wh').replace(/^m/, 'M').replace(/^k/, 'k').replace(/^g/, 'G');
  } else if (has(tokens, STOCK_WORDS) && !has(tokens, FLOW_WORDS)) {
    nature = 'stock';
    aggregate = 'sum';
    snapshot = true;
    unit = currency;
  } else if (has(tokens, LEVEL_WORDS)) {
    nature = 'level';
    aggregate = 'avg';
    unit = has(tokens, ['mw']) ? 'MW' : has(tokens, ['kw']) ? 'kW' : has(tokens, ['gw']) ? 'GW' : currency;
  } else if (has(tokens, AMOUNT_WORDS) || currency) {
    nature = 'amount';
    aggregate = 'sum';
    unit = currency;
  } else if (has(tokens, COUNT_WORDS)) {
    nature = 'count';
    aggregate = 'sum';
    unit = has(tokens, ['bytes']) ? 'bytes' : undefined;
    format = unit === 'bytes' ? 'bytes' : undefined;
  } else if (ORDINAL_WORDS.includes(last)) {
    nature = 'level';
    aggregate = 'avg';
  } else {
    // Nothing in the name says how it combines: readings of a series are levels, figures of a record add up
    guessed = true;
    nature = seriesLike ? 'level' : 'amount';
    aggregate = seriesLike ? 'avg' : 'sum';
  }
  if (unit && CURRENCY_FORMAT[unit] && nature !== 'rate') format = CURRENCY_FORMAT[unit];
  if (!format && aggregate === 'sum' && Math.abs(sum) >= 10_000) format = 'compact';

  return {
    aggregate,
    nature,
    ...(guessed ? { guessed } : {}),
    ...(unit ? { unit } : {}),
    ...(format ? { format } : {}),
    min: round(min),
    max: round(max),
    mean: round(mean),
    median: round(median),
    p95: round(quantile(sorted, 0.95)),
    ...(aggregate === 'sum' ? { total: round(sum, 6) } : {}),
    zeroPct: present > 0 ? round((100 * zeros) / present, 3) : 0,
    negative: min < 0,
    ...(snapshot ? { snapshot } : {}),
    ...(iqr > 0 && Math.abs(mean - median) > 0.5 * iqr ? { skewed: true } : {}),
  };
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

const NUMERIC_TYPE = /INT|REAL|FLOAT|NUM|DEC|DOUBLE/i;
const TEMPORAL_TYPE = /^(DATE|DATETIME|TIMESTAMP)$/i;
const BLOB_TYPE = /JSON|RECORD|STRUCT|ARRAY|GEOGRAPHY|BYTES/i;
const BOOL_TYPE = /BOOL/i;

function calendarPartOf(name: string, tokens: string[]): [CalendarPart, number, number] | null {
  const lower = name.toLowerCase();
  const candidates = [lower, tokens[tokens.length - 1] ?? '', tokens.slice(-2).join('_'), tokens.slice(-3).join('_')];
  for (const [re, part, lo, hi] of CALENDAR_NAMES) {
    if (candidates.some((c) => re.test(c))) return [part, lo, hi];
  }
  return null;
}

function topValues(scan: Scan, limit = 8): { value: string | number; pct: number }[] {
  if (!scan.counts || scan.present === 0) return [];
  return [...scan.counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value, n]) => ({ value: typeof value === 'string' && value.length > 40 ? `${value.slice(0, 39)}…` : value, pct: round((100 * n) / scan.present, 3) }));
}

function sortedValues(scan: Scan): (string | number)[] {
  if (!scan.counts) return [];
  const values = [...scan.counts.keys()];
  return values.every((v) => typeof v === 'number')
    ? (values as number[]).sort((a, b) => a - b)
    : values.map(String).sort();
}

const VALUES_LIMIT = 12;

function classify(
  col: ProfileInput['columns'][number],
  scan: Scan,
  rows: number,
  exact: NonNullable<ProfileInput['exact']>[string] | undefined,
  dialect: SqlDialect,
  rowCount: number,
): ColumnInsight {
  const tokens = nameTokens(col.name);
  const last = tokens[tokens.length - 1] ?? '';
  const distinct = exact?.distinct ?? scan.distinct;
  const base: ColumnInsight = {
    name: col.name,
    type: col.type,
    ...(col.description ? { description: col.description } : {}),
    role: 'dimension',
    nullPct: rows > 0 ? round((100 * scan.nulls) / rows, 3) : 0,
    distinct,
    ...(needsQuoting(col.name, dialect) ? { reserved: true } : {}),
  };
  const schemaOnly = rows === 0;
  const geo = GEO_WORDS.find(([words]) => has(tokens, words))?.[1];

  // --- No values to read: the type and the name are all there is
  if (schemaOnly) {
    if (BLOB_TYPE.test(col.type)) return { ...base, role: 'text', note: 'nested or binary: not chartable as is' };
    if (TEMPORAL_TYPE.test(col.type)) {
      return { ...base, role: 'time', time: { format: /DATE$/i.test(col.type) ? 'date' : 'datetime', from: '', to: '', periods: 0, grain: 'unknown', ...(has(tokens, AUDIT_WORDS) ? { audit: true } : {}), ...(has(tokens, ATTRIBUTE_DATE_WORDS) ? { attribute: true } : {}) } };
    }
    if (BOOL_TYPE.test(col.type) || (FLAG_PREFIX.includes(tokens[0] ?? '') && tokens.length > 1)) return { ...base, role: 'flag' };
    if (ID_SUFFIX.includes(last) || col.name.toLowerCase() === 'id') return { ...base, role: 'id' };
    if (NUMERIC_TYPE.test(col.type)) {
      const part = calendarPartOf(col.name, tokens);
      if (part) return { ...base, role: 'dimension', calendar: part[0] };
      if (geo === 'latitude' || geo === 'longitude') return { ...base, role: 'dimension', geo };
      if (CODE_WORDS.includes(last)) return { ...base, role: 'dimension', note: 'a numeric code' };
      const m = measureInsight(col, [], 0, false);
      return { ...base, role: 'measure', measure: m };
    }
    return { ...base, role: 'dimension', ...(geo ? { geo } : {}) };
  }

  if (scan.present === 0) return { ...base, role: 'empty', note: 'no values' };

  const numeric = scan.numbers.length === scan.present;
  const textual = scan.strings === scan.present;
  const values = distinct <= VALUES_LIMIT ? (exact?.values ?? sortedValues(scan)) : undefined;

  // --- Time
  const declaredTime = TEMPORAL_TYPE.test(col.type);
  const format = textual ? timeFormatOf(scan.sampleStrings) : null;
  if (format || (declaredTime && textual)) {
    const fmt: TimeFormat = format ?? 'datetime';
    const all = [...scan.seen].map(String).sort();
    const from = String(exact?.min ?? all[0] ?? '');
    const to = String(exact?.max ?? all[all.length - 1] ?? '');
    // A sample skips moments, so the pace is read from the first ones in a row when the database gave them
    const pace = paceOf(fmt, exact?.moments ?? all);
    return {
      ...base,
      role: 'time',
      ...(values ? { values } : {}),
      min: from,
      max: to,
      time: {
        format: fmt,
        from,
        to,
        periods: distinct,
        ...pace,
        ...(has(tokens, AUDIT_WORDS) ? { audit: true } : {}),
        ...(has(tokens, ATTRIBUTE_DATE_WORDS) ? { attribute: true } : {}),
      },
    };
  }

  // --- Flags
  const flagName = (FLAG_PREFIX.includes(tokens[0] ?? '') && tokens.length > 1) || last === 'flag' || last === 'ind';
  if (numeric && distinct <= 2) {
    const set = new Set(scan.numbers);
    const zeroOne = [...set].every((v) => v === 0 || v === 1);
    const sign = [...set].every((v) => v === -1 || v === 1);
    if ((zeroOne && (flagName || set.size === 2 || scan.booleans > 0 || BOOL_TYPE.test(col.type))) || (sign && set.size === 2)) {
      const on = scan.numbers.filter((v) => v === 1).length;
      return {
        ...base,
        role: 'flag',
        values: [...set].sort((a, b) => a - b),
        flag: { on: 1, pct: round((100 * on) / scan.present, 3) },
        ...(sign ? { note: 'a sign: −1 or 1' } : {}),
      };
    }
  }
  if (textual && distinct <= 2 && scan.counts) {
    const lower = [...scan.counts.keys()].map((v) => String(v).toLowerCase());
    const yes = ['true', 'yes', 'y', 'da', '1'];
    const no = ['false', 'no', 'n', 'nu', '0'];
    if (lower.every((v) => yes.includes(v) || no.includes(v))) {
      const onValue = [...scan.counts.keys()].find((v) => yes.includes(String(v).toLowerCase()));
      const on = onValue !== undefined ? scan.counts.get(onValue) ?? 0 : 0;
      return { ...base, role: 'flag', values: sortedValues(scan), flag: { on: onValue ?? 'true', pct: round((100 * on) / scan.present, 3) } };
    }
  }

  // --- A single value says nothing
  if (distinct <= 1 && rows > 1) {
    const only = scan.counts ? [...scan.counts.keys()][0] : undefined;
    return { ...base, role: 'constant', ...(only !== undefined ? { values: [only] } : {}), note: `always ${JSON.stringify(only)}` };
  }

  // In a sample, no repeat proves little: the database's count of distinct values has to agree
  const unique = scan.present >= 2 && scan.distinct === scan.present && scan.nulls === 0 &&
    (exact?.distinct === undefined || exact.distinct >= rowCount);
  const ratio = scan.present > 0 ? scan.distinct / scan.present : 0;

  // --- Text columns
  if (!numeric) {
    const avgLength = scan.strings > 0 ? scan.totalLength / scan.strings : 0;
    const blob = BLOB_TYPE.test(col.type) || scan.sampleStrings.slice(0, 20).every((s) => /^\s*[[{]/.test(s));
    if (blob) return { ...base, role: 'text', note: 'JSON or nested values: not chartable as is' };
    const idName = ID_SUFFIX.includes(last) || col.name.toLowerCase() === 'id';
    if (unique && scan.present >= 8 && avgLength <= 60) {
      return { ...base, role: 'id', unique: true, ...(idName ? {} : { note: 'a name that identifies the row' }) };
    }
    if (idName && (distinct > 50 || ratio > 0.2)) return { ...base, role: 'id', ...(unique ? { unique: true } : {}) };
    if (avgLength > 60 || (ratio > 0.6 && distinct > 40)) return { ...base, role: 'text', note: 'free text: not chartable as is' };
    const words = new Set([...(scan.counts?.keys() ?? [])].map((v) => String(v).toLowerCase()));
    const calendar: CalendarPart | undefined = words.size > 0 && [...words].every((w) => WEEKDAY_NAMES.has(w)) ? 'weekday'
      : words.size > 0 && [...words].every((w) => MONTH_NAMES.has(w)) ? 'month' : undefined;
    return {
      ...base,
      role: 'dimension',
      ...(values ? { values } : {}),
      top: topValues(scan),
      ...(calendar ? { calendar } : {}),
      ...(geo && geo !== 'latitude' && geo !== 'longitude' ? { geo } : {}),
    };
  }

  // --- Numbers
  const sortedNumbers = scan.numbers.toSorted((a, b) => a - b);
  const lo = sortedNumbers[0];
  const hi = sortedNumbers[sortedNumbers.length - 1];
  const range = { min: (exact?.min ?? lo) as number, max: (exact?.max ?? hi) as number };

  if (geo === 'latitude' || geo === 'longitude') {
    return { ...base, role: 'dimension', geo, ...range, note: 'a coordinate, not a quantity' };
  }
  if (scan.integers) {
    const part = calendarPartOf(col.name, tokens);
    if (part && lo >= part[1] && hi <= part[2]) {
      return { ...base, role: 'dimension', calendar: part[0], ...(values ? { values } : {}), ...range };
    }
    const idName = ID_SUFFIX.includes(last) || col.name.toLowerCase() === 'id';
    // Consecutive whole numbers that never repeat are a row counter
    const counter = unique && scan.present >= 8 && hi - lo + 1 <= scan.present * 1.05;
    if ((idName && (distinct > 50 || ratio > 0.2)) || (counter && !has(tokens, COUNT_WORDS) && !has(tokens, AMOUNT_WORDS))) {
      return { ...base, role: 'id', ...(unique ? { unique: true } : {}), ...range };
    }
    const measureName = has(tokens, [...COUNT_WORDS, ...AMOUNT_WORDS, ...RATE_WORDS, ...SCORE_WORDS, ...DURATION_WORDS, ...PRICE_WORDS, ...LEVEL_WORDS, ...STOCK_WORDS, ...ENERGY_WORDS, ...STATISTIC_WORDS]) || last === 'min';
    const fewValues = distinct <= 10 && scan.present >= 30;
    if ((CODE_WORDS.includes(last) && distinct <= 60) || idName || (fewValues && !measureName)) {
      return {
        ...base,
        role: 'dimension',
        ...(values ? { values } : {}),
        top: topValues(scan),
        ...range,
        note: 'a numeric code: group by it, never sum or average it',
      };
    }
  } else if (distinct <= 3 && scan.present >= 30) {
    // A model threshold, a tax rate: a setting, not a metric
    return { ...base, role: 'dimension', ...(values ? { values } : {}), top: topValues(scan), ...range, note: 'a setting with a few fixed values, not a metric' };
  }

  return { ...base, role: 'measure', ...(values ? { values } : {}), ...range };
}

// ---------------------------------------------------------------------------
// Table: grain, kind, what explains what
// ---------------------------------------------------------------------------

function isKey(rows: ProfileCell[][], idxs: number[]): boolean {
  if (rows.length < 2) return false;
  const seen = new Set<string>();
  for (const r of rows) {
    const key = idxs.map((i) => String(r[i])).join('\u0001');
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

/** Share of a measure's variance explained by a grouping (eta squared), and how unevenly the rows fall into the groups. */
function groupEffect(
  rows: ProfileCell[][],
  keyOf: (row: ProfileCell[]) => string | null,
  measureIdx: number[],
): { groups: number; unevenness: number; explains: number[] } {
  const groups = new Map<string, { n: number; sums: number[]; ns: number[] }>();
  const totals = measureIdx.map(() => ({ n: 0, sum: 0, sq: 0 }));
  for (const r of rows) {
    const key = keyOf(r);
    if (key === null) continue;
    let g = groups.get(key);
    if (!g) {
      g = { n: 0, sums: measureIdx.map(() => 0), ns: measureIdx.map(() => 0) };
      groups.set(key, g);
    }
    g.n++;
    measureIdx.forEach((m, k) => {
      const v = r[m];
      if (typeof v !== 'number') return;
      g!.sums[k] += v;
      g!.ns[k]++;
      totals[k].n++;
      totals[k].sum += v;
      totals[k].sq += v * v;
    });
  }
  const counts = [...groups.values()].map((g) => g.n);
  const meanCount = counts.reduce((a, b) => a + b, 0) / Math.max(1, counts.length);
  const cv = meanCount > 0 ? Math.sqrt(counts.reduce((a, b) => a + (b - meanCount) ** 2, 0) / counts.length) / meanCount : 0;
  const explains = measureIdx.map((_, k) => {
    const t = totals[k];
    if (t.n < 3) return 0;
    const mean = t.sum / t.n;
    const total = t.sq - t.n * mean * mean;
    if (total <= 1e-12) return 0;
    let between = 0;
    for (const g of groups.values()) {
      if (g.ns[k] > 0) between += g.ns[k] * (g.sums[k] / g.ns[k] - mean) ** 2;
    }
    return Math.max(0, Math.min(1, between / total));
  });
  return { groups: groups.size, unevenness: Math.min(1, cv / (1 + cv)), explains };
}

function pearson(rows: ProfileCell[][], a: number, b: number): number {
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const r of rows) {
    const x = r[a];
    const y = r[b];
    if (typeof x !== 'number' || typeof y !== 'number') continue;
    n++;
    sx += x;
    sy += y;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
  }
  if (n < 8) return 0;
  const cov = sxy - (sx * sy) / n;
  const vx = sxx - (sx * sx) / n;
  const vy = syy - (sy * sy) / n;
  return vx <= 0 || vy <= 0 ? 0 : cov / Math.sqrt(vx * vy);
}

const PAIR_WORDS: Record<string, string> = {
  actual: 'Actual', realized: 'Actual', real: 'Actual', observed: 'Actual',
  forecast: 'Forecast', forecasted: 'Forecast', predicted: 'Forecast', pred: 'Forecast', expected: 'Forecast', estimated: 'Forecast',
  target: 'Target', budget: 'Budget', plan: 'Plan', planned: 'Plan', goal: 'Target', quota: 'Target',
  p10: 'P10', p50: 'P50', p90: 'P90',
};

/** Measures whose names differ only by a word like actual / forecast / target, or by a P10/P50/P90 quantile. */
function findPairs(measures: ColumnInsight[]): TableProfile['pairs'] {
  const byStem = new Map<string, { column: string; label: string }[]>();
  for (const m of measures) {
    const tokens = nameTokens(m.name);
    const word = tokens.find((t) => PAIR_WORDS[t]);
    if (!word) continue;
    const stem = tokens.filter((t) => t !== word).join('_');
    if (!stem) continue;
    const list = byStem.get(stem) ?? [];
    list.push({ column: m.name, label: PAIR_WORDS[word] });
    byStem.set(stem, list);
  }
  return [...byStem.entries()]
    .filter(([, members]) => members.length >= 2 && new Set(members.map((x) => x.label)).size >= 2)
    .map(([stem, members]) => ({ stem, members }))
    .slice(0, 4);
}

const DAY = 86_400;

/** The bucket that turns the time column into a trend a person can read (a dozen to a few hundred points). */
function bucketFor(time: TimeInsight, column: string, dialect: SqlDialect, columnType: string): TableProfile['bucket'] {
  const c = quoteIdent(column, dialect);
  if (time.format !== 'date' && time.format !== 'datetime') return { unit: 'raw', sql: c, points: time.periods };
  const from = epochMsOfIso(time.from);
  const to = epochMsOfIso(time.to);
  const spanDays = Number.isFinite(from) && Number.isFinite(to) ? (to - from) / 1000 / DAY : 0;
  const step = time.stepSeconds ?? 0;
  let unit: TimeBucket | 'raw';
  // Few periods, or a daily series of a season: every point is worth showing
  if (step > 0 && (time.periods <= 62 || (step >= DAY && time.periods <= 120))) unit = 'raw';
  else if (spanDays <= 4 && (step === 0 || step < 3600)) unit = 'hour';
  else if (spanDays <= 62) unit = 'day';
  else if (spanDays <= 200) unit = 'week';
  else if (spanDays <= 366 * 6) unit = 'month';
  else unit = 'year';
  if (unit === 'raw') return { unit, sql: c, points: time.periods };

  const points = unit === 'hour' ? Math.ceil(spanDays * 24) + 1
    : unit === 'day' ? Math.ceil(spanDays) + 1
      : unit === 'week' ? Math.ceil(spanDays / 7) + 1
        : unit === 'month' ? Math.ceil(spanDays / 30.4) + 1
          : Math.ceil(spanDays / 365.25) + 1;
  return { unit, sql: bucketExpression(unit, c, dialect, columnType), points };
}

/** The SQL that turns a date or timestamp expression into the label of its hour, day, week (its Monday), month, quarter or year. */
export function bucketExpression(unit: TimeBucket, c: string, dialect: SqlDialect, columnType = ''): string {
  if (dialect === 'bigquery') {
    const isDate = /^DATE$/i.test(columnType);
    const isTimestamp = /^TIMESTAMP$/i.test(columnType);
    const asDate = isDate ? c : `DATE(${c})`;
    return unit === 'hour' ? `${isTimestamp ? 'FORMAT_TIMESTAMP' : 'FORMAT_DATETIME'}('%Y-%m-%d %H:00', ${c})`
      : unit === 'day' ? `FORMAT_DATE('%Y-%m-%d', ${asDate})`
        : unit === 'week' ? `FORMAT_DATE('%Y-%m-%d', DATE_TRUNC(${asDate}, WEEK(MONDAY)))`
          : unit === 'month' ? `FORMAT_DATE('%Y-%m', ${asDate})`
            : unit === 'quarter' ? `FORMAT_DATE('%Y-Q%Q', ${asDate})`
              : `FORMAT_DATE('%Y', ${asDate})`;
  }
  if (dialect === 'sqlite') {
    return unit === 'hour' ? `strftime('%Y-%m-%d %H:00', ${c})`
      : unit === 'day' ? `date(${c})`
        : unit === 'week' ? `date(${c}, 'weekday 0', '-6 days')`
          : unit === 'month' ? `strftime('%Y-%m', ${c})`
            : unit === 'quarter' ? `strftime('%Y', ${c}) || '-Q' || ((CAST(strftime('%m', ${c}) AS INTEGER) + 2) / 3)`
              : `strftime('%Y', ${c})`;
  }
  if (dialect === 'clickhouse') {
    return unit === 'hour' ? `formatDateTime(toStartOfHour(${c}), '%Y-%m-%d %H:00')`
      : unit === 'day' ? `toString(toDate(${c}))`
        : unit === 'week' ? `toString(toMonday(${c}))`
          : unit === 'month' ? `formatDateTime(${c}, '%Y-%m')`
            : unit === 'quarter' ? `concat(toString(toYear(${c})), '-Q', toString(toQuarter(${c})))`
              : `toString(toYear(${c}))`;
  }
  return unit === 'hour' ? `to_char(date_trunc('hour', ${c}), 'YYYY-MM-DD HH24:00')`
    : unit === 'day' ? `to_char(${c}, 'YYYY-MM-DD')`
      : unit === 'week' ? `to_char(date_trunc('week', ${c}), 'YYYY-MM-DD')`
        : unit === 'month' ? `to_char(${c}, 'YYYY-MM')`
          : unit === 'quarter' ? `to_char(${c}, 'YYYY-"Q"Q')`
            : `to_char(${c}, 'YYYY')`;
}

const compactCount = (n: number) => n.toLocaleString('en-US');

/** Reads a table: the role of every column, what a row is, and what is worth charting. */
export function buildTableProfile(input: ProfileInput): TableProfile {
  const { rows, columns, dialect } = input;
  const scans = columns.map((_, i) => scanColumn(rows, i));
  const insights = columns.map((c, i) => classify(c, scans[i], rows.length, input.exact?.[c.name], dialect, input.rowCount));
  const indexOf = new Map(columns.map((c, i) => [c.name, i]));
  const notes: string[] = [];

  // --- Time: the column that orders the facts
  if (!insights.some((c) => c.role === 'time')) {
    // Yearly data keeps its time in a plain number
    const year = insights.find((c) => c.calendar === 'year' && typeof c.min === 'number' && typeof c.max === 'number');
    if (year) {
      year.role = 'time';
      year.time = { format: 'year', from: String(year.min), to: String(year.max), periods: year.distinct, stepSeconds: FORMAT_STEP.year, grain: 'year' };
      delete year.calendar;
    }
  }
  const times = insights.filter((c) => c.role === 'time');
  if (times.length > 1) {
    // A load timestamp is only "audit" next to a real one
    const real = times.filter((c) => !c.time!.audit);
    if (real.length === 0) times.forEach((c) => { delete c.time!.audit; });
  }
  const eventTimes = times.filter((c) => !c.time!.audit && !c.time!.attribute);
  const primary = (eventTimes.length > 0 ? eventTimes : times.filter((c) => !c.time!.audit))
    .toSorted((a, b) => b.time!.periods - a.time!.periods)[0];
  const timeColumn = primary && !primary.time!.attribute ? primary.name : undefined;

  // --- Grain: the columns that identify a row
  const dims = insights
    .filter((c) => (c.role === 'dimension' || c.role === 'flag' || (c.role === 'id' && !c.unique)) && c.distinct >= 2 && c.distinct <= 2000)
    .sort((a, b) => a.distinct - b.distinct);
  const idx = (name: string) => indexOf.get(name)!;
  let grain: string[] | undefined;
  const uniqueId = insights.find((c) => c.role === 'id' && c.unique);
  // Timestamps that never repeat but come at no pace are events, each with its own moment
  const paced = primary?.time?.stepSeconds !== undefined;
  if (rows.length >= 2) {
    if (timeColumn && paced && isKey(rows, [idx(timeColumn)])) {
      grain = [timeColumn];
    } else if (timeColumn && paced) {
      // Calendar parts repeat what the time column says; they are never what separates two rows
      const candidates = dims.filter((d) => !d.calendar).slice(0, 10);
      const one = candidates.find((d) => isKey(rows, [idx(timeColumn), idx(d.name)]));
      if (one) grain = [timeColumn, one.name];
      if (!grain && !uniqueId) {
        const few = candidates.slice(0, 7);
        search: for (let a = 0; a < few.length; a++) {
          for (let b = a + 1; b < few.length; b++) {
            if (isKey(rows, [idx(timeColumn), idx(few[a].name), idx(few[b].name)])) {
              grain = [timeColumn, few[a].name, few[b].name];
              break search;
            }
          }
        }
      }
    }
    if (!grain && uniqueId) grain = [uniqueId.name];
    if (!grain && timeColumn && !paced && isKey(rows, [idx(timeColumn)])) grain = [timeColumn];
    if (!grain && !timeColumn) {
      const candidates = dims.slice(0, 7);
      const single = candidates.find((d) => isKey(rows, [idx(d.name)]));
      if (single) grain = [single.name];
      search2: for (let a = 0; !grain && a < candidates.length; a++) {
        for (let b = a + 1; b < candidates.length; b++) {
          if (isKey(rows, [idx(candidates[a].name), idx(candidates[b].name)])) {
            grain = [candidates[a].name, candidates[b].name];
            break search2;
          }
        }
      }
    }
  }

  const kind: TableKind = rows.length === 0 ? (input.rowCount === 0 ? 'empty' : 'records')
    : timeColumn && paced && grain?.includes(timeColumn) ? 'time_series'
      : timeColumn ? 'events'
        : uniqueId ? 'entities'
          : 'records';
  const seriesLike = kind === 'time_series' && (primary?.time?.stepSeconds ?? DAY) < DAY * 27;

  // --- Measures, with how they combine
  for (const c of insights) {
    if (c.role !== 'measure') continue;
    const i = idx(c.name);
    c.measure = measureInsight(columns[i], scans[i].numbers, scans[i].present, seriesLike);
  }

  const measureScore = (c: ColumnInsight, position: number): number => {
    const tokens = nameTokens(c.name);
    const m = c.measure!;
    let score = 0;
    score += m.aggregate === 'sum' ? (m.nature === 'count' ? 3 : 3.5) : m.nature === 'level' ? 2 : m.nature === 'rate' || m.nature === 'price' ? 1 : 0;
    if (has(tokens, HEADLINE_WORDS)) score += 2.5;
    // Money comes first, and what comes in before what goes out
    if (m.unit && ['USD', 'EUR', 'GBP', 'RON', 'CHF'].includes(m.unit)) score += 0.75;
    if (has(tokens, ['revenue', 'sales', 'income', 'gmv', 'bookings', 'mrr', 'arr', 'profit'])) score += 1;
    if (has(tokens, TECHNICAL_WORDS)) score -= 2.5;
    if (has(tokens, DERIVED_WORDS)) score -= 4;
    if (m.nature === 'statistic') score -= 2;
    if (m.guessed) score -= 0.5;
    score -= c.nullPct / 25;
    score -= Math.min(2, position / 20);
    return score;
  };
  const measures = insights
    .map((c, position) => ({ c, position }))
    .filter(({ c }) => c.role === 'measure')
    .sort((a, b) => measureScore(b.c, b.position) - measureScore(a.c, a.position))
    .map(({ c }) => c.name);

  // --- Dimensions: the ones that separate the rows
  // What a grouping can explain: the leading measures, and the flags (the share of rows that have them)
  const lead = [...measures.slice(0, 3), ...insights.filter((c) => c.role === 'flag' && c.distinct === 2 && typeof c.flag?.on === 'number').slice(0, 2).map((c) => c.name)];
  const breakdownCandidates = insights.filter((c) =>
    (c.role === 'dimension' || (c.role === 'id' && !c.unique)) && !c.calendar && c.geo !== 'latitude' && c.geo !== 'longitude' && c.distinct >= 2 && c.distinct <= 400);
  const breakdowns: BreakdownStrength[] = rows.length >= 4
    ? breakdownCandidates.slice(0, 24).map((d) => {
        const at = idx(d.name);
        const effect = groupEffect(rows, (r) => String(r[at]), lead.map(idx));
        return {
          dimension: d.name,
          groups: d.distinct,
          unevenness: round(effect.unevenness, 3),
          explains: Object.fromEntries(lead.map((m, k) => [m, round(effect.explains[k], 3)])),
        };
      })
    : [];
  const strengthOf = (d: ColumnInsight): number => {
    const b = breakdowns.find((x) => x.dimension === d.name);
    const tokens = nameTokens(d.name);
    // A handful of groups reads at a glance; hundreds do not
    const size = d.distinct <= 12 ? 1 : d.distinct <= 40 ? 0.6 : 0.25;
    // Groups of one or two rows "explain" everything and mean nothing
    const support = Math.min(1, rows.length / Math.max(1, d.distinct) / 4);
    const signal = b ? Math.max(b.unevenness * 0.6, ...Object.values(b.explains)) * support : 0;
    return size * (0.35 + signal)
      // The dimension that tells two rows of one moment apart is what the table is about
      + (grain?.includes(d.name) ? 0.6 : 0)
      + (has(tokens, DIMENSION_WORDS) ? 0.15 : 0)
      - (d.role === 'id' ? 0.2 : 0)
      - (d.note ? 0.35 : 0);
  };
  const dimensions = breakdownCandidates.toSorted((a, b) => strengthOf(b) - strengthOf(a)).map((d) => d.name);
  // Two flags that say yes on exactly the same rows are one fact said twice (a −1/1 sign and its 0/1 twin)
  const flagCols = insights.filter((c) => c.role === 'flag' && c.flag !== undefined);
  for (const a of flagCols) {
    for (const b of flagCols) {
      if (a === b || a.twinOf || b.twinOf || rows.length === 0) continue;
      const ia = idx(a.name);
      const ib = idx(b.name);
      if (!rows.every((r) => (r[ia] === null) === (r[ib] === null) && (r[ia] === a.flag!.on) === (r[ib] === b.flag!.on))) continue;
      // The plain one stays; the one with a note (a sign) is the twin
      const twin = a.note && !b.note ? a : b;
      twin.twinOf = twin === a ? b.name : a.name;
    }
  }
  const flags = insights.filter((c) => c.role === 'flag' && !c.twinOf).map((c) => c.name);

  // --- The rhythm of the day and of the week
  let rhythm: TableProfile['rhythm'];
  const pt = primary?.time;
  if (timeColumn && pt && rows.length >= 48) {
    const at = idx(timeColumn);
    const from = epochMsOfIso(pt.from);
    const to = epochMsOfIso(pt.to);
    const spanDays = Number.isFinite(from) && Number.isFinite(to) ? (to - from) / 1000 / DAY : 0;
    pt.spanDays = round(spanDays, 3);
    const leadIdx = measures.slice(0, 1).map(idx);
    const part = (keyOf: (row: ProfileCell[]) => string | null) => {
      const e = groupEffect(rows, keyOf, leadIdx);
      return { explains: round(e.explains[0] ?? 0, 3), unevenness: round(e.unevenness, 3) };
    };
    const subDaily = pt.format === 'datetime' && (pt.stepSeconds === undefined || pt.stepSeconds < DAY);
    if (subDaily && spanDays >= 1.5) {
      const hour = part((r) => (typeof r[at] === 'string' ? (r[at] as string).slice(11, 13) : null));
      rhythm = { ...rhythm, hour };
    }
    if ((pt.format === 'datetime' || pt.format === 'date') && spanDays >= 21 && (pt.stepSeconds === undefined || pt.stepSeconds <= DAY)) {
      const weekday = part((r) => {
        const ms = typeof r[at] === 'string' ? epochMsOfIso(r[at] as string) : NaN;
        return Number.isFinite(ms) ? String(new Date(ms).getUTCDay()) : null;
      });
      rhythm = { ...rhythm, weekday };
    }
  }

  // --- Relationships between the leading measures (rows of a series follow time, not each other)
  const correlations: TableProfile['correlations'] = [];
  const leading = measures.slice(0, 6);
  if (rows.length >= 8) {
    for (let a = 0; a < leading.length; a++) {
      for (let b = a + 1; b < leading.length; b++) {
        const r = pearson(rows, idx(leading[a]), idx(leading[b]));
        if (Math.abs(r) >= 0.3 && Math.abs(r) < 0.999) correlations.push({ a: leading[a], b: leading[b], r: round(r, 2) });
      }
    }
    correlations.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));
  }

  const uniqueTexts = insights.filter((c) => c.role === 'id' && c.unique && !NUMERIC_TYPE.test(c.type));
  const labelColumn = kind === 'entities' || kind === 'events' || kind === 'records'
    // A name a person would recognise before a code
    ? (uniqueTexts.find((c) => !ID_SUFFIX.includes(nameTokens(c.name).pop() ?? '')) ?? uniqueTexts[0])?.name
    : undefined;

  // --- The sentence, and what a builder must not get wrong
  const part = input.partOf;
  const sampled = rows.length < input.rowCount;
  const what = kind === 'empty' ? 'Empty table'
    : kind === 'time_series' ? 'Time series'
      : kind === 'events' ? 'Events'
        : kind === 'entities' ? 'Entities'
          : 'Records';
  const grainText = grain ? `one row per ${grain.join(' × ')}` : undefined;
  const t = primary?.time;
  const timeText = t && timeColumn && t.from
    ? `${timeColumn} ${t.from} → ${t.to} (${t.grain === 'irregular' ? `${compactCount(t.periods)} moments` : `${t.grain} grain, ${compactCount(t.periods)} periods`})`
    : undefined;
  const about = kind === 'empty'
    ? 'Empty table: 0 rows, nothing to chart.'
    : `${what}: ${[grainText, timeText].filter(Boolean).join('; ') || `${compactCount(input.rowCount)} rows`}.`;

  if (part) {
    notes.push(`Only ${compactCount(input.rowCount)} of the ${compactCount(part.rowCount)} rows of ${part.table} are loaded here: totals and counts describe this part, so say "sample" in the subtitle and never present a total as the whole table's.`);
  } else if (sampled && rows.length > 0) {
    notes.push(`Profiled on ${compactCount(rows.length)} of ${compactCount(input.rowCount)} rows: shares and averages are estimates.`);
  }
  if (kind === 'time_series' && grain && grain.length > 1) {
    notes.push(`Several rows share one ${timeColumn} (one per ${grain.slice(1).join(' × ')}): a trend must set series_field to ${grain[1]} or aggregate across it.`);
  }
  const avgOnly = measures.filter((m) => insights[idx(m)].measure!.aggregate === 'avg').slice(0, 8);
  if (avgOnly.length > 0) notes.push(`Never SUM ${avgOnly.join(', ')}: ${avgOnly.length === 1 ? 'it is a rate, price or level' : 'they are rates, prices or levels'} — use AVG (or the value of one period).`);
  const snapshots = measures.filter((m) => insights[idx(m)].measure!.snapshot).slice(0, 6);
  if (snapshots.length > 0 && timeColumn) notes.push(`${snapshots.join(', ')} ${snapshots.length === 1 ? 'is a level' : 'are levels'} at one ${t?.grain ?? 'period'}: sum across categories within one ${timeColumn}, never across several (use the latest ${timeColumn} for a headline).`);
  const guessed = measures.filter((m) => insights[idx(m)].measure!.guessed).slice(0, 6);
  if (guessed.length > 0) notes.push(`How ${guessed.join(', ')} combine${guessed.length === 1 ? 's' : ''} was inferred from the table shape (${insights[idx(guessed[0])].measure!.aggregate}), not from the name: use what the column means if you know better.`);
  const even = breakdowns.filter((b) => b.unevenness < 0.03 && b.groups >= 2 && b.groups <= 40 && rows.length >= b.groups * 3).map((b) => b.dimension);
  if (even.length > 0 && kind !== 'entities') notes.push(`Rows are spread evenly over ${even.slice(0, 4).join(', ')}: a count of rows by ${even.length === 1 ? 'it' : 'them'} shows equal bars — compare a measure instead.`);
  const codes = insights.filter((c) => c.role === 'dimension' && NUMERIC_TYPE.test(c.type) && !c.calendar && !c.geo).map((c) => c.name);
  if (codes.length > 0) notes.push(`${codes.slice(0, 6).join(', ')} ${codes.length === 1 ? 'is a number used as a label' : 'are numbers used as labels'}: group by ${codes.length === 1 ? 'it' : 'them'}, never aggregate.`);
  const reserved = insights.filter((c) => c.reserved).map((c) => quoteIdent(c.name, dialect));
  if (reserved.length > 0) notes.push(`Quote these column names in SQL: ${reserved.join(', ')}.`);
  const sparse = insights.filter((c) => c.nullPct >= 30 && c.role !== 'empty').map((c) => `${c.name} (${Math.round(c.nullPct)}% empty)`);
  if (sparse.length > 0) notes.push(`Mostly empty: ${sparse.slice(0, 5).join(', ')}.`);

  return {
    name: input.name,
    sqlRef: input.sqlRef ?? quoteIdent(input.name, dialect),
    dialect,
    rowCount: input.rowCount,
    profiledRows: rows.length,
    kind,
    ...(grain ? { grain } : {}),
    about,
    ...(timeColumn ? { timeColumn } : {}),
    ...(timeColumn && t && t.from ? { bucket: bucketFor(t, timeColumn, dialect, columns[idx(timeColumn)].type) } : {}),
    ...(labelColumn ? { labelColumn } : {}),
    columns: insights,
    measures,
    dimensions,
    flags,
    breakdowns,
    ...(rhythm ? { rhythm } : {}),
    correlations: kind === 'time_series' && seriesLike ? correlations.slice(0, 2) : correlations.slice(0, 4),
    pairs: findPairs(insights.filter((c) => c.role === 'measure')),
    notes,
    ...(part ? { partOf: part } : {}),
  };
}

// ---------------------------------------------------------------------------
// The profile as the voice agent reads it
// ---------------------------------------------------------------------------

const clip = (text: string | undefined, max: number) =>
  (text == null || text.length <= max ? text : `${text.slice(0, max - 1)}…`);

/** One column, with only the fields that say something. */
export function columnForModel(c: ColumnInsight): Record<string, unknown> {
  const out: Record<string, unknown> = { name: c.name, type: c.type, role: c.role };
  if (c.description) out.description = clip(c.description, 120);
  if (c.calendar) out.calendar = c.calendar;
  if (c.geo) out.geo = c.geo;
  if (c.role === 'time' && c.time) {
    if (c.time.grain !== 'unknown') out.grain = c.time.grain;
    if (c.time.audit) out.note = 'when the row was loaded or scored, not when it happened';
    else if (c.time.attribute) out.note = 'a date that describes the row, not when it happened';
  }
  if (c.role === 'measure' && c.measure) {
    const m = c.measure;
    out.agg = m.aggregate;
    out.nature = m.nature;
    if (m.unit) out.unit = m.unit;
    if (m.format) out.format = m.format;
    if (m.snapshot) out.snapshot = true;
  }
  // Literals that exist in the data: every value of a small set, the range of the rest
  if (c.values && c.role !== 'constant') out.values = c.values;
  else if (c.min !== undefined && c.max !== undefined) {
    out.range = [c.min, c.max];
    out.distinct = c.distinct;
  } else if (c.role !== 'constant' && c.role !== 'empty' && c.distinct > 0) {
    out.distinct = c.distinct;
  }
  if (c.role === 'measure' && c.measure && (c.measure.max !== 0 || c.measure.min !== 0)) {
    const m = c.measure;
    out.stats = { mean: m.mean, median: m.median, ...(m.total !== undefined ? { total: m.total } : {}) };
    if (m.skewed) out.skewed = true;
  }
  if (c.role === 'dimension' && c.top && c.top.length > 0 && (!c.values || c.top[0].pct >= 40)) {
    out.top = c.top.slice(0, 5).map((v) => `${v.value} ${v.pct}%`).join(', ');
  }
  if (c.flag) out.share = `${c.flag.pct}% are ${JSON.stringify(c.flag.on)}`;
  if (c.twinOf) out.note = `says yes on the same rows as ${c.twinOf}`;
  if (c.unique) out.unique = true;
  if (c.nullPct >= 5) out.empty = `${Math.round(c.nullPct)}%`;
  if (c.note && out.note === undefined) out.note = c.note;
  return out;
}

/** Where a role stands when a table has more columns than fit in one answer (lower first). */
/** A column in a few words, for a table listed next to others. */
export function columnBrief(c: ColumnInsight): Record<string, unknown> {
  const out: Record<string, unknown> = { name: c.name, role: c.role };
  if (c.description) out.description = clip(c.description, 80);
  if (c.role === 'measure' && c.measure) {
    out.agg = c.measure.aggregate;
    if (c.measure.unit) out.unit = c.measure.unit;
    if (c.measure.snapshot) out.snapshot = true;
  }
  if (c.role === 'time' && c.time && c.time.grain !== 'unknown') out.grain = c.time.grain;
  if (c.values && c.role !== 'constant') out.values = c.values;
  else if ((c.role === 'time' || c.role === 'measure') && c.min !== undefined && c.max !== undefined) out.range = [c.min, c.max];
  if (c.note && c.role !== 'measure') out.note = c.note;
  return out;
}

/** Puts the columns whose name has one of the words first (a search in a wide table). */
export function columnsMatching(profile: TableProfile, words: string[]): ColumnInsight[] {
  if (words.length === 0) return [];
  return profile.columns.filter((c) => words.some((w) => c.name.toLowerCase().includes(w) || (c.description ?? '').toLowerCase().includes(w)));
}

const ROLE_ORDER: Record<ColumnRole, number> = { time: 0, dimension: 1, measure: 1, flag: 2, id: 3, text: 9, constant: 10, empty: 11 };

/**
 * The columns that fit in one answer, the telling ones first: a table of 300
 * engineered features is described by its time, its grain and its leading
 * measures, with the rest counted by name family.
 */
export function pickColumns(profile: TableProfile, limit: number): { shown: ColumnInsight[]; families: { prefix: string; columns: number }[] } {
  if (profile.columns.length <= limit) return { shown: profile.columns, families: [] };
  const rank = new Map<string, number>();
  profile.columns.forEach((c, position) => {
    const m = profile.measures.indexOf(c.name);
    const d = profile.dimensions.indexOf(c.name);
    const score = c.name === profile.timeColumn || profile.grain?.includes(c.name) ? position / 1000
      // Dimensions and measures take turns, each in its own order of interest
      : d >= 0 ? 100 + d * 2
        : m >= 0 ? 101 + m * 2
          : ROLE_ORDER[c.role] * 1000 + position;
    rank.set(c.name, score);
  });
  const sorted = profile.columns.toSorted((a, b) => rank.get(a.name)! - rank.get(b.name)!);
  const shownNames = new Set(sorted.slice(0, limit).map((c) => c.name));
  const families = new Map<string, number>();
  for (const c of profile.columns) {
    if (shownNames.has(c.name)) continue;
    const prefix = c.name.includes('__') ? `${c.name.split('__')[0]}__*` : `${nameTokens(c.name).slice(0, 2).join('_')}*`;
    families.set(prefix, (families.get(prefix) ?? 0) + 1);
  }
  return {
    shown: profile.columns.filter((c) => shownNames.has(c.name)),
    families: [...families.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([prefix, columns]) => ({ prefix, columns })),
  };
}

/** "pred_mw follows the hour of the day (62% of its variation)". */
function rhythmFindings(profile: TableProfile): string[] {
  const out: string[] = [];
  const lead = profile.measures[0];
  const say = (what: string, r: { explains: number; unevenness: number } | undefined) => {
    if (!r) return;
    if (lead && r.explains >= 0.08) out.push(`${lead} follows the ${what} (${Math.round(r.explains * 100)}% of its variation)`);
    else if (profile.kind === 'events' && r.unevenness >= 0.15) out.push(`activity depends on the ${what}`);
  };
  say('hour of the day', profile.rhythm?.hour);
  say('day of the week', profile.rhythm?.weekday);
  return out;
}

/** What the table is, in the few fields a builder reads before choosing charts. */
export function summaryForModel(profile: TableProfile): Record<string, unknown> {
  const col = (name: string) => profile.columns.find((c) => c.name === name)!;
  const t = profile.timeColumn ? col(profile.timeColumn).time : undefined;
  const strong = profile.breakdowns
    .filter((b) => profile.profiledRows >= b.groups * 4)
    .map((b) => ({ b, best: Object.entries(b.explains).sort((x, y) => y[1] - x[1])[0] }))
    .filter(({ best }) => best && best[1] >= 0.08)
    .sort((x, y) => y.best[1] - x.best[1])
    .slice(0, 4)
    .map(({ b, best }) => `${b.dimension} explains ${Math.round(best[1] * 100)}% of ${best[0]}`);
  return {
    about: profile.about,
    ...(profile.grain ? { grain: profile.grain } : {}),
    ...(t && profile.timeColumn && t.from
      ? {
          time: {
            column: profile.timeColumn,
            from: t.from,
            to: t.to,
            grain: t.grain,
            ...(profile.bucket && profile.bucket.unit !== 'raw' ? { trendBucket: profile.bucket.unit, trendBucketSql: profile.bucket.sql } : {}),
          },
        }
      : {}),
    ...(profile.measures.length > 0 ? { measures: profile.measures.slice(0, 12).map((m) => `${m} (${col(m).measure!.aggregate})`) } : {}),
    ...(profile.dimensions.length > 0 ? { dimensions: profile.dimensions.slice(0, 10) } : {}),
    ...(profile.flags.length > 0 ? { flags: profile.flags.slice(0, 10) } : {}),
    ...(profile.labelColumn ? { label: profile.labelColumn } : {}),
    ...(strong.length > 0 || profile.correlations.length > 0 || profile.pairs.length > 0 || rhythmFindings(profile).length > 0
      ? {
          findings: [
            ...rhythmFindings(profile),
            ...strong,
            ...profile.correlations.slice(0, 3).map((c) => `${c.a} and ${c.b} move together (r = ${c.r})`),
            ...profile.pairs.map((p) => `${p.members.map((m) => m.column).join(' / ')} are ${p.members.map((m) => m.label.toLowerCase()).join(' vs ')} of the same thing`),
          ],
        }
      : {}),
    ...(profile.notes.length > 0 ? { notes: profile.notes } : {}),
  };
}
