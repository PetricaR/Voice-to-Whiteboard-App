/**
 * The charts a table can carry, derived from what it means (dataProfile.ts)
 * rather than from its column types: headline numbers that aggregate the way
 * the measure combines, a trend at a grain a person can read, the rhythm of
 * the day and the week, the breakdowns that really separate the numbers, the
 * strongest relationship and the detail rows.
 *
 * The voice agent receives these as a grounded starting point for the first
 * dashboard on a table, and the studio builds from them directly when no
 * model is available.
 */
import { bucketExpression, isHeadlineMeasure, nameTokens, quoteIdent, type ColumnInsight, type MeasureNature, type TableProfile } from '../data/dataProfile';
import type { CreateDashboardRequest, DashboardWidgetInput, ValueFormat } from './dashboard';

export type IdeaSlot = 'headline' | 'trend' | 'pattern' | 'breakdown' | 'relationship' | 'distribution' | 'detail';

export interface ChartIdea {
  slot: IdeaSlot;
  /** The question the chart answers. */
  question: string;
  widget: DashboardWidgetInput & { id: string };
}

type Widget = Omit<DashboardWidgetInput, 'id'>;

const ACRONYMS = new Set(['mrr', 'arr', 'usd', 'eur', 'gbp', 'ron', 'mw', 'mwh', 'kw', 'kwh', 'id', 'api', 'aov', 'ndr', 'nps', 'kpi', 'sla', 'roi', 'ctr', 'cpc', 'gmv', 'ltv', 'cac', 'url', 'ip', 'sku', 'auc', 'ece', 'p10', 'p50', 'p90', 'p95', 'p99', 'http', 'gdp', 'vat']);
const UNIT_SUFFIX = new Set(['usd', 'eur', 'gbp', 'ron', 'lei', 'pct', 'percent', 'ms']);
const FLAG_PREFIX = new Set(['is', 'has', 'was', 'can', 'did']);
/** Abbreviations of column names, in the words a title uses. */
const WORDS: Record<string, string> = {
  pred: 'predicted', prob: 'probability', qty: 'quantity', amt: 'amount', cnt: 'count', num: 'number', avg: 'average',
  est: 'estimated', temp: 'temperature', dt: 'date', ts: 'time', cat: 'category', dept: 'department', org: 'organization',
  acct: 'account', txn: 'transaction', inv: 'invoice', bal: 'balance', vol: 'volume', rev: 'revenue', mgr: 'manager',
  desc: 'description', addr: 'address', pos: 'position', perf: 'performance', req: 'request', resp: 'response',
};

/** "net_revenue_usd" → "Net Revenue", "is_returned" → "Returned", "pred_mw" → "Predicted MW". */
export function humanize(name: string): string {
  let tokens = nameTokens(name);
  if (tokens.length > 1 && UNIT_SUFFIX.has(tokens[tokens.length - 1])) tokens = tokens.slice(0, -1);
  if (tokens.length > 1 && FLAG_PREFIX.has(tokens[0])) tokens = tokens.slice(1);
  return tokens
    .map((t) => WORDS[t] ?? t)
    .map((t) => (ACRONYMS.has(t) ? t.toUpperCase() : t.charAt(0).toUpperCase() + t.slice(1)))
    .join(' ') || name;
}

function plural(word: string): string {
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  if (/(s|x|ch|sh)$/i.test(word)) return `${word}es`;
  return `${word}s`;
}

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'chart';
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const tidy = (n: number) => Number(n.toPrecision(12));

/** 1, 2 or 5 times a power of ten: the first such step at or above the raw one. */
function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / magnitude;
  return tidy((unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * magnitude);
}

const weekdayName = (expr: string) =>
  `CASE ${expr} WHEN 0 THEN 'Sun' WHEN 1 THEN 'Mon' WHEN 2 THEN 'Tue' WHEN 3 THEN 'Wed' WHEN 4 THEN 'Thu' WHEN 5 THEN 'Fri' ELSE 'Sat' END`;

/** How much a difference between groups is worth showing, by what the measure is: a price per product is no finding. */
const NATURE_WEIGHT: Record<MeasureNature, number> = { amount: 1, count: 1, stock: 1, rate: 0.9, score: 0.8, duration: 0.8, level: 0.6, price: 0.15, statistic: 0.2 };

const REVENUE_WORDS = ['revenue', 'sales', 'income', 'gmv', 'bookings', 'billings'];
const COST_WORDS = ['cost', 'cogs', 'expense', 'expenses', 'spend'];
const STAGE_WORDS = ['stage', 'step', 'phase'];
const ORDER_WORDS = ['order', 'step', 'seq', 'sequence', 'position', 'rank'];

