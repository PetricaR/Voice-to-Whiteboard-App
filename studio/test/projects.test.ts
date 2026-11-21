import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import type { SavedWorkspace } from '../src/engine/workspace';
import { Workspace } from '../src/engine/workspace';
import { ensureFirstProject, FIRST_PROJECT_NAME, FIRST_RUN_KEY, projectIdFromUrl, projectUrl } from '../src/projects/boot';
import { projectFileName, projectFromFile, projectToFile } from '../src/projects/projectFile';
import {
  isProjectId,
  MAX_NAME_LENGTH,
  openProjectStore,
  ProjectGoneError,
  type ProjectStore,
} from '../src/projects/projectStore';
import { LEGACY_LIBRARY_KEY, LEGACY_SCENE_KEY, LEGACY_WORKSPACE_KEY, readLegacyWorkspace } from '../src/projects/workspaceData';
import { pagesToJson } from '../src/ui/export';

class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
}

/** A workspace with one page per title, made the way the studio makes them. */
function workspaceWith(...titles: string[]): SavedWorkspace {
  const ws = new Workspace();
  titles.forEach((title, i) => {
    if (i > 0) ws.addPage({ label: 'New page' });
    ws.store.edit({ title }, { source: 'manual', label: 'Renamed' });
  });
  return ws.serialize();
}

let store: ProjectStore;
beforeEach(async () => {
  store = await openProjectStore(new IDBFactory());
});

describe('project store', () => {
  it('creates, lists, renames and deletes projects', async () => {
    const a = await store.createProject({ name: '  Churn   analysis ', brief: 'Q4 retail churn' });
    expect(a.name).toBe('Churn analysis');
    expect(isProjectId(a.id)).toBe(true);
    expect(a.sources).toEqual({ includeSamples: false, remote: [], defaultSource: 'local' });

    const b = await store.createProject({ name: '' });
    expect(b.name).toBe('Untitled project');
    await store.updateProject(a.id, { lastOpenedAt: Date.now() + 1000 });
    expect((await store.listProjects()).map((p) => p.id)).toEqual([a.id, b.id]);

    const renamed = await store.updateProject(b.id, { name: 'x'.repeat(200), brief: 'about' });
    expect(renamed?.name.length).toBe(MAX_NAME_LENGTH);
    expect(renamed?.brief).toBe('about');
    expect(await store.updateProject('nope', { name: 'y' })).toBeNull();

    await store.deleteProject(a.id);
    expect((await store.listProjects()).map((p) => p.id)).toEqual([b.id]);
    expect(await store.getProject(a.id)).toBeNull();
  });

  it('keeps each project’s workspace apart and round-trips it', async () => {
    const a = await store.createProject({ name: 'A' });
    const b = await store.createProject({ name: 'B', workspace: workspaceWith('B one') });
    expect(b.pageCount).toBe(1);
    expect(await store.loadWorkspace(a.id)).toBeNull();

    await store.saveWorkspace(a.id, workspaceWith('A one', 'A two'));
    const loadedA = await store.loadWorkspace(a.id);
    const loadedB = await store.loadWorkspace(b.id);
    expect(loadedA?.pages.map((p) => p.scene.title)).toEqual(['A one', 'A two']);
    expect(loadedB?.pages.map((p) => p.scene.title)).toEqual(['B one']);
    expect((await store.getProject(a.id))?.pageCount).toBe(2);

    // The loaded workspace opens as a working Workspace again
    const reopened = new Workspace(loadedA);
    expect(reopened.pages.map((p) => p.store.scene.title)).toEqual(['A one', 'A two']);
  });

  it('refuses to save a project deleted meanwhile, without leaving data behind', async () => {
    const a = await store.createProject({ name: 'A' });
    await store.deleteProject(a.id);
    await expect(store.saveWorkspace(a.id, workspaceWith('late'))).rejects.toBeInstanceOf(ProjectGoneError);
    expect(await store.loadWorkspace(a.id)).toBeNull();
  });

  it('stores tables per project; delete and duplicate take them along', async () => {
    const a = await store.createProject({ name: 'A' });
    const b = await store.createProject({ name: 'B' });
    const bytes = new TextEncoder().encode('region,revenue\nEMEA,10\n');
    await store.putTable({ projectId: a.id, tableName: 'sales', kind: 'file', fileName: 'sales.csv', bytes, loadedAt: 2 });
    await store.putTable({ projectId: a.id, tableName: 'leads', kind: 'rows', fileName: 'leads.json', bytes, loadedAt: 1 });
    await store.putTable({ projectId: b.id, tableName: 'sales', kind: 'file', fileName: 'other.csv', bytes, loadedAt: 1 });

    expect((await store.listTables(a.id)).map((t) => t.tableName)).toEqual(['leads', 'sales']);
    expect((await store.listTables(b.id)).map((t) => t.fileName)).toEqual(['other.csv']);
    expect(new TextDecoder().decode((await store.listTables(a.id))[1].bytes)).toContain('EMEA');

    await store.saveWorkspace(a.id, workspaceWith('A page'));
    const copy = await store.duplicateProject(a.id);
    expect(copy?.name).toBe('A (copy)');
    expect((await store.listTables(copy!.id)).map((t) => t.tableName)).toEqual(['leads', 'sales']);
    expect((await store.loadWorkspace(copy!.id))?.pages[0].scene.title).toBe('A page');

    await store.deleteTable(a.id, 'leads');
    await store.deleteProject(a.id);
    expect(await store.listTables(a.id)).toEqual([]);
    expect((await store.listTables(b.id)).length).toBe(1);
    expect((await store.listTables(copy!.id)).length).toBe(2);
  });
});

