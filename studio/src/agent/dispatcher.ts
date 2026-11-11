/**
 * Executes the agent's function calls on the workspace. Every response
 * carries the resulting diagram state of the active page (and the list of
 * pages), so the model always edits the real canvas (including changes the
 * user made by hand) instead of its memory.
 */
import { bqApi } from '../data/bqCatalogClient';
import {
  executeSqlQuery,
  importRowsIntoLocalTable,
  inspectDataSchema,
  listAllDataSources,
  type QueryExecutionResult,
  type TableSchemaInfo,
} from '../data/sqlEngine';
import { dialectOfSource, validateReadOnlySql } from '../data/sqlGuard';
import { resolveBlock } from '../engine/blocks';
import { loadAllBlueprints, retrieveCatalogContext } from '../engine/catalog';
import {
  filterParamsOf,
  type CreateDashboardRequest,
  type DashboardSpec,
  type EditDashboardRequest,
} from '../engine/dashboard';
import type { CreateMotionRequest, EditMotionRequest } from '../engine/motion';
import type { BlockInput, CreateRequest, EditRequest, EditResult } from '../engine/ops';
import { resolveRef } from '../engine/resolve';
import { DiagramStore, type ChangeSource } from '../engine/store';
import { describeChanges, describeScene } from '../engine/summary';
import type { ChangeSet } from '../engine/types';
import type { PageView, Workspace } from '../engine/workspace';

/** Moves the canvas view; provided by the UI. */
export interface ViewController {
  zoomIn(): void;
  zoomOut(): void;
  /** Fits the whole diagram (with its texts and tables). */
  fit(): void;
  /** 100 %. */
  actualSize(): void;
  /** Zooms to the given elements (nodes or groups); false if none is on the canvas. */
  focus(ids: string[]): boolean;
}

/** Optional UI hooks for Dashboard SQL Inspector & Motion playback/export controls. */
export interface StudioController {
  inspectWidget?(widgetId: string): void;
  controlMotion?(action: 'play' | 'pause' | 'restart' | 'seek' | 'export_mp4', timeMs?: number): void;
  getDashboardResults?(): Record<string, QueryExecutionResult | undefined>;
}

export interface ToolContext {
  /** The document with its pages; tools act on the active page. */
  workspace?: Workspace;
  /** A single diagram without pages (tests, eval). Ignored when workspace is set. */
  store?: DiagramStore;
  source: ChangeSource;
  /** What the user said or typed in the current turn, for the history. */
  request?: string;
  view?: ViewController;
  studio?: StudioController;
}

export type ToolResponse = Record<string, unknown>;

function storeOf(ctx: ToolContext): DiagramStore {
  const store = ctx.workspace?.store ?? ctx.store;
  if (store == null) throw new Error('No diagram to edit.');
  return store;
}

/**
 * The pages line of the state, e.g.
 *   pages: page_1 "Checkout" (current) + documentation (3 chapters) · page_2 "Data flow".
 */
function pagesLine(ws: Workspace): string {
  return 'pages: ' + ws.pages.map((p, i) => {
    const chapters = p.store.scene.blocks.length;
    const widgets = p.store.scene.dashboard?.widgets.length ?? 0;
    const motionScenes = p.store.scene.motion?.scenes.length ?? 0;
    const currentViewSuffix = p.id === ws.activeId
      ? p.view === 'doc'
        ? ' (current, its documentation tab is shown)'
        : p.view === 'dashboard'
          ? ' (current, its dashboard tab is shown)'
          : p.view === 'motion'
            ? ' (current, its motion tab is shown)'
            : ' (current)'
      : '';
    return `${p.id} ${JSON.stringify(ws.pageTitle(p))}` +
      currentViewSuffix +
      (widgets > 0 ? ` + dashboard (${widgets} ${widgets === 1 ? 'widget' : 'widgets'})` : '') +
      (motionScenes > 0 ? ` + motion (${motionScenes} ${motionScenes === 1 ? 'scene' : 'scenes'})` : '') +
      (chapters > 0 ? ` + documentation (${chapters} ${chapters === 1 ? 'chapter' : 'chapters'})` : '') +
      (i === 0 && ws.pages.length === 1 ? ' (only page)' : '');
  }).join(' · ');
}