/** The charts worth drawing from a table, in the order of the story: headline numbers first, detail rows last. */
export function suggestCharts(profile: TableProfile): ChartIdea[] {
  // The SQL is written for the local engine, where the rows were read
  if (profile.dialect !== 'sqlite' || profile.profiledRows === 0) return [];

  const q = (name: string) => quoteIdent(name, profile.dialect);
  const t = profile.sqlRef;
  const col = (name: string): ColumnInsight => profile.columns.find((c) => c.name === name)!;
  const measures = profile.measures.map(col);
  const m0: ColumnInsight | undefined = measures[0];
  // An event log is about how many events there are, unless a measure is what the events are for (the revenue of orders)
  const countLed = profile.kind === 'events' && !(m0 !== undefined && m0.measure!.aggregate === 'sum' && isHeadlineMeasure(m0));
  const time = profile.timeColumn ? col(profile.timeColumn) : undefined;
  const span = time?.time ? `${time.time.from.slice(0, 10)} – ${time.time.to.slice(0, 10)}` : undefined;
  const loaded = profile.partOf ? 'the loaded rows' : 'all rows';
  const scope = [span, profile.partOf ? `sample of ${profile.rowCount.toLocaleString('en-US')} rows` : undefined].filter(Boolean).join(' · ') || undefined;
  const ideas: ChartIdea[] = [];
  const ids = new Set<string>();

  const add = (slot: IdeaSlot, question: string, widget: Widget) => {
    let id = slug(widget.title);
    for (let n = 2; ids.has(id); n++) id = `${slug(widget.title)}_${n}`;
    ids.add(id);
    ideas.push({ slot, question, widget: { id, ...widget } });
  };

  // --- How a measure is aggregated, named and formatted
  const fraction = (c: ColumnInsight) => c.measure?.unit === 'fraction';
  const decimalsOf = (c: ColumnInsight) => (Math.abs(c.measure?.max ?? 0) < 10 ? 3 : 2);
  const avgSql = (c: ColumnInsight) =>
    // A share kept as 0–1 is shown as a percentage
    (fraction(c) ? `ROUND(100.0 * AVG(${q(c.name)}), 1)` : `ROUND(AVG(${q(c.name)}), ${decimalsOf(c)})`);
  const aggSql = (c: ColumnInsight) => (c.measure!.aggregate === 'sum' ? `ROUND(SUM(${q(c.name)}), 2)` : avgSql(c));
  const safe = (name: string) => name.replace(/[^A-Za-z0-9_]/g, '_');
  const avgAlias = (c: ColumnInsight) => safe(fraction(c) ? `${c.name}_pct` : `avg_${c.name}`);
  const alias = (c: ColumnInsight) => (c.measure!.aggregate === 'sum' ? safe(c.name) : avgAlias(c));
  const formatOf = (c: ColumnInsight): ValueFormat => (fraction(c) ? 'percent' : c.measure!.format ?? 'number');
  const unitOf = (c: ColumnInsight): string | undefined => {
    const u = c.measure!.unit;
    return u && !['percent', 'fraction', 'USD', 'EUR', 'GBP', 'ms', 'bytes'].includes(u) ? u : undefined;
  };
  const named = (c: ColumnInsight) => (c.measure!.aggregate === 'sum' ? humanize(c.name) : `Average ${humanize(c.name)}`);
  const how = (c: ColumnInsight) => (c.measure!.aggregate === 'sum' ? `The sum of ${c.name}` : `The average of ${c.name}${fraction(c) ? ', as a percentage,' : ''}`);

  // --- Flags: the share of rows that have them
  const flagSql = (f: ColumnInsight) => {
    const on = typeof f.flag!.on === 'number' ? String(f.flag!.on) : `'${String(f.flag!.on).replace(/'/g, "''")}'`;
    return `ROUND(100.0 * AVG(CASE WHEN ${q(f.name)} = ${on} THEN 1.0 ELSE 0 END), 1)`;
  };
  const flagAlias = (f: ColumnInsight) => `${slug(humanize(f.name))}_pct`;
  const flags = profile.flags.map(col).filter((f) => f.flag !== undefined && f.distinct === 2);
  // A sign and its 0/1 twin say the same thing: the plain flag stands for both
  const flag0: ColumnInsight | undefined = flags.find((f) => !f.note) ?? flags[0];

  // --- What one row is called
  const idColumn = profile.grain?.length === 1 && col(profile.grain[0]).role === 'id' ? profile.grain[0] : undefined;
  const entityTokens = idColumn ? nameTokens(idColumn).filter((x) => !['id', 'uuid', 'key', 'guid'].includes(x)) : [];
  const entity = entityTokens.length > 0 ? plural(entityTokens[entityTokens.length - 1]) : 'records';
  const entityTitle = capital(entity);
  const counted = slug(entity);

  // --- Time: the expression that gives a readable trend
  const bucket = profile.bucket;
  const tc = profile.timeColumn ? q(profile.timeColumn) : '';
  const timeExpr = bucket ? bucket.sql : '';
  const timeAlias = bucket ? (bucket.unit === 'raw' ? safe(profile.timeColumn!) : bucket.unit) : '';
  const per = bucket && bucket.unit !== 'raw' ? `per ${bucket.unit}` : time?.time ? `per ${time.time.grain}` : '';
  const trendScope = [per, scope].filter(Boolean).join(' · ') || undefined;
  const series = profile.kind === 'time_series';
  const latest = series && tc ? `${tc} = (SELECT MAX(${tc}) FROM ${t})` : undefined;
  const latestLabel = time?.time ? `Latest ${time.time.grain}: ${time.time.to}` : undefined;
  // A level of one moment (MRR, stock) is read at the latest moment, never summed over several
  const atLatest = (c: ColumnInsight) => (c.measure?.snapshot === true && latest ? ` WHERE ${latest}` : '');
  const scopeOf = (c: ColumnInsight) => (c.measure?.snapshot === true && latest ? latestLabel : scope);
  // The dimension that tells the rows of one moment apart: a trend is split by it
  const seriesDim = series && profile.grain?.length === 2 && col(profile.grain[1]).distinct <= 6 ? profile.grain[1] : undefined;
  const zeroLine = (c: ColumnInsight | undefined) => (c?.measure?.negative ? { reference_lines: [{ axis: 'y', value: '0', label: 'Zero' }] } : {});

  // ---------------------------------------------------------------- headline numbers
  const kpi = (c: ColumnInsight) => {
    const sum = c.measure!.aggregate === 'sum';
    const now = c.measure!.snapshot === true && latest !== undefined;
    add('headline', `What is the ${sum ? 'total' : 'typical'} ${humanize(c.name)}?`, {
      title: sum ? (now ? humanize(c.name) : `Total ${humanize(c.name)}`) : named(c),
      subtitle: scopeOf(c),
      kind: 'kpi',
      sql: `SELECT ${aggSql(c)} AS ${alias(c)} FROM ${t}${atLatest(c)}`,
      format: formatOf(c),
      unit: unitOf(c),
      explanation: now
        ? `${humanize(c.name)} is a level at one ${time!.time!.grain}: the sum over the latest ${profile.timeColumn}, not over all of them.`
        : `${how(c)} over ${loaded}.`,
    });
  };
  if (profile.kind === 'events' || profile.kind === 'entities') {
    add('headline', `How many ${entity} are there?`, {
      title: entityTitle,
      subtitle: scope,
      kind: 'kpi',
      sql: `SELECT COUNT(*) AS ${counted} FROM ${t}`,
      format: profile.rowCount >= 10_000 ? 'compact' : 'number',
      explanation: `Counts the rows of ${profile.name}: one per ${idColumn ?? 'record'}.`,
    });
  }
  if (m0) kpi(m0);
  // Revenue next to cost: the margin is the number both are for
  const additive = measures.filter((m) => m.measure!.aggregate === 'sum');
  const revenue = additive.find((m) => nameTokens(m.name).some((x) => REVENUE_WORDS.includes(x)));
  const cost = additive.find((m) => nameTokens(m.name).some((x) => COST_WORDS.includes(x)));
  const margin = revenue && cost && revenue.measure!.unit === cost.measure!.unit
    ? `ROUND(100.0 * (SUM(${q(revenue.name)}) - SUM(${q(cost.name)})) / NULLIF(SUM(${q(revenue.name)}), 0), 1)`
    : undefined;
  if (margin) {
    add('headline', 'How much of the revenue is left after costs?', {
      title: 'Margin',
      subtitle: `(${revenue!.name} − ${cost!.name}) / ${revenue!.name}`,
      kind: 'kpi',
      sql: `SELECT ${margin} AS margin_pct FROM ${t}`,
      format: 'percent',
      explanation: `Revenue minus cost as a percentage of revenue, over ${loaded}.`,
    });
  }
  if (flag0) {
    add('headline', `What share of the ${entity} is ${humanize(flag0.name).toLowerCase()}?`, {
      title: `${humanize(flag0.name)} Rate`,
      subtitle: scope,
      kind: 'kpi',
      sql: `SELECT ${flagSql(flag0)} AS ${flagAlias(flag0)} FROM ${t}`,
      format: 'percent',
      explanation: `The percentage of rows where ${flag0.name} is ${JSON.stringify(flag0.flag!.on)}.`,
    });
  }
  measures.slice(1, 3).filter((m) => m !== cost || !margin).forEach(kpi);
  // An id that repeats names the things the rows are about (the customers behind the orders)
  const repeated = profile.columns.find((c) => c.role === 'id' && !c.unique && c.distinct >= 20 && c.name !== idColumn);
  const repeatedName = repeated ? plural(nameTokens(repeated.name).filter((x) => x !== 'id').pop() ?? 'item') : '';
  if (repeated && profile.kind === 'events') {
    add('headline', `How many distinct ${repeatedName} are behind the ${entity}?`, {
      title: capital(repeatedName),
      subtitle: scope,
      kind: 'kpi',
      sql: `SELECT COUNT(DISTINCT ${q(repeated.name)}) AS ${slug(repeatedName)} FROM ${t}`,
      format: 'number',
      explanation: `Counts the distinct values of ${repeated.name}.`,
    });
  }

  // ---------------------------------------------------------------- trend
  if (time && bucket) {
    const grouped = ' GROUP BY 1 ORDER BY 1';
    const bucketed = bucket.unit !== 'raw';
    if (countLed) {
      add('trend', `How does the number of ${entity} develop over time?`, {
        title: `${entityTitle} over Time`,
        subtitle: trendScope,
        kind: 'area',
        sql: `SELECT ${timeExpr} AS ${timeAlias}, COUNT(*) AS ${counted} FROM ${t}${grouped}`,
        x_field: timeAlias,
        y_fields: [counted],
        format: 'number',
        chart_config: { highlight_max_min: true },
        explanation: `Counts the ${entity} ${per}.`,
      });
    }
    if (m0 && seriesDim) {
      // Within one series every moment has one row: a level is averaged over the bucket, never summed
      const value = m0.measure!.snapshot && bucketed ? `ROUND(AVG(${q(m0.name)}), 2)` : aggSql(m0);
      add('trend', `How does ${humanize(m0.name)} develop for each ${humanize(seriesDim)}?`, {
        title: `${named(m0)} by ${humanize(seriesDim)}`,
        subtitle: trendScope,
        kind: 'line',
        sql: `SELECT ${timeExpr} AS ${timeAlias}, ${q(seriesDim)}, ${value} AS ${alias(m0)} FROM ${t} GROUP BY 1, 2 ORDER BY 1`,
        x_field: timeAlias,
        y_fields: [alias(m0)],
        series_field: seriesDim,
        format: formatOf(m0),
        unit: unitOf(m0),
        chart_config: { direct_line_labels: col(seriesDim).distinct <= 4, ...zeroLine(m0) },
        explanation: `${how(m0)} ${per}, one line per ${seriesDim}.`,
      });
    } else if (m0) {
      // A level of one moment is first totalled per moment, then averaged over the bucket
      const sql = m0.measure!.snapshot && bucketed && series
        ? `SELECT ${bucketExpression(bucket.unit as Exclude<typeof bucket.unit, 'raw'>, 'moment', profile.dialect)} AS ${timeAlias}, ROUND(AVG(total), 2) AS ${alias(m0)} ` +
          `FROM (SELECT ${tc} AS moment, SUM(${q(m0.name)}) AS total FROM ${t} GROUP BY 1)${grouped}`
        : `SELECT ${timeExpr} AS ${timeAlias}, ${aggSql(m0)} AS ${alias(m0)} FROM ${t}${grouped}`;
      add('trend', `How does ${humanize(m0.name)} develop over time?`, {
        title: `${named(m0)} over Time`,
        subtitle: trendScope,
        kind: m0.measure!.aggregate === 'sum' && !m0.measure!.negative ? 'area' : 'line',
        sql,
        x_field: timeAlias,
        y_fields: [alias(m0)],
        format: formatOf(m0),
        unit: unitOf(m0),
        chart_config: { highlight_max_min: true, ...zeroLine(m0) },
        explanation: `${how(m0)} ${per}.`,
      });
    }
    // How the total is made up over time, by the dimension with a handful of values that separates it best
    const stackable = countLed || (m0 !== undefined && m0.measure!.aggregate === 'sum' && !m0.measure!.negative && !(m0.measure!.snapshot && bucketed));
    const mix = stackable && bucket.points <= 40
      ? profile.dimensions.map(col).find((d) => {
          const b = profile.breakdowns.find((x) => x.dimension === d.name);
          return d.name !== seriesDim && d.distinct >= 2 && d.distinct <= 5 && !d.note && b !== undefined &&
            ((!countLed && (b.explains[m0!.name] ?? 0) >= 0.05) || b.unevenness >= 0.1 || profile.grain?.includes(d.name) === true);
        })
      : undefined;
    if (mix) {
      const what = countLed ? entityTitle : humanize(m0!.name);
      const valueAlias = countLed ? counted : alias(m0!);
      add('trend', `How is the total of ${what} made up over time?`, {
        title: `${what} by ${humanize(mix.name)} over Time`,
        subtitle: trendScope,
        kind: 'stacked_bar',
        sql: `SELECT ${timeExpr} AS ${timeAlias}, ${q(mix.name)}, ${countLed ? 'COUNT(*)' : aggSql(m0!)} AS ${valueAlias} FROM ${t} GROUP BY 1, 2 ORDER BY 1`,
        x_field: timeAlias,
        y_fields: [valueAlias],
        series_field: mix.name,
        format: countLed ? 'number' : formatOf(m0!),
        ...(countLed ? {} : { unit: unitOf(m0!) }),
        chart_config: { stack_mode: 'stacked' },
        explanation: `${countLed ? `Counts the ${entity}` : how(m0!)} ${per}, stacked by ${mix.name}.`,
      });
    }
    // The same measure said twice: what happened next to what was expected
    for (const pair of profile.pairs.slice(0, 1)) {
      const members = pair.members.slice(0, 4).map((x) => col(x.column)).filter((c) => c.role === 'measure');
      if (members.length < 2) continue;
      add('trend', `How do ${pair.members.map((x) => x.label.toLowerCase()).join(' and ')} compare over time?`, {
        title: `${humanize(pair.stem)}: ${pair.members.map((x) => x.label).join(' vs ')}`,
        subtitle: trendScope,
        kind: 'line',
        sql: `SELECT ${timeExpr} AS ${timeAlias}, ${members.map((c) => `${aggSql(c)} AS ${alias(c)}`).join(', ')} FROM ${t}${grouped}`,
        x_field: timeAlias,
        y_fields: members.map(alias),
        format: formatOf(members[0]),
        unit: unitOf(members[0]),
        chart_config: { direct_line_labels: true },
        explanation: `${members.map((c) => c.name).join(' and ')} ${per}, on one axis.`,
      });
    }
    const ohlc = ['open', 'high', 'low', 'close'].map((w) => measures.find((m) => nameTokens(m.name)[0] === w));
    if (series && ohlc.every((c) => c !== undefined)) {
      const [open, high, low, close] = ohlc as ColumnInsight[];
      add('trend', 'How did the price move within each period?', {
        title: 'Price Range per Period',
        subtitle: scope,
        kind: 'candlestick',
        sql: `SELECT ${tc}, ${[open, high, low, close].map((c) => q(c.name)).join(', ')} FROM ${t} ORDER BY 1`,
        x_field: profile.timeColumn,
        open_field: open.name,
        high_field: high.name,
        low_field: low.name,
        close_field: close.name,
        format: formatOf(close),
        explanation: 'Open, high, low and close of every period.',
      });
    }
  }

  // ---------------------------------------------------------------- the rhythm of the day and of the week
  if (time && profile.rhythm) {
    const hour = profile.rhythm.hour;
    const weekday = profile.rhythm.weekday;
    // An event log is about when things happen; a series about how its measure moves within the day
    const byCount = !m0 || (countLed && (hour?.explains ?? 0) < 0.15 && (weekday?.explains ?? 0) < 0.1);
    const value = byCount ? `COUNT(*) AS ${counted}` : `${avgSql(m0!)} AS ${avgAlias(m0!)}`;
    const valueAlias = byCount ? counted : avgAlias(m0!);
    const valueName = byCount ? entityTitle : `Average ${humanize(m0!.name)}`;
    const valueFormat: ValueFormat = byCount ? 'number' : formatOf(m0!);
    const hourTells = hour !== undefined && (byCount ? hour.unevenness >= 0.12 : hour.explains >= 0.05);
    const weekdayTells = weekday !== undefined && (byCount ? weekday.unevenness >= 0.08 : weekday.explains >= 0.03);
    const hourExpr = `CAST(strftime('%H', ${tc}) AS INTEGER)`;
    const dowExpr = `CAST(strftime('%w', ${tc}) AS INTEGER)`;
    if (hourTells && weekdayTells) {
      add('pattern', 'When in the week does it happen?', {
        title: `${valueName} by Weekday and Hour`,
        subtitle: scope,
        kind: 'heatmap',
        sql: `SELECT ${hourExpr} AS hour, ${weekdayName(dowExpr)} AS weekday, ${value} FROM ${t} GROUP BY 1, 2 ORDER BY (${dowExpr} + 6) % 7, 1`,
        x_field: 'hour',
        series_field: 'weekday',
        y_fields: [valueAlias],
        format: valueFormat,
        chart_config: { palette: 'viridis', x_axis_title: 'Hour of day (UTC)' },
        explanation: `${valueName} for every hour of the day (UTC) and day of the week.`,
      });
    } else if (hourTells) {
      const split = !byCount && seriesDim !== undefined && col(seriesDim).distinct <= 4;
      add('pattern', 'What does a typical day look like?', {
        title: `${valueName} by Hour of Day`,
        subtitle: scope,
        kind: split ? 'line' : 'column',
        sql: split
          ? `SELECT ${hourExpr} AS hour, ${q(seriesDim!)}, ${value} FROM ${t} GROUP BY 1, 2 ORDER BY 1`
          : `SELECT ${hourExpr} AS hour, ${value} FROM ${t} GROUP BY 1 ORDER BY 1`,
        x_field: 'hour',
        y_fields: [valueAlias],
        ...(split ? { series_field: seriesDim } : {}),
        format: valueFormat,
        chart_config: { x_axis_title: 'Hour of day (UTC)', sort_by: 'none', ...(split ? { direct_line_labels: true } : {}), ...(byCount ? {} : zeroLine(m0)) },
        explanation: `${valueName} over all days, by the hour of the day.`,
      });
    } else if (weekdayTells) {
      add('pattern', 'Which days of the week stand out?', {
        title: `${valueName} by Weekday`,
        subtitle: scope,
        kind: 'column',
        sql: `SELECT ${weekdayName(dowExpr)} AS weekday, ${value} FROM ${t} GROUP BY 1 ORDER BY (${dowExpr} + 6) % 7`,
        x_field: 'weekday',
        y_fields: [valueAlias],
        format: valueFormat,
        chart_config: { sort_by: 'none' },
        explanation: `${valueName} over all weeks, by the day of the week.`,
      });
    }
  }

  // ---------------------------------------------------------------- breakdowns: the dimensions that separate the numbers
  interface Option { dim: string; value: string; signal: number; share: boolean; question: string; widget: Widget }
  const options: Option[] = [];
  const usedValues = new Set<string>();
  let rankings = 0;
  // A table of things is first of all a ranking of those things
  if (profile.kind === 'entities' && profile.labelColumn && m0 && profile.rowCount >= 3) {
    const asc = m0.measure!.aggregate === 'avg' && m0.measure!.nature === 'duration';
    add('breakdown', `Which ${entity} have the ${asc ? 'lowest' : 'highest'} ${humanize(m0.name)}?`, {
      title: `Top ${entityTitle} by ${humanize(m0.name)}`,
      subtitle: scope,
      kind: 'horizontal_bar',
      sql: `SELECT ${q(profile.labelColumn)}, ${q(m0.name)} FROM ${t} WHERE ${q(m0.name)} IS NOT NULL ORDER BY 2 ${asc ? 'ASC' : 'DESC'} LIMIT 10`,
      x_field: profile.labelColumn,
      y_fields: [m0.name],
      format: formatOf(m0) === 'percent' && fraction(m0) ? 'number' : formatOf(m0),
      unit: unitOf(m0),
      chart_config: { sort_by: asc ? 'value_asc' : 'value_desc' },
      explanation: `The ten ${entity} with the ${asc ? 'lowest' : 'highest'} ${m0.name}.`,
    });
    usedValues.add(m0.name);
    rankings++;
  }
  for (const name of profile.dimensions.slice(0, 6)) {
    const d = col(name);
    const b = profile.breakdowns.find((x) => x.dimension === name);
    // Groups of one or two rows compare nothing
    if (!b || (profile.kind !== 'entities' && profile.profiledRows < d.distinct * 3)) continue;
    const structural = profile.grain?.includes(name) === true;
    // A number used as a label (a status code, a version) is rarely what the question is about
    const weight = d.note ? 0.5 : 1;
    const top = d.distinct > 10 ? ' LIMIT 10' : '';
    const tops = top ? ' (the ten largest)' : '';
    for (const m of measures.slice(0, 3)) {
      const explained = b.explains[m.name] ?? 0;
      const sum = m.measure!.aggregate === 'sum';
      // Among events the row count already shows how the rows fall: a sum is worth a chart where it differs from that
      const base = sum && !countLed ? Math.max(explained, b.unevenness * 0.5) : explained;
      // The groups a table is made of are compared even when they differ little (the models of a forecast)
      const signal = Math.max(base * NATURE_WEIGHT[m.measure!.nature] * weight, structural && m === m0 && !countLed ? 0.1 : 0);
      if (signal < 0.02) continue;
      options.push({
        dim: name,
        value: m.name,
        signal,
        share: sum && d.distinct <= 6 && !m.measure!.negative,
        question: sum ? `Which ${humanize(name)} brings in the most ${humanize(m.name)}?` : `How does ${humanize(m.name)} differ by ${humanize(name)}?`,
        widget: {
          title: `${named(m)} by ${humanize(name)}`,
          subtitle: scopeOf(m),
          kind: 'horizontal_bar',
          sql: `SELECT ${q(name)}, ${aggSql(m)} AS ${alias(m)} FROM ${t}${atLatest(m)} GROUP BY 1 ORDER BY 2 DESC${top}`,
          x_field: name,
          y_fields: [alias(m)],
          format: formatOf(m),
          unit: unitOf(m),
          chart_config: { sort_by: 'value_desc', ...(sum ? {} : { show_average_line: true }) },
          explanation: `${how(m)} for every ${name}${tops}.`,
        },
      });
    }
    for (const f of flags) {
      // A yes/no outcome never explains much variance: a rate that differs between groups is a finding all the same
      const signal = Math.min(0.9, (b.explains[f.name] ?? 0) * 6) * weight;
      if (signal < 0.02) continue;
      options.push({
        dim: name,
        value: f.name,
        signal,
        share: false,
        question: `Where is the share of ${humanize(f.name).toLowerCase()} highest?`,
        widget: {
          title: `${humanize(f.name)} Rate by ${humanize(name)}`,
          subtitle: scope,
          kind: 'horizontal_bar',
          sql: `SELECT ${q(name)}, ${flagSql(f)} AS ${flagAlias(f)} FROM ${t} GROUP BY 1 ORDER BY 2 DESC${top}`,
          x_field: name,
          y_fields: [flagAlias(f)],
          format: 'percent',
          chart_config: { sort_by: 'value_desc', show_average_line: true },
          explanation: `The percentage of rows where ${f.name} is ${JSON.stringify(f.flag!.on)}, for every ${name}${tops}.`,
        },
      });
    }
    if (profile.kind === 'events' && b.unevenness >= 0.1) {
      options.push({
        dim: name,
        value: '#rows',
        signal: b.unevenness * 0.4 * weight,
        share: d.distinct <= 6,
        question: `Which ${humanize(name)} has the most ${entity}?`,
        widget: {
          title: `${entityTitle} by ${humanize(name)}`,
          subtitle: scope,
          kind: 'horizontal_bar',
          sql: `SELECT ${q(name)}, COUNT(*) AS ${counted} FROM ${t} GROUP BY 1 ORDER BY 2 DESC${top}`,
          x_field: name,
          y_fields: [counted],
          format: 'number',
          chart_config: { sort_by: 'value_desc' },
          explanation: `Counts the ${entity} of every ${name}${tops}.`,
        },
      });
    }
  }
  // The leading figure by the dimension that separates it best, then the strongest findings,
  // each telling something the others do not: a new figure, or a new dimension
  const leadValue = countLed ? '#rows' : m0?.measure!.aggregate === 'sum' ? m0.name : undefined;
  const picked: Option[] = [];
  const lead = leadValue !== undefined ? options.find((o) => o.value === leadValue) : undefined;
  if (lead) picked.push(lead);
  const pickedValue = (v: string) => usedValues.has(v) || picked.some((p) => p.value === v);
  const echoes = (v: string) => profile.correlations.some((c) =>
    Math.abs(c.r) >= 0.9 && ((c.a === v && pickedValue(c.b)) || (c.b === v && pickedValue(c.a))));
  while (picked.length + rankings < 3) {
    let best: Option | undefined;
    let bestScore = 0.08;
    for (const o of options) {
      const sameDim = picked.filter((p) => p.dim === o.dim).length;
      if (picked.includes(o) || sameDim >= 2) continue;
      const score = o.signal * (sameDim > 0 ? 0.75 : 1) * (pickedValue(o.value) && o.value !== leadValue ? 0.2 : 1) * (echoes(o.value) ? 0.25 : 1);
      if (score > bestScore) {
        best = o;
        bestScore = score;
      }
    }
    if (!best) break;
    picked.push(best);
  }
  let donutUsed = false;
  for (const o of picked) {
    // One share of a whole per dashboard, for a handful of parts
    const donut: boolean = o.share && !donutUsed;
    donutUsed = donutUsed || donut;
    add('breakdown', o.question, donut
      ? { ...o.widget, kind: 'donut', chart_config: { show_data_labels: true, data_label_content: 'percent' } }
      : o.widget);
  }
  if (repeated && profile.kind === 'events' && (countLed || (m0 !== undefined && m0.measure!.aggregate === 'sum'))) {
    const what = countLed ? entityTitle : humanize(m0!.name);
    const valueAlias = countLed ? counted : alias(m0!);
    add('breakdown', `Which ${repeatedName} account for the most ${what}?`, {
      title: `Top ${capital(repeatedName)} by ${what}`,
      subtitle: scope,
      kind: 'horizontal_bar',
      sql: `SELECT ${q(repeated.name)}, ${countLed ? 'COUNT(*)' : aggSql(m0!)} AS ${valueAlias} FROM ${t} GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
      x_field: repeated.name,
      y_fields: [valueAlias],
      format: countLed ? 'number' : formatOf(m0!),
      ...(countLed ? {} : { unit: unitOf(m0!) }),
      chart_config: { sort_by: 'value_desc' },
      explanation: `${countLed ? `Counts the ${entity}` : how(m0!)} for the ten largest ${repeated.name}.`,
    });
  }

  // Stages in their order are a funnel
  const stage = profile.columns.find((c) => c.role === 'dimension' && !c.note && nameTokens(c.name).some((x) => STAGE_WORDS.includes(x)) && c.distinct >= 3 && c.distinct <= 8);
  const stageOrder = stage
    ? profile.columns.find((c) => c.name !== stage.name && typeof c.min === 'number' && nameTokens(c.name).some((x) => ORDER_WORDS.includes(x)) && c.distinct === stage.distinct)
    : undefined;
  if (stage && stageOrder && additive[0]) {
    const volume = additive[0];
    add('breakdown', 'Where do we lose the most between stages?', {
      title: `${humanize(volume.name)} by ${humanize(stage.name)}`,
      subtitle: scope,
      kind: 'funnel',
      sql: `SELECT ${q(stage.name)}, ${aggSql(volume)} AS ${alias(volume)} FROM ${t} GROUP BY ${q(stageOrder.name)}, ${q(stage.name)} ORDER BY ${q(stageOrder.name)}`,
      x_field: stage.name,
      y_fields: [alias(volume)],
      format: formatOf(volume),
      explanation: `${how(volume)} at every ${stage.name}, in the order of ${stageOrder.name}.`,
    });
  }

  // Two dimensions at once, when both matter
  const telling = countLed || m0
    ? profile.dimensions.filter((name) => {
        const b = profile.breakdowns.find((x) => x.dimension === name);
        return b !== undefined && b.groups >= 2 && b.groups <= 12 && profile.profiledRows >= b.groups * 4 && !col(name).note &&
          ((!countLed && (b.explains[m0!.name] ?? 0) >= 0.05) || ((countLed || m0!.measure!.aggregate === 'sum') && b.unevenness >= 0.15));
      })
    : [];
  if (telling.length >= 2 && profile.profiledRows >= 60) {
    const [x, y] = telling;
    const valueAlias = countLed ? counted : alias(m0!);
    add('breakdown', `Which combinations of ${humanize(x)} and ${humanize(y)} stand out?`, {
      title: `${countLed ? entityTitle : named(m0!)} by ${humanize(x)} and ${humanize(y)}`,
      subtitle: countLed ? scope : scopeOf(m0!),
      kind: 'heatmap',
      sql: `SELECT ${q(x)}, ${q(y)}, ${countLed ? 'COUNT(*)' : aggSql(m0!)} AS ${valueAlias} FROM ${t}${countLed ? '' : atLatest(m0!)} GROUP BY 1, 2`,
      x_field: x,
      series_field: y,
      y_fields: [valueAlias],
      format: countLed ? 'number' : formatOf(m0!),
      chart_config: { show_data_labels: col(x).distinct * col(y).distinct <= 30 },
      explanation: `${countLed ? `Counts the ${entity}` : how(m0!)} for every combination of ${x} and ${y}.`,
    });
  }

  // ---------------------------------------------------------------- relationship between two measures
  const money = (c: ColumnInsight) => ['USD', 'EUR', 'GBP', 'RON', 'CHF'].includes(c.measure?.unit ?? '') || ['amount', 'price'].includes(c.measure?.nature ?? '');
  // Revenue, cost and price move together by construction: that is arithmetic, not a finding
  const related = profile.correlations.find((c) => Math.abs(c.r) >= 0.4 && Math.abs(c.r) < 0.97 && !(money(col(c.a)) && money(col(c.b))));
  if (related && !series) {
    const a = col(related.a);
    const b = col(related.b);
    const label = profile.labelColumn ?? idColumn;
    const carrier = profile.dimensions.map(col).find((d) => d.distinct >= 8 && d.distinct <= 80 && profile.profiledRows >= d.distinct * 3);
    const raw = profile.rowCount <= 150 && label !== undefined;
    const by = raw ? label! : carrier?.name;
    if (by) {
      add('relationship', `Do ${humanize(a.name)} and ${humanize(b.name)} go together?`, {
        title: `${humanize(b.name)} vs ${humanize(a.name)}`,
        subtitle: raw ? `One point per ${by}` : `One point per ${by} (averages)`,
        kind: 'scatter',
        sql: raw
          ? `SELECT ${q(by)}, ${q(a.name)}, ${q(b.name)} FROM ${t} WHERE ${q(a.name)} IS NOT NULL AND ${q(b.name)} IS NOT NULL`
          : `SELECT ${q(by)}, ROUND(AVG(${q(a.name)}), 2) AS ${safe(a.name)}, ROUND(AVG(${q(b.name)}), 2) AS ${safe(b.name)} FROM ${t} GROUP BY 1`,
        x_field: safe(a.name),
        y_fields: [safe(b.name)],
        format: b.measure!.format ?? 'number',
        chart_config: { show_trendline: true, x_axis_title: humanize(a.name), y_axis_title: humanize(b.name) },
        explanation: `${b.name} against ${a.name}, one point per ${by} (correlation ${related.r} over the rows).`,
      });
    }
  }

  // ---------------------------------------------------------------- how the values are spread
  // In an event log the spread worth seeing is that of a per-event reading (latency), not of a payload size
  const spread = countLed ? measures.find((m) => m.measure!.aggregate === 'avg' && m.measure!.nature !== 'statistic') ?? m0 : m0;
  if (spread && !series && profile.rowCount >= 30 && spread.measure!.max > spread.measure!.min && spread.distinct > 12) {
    const { min, max, p95 } = spread.measure!;
    if (profile.rowCount <= 900) {
      add('distribution', `How is ${humanize(spread.name)} spread?`, {
        title: `Distribution of ${humanize(spread.name)}`,
        subtitle: scope,
        kind: 'histogram',
        sql: `SELECT ${q(spread.name)} FROM ${t} WHERE ${q(spread.name)} IS NOT NULL`,
        y_fields: [spread.name],
        format: spread.measure!.format ?? 'number',
        chart_config: { bin_count: 16 },
        explanation: `Every value of ${spread.name}, grouped into bins.`,
      });
    } else {
      // Too many rows to hand to the chart: the bins are counted in SQL, so no row is left out.
      // A long tail would squeeze everything into the first bin, so the bins stop where it starts.
      const tail = spread.measure!.skewed === true && p95 > min && p95 < max;
      const top = tail ? p95 : max;
      const step = niceStep((top - min) / 16);
      const base = tidy(Math.floor(min / step) * step);
      const digits = Math.max(0, -Math.floor(Math.log10(step)));
      add('distribution', `How is ${humanize(spread.name)} spread?`, {
        title: `Distribution of ${humanize(spread.name)}`,
        subtitle: [`bins of ${step}`, tail ? `up to ${top} (95% of the ${entity})` : undefined, scope].filter(Boolean).join(' · '),
        kind: 'column',
        sql: `SELECT ROUND(${base} + CAST((${q(spread.name)} - (${base})) / ${step} AS INTEGER) * ${step}, ${digits}) AS ${safe(spread.name)}_from, COUNT(*) AS ${counted} ` +
          `FROM ${t} WHERE ${q(spread.name)} IS NOT NULL${tail ? ` AND ${q(spread.name)} <= ${top}` : ''} GROUP BY 1 ORDER BY 1`,
        x_field: `${safe(spread.name)}_from`,
        y_fields: [counted],
        format: 'number',
        chart_config: { sort_by: 'none', x_axis_title: `${humanize(spread.name)} (start of the bin)` },
        explanation: `Counts the ${entity} in bins of ${step} of ${spread.name}${tail ? `, leaving out the 5% above ${top}` : ''}.`,
      });
    }
  }

  // ---------------------------------------------------------------- the rows themselves
  const detail: string[] = [];
  const show = (name: string | undefined) => {
    if (name && !detail.includes(name) && detail.length < 7) detail.push(name);
  };
  show(profile.labelColumn ?? idColumn);
  show(profile.timeColumn);
  profile.grain?.forEach(show);
  profile.dimensions.slice(0, 2).forEach(show);
  profile.measures.slice(0, 3).forEach(show);
  profile.flags.slice(0, 1).forEach(show);
  if (detail.length >= 2) {
    const byTime = profile.timeColumn !== undefined && (series || !m0 || countLed);
    const rowsName = entityTitle === 'Records' ? 'Rows' : entityTitle;
    add('detail', 'Which rows are behind the numbers?', {
      title: byTime ? `Latest ${rowsName}` : m0 ? `Top ${rowsName} by ${humanize(m0.name)}` : rowsName,
      subtitle: scope,
      kind: 'table',
      sql: `SELECT ${detail.map(q).join(', ')} FROM ${t} ORDER BY ${byTime ? `${tc} DESC` : m0 ? `${q(m0.name)} DESC` : q(detail[0])} LIMIT 25`,
      format: 'number',
      explanation: byTime ? 'The most recent rows.' : m0 ? `The 25 rows with the highest ${m0.name}.` : 'The first rows.',
    });
  }

  return ideas;
}

const SLOT_LIMIT: Record<IdeaSlot, number> = { headline: 4, trend: 1, pattern: 1, breakdown: 2, relationship: 1, distribution: 1, detail: 1 };

/**
 * A complete first dashboard for a table: the leading idea of every part of
 * the story, laid out on the 12-column grid (headline cards, the trend next
 * to a share chart, the remaining charts in pairs, the detail table).
 */
export function starterDashboard(profile: TableProfile, opts: { source?: string } = {}): CreateDashboardRequest | null {
  const ideas = suggestCharts(profile);
  if (ideas.length === 0) return null;
  const taken: Record<IdeaSlot, ChartIdea[]> = { headline: [], trend: [], pattern: [], breakdown: [], relationship: [], distribution: [], detail: [] };
  for (const idea of ideas) {
    if (taken[idea.slot].length < SLOT_LIMIT[idea.slot]) taken[idea.slot].push(idea);
  }
  const widgets: DashboardWidgetInput[] = [];
  const place = (idea: ChartIdea, colSpan: number) => widgets.push({ ...idea.widget, col_span: colSpan });

  const kpis = taken.headline;
  const kpiSpan = kpis.length >= 4 ? 3 : kpis.length === 3 ? 4 : kpis.length === 2 ? 6 : 12;
  kpis.forEach((k) => place(k, kpiSpan));

  // The trend takes two thirds of a row next to a share chart, or the whole row
  const trend = taken.trend[0];
  const charts = [...taken.pattern, ...taken.breakdown, ...taken.relationship, ...taken.distribution];
  if (trend) {
    const partner = charts.findIndex((c) => c.widget.kind === 'donut');
    if (partner >= 0) {
      place(trend, 8);
      place(charts.splice(partner, 1)[0], 4);
    } else {
      place(trend, 12);
    }
  }
  charts.forEach((c, i) => place(c, charts.length % 2 === 1 && i === charts.length - 1 ? 12 : 6));
  taken.detail.forEach((d) => place(d, 12));

  const t = profile.timeColumn ? profile.columns.find((c) => c.name === profile.timeColumn)?.time : undefined;
  return {
    title: `${humanize(profile.name)} Overview`,
    subtitle: [
      t && t.from ? `${t.from.slice(0, 10)} – ${t.to.slice(0, 10)}` : undefined,
      profile.partOf
        ? `sample of ${profile.rowCount.toLocaleString('en-US')} of ${profile.partOf.rowCount.toLocaleString('en-US')} rows`
        : `${profile.rowCount.toLocaleString('en-US')} rows`,
    ].filter(Boolean).join(' · '),
    source: opts.source ?? 'local',
    widgets,
  };
}

/** An idea as the voice agent reads it: the question it answers, then the widget as create_dashboard takes it. */
export function ideaForModel(idea: ChartIdea): Record<string, unknown> {
  return { answers: idea.question, ...Object.fromEntries(Object.entries(idea.widget).filter(([, v]) => v !== undefined)) };
}
