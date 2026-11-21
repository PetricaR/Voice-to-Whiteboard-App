/**
 * Projects, saved in this browser (IndexedDB). A project holds its own pages,
 * diagram history and data tables, and each browser tab works on one project.
 *
 * Everything else talks to the `ProjectStore` interface, so another backend
 * (e.g. Firestore) can be added later without touching the callers.
 *
 * Database `studio`, version 1:
 *   projects    key id                     ProjectMeta
 *   workspaces  key projectId              { projectId, json }  (the SavedWorkspace as JSON text)
 *   tables      key [projectId, tableName] StoredTable          (uploaded data, so it survives a reload)
 */
import type { SavedWorkspace } from '../engine/workspace';
import { parseSavedWorkspace } from './workspaceData';

export interface ProjectSources {
  /** The built-in sample tables are queryable in this project. */
  includeSamples: boolean;
  /** Remote source ids attached to this project: 'bigquery:<gcp-project>', 'postgres', 'clickhouse', 'rest:<name>'. */
  remote: string[];
  /** Used when a widget or query names no source. */
  defaultSource: string;
}

export interface ProjectMeta {
  id: string;
  name: string;
  /** What the project is about, in the user's words (given to the agent as context). */
  brief: string;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
  /** Pages when it was last saved, for the project list. */
  pageCount: number;
  sources: ProjectSources;
}

export interface StoredTable {
  projectId: string;
  tableName: string;
  /** 'file': the uploaded file's bytes; 'rows': rows loaded from a warehouse, as JSON. */
  kind: 'file' | 'rows';
  fileName: string;
  bytes: Uint8Array;
  loadedAt: number;
  description?: string;
}

export type NewTable = Omit<StoredTable, 'projectId'>;

export interface NewProject {
  name: string;
  brief?: string;
  sources?: Partial<ProjectSources>;
  workspace?: SavedWorkspace | null;
  tables?: NewTable[];
}

export type ProjectPatch = Partial<Pick<ProjectMeta, 'name' | 'brief' | 'sources' | 'lastOpenedAt'>>;

export interface ProjectStore {
  /** All projects, the most recently opened first. */
  listProjects(): Promise<ProjectMeta[]>;
  getProject(id: string): Promise<ProjectMeta | null>;
  createProject(input: NewProject): Promise<ProjectMeta>;
  /** Null when the project does not exist (any more). */
  updateProject(id: string, patch: ProjectPatch): Promise<ProjectMeta | null>;
  /** Removes the project with its workspace and tables. */
  deleteProject(id: string): Promise<void>;
  duplicateProject(id: string, name?: string): Promise<ProjectMeta | null>;
  loadWorkspace(id: string): Promise<SavedWorkspace | null>;
  /** Throws ProjectGoneError when the project was deleted meanwhile (e.g. from another tab). */
  saveWorkspace(id: string, workspace: SavedWorkspace): Promise<void>;
  listTables(id: string): Promise<StoredTable[]>;
  putTable(table: StoredTable): Promise<void>;
  deleteTable(id: string, tableName: string): Promise<void>;
  close(): void;
}

export class ProjectGoneError extends Error {
  constructor(id: string) {
    super(`Project ${id} no longer exists.`);
    this.name = 'ProjectGoneError';
  }
}

export const MAX_NAME_LENGTH = 80;
export const MAX_BRIEF_LENGTH = 500;
export const DEFAULT_PROJECT_NAME = 'Untitled project';

const DB_NAME = 'studio';
const DB_VERSION = 1;
const PROJECTS = 'projects';
const WORKSPACES = 'workspaces';
const TABLES = 'tables';

export function cleanName(name: unknown): string {
  const s = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH) : '';
  return s || DEFAULT_PROJECT_NAME;
}

export function cleanBrief(brief: unknown): string {
  return typeof brief === 'string' ? brief.trim().slice(0, MAX_BRIEF_LENGTH) : '';
}

export function defaultSources(patch?: Partial<ProjectSources>): ProjectSources {
  return {
    includeSamples: patch?.includeSamples === true,
    remote: Array.isArray(patch?.remote) ? [...new Set(patch.remote.filter((s) => typeof s === 'string' && s !== ''))] : [],
    defaultSource: typeof patch?.defaultSource === 'string' && patch.defaultSource !== '' ? patch.defaultSource : 'local',
  };
}

/** A project id: short, random, safe in a URL. */
export function newProjectId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return 'p' + Array.from(bytes, (b) => (b % 36).toString(36)).join('');
}

/** Ids are made by newProjectId; anything else in a URL is ignored. */
export function isProjectId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-z0-9_-]{1,40}$/i.test(id);
}

function pageCountOf(workspace: SavedWorkspace | null | undefined): number {
  return workspace?.pages.length ?? 0;
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
}

function completion(tx: IDBTransaction): Promise<void> {
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
  // A failed request inside the transaction rejects first; this one must not also go unhandled
  done.catch(() => undefined);
  return done;
}

/** Every table key of a project: [id] sorts before [id, name], and arrays after strings. */
function tablesOf(id: string): IDBKeyRange {
  return IDBKeyRange.bound([id], [id, []]);
}

/** Opens (and on first use creates) the projects database. */
export async function openProjectStore(factory: IDBFactory = indexedDB, name = DB_NAME): Promise<ProjectStore> {
  const open = factory.open(name, DB_VERSION);
  open.onupgradeneeded = () => {
    const db = open.result;
    if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS, { keyPath: 'id' });
    if (!db.objectStoreNames.contains(WORKSPACES)) db.createObjectStore(WORKSPACES, { keyPath: 'projectId' });
    if (!db.objectStoreNames.contains(TABLES)) db.createObjectStore(TABLES, { keyPath: ['projectId', 'tableName'] });
  };
  const db = await request(open);
  // A newer version of the app in another tab wants to upgrade: let it
  db.onversionchange = () => db.close();
  return new IdbProjectStore(db);
}

