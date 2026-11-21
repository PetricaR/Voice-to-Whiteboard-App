/**
 * Live data on slides: the read-only SQL queries that chart, table and kpis
 * slides carry (`sql` + `data_source` in a tool call or the slide inspector).
 *
 * Before a deck is created or edited, the queries of the request are checked
 * (read-only, the source's dialect) and run; their results go to the deck
 * engine, which fills the slides (engine/deck.ts). "Sync data" runs every
 * query of the deck again. The voice agent and the Deck tab share this, so a
 * chart said aloud and a query typed in the inspector behave the same.
 */
import { executeSqlQuery, type QueryExecutionResult } from '../data/sqlEngine';
import { dialectOfSource, validateReadOnlySql } from '../data/sqlGuard';
import { filterParamsOf, type DashboardSpec } from '../engine/dashboard';
import { deckQueries, queryKey, queryOfInput, type DeckSpec, type QueryInput, type QueryResults, type SlideInput, type SlideQuery } from '../engine/deck';

type DeckRequestSlides = { slides?: SlideInput[]; add_slides?: SlideInput[]; update_slides?: SlideInput[] };

/** Slides and metrics of a request that name a query. */
function queryInputs(req: DeckRequestSlides): QueryInput[] {
  const out: QueryInput[] = [];
  for (const s of [...(req.slides ?? []), ...(req.add_slides ?? []), ...(req.update_slides ?? [])]) {
    if (s == null || typeof s !== 'object') continue;
    out.push(s);
    for (const m of Array.isArray(s.metrics) ? s.metrics : []) if (m != null && typeof m === 'object') out.push(m);
  }
  return out;
}

/**
 * Gives a data source to every query of the request that names none (the
 * page's default source), in place, and returns the queries to run.
 */
export function prepareDeckQueries(req: DeckRequestSlides, defaultSource = 'local'): SlideQuery[] {
  const out = new Map<string, SlideQuery>();
  for (const input of queryInputs(req)) {
    if (typeof input.sql !== 'string' || input.sql.trim() === '') continue;
    if (!input.data_source && !input.dataSource) input.data_source = defaultSource;
    const q = queryOfInput(input);
    if (q) out.set(queryKey(q), q);
  }
  return [...out.values()];
}

export interface DeckQueryRun {
  results: QueryResults;
  /** One line per query that is not read-only or failed: told to the agent (or the user) to fix. */
  errors: string[];
}

/** Checks and runs the queries (in parallel). */
export async function runDeckQueries(queries: SlideQuery[], dashboard?: DashboardSpec): Promise<DeckQueryRun> {
  const results: QueryResults = new Map();
  const errors: string[] = [];
  const params = filterParamsOf(dashboard);
  await Promise.all(queries.map(async (q) => {
    const short = q.sql.replace(/\s+/g, ' ').slice(0, 80);
    const check = validateReadOnlySql(q.sql, { dialect: dialectOfSource(q.source) });
    if (!check.ok) {
      errors.push(`Query "${short}…": ${check.error}`);
      return;
    }
    let res: QueryExecutionResult;
    try {
      res = await executeSqlQuery(q.sql, { source: q.source, params });
    } catch (e) {
      errors.push(`Query "${short}…" on ${q.source}: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (!res.ok) {
      errors.push(`Query "${short}…" on ${q.source}: ${res.error ?? 'the query failed'}`);
      return;
    }
    results.set(queryKey(q), res);
  }));
  return { results, errors };
}

/** Runs every query of a deck again (for "Sync data"). Failed queries keep their slide's numbers. */
export async function rerunDeckQueries(deck: DeckSpec, dashboard?: DashboardSpec): Promise<DeckQueryRun> {
  return runDeckQueries(deckQueries(deck), dashboard);
}
