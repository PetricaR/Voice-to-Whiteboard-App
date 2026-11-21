/**
 * The Board of a page: work in progress while looking for insights. The agent
 * (or the user) puts charts and tables there while exploring; the ones worth
 * keeping are promoted — copied — to the page's dashboard.
 *
 * A promoted chart is a copy, so the Board keeps its history (what was asked,
 * what it showed) and the dashboard chart can be refined on its own. The Board
 * never refreshes by itself: exploring must not keep a warehouse busy.
 */
import {
  cloneDashboard,
  resolveWidgetRef,
  type DashboardFilter,
  type DashboardSpec,
  type DashboardWidget,
} from './dashboard';

export function emptyBoard(defaultSource = 'local'): DashboardSpec {
  return { title: 'Board', defaultSource, refreshSeconds: 0, filters: [], widgets: [] };
}

/** The `:param` names a query uses, outside quoted text and comments. */
export function sqlParamsOf(sql: string): string[] {
  const stripped = sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"|`[^`]*`/g, ' ');
  const out = new Set<string>();
  for (const m of stripped.matchAll(/(^|[^:\w]):([A-Za-z_]\w*)/g)) out.add(m[2]);
  return [...out];
}

function uniqueId(base: string, used: Set<string>): string {
  let id = base;
  let n = 2;
  while (used.has(id)) id = `${base}_${n++}`;
  used.add(id);
  return id;
}

export interface PromoteResult {
  ok: boolean;
  board: DashboardSpec;
  dashboard: DashboardSpec;
  /** Board widget id → its new dashboard widget id. */
  promoted: [string, string][];
  /** Filters the dashboard got so the copies keep working. */
  addedFilters: string[];
  createdDashboard: boolean;
  errors: string[];
  warnings: string[];
  notes: string[];
}

/**
 * Copies Board charts to the dashboard (made when there is none). A copy gets
 * an id of its own on the dashboard and the filters its query uses; the Board
 * chart is marked as promoted. A chart already on the dashboard is not copied
 * again.
 */
export function promoteWidgets(
  board: DashboardSpec,
  dashboard: DashboardSpec | undefined,
  refs: string[],
  opts: { selection?: string[]; title?: string; now?: number } = {},
): PromoteResult {
  const nextBoard = cloneDashboard(board);
  const createdDashboard = dashboard == null;
  const nextDash: DashboardSpec = dashboard
    ? cloneDashboard(dashboard)
    : { title: opts.title?.trim() || 'Dashboard', defaultSource: board.defaultSource, refreshSeconds: 0, filters: [], widgets: [] };
  const errors: string[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];
  const promoted: [string, string][] = [];
  const addedFilters: string[] = [];
  const usedWidgetIds = new Set(nextDash.widgets.map((w) => w.id));
  const usedFilterIds = new Set(nextDash.filters.map((f) => f.id));
  const now = opts.now ?? Date.now();
  const seen = new Set<string>();

  if (refs.length === 0) errors.push('Name the Board charts to promote (their ids, or "@selected").');

  for (const ref of refs) {
    const r = resolveWidgetRef(ref, nextBoard.widgets, opts.selection ?? []);
    const source = r.item;
    if (source == null) {
      errors.push(r.error ?? `No Board chart matching "${ref}".`);
      continue;
    }
    if (r.note) notes.push(r.note);
    if (seen.has(source.id)) continue;
    seen.add(source.id);
    if (source.promotedAs && nextDash.widgets.some((w) => w.id === source.promotedAs)) {
      warnings.push(`${source.id} is already on the dashboard as ${source.promotedAs}; it was not copied again.`);
      continue;
    }

    // The copy works on the dashboard as it does on the Board: the filters its query uses come along
    for (const param of sqlParamsOf(source.sql)) {
      if (nextDash.filters.some((f) => f.param === param)) continue;
      const bf = nextBoard.filters.find((f) => f.param === param);
      if (bf == null) continue;
      const copy: DashboardFilter = { ...bf, id: uniqueId(bf.id, usedFilterIds), options: bf.options ? [...bf.options] : undefined };
      if (copy.options == null) delete copy.options;
      nextDash.filters.push(copy);
      addedFilters.push(copy.id);
    }

    const { askedAs: _a, insight: _i, promotedAt: _p, promotedAs: _s, ...rest } = source;
    const copy: DashboardWidget = {
      ...rest,
      id: uniqueId(source.id, usedWidgetIds),
      yFields: source.yFields ? [...source.yFields] : undefined,
      ...(source.chartConfig ? { chartConfig: structuredClone(source.chartConfig) } : {}),
    };
    if (copy.yFields === undefined) delete copy.yFields;
    nextDash.widgets.push(copy);
    source.promotedAt = now;
    source.promotedAs = copy.id;
    promoted.push([source.id, copy.id]);
    if (copy.id !== source.id) notes.push(`${source.id} is ${copy.id} on the dashboard (the id was taken).`);
  }

  return {
    ok: errors.length === 0 || promoted.length > 0,
    board: nextBoard,
    dashboard: nextDash,
    promoted,
    addedFilters,
    createdDashboard: createdDashboard && promoted.length > 0,
    errors,
    warnings,
    notes,
  };
}