class IdbProjectStore implements ProjectStore {
  constructor(private db: IDBDatabase) {}

  close() {
    this.db.close();
  }

  async listProjects(): Promise<ProjectMeta[]> {
    const tx = this.db.transaction(PROJECTS, 'readonly');
    const all = await request(tx.objectStore(PROJECTS).getAll() as IDBRequest<ProjectMeta[]>);
    return all.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt || b.updatedAt - a.updatedAt);
  }

  async getProject(id: string): Promise<ProjectMeta | null> {
    const tx = this.db.transaction(PROJECTS, 'readonly');
    return ((await request(tx.objectStore(PROJECTS).get(id))) as ProjectMeta | undefined) ?? null;
  }

  async createProject(input: NewProject): Promise<ProjectMeta> {
    const now = Date.now();
    const meta: ProjectMeta = {
      id: newProjectId(),
      name: cleanName(input.name),
      brief: cleanBrief(input.brief),
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
      pageCount: pageCountOf(input.workspace),
      sources: defaultSources(input.sources),
    };
    const tx = this.db.transaction([PROJECTS, WORKSPACES, TABLES], 'readwrite');
    const done = completion(tx);
    tx.objectStore(PROJECTS).add(meta);
    if (input.workspace != null) {
      tx.objectStore(WORKSPACES).put({ projectId: meta.id, json: JSON.stringify(input.workspace) });
    }
    for (const t of input.tables ?? []) tx.objectStore(TABLES).put({ ...t, projectId: meta.id });
    await done;
    return meta;
  }

  async updateProject(id: string, patch: ProjectPatch): Promise<ProjectMeta | null> {
    const tx = this.db.transaction(PROJECTS, 'readwrite');
    const done = completion(tx);
    const projects = tx.objectStore(PROJECTS);
    const meta = (await request(projects.get(id))) as ProjectMeta | undefined;
    if (meta == null) {
      await done;
      return null;
    }
    const next: ProjectMeta = { ...meta };
    if (patch.name !== undefined) next.name = cleanName(patch.name);
    if (patch.brief !== undefined) next.brief = cleanBrief(patch.brief);
    if (patch.sources !== undefined) next.sources = defaultSources(patch.sources);
    if (patch.lastOpenedAt !== undefined) next.lastOpenedAt = patch.lastOpenedAt;
    if (patch.name !== undefined || patch.brief !== undefined || patch.sources !== undefined) next.updatedAt = Date.now();
    projects.put(next);
    await done;
    return next;
  }

  async deleteProject(id: string): Promise<void> {
    const tx = this.db.transaction([PROJECTS, WORKSPACES, TABLES], 'readwrite');
    const done = completion(tx);
    tx.objectStore(PROJECTS).delete(id);
    tx.objectStore(WORKSPACES).delete(id);
    tx.objectStore(TABLES).delete(tablesOf(id));
    await done;
  }

  async duplicateProject(id: string, name?: string): Promise<ProjectMeta | null> {
    const meta = await this.getProject(id);
    if (meta == null) return null;
    const [workspace, tables] = await Promise.all([this.loadWorkspace(id), this.listTables(id)]);
    return this.createProject({
      name: name ?? `${meta.name} (copy)`,
      brief: meta.brief,
      sources: meta.sources,
      workspace,
      tables: tables.map(({ projectId: _drop, ...t }) => t),
    });
  }

  async loadWorkspace(id: string): Promise<SavedWorkspace | null> {
    const tx = this.db.transaction(WORKSPACES, 'readonly');
    const rec = (await request(tx.objectStore(WORKSPACES).get(id))) as { json?: unknown } | undefined;
    if (rec == null || typeof rec.json !== 'string') return null;
    try {
      return parseSavedWorkspace(JSON.parse(rec.json));
    } catch {
      return null;
    }
  }

  async saveWorkspace(id: string, workspace: SavedWorkspace): Promise<void> {
    const json = JSON.stringify(workspace);
    const tx = this.db.transaction([PROJECTS, WORKSPACES], 'readwrite');
    const done = completion(tx);
    const projects = tx.objectStore(PROJECTS);
    const meta = (await request(projects.get(id))) as ProjectMeta | undefined;
    if (meta == null) {
      // Deleted meanwhile: writing now would leave an orphan workspace behind
      await done;
      throw new ProjectGoneError(id);
    }
    tx.objectStore(WORKSPACES).put({ projectId: id, json });
    projects.put({ ...meta, updatedAt: Date.now(), pageCount: pageCountOf(workspace) });
    await done;
  }

  async listTables(id: string): Promise<StoredTable[]> {
    const tx = this.db.transaction(TABLES, 'readonly');
    const all = (await request(tx.objectStore(TABLES).getAll(tablesOf(id)))) as StoredTable[];
    return all.sort((a, b) => a.loadedAt - b.loadedAt);
  }

  async putTable(table: StoredTable): Promise<void> {
    const tx = this.db.transaction(TABLES, 'readwrite');
    const done = completion(tx);
    tx.objectStore(TABLES).put(table);
    await done;
  }

  async deleteTable(id: string, tableName: string): Promise<void> {
    const tx = this.db.transaction(TABLES, 'readwrite');
    const done = completion(tx);
    tx.objectStore(TABLES).delete([id, tableName]);
    await done;
  }
}