/**
 * Shows what an agent change touched: dashboard, motion, diagram, or documentation.
 */
function follow(ws: Workspace | undefined, c: ChangeSet | undefined) {
  if (ws == null || c == null) return;
  const dashChanged = c.addedWidgets.length + c.updatedWidgets.length + c.removedWidgets.length > 0;
  const motionChanged = c.addedMotionScenes.length + c.updatedMotionScenes.length + c.removedMotionScenes.length > 0;
  const diagram = c.addedNodes.length + c.updatedNodes.length + c.removedNodes.length + c.movedNodes.length +
    c.addedEdges.length + c.updatedEdges.length + c.removedEdges.length +
    c.addedGroups.length + c.updatedGroups.length + c.removedGroups.length > 0;
  const chapters = [...c.addedBlocks, ...c.updatedBlocks, ...c.removedBlocks];
  const chapter = chapters.find((id) => ws.store.scene.blocks.some((b) => b.id === id));
  if (dashChanged) ws.showView('dashboard');
  else if (motionChanged) ws.showView('motion');
  else if (diagram) ws.showView('diagram');
  else if (chapters.length > 0) ws.showView('doc', { chapter });
}

const DOC_WORDS = /\b(doc|docs|documentation|documentatia|documentatie|documentația|documentație|book|carte|cartea)\b/i;
const DASH_WORDS = /\b(dashboard|dashboards|metrics|charts|kpi|kpis)\b/i;
const MOTION_WORDS = /\b(motion|animation|animated|explainer|video|walkthrough)\b/i;

function stateOf(ctx: ToolContext): string {
  const store = storeOf(ctx);
  const scene = describeScene(store.scene, store.selection);
  return ctx.workspace != null ? `${pagesLine(ctx.workspace)}\n${scene}` : scene;
}

function editResponse(ctx: ToolContext, result: EditResult, staleNote?: string): ToolResponse {
  const response: ToolResponse = { ok: result.ok };
  if (result.ok) {
    response.result = describeChanges(result.changes);
  } else {
    response.errors = result.errors;
    response.result = 'Nothing was changed.';
  }
  if (result.warnings.length > 0) response.warnings = result.warnings;
  if (result.notes.length > 0) response.understood = result.notes;
  if (staleNote) response.note = staleNote;
  response.diagram = stateOf(ctx);
  return response;
}

const asInt = (v: unknown, def: number) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 50) : def;
};

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);

const needsPages = (ctx: ToolContext): ToolResponse | null => (ctx.workspace == null
  ? { ok: false, errors: ['Pages are not available here.'], diagram: stateOf(ctx) }
  : null);

/** Label of a write_text / write_table call in the history. */
function blockLabel(kind: 'text' | 'table', input: BlockInput, existed: boolean, summary: string | undefined): string {
  if (summary) return summary;
  const name = input.title ? `“${input.title}”` : kind === 'table' ? 'a table' : 'a text';
  if (kind === 'table') return existed ? `Updated the table ${input.title ? name : ''}`.trim() : `Added the table ${name}`;
  return existed ? `Updated ${name}` : `Wrote ${name}`;
}

/** Tables whose columns fit into one answer; beyond that the model gets an index and asks again. */
const SCHEMA_FULL_TABLES = 12;
const SCHEMA_INDEX_TABLES = 150;
const SCHEMA_COLUMNS = 60;

const clip = (text: string | undefined, max: number) =>
  (text == null || text.length <= max ? text : `${text.slice(0, max - 1)}…`);

/**
 * A warehouse catalog can hold thousands of tables; sent whole it would fill
 * the model's context. Few tables are described in full, many as an index of
 * names the model narrows with `table` or `search`.
 */
