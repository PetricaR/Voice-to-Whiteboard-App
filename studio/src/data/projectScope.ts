/**
 * The project the data layer works for: which sources it may use (the sample
 * tables, the remote sources attached to it; its uploaded tables always), and
 * where a loaded table is kept so it comes back with the project.
 *
 * Without a scope (tests, eval, tools) everything is allowed, as before
 * projects existed.
 *
 * This keeps the work on the project; it is not a security boundary (the
 * server trusts the signed-in user as it always did).
 */
import type { ProjectSources } from '../projects/projectStore';

export interface ProjectScope {
  projectId: string;
  name: string;
  brief: string;
  sources: ProjectSources;
}

export interface PersistedTable {
  tableName: string;
  /** 'file': the uploaded file's bytes; 'rows': the rows loaded from a warehouse (JSON of the import). */
  kind: 'file' | 'rows';
  fileName: string;
  bytes: Uint8Array;
  loadedAt: number;
  description?: string;
}

export interface ScopeHooks {
  /** Keeps a table the user loaded with the project. */
  saveTable?: (table: PersistedTable) => Promise<void>;
  /** Forgets a table the user removed. */
  removeTable?: (tableName: string) => Promise<void>;
  /** Adds a remote source to the project (e.g. a BigQuery project the agent synced). */
  attachSource?: (sourceId: string) => Promise<void>;
  /** A table could not be kept (storage full): it works now but is gone after a reload. */
  onSaveError?: (tableName: string, error: unknown) => void;
}

let scope: ProjectScope | null = null;
let hooks: ScopeHooks = {};

export function setProjectScope(next: ProjectScope | null, nextHooks?: ScopeHooks): void {
  scope = next;
  if (nextHooks !== undefined) hooks = nextHooks;
}

/** Updates the hooks without touching the scope. */
export function setScopeHooks(patch: ScopeHooks): void {
  hooks = { ...hooks, ...patch };
}

export function getProjectScope(): ProjectScope | null {
  return scope;
}

export function getScopeHooks(): ScopeHooks {
  return hooks;
}

/** The sample tables are part of the local database (always, without a project). */
export function samplesIncluded(): boolean {
  return scope == null || scope.sources.includeSamples;
}

/**
 * One id per remote source, whatever it was called: "bigquery" is the server's
 * default BigQuery project, so it becomes "bigquery:<that project>".
 */
export function canonicalSourceId(id: string, defaultBigQueryProject?: string | null): string {
  const s = id.trim();
  if (s === 'bigquery' && defaultBigQueryProject) return `bigquery:${defaultBigQueryProject}`;
  return s;
}

/** Whether the project may use this source. Local is always allowed (its sample tables are gated apart). */
export function isSourceAttached(id: string, defaultBigQueryProject?: string | null): boolean {
  if (scope == null) return true;
  const s = id.trim();
  if (s === '' || s === 'local') return true;
  const canonical = canonicalSourceId(s, defaultBigQueryProject);
  const remote = scope.sources.remote;
  if (remote.includes(s) || remote.includes(canonical)) return true;
  // A project made from earlier work may keep the plain "bigquery" its dashboards used: the server's default project
  return defaultBigQueryProject != null && remote.includes('bigquery') && canonical === `bigquery:${defaultBigQueryProject}`;
}

export function notAttachedMessage(id: string): string {
  const name = scope?.name ?? 'this project';
  return `Source "${id}" is not part of project "${name}". Add it to the project in Data sources first ` +
    '(BigQuery: Data sources → BigQuery Catalog → Add to project).';
}

/** Adds a source to the project; false when nothing could add it (no project). */
export async function attachSourceToProject(id: string): Promise<boolean> {
  if (scope == null || hooks.attachSource == null) return false;
  if (scope.sources.remote.includes(id)) return true;
  await hooks.attachSource(id);
  // The app updates the scope too; until then the next query must already see it
  if (scope != null && !scope.sources.remote.includes(id)) {
    scope = { ...scope, sources: { ...scope.sources, remote: [...scope.sources.remote, id] } };
  }
  return true;
}