describe('first start', () => {
  it('turns the work of an earlier version into the first project, once', async () => {
    const storage = new MemoryStorage();
    const legacy = workspaceWith('Old dashboard', 'Old diagram');
    storage.setItem(LEGACY_WORKSPACE_KEY, JSON.stringify({ version: 2, active: legacy.active, pages: legacy.pages }));
    storage.setItem(LEGACY_LIBRARY_KEY, JSON.stringify(legacy.library));

    const first = await ensureFirstProject(store, storage);
    expect(first?.name).toBe(FIRST_PROJECT_NAME);
    expect(first?.sources.includeSamples).toBe(true);
    expect((await store.loadWorkspace(first!.id))?.pages.map((p) => p.scene.title)).toEqual(['Old dashboard', 'Old diagram']);
    expect(storage.getItem(FIRST_RUN_KEY)).toBe('1');
    // The earlier keys stay as a backup
    expect(storage.getItem(LEGACY_WORKSPACE_KEY)).not.toBeNull();

    expect(await ensureFirstProject(store, storage)).toBeNull();
    expect((await store.listProjects()).length).toBe(1);
  });

  it('reads the single scene of the earliest versions', () => {
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_SCENE_KEY, JSON.stringify(workspaceWith('Very old').pages[0].scene));
    expect(readLegacyWorkspace(storage)?.pages.map((p) => p.scene.title)).toEqual(['Very old']);
    expect(readLegacyWorkspace(new MemoryStorage())).toBeNull();
    const broken = new MemoryStorage();
    broken.setItem(LEGACY_WORKSPACE_KEY, '{not json');
    expect(readLegacyWorkspace(broken)).toBeNull();
  });

  it('makes an empty first project for a new user, and none after the user deleted every project', async () => {
    const storage = new MemoryStorage();
    const first = await ensureFirstProject(store, storage);
    expect(await store.loadWorkspace(first!.id)).toBeNull();
    await store.deleteProject(first!.id);
    expect(await ensureFirstProject(store, storage)).toBeNull();
    expect(await store.listProjects()).toEqual([]);
  });
});

describe('project addresses', () => {
  it('reads and writes ?project=', () => {
    expect(projectIdFromUrl('http://127.0.0.1:5173/?project=pabc123')).toBe('pabc123');
    expect(projectIdFromUrl('http://127.0.0.1:5173/')).toBeNull();
    expect(projectIdFromUrl('http://127.0.0.1:5173/?project=%3Cscript%3E')).toBeNull();
    expect(projectUrl('p1', 'http://h/studio/?x=1#frag')).toBe('/studio/?x=1&project=p1');
    expect(projectUrl(null, 'http://h/?project=p1&x=1')).toBe('/?x=1');
  });
});

describe('project files', () => {
  it('round-trips a project with its tables', async () => {
    const a = await store.createProject({ name: 'Churn', brief: 'Q4', sources: { includeSamples: true, remote: ['bigquery:acme'] } });
    await store.saveWorkspace(a.id, workspaceWith('Overview'));
    const bytes = new Uint8Array(70000).map((_, i) => i % 251);
    await store.putTable({ projectId: a.id, tableName: 'big', kind: 'file', fileName: 'big.parquet', bytes, loadedAt: 5 });

    const text = projectToFile((await store.getProject(a.id))!, await store.loadWorkspace(a.id), await store.listTables(a.id));
    const parsed = projectFromFile(text);
    expect(parsed?.name).toBe('Churn');
    expect(parsed?.brief).toBe('Q4');
    expect(parsed?.sources).toEqual({ includeSamples: true, remote: ['bigquery:acme'], defaultSource: 'local' });
    expect(parsed?.workspace?.pages[0].scene.title).toBe('Overview');
    expect(parsed?.tables?.[0].bytes).toEqual(bytes);

    const imported = await store.createProject(parsed!);
    expect(imported.id).not.toBe(a.id);
    expect((await store.listTables(imported.id))[0].bytes).toEqual(bytes);
  });

  it('opens a studio pages file as a project, and rejects anything else', () => {
    const pages = workspaceWith('Diagram one', 'Diagram two').pages.map((p) => p.scene);
    const parsed = projectFromFile(pagesToJson(pages), 'export.json');
    expect(parsed?.name).toBe('Diagram one');
    expect(parsed?.workspace?.pages.length).toBe(2);
    expect(projectFromFile('{"hello":1}')).toBeNull();
    expect(projectFromFile('not json')).toBeNull();
    expect(projectFileName('Q4 Churn / Retail!')).toBe('q4-churn-retail.project.json');
  });
});