export function schemaForModel(all: TableSchemaInfo[], search?: string): Record<string, unknown> {
  const words = (search ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (t: TableSchemaInfo) => {
    if (words.length === 0) return true;
    const text = [t.name, t.fullName, t.description, ...t.columns.map((c) => c.name)].join(' ').toLowerCase();
    return words.every((w) => text.includes(w));
  };
  const tables = all.filter(matches);
  if (tables.length <= SCHEMA_FULL_TABLES) {
    return {
      tables: tables.map((t) => ({
        name: t.name,
        ...(t.fullName ? { fullName: t.fullName } : {}),
        dataset: t.dataset,
        description: clip(t.description, 240),
        rowCount: t.rowCount,
        columns: t.columns.slice(0, SCHEMA_COLUMNS).map((c) => ({
          name: c.name,
          type: c.type,
          ...(c.description ? { description: clip(c.description, 120) } : {}),
        })),
        ...(t.columns.length > SCHEMA_COLUMNS ? { moreColumns: t.columns.length - SCHEMA_COLUMNS } : {}),
        ...(t.sampleRows?.length ? { sampleRows: t.sampleRows } : {}),
      })),
      ...(words.length > 0 && tables.length === 0 ? { note: `No table matches "${search}". Call inspect_schema without search to list the tables.` } : {}),
    };
  }
  return {
    tableCount: tables.length,
    tableIndex: tables.slice(0, SCHEMA_INDEX_TABLES).map((t) => ({
      name: t.name,
      rowCount: t.rowCount,
      columns: t.columns.length,
      ...(t.description ? { description: clip(t.description, 80) } : {}),
    })),
    note: `${tables.length} tables${tables.length > SCHEMA_INDEX_TABLES ? ` (the first ${SCHEMA_INDEX_TABLES} are listed)` : ''}: too many to describe at once. Call inspect_schema again with table (a table or dataset name) or search (words) to get the columns.`,
  };
}

async function computeDashboardResults(d: DashboardSpec): Promise<Record<string, QueryExecutionResult | undefined>> {
  const out: Record<string, QueryExecutionResult | undefined> = {};
  const params = filterParamsOf(d);
  await Promise.all(
    d.widgets.map(async (w) => {
      try {
        const res = await executeSqlQuery(w.sql, { source: w.source, params });
        if (res.ok) out[w.id] = res;
      } catch {
        // Ignore individual remote errors during background synthesis
      }
    }),
  );
  return out;
}

export async function handleToolCall(name: string, args: Record<string, unknown> | undefined, ctx: ToolContext): Promise<ToolResponse> {
  const a = args ?? {};
  const ws = ctx.workspace;
  const meta = { source: ctx.source, request: ctx.request };

  switch (name) {
    case 'get_diagram':
      return { ok: true, diagram: stateOf(ctx) };

    case 'list_data_sources': {
      const sources = await listAllDataSources();
      return { ok: true, sources, diagram: stateOf(ctx) };
    }

    case 'inspect_schema': {
      const source = str(a.source) ?? 'local';
      const table = str(a.table);
      try {
        const schema = await inspectDataSchema({ source, table });
        return { ok: true, source: schema.source, ...schemaForModel(schema.tables, str(a.search)), diagram: stateOf(ctx) };
      } catch (e) {
        return { ok: false, errors: [e instanceof Error ? e.message : String(e)], diagram: stateOf(ctx) };
      }
    }

    case 'sync_bigquery': {
      const projectId = str(a.project_id);
      const datasetFilter = str(a.dataset_filter) ?? null;
      const loadTable = str(a.load_table_to_local);
      try {
        let synced: unknown;
        if (projectId) {
          await bqApi.addSource({ project_id: projectId, dataset_filter: datasetFilter }).catch(() => undefined);
          synced = await bqApi.sync({ project_id: projectId, dataset_filter: datasetFilter });
        } else {
          synced = await bqApi.syncAll();
        }
        let loadedLocalTable: unknown;
        if (loadTable && projectId) {
          const parts = loadTable.replace(/`/g, '').split('.').filter(Boolean);
          const dsId = parts.length >= 2 ? parts[parts.length - 2] : undefined;
          const tblId = parts.length >= 2 ? parts[parts.length - 1] : undefined;
          if (dsId && tblId) {
            const preview = await bqApi.runPreview({
              project_id: projectId,
              dataset_id: dsId,
              table_id: tblId,
              limit: 1000,
              sample: false,
            });
            loadedLocalTable = await importRowsIntoLocalTable({
              tableName: `${dsId}_${tblId}`,
              columns: preview.columns,
              rows: preview.rows,
              dataset: `${projectId}.${dsId}`,
              datasetLabel: `BigQuery · ${projectId}.${dsId}`,
            });
          }
        }
        return {
          ok: true,
          synced,
          ...(loadedLocalTable ? { loadedLocalTable } : {}),
          diagram: stateOf(ctx),
        };
      } catch (e) {
        return { ok: false, errors: [e instanceof Error ? e.message : String(e)], diagram: stateOf(ctx) };
      }
    }

    case 'run_query': {
      const source = str(a.source) ?? 'local';
      const sql = str(a.sql);
      if (!sql) return { ok: false, errors: ['run_query requires a read-only SQL query.'], diagram: stateOf(ctx) };
      try {
        const dash = storeOf(ctx).scene.dashboard;
        const res = await executeSqlQuery(sql, { source, params: dash ? filterParamsOf(dash) : undefined });
        if (!res.ok) {
          return { ok: false, errors: [res.error ?? 'SQL query failed.'], diagram: stateOf(ctx) };
        }
        return {
          ok: true,
          source: res.source,
          columns: res.columns,
          rows: res.rows.slice(0, 60),
          rowCount: res.rowCount,
          durationMs: res.durationMs,
          diagram: stateOf(ctx),
        };
      } catch (e) {
        return { ok: false, errors: [e instanceof Error ? e.message : String(e)], diagram: stateOf(ctx) };
      }
    }

    case 'create_dashboard': {
      const store = storeOf(ctx);
      const req = a as unknown as CreateDashboardRequest;
      const defaultSrc = str(req.source) ?? 'local';

      // Validate read-only SQL and pre-verify local SQLite queries so Gemini catches column typos immediately
      const sqlErrors: string[] = [];
      const filterParams: Record<string, string> = {};
      for (const f of req.filters ?? []) {
        if (f?.param) filterParams[f.param] = f.value ?? f.options?.[0] ?? 'ALL';
      }
      for (const w of req.widgets ?? []) {
        const src = w?.source || defaultSrc;
        const check = validateReadOnlySql(w?.sql ?? '', { dialect: dialectOfSource(src) });
        if (!check.ok) {
          sqlErrors.push(`Widget "${w?.title ?? 'unnamed'}": ${check.error}`);
          continue;
        }
        if (src === 'local') {
          const qr = await executeSqlQuery(w.sql, { source: 'local', params: filterParams });
          if (!qr.ok) {
            sqlErrors.push(`Widget "${w.title}" SQL error on local SQLite: ${qr.error ?? 'Unknown SQL error'}`);
          }
        }
      }
      if (sqlErrors.length > 0) {
        return { ok: false, errors: sqlErrors, diagram: stateOf(ctx) };
      }

      const hasDash = store.scene.dashboard != null;
      if (hasDash && req.new_page === true && ws != null) {
        const draft = new DiagramStore();
        const res = draft.createDashboard(req, meta);
        if (res.ok) {
          ws.addPage({
            scene: draft.scene,
            view: 'dashboard',
            label: `Created dashboard “${draft.scene.dashboard?.title ?? 'Dashboard'}”`,
            meta,
          });
        }
        return editResponse(ctx, res);
      }
      if (hasDash && req.replace !== true) {
        return {
          ok: false,
          errors: [
            `This page already has dashboard "${store.scene.dashboard!.title}". Use edit_dashboard to modify it, ` +
            'create_dashboard with new_page: true for a separate tab, or replace: true to overwrite it.',
          ],
          diagram: stateOf(ctx),
        };
      }
      const res = store.createDashboard(req, meta);
      if (res.ok) ws?.showView('dashboard');
      return editResponse(ctx, res);
    }

    case 'edit_dashboard': {
      const store = storeOf(ctx);
      const req = a as unknown as EditDashboardRequest;
      const curDash = store.scene.dashboard;
      if (!curDash) {
        return { ok: false, errors: ['No dashboard on this page yet. Call create_dashboard first.'], diagram: stateOf(ctx) };
      }
      const params = filterParamsOf(curDash);
      const sqlErrors: string[] = [];
      for (const w of [...(req.add_widgets ?? []), ...(req.update_widgets ?? [])]) {
        if (w.sql !== undefined) {
          // An updated widget keeps its own source unless the edit names another
          const src = w.source || curDash.widgets.find((x) => x.id === (w as { id?: string }).id)?.source || curDash.defaultSource;
          const check = validateReadOnlySql(w.sql, { dialect: dialectOfSource(src) });
          if (!check.ok) {
            sqlErrors.push(check.error);
            continue;
          }
          if (src === 'local') {
            const qr = await executeSqlQuery(w.sql, { source: 'local', params });
            if (!qr.ok) {
              sqlErrors.push(`SQL error: ${qr.error ?? 'Unknown SQL error'}`);
            }
          }
        }
      }
      if (sqlErrors.length > 0) return { ok: false, errors: sqlErrors, diagram: stateOf(ctx) };

      const res = store.editDashboard(req, { ...meta, label: str(req.summary) });
      if (res.ok) ws?.showView('dashboard');
      return editResponse(ctx, res);
    }

    case 'refresh_dashboard': {
      const dash = storeOf(ctx).scene.dashboard;
      if (!dash) return { ok: false, errors: ['No dashboard on the current page.'], diagram: stateOf(ctx) };
      ws?.showView('dashboard');
      const liveResults = await computeDashboardResults(dash);
      const summary = dash.widgets.map((w) => ({
        id: w.id,
        title: w.title,
        rowCount: liveResults[w.id]?.rowCount ?? 0,
        firstRow: liveResults[w.id]?.rows?.[0] ?? null,
      }));
      return { ok: true, result: 'Refreshed all dashboard SQL queries.', widgets: summary, diagram: stateOf(ctx) };
    }

    case 'inspect_widget': {
      const store = storeOf(ctx);
      const dash = store.scene.dashboard;
      if (!dash) return { ok: false, errors: ['No dashboard on the current page.'], diagram: stateOf(ctx) };
      const ref = str(a.widget_id) ?? '@selected';
      const resolved: { item?: (typeof dash.widgets)[number]; error?: string } = ref === '@selected' && store.selection.length > 0
        ? { item: dash.widgets.find((w) => store.selection.includes(w.id)) }
        : (() => {
            const r = resolveRef(ref, dash.widgets.map((w) => ({ id: w.id, label: w.title, widget: w })), 'widget');
            return { item: r.item?.widget, error: r.error };
          })();
      if (!resolved.item) {
        return { ok: false, errors: [resolved.error ?? `Widget "${ref}" not found.`], diagram: stateOf(ctx) };
      }
      const w = resolved.item;
      ws?.showView('dashboard');
      ctx.studio?.inspectWidget?.(w.id);
      try {
        const res = await executeSqlQuery(w.sql, { source: w.source, params: filterParamsOf(dash) });
        if (!res.ok) {
          return { ok: false, errors: [res.error ?? 'SQL query failed.'], diagram: stateOf(ctx) };
        }
        return {
          ok: true,
          widget: { id: w.id, title: w.title, source: w.source, sql: w.sql, explanation: w.explanation },
          columns: res.columns,
          rows: res.rows.slice(0, 25),
          rowCount: res.rowCount,
          diagram: stateOf(ctx),
        };
      } catch (e) {
        return { ok: false, errors: [e instanceof Error ? e.message : String(e)], diagram: stateOf(ctx) };
      }
    }

    case 'create_motion': {
      const store = storeOf(ctx);
      const req = a as unknown as CreateMotionRequest;
      let dashResults = ctx.studio?.getDashboardResults?.();
      if ((!dashResults || Object.keys(dashResults).length === 0) && store.scene.dashboard) {
        dashResults = await computeDashboardResults(store.scene.dashboard);
      }

      const hasMot = store.scene.motion != null;
      if (hasMot && req.new_page === true && ws != null) {
        const draft = new DiagramStore(store.scene);
        const res = draft.createMotion({ ...req, replace: true }, meta, dashResults);
        if (res.ok) {
          ws.addPage({
            scene: { ...draft.scene, nodes: [], edges: [], groups: [], blocks: [], dashboard: undefined },
            view: 'motion',
            label: `Created motion “${draft.scene.motion?.title ?? 'Motion'}”`,
            meta,
          });
        }
        return editResponse(ctx, res);
      }
      if (hasMot && req.replace !== true && !req.from_current_page) {
        return {
          ok: false,
          errors: [
            `This page already has motion composition "${store.scene.motion!.title}". Use edit_motion to refine it, ` +
            'or pass replace: true / new_page: true.',
          ],
          diagram: stateOf(ctx),
        };
      }
      const res = store.createMotion(req, meta, dashResults);
      if (res.ok) {
        ws?.showView('motion');
        ctx.studio?.controlMotion?.('restart');
      }
      return editResponse(ctx, res);
    }

    case 'edit_motion': {
      const store = storeOf(ctx);
      const req = a as unknown as EditMotionRequest;
      const res = store.editMotion(req, { ...meta, label: str(req.summary) });
      if (res.ok) ws?.showView('motion');
      return editResponse(ctx, res);
    }

    case 'control_motion': {
      const store = storeOf(ctx);
      if (!store.scene.motion) {
        return { ok: false, errors: ['No motion explainer on this page yet. Call create_motion first.'], diagram: stateOf(ctx) };
      }
      const actionRaw = str(a.action) ?? 'play';
      const action = (['play', 'pause', 'restart', 'seek', 'export_mp4'] as const).includes(actionRaw as any)
        ? (actionRaw as 'play' | 'pause' | 'restart' | 'seek' | 'export_mp4')
        : 'play';
      const timeMs = typeof a.time_ms === 'number' ? a.time_ms : undefined;
      ws?.showView('motion');
      ctx.studio?.controlMotion?.(action, timeMs);
      return { ok: true, result: `Motion command executed: ${action}.`, diagram: stateOf(ctx) };
    }

    case 'search_catalog': {
      // Without the 101 blueprints the search still has the built-in ones
      await loadAllBlueprints().catch(() => undefined);
      const retrieved = retrieveCatalogContext(str(a.query) ?? '', {
        provider: str(a.provider),
        category: str(a.category),
      });
      return {
        ok: true,
        blueprints: retrieved.blueprints,
        components: retrieved.components,
        diagram: stateOf(ctx),
      };
    }

    case 'create_diagram': {
      const store = storeOf(ctx);
      // Documentation alone does not count: the diagram is drawn on the page and the chapters stay
      const isEmpty = store.scene.nodes.length === 0 && store.scene.groups.length === 0;
      const label = typeof a.title === 'string' && a.title ? `Created “${a.title}”` : undefined;
      if (!isEmpty && a.new_page === true && ws != null) {
        // A separate diagram on its own page; the current one stays as it is
        const draft = new DiagramStore();
        const result = await draft.create(a as CreateRequest, { ...meta, label });
        if (result.ok) ws.addPage({ scene: draft.scene, label: label ?? 'Created the diagram', meta });
        return editResponse(ctx, result);
      }
      if (!isEmpty && a.replace !== true) {
        const scene = store.scene;
        return {
          ok: false,
          errors: [`The current page already has a diagram (${scene.nodes.length} nodes). Change it with edit_diagram. ` +
            (ws != null ? 'For a new, separate diagram call create_diagram again with new_page: true (keeps this one). ' : '') +
            'Use replace: true only if the user explicitly asked to replace this diagram or to start over.'],
          diagram: stateOf(ctx),
        };
      }
      const result = await store.create(a as CreateRequest, { ...meta, label });
      if (result.ok) ws?.showView('diagram');
      return editResponse(ctx, result);
    }

    case 'edit_diagram': {
      const store = storeOf(ctx);
      const req = a as EditRequest;
      const base = typeof req.base_version === 'number' ? req.base_version : undefined;
      const current = store.scene.version;
      const stale = base != null && base !== current
        ? `The diagram is at version ${current}, not ${base} (it was changed in the meantime, e.g. by hand). ` +
          'The state below is current; check that the edit still fits it.'
        : undefined;
      // Connecting a diagram that was drawn without connections lays it out from them
      const result = await store.editConnectingNewDiagram(req, { ...meta, label: typeof req.summary === 'string' && req.summary.trim() ? req.summary.trim() : undefined });
      if (result.ok) follow(ws, result.changes);
      return editResponse(ctx, result, stale);
    }

    case 'write_text':
    case 'write_table': {
      const store = storeOf(ctx);
      const kind = name === 'write_table' ? 'table' : 'text';
      const input: BlockInput = { ...(a as BlockInput), kind };
      const existed = input.id != null && store.scene.blocks.some((b) => b.id === input.id);
      const result = store.edit({ write_blocks: [input] }, { ...meta, label: blockLabel(kind, input, existed, str(a.summary)) });
      const id = result.ok ? [...result.changes.addedBlocks, ...result.changes.updatedBlocks][0] : undefined;
      // The chapter is shown in the documentation tab as soon as it is written
      if (id != null) ws?.showView('doc', { chapter: id });
      const response = editResponse(ctx, result);
      if (id != null) response.id = id;
      return response;
    }

    case 'tidy_layout': {
      const store = storeOf(ctx);
      const dir = typeof a.direction === 'string' ? a.direction.toUpperCase() : undefined;
      await store.relayout({ ...meta, label: dir ? `Laid out ${dir === 'TB' ? 'top to bottom' : 'left to right'}` : undefined },
        dir === 'TB' || dir === 'TD' ? 'TB' : dir === 'LR' ? 'LR' : undefined);
      ws?.showView('diagram');
      return { ok: true, result: 'Laid out again.', diagram: stateOf(ctx) };
    }

    case 'undo': {
      const steps = asInt(a.steps, 1);
      const store = storeOf(ctx);
      const done = store.undo(steps);
      if (done) follow(ws, store.lastChange?.changes);
      return { ok: done, result: done ? `Undid ${steps} change(s).` : 'Nothing to undo on this page.', diagram: stateOf(ctx) };
    }

    case 'redo': {
      const steps = asInt(a.steps, 1);
      const store = storeOf(ctx);
      const done = store.redo(steps);
      if (done) follow(ws, store.lastChange?.changes);
      return { ok: done, result: done ? `Redid ${steps} change(s).` : 'Nothing to redo on this page.', diagram: stateOf(ctx) };
    }

    case 'new_page': {
      const missing = needsPages(ctx);
      if (missing || ws == null) return missing!;
      const page = ws.addPage({ title: str(a.title), label: 'New page', meta });
      return { ok: true, result: `Opened the new page ${page.id}.`, diagram: stateOf(ctx) };
    }

    case 'switch_page': {
      const missing = needsPages(ctx);
      if (missing || ws == null) return missing!;
      const ref = str(a.page);
      const viewArg = str(a.view)?.toLowerCase();
      const docRef = ref != null && DOC_WORDS.test(ref);
      const dashRef = ref != null && DASH_WORDS.test(ref) && ws.active.store.scene.dashboard != null && ws.pages.length === 1;
      const motionRef = ref != null && MOTION_WORDS.test(ref) && ws.active.store.scene.motion != null && ws.pages.length === 1;
      const pageRef = docRef
        ? str(ref!.replace(new RegExp(DOC_WORDS.source, 'gi'), ' ').replace(/\b(of|the|for|a|al|lui|despre|open|show)\b/gi, ' '))
        : dashRef || motionRef
          ? undefined
          : ref;

      let targetView: PageView = 'diagram';
      if (viewArg != null) {
        if (/^doc/.test(viewArg)) targetView = 'doc';
        else if (/^dash/.test(viewArg)) targetView = 'dashboard';
        else if (/^motion|^video|^anim/.test(viewArg)) targetView = 'motion';
        else targetView = 'diagram';
      } else if (docRef) {
        targetView = 'doc';
      } else if (dashRef) {
        targetView = 'dashboard';
      } else if (motionRef) {
        targetView = 'motion';
      }

      const r = ws.findPage(pageRef);
      if (r.item == null) return { ok: false, errors: [r.error ?? 'No such page.'], diagram: stateOf(ctx) };
      const chapter = str(a.chapter);
      const blocks = r.item.store.scene.blocks;
      const found = chapter != null ? resolveBlock(chapter, blocks) : undefined;
      if (found != null && found.item == null) {
        return { ok: false, errors: [`switch_page: ${found.error ?? `no chapter "${chapter}"`}`], diagram: stateOf(ctx) };
      }
      if (found != null) targetView = 'doc';
      // When switching to another page without naming a specific view, show its primary surface if it has no diagram
      if (viewArg == null && !docRef && !dashRef && !motionRef && found == null) {
        const s = r.item.store.scene;
        if (s.nodes.length === 0 && s.groups.length === 0) {
          if (s.dashboard != null) targetView = 'dashboard';
          else if (s.motion != null) targetView = 'motion';
        }
      }
      ws.showView(targetView, { page: r.item.id, chapter: found?.item?.id });
      const notes = [r.note, found?.note].filter((x): x is string => x != null);
      const shown = ws.view === 'doc'
        ? (blocks.length === 0 ? 'its documentation tab (no chapters yet)' : 'its documentation tab')
        : ws.view === 'dashboard'
          ? 'its dashboard tab'
          : ws.view === 'motion'
            ? 'its motion explainer tab'
            : 'its diagram';
      return { ok: true, result: `Now on ${r.item.id}, showing ${shown}.`, ...(notes.length ? { understood: notes } : {}), diagram: stateOf(ctx) };
    }

    case 'rename_page': {
      const missing = needsPages(ctx);
      if (missing || ws == null) return missing!;
      const title = str(a.title);
      const r = ws.findPage(str(a.page));
      if (r.item == null || title == null) {
        return { ok: false, errors: [title == null ? 'rename_page needs a title.' : r.error ?? 'No such page.'], diagram: stateOf(ctx) };
      }
      ws.renamePage(r.item.id, title, { ...meta, label: `Renamed the page to “${title}”` });
      return { ok: true, result: `Renamed ${r.item.id}.`, diagram: stateOf(ctx) };
    }

    case 'delete_page': {
      const missing = needsPages(ctx);
      if (missing || ws == null) return missing!;
      const r = ws.findPage(str(a.page));
      if (r.item == null) return { ok: false, errors: [r.error ?? 'No such page.'], diagram: stateOf(ctx) };
      if (ws.pages.length <= 1) {
        return { ok: false, errors: ['This is the only page and cannot be closed. To clear it, ask the user and use create_diagram with replace: true.'], diagram: stateOf(ctx) };
      }
      const title = ws.pageTitle(r.item);
      ws.removePage(r.item.id);
      return { ok: true, result: `Closed the page "${title}" (it stays in the diagram history).`, diagram: stateOf(ctx) };
    }

    case 'change_view': {
      const view = ctx.view;
      const action = String(a.action ?? 'fit').toLowerCase();
      const targets = Array.isArray(a.targets) ? a.targets.map(String) : typeof a.targets === 'string' ? [a.targets] : [];
      // A chapter is "focused" by opening it in the documentation tab
      const scene = storeOf(ctx).scene;
      const chapter = action === 'focus' && ws != null
        ? targets.map((t) => scene.blocks.find((b) => b.id === t)).find((b) => b != null)
        : undefined;
      if (chapter != null) {
        ws!.showView('doc', { chapter: chapter.id });
        return { ok: true, result: `Opened the chapter ${chapter.id} in the documentation tab.` };
      }
      if (view == null) return { ok: false, errors: ['The view cannot be changed here.'] };
      // Zooming is about the diagram: show it if the documentation was open
      ws?.showView('diagram');
      switch (action) {
        case 'zoom_in': view.zoomIn(); break;
        case 'zoom_out': view.zoomOut(); break;
        case 'actual_size': view.actualSize(); break;
        case 'focus': {
          const store = storeOf(ctx);
          const ids = targets.flatMap((t) => {
            if (store.scene.nodes.some((n) => n.id === t) || store.scene.groups.some((g) => g.id === t)) return [t];
            const n = store.scene.nodes.find((x) => x.label.toLowerCase() === t.toLowerCase());
            return n != null ? [n.id] : [];
          });
          if (ids.length === 0 || !view.focus(ids)) {
            return { ok: false, errors: [`Nothing to focus on: ${targets.join(', ') || 'no targets'} (use ids from the state).`] };
          }
          break;
        }
        default: view.fit();
      }
      return { ok: true, result: 'View changed.' };
    }

    default:
      return { ok: false, errors: [`Unknown function ${name}.`] };
  }
}
