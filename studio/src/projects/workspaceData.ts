/**
 * Reading saved workspaces (pages + diagram history): from a project record,
 * from a project file, and from the single workspace that earlier versions
 * kept in localStorage.
 */
import type { LibraryEntry, SavedWorkspace } from '../engine/workspace';
import type { Scene } from '../engine/types';
import { fromJson, normalizeScene } from '../ui/export';

/** Where earlier versions kept the one workspace of the browser. */
export const LEGACY_WORKSPACE_KEY = 'studio.workspace';
export const LEGACY_LIBRARY_KEY = 'studio.library';
/** Single diagram saved by the earliest versions. */
export const LEGACY_SCENE_KEY = 'studio.scene';

function parseLibrary(raw: unknown): LibraryEntry[] {
  return (Array.isArray(raw) ? raw : []).flatMap((e: any) => {
    const scene = normalizeScene(e?.scene);
    return scene != null && typeof e.id === 'string' ? [{ ...e, scene } as LibraryEntry] : [];
  });
}

function parsePages(raw: unknown): SavedWorkspace['pages'] {
  return (Array.isArray(raw) ? raw : []).flatMap((p: any) => {
    const scene = normalizeScene(p?.scene);
    return scene != null && typeof p.id === 'string'
      ? [{ id: p.id, scene, diagram: p.diagram, view: p.view, chapter: p.chapter }]
      : [];
  });
}

/** A saved workspace with every scene checked, or null when there is nothing usable in it. */
export function parseSavedWorkspace(raw: unknown): SavedWorkspace | null {
  if (raw == null || typeof raw !== 'object') return null;
  const data = raw as { active?: unknown; pages?: unknown; library?: unknown };
  const pages = parsePages(data.pages);
  const library = parseLibrary(data.library);
  if (pages.length === 0 && library.length === 0) return null;
  return { version: 2, active: typeof data.active === 'string' ? data.active : '', pages, library };
}

/** The remote sources the dashboards of a workspace query ("bigquery", "postgres", …; never "local"). */
export function remoteSourcesOf(workspace: SavedWorkspace | null | undefined): string[] {
  const out = new Set<string>();
  for (const p of workspace?.pages ?? []) {
    const d = p.scene.dashboard;
    if (d == null) continue;
    for (const id of [d.defaultSource, ...d.widgets.map((w) => w.source)]) {
      const s = typeof id === 'string' ? id.trim() : '';
      if (s !== '' && s !== 'local') out.add(s);
    }
  }
  return [...out];
}

/** A workspace made of opened scenes, one page each. */
export function workspaceFromScenes(scenes: Scene[]): SavedWorkspace {
  return {
    version: 2,
    active: 'page_1',
    pages: scenes.map((scene, i) => ({ id: `page_${i + 1}`, scene })),
    library: [],
  };
}

/** The workspace an earlier version saved in this browser, if any. */
export function readLegacyWorkspace(storage: Pick<Storage, 'getItem'>): SavedWorkspace | null {
  try {
    const library = parseLibrary(JSON.parse(storage.getItem(LEGACY_LIBRARY_KEY) ?? '[]'));
    const text = storage.getItem(LEGACY_WORKSPACE_KEY);
    if (text) {
      const data = JSON.parse(text);
      const pages = parsePages(data?.pages);
      if (pages.length > 0) return { version: 2, active: typeof data.active === 'string' ? data.active : '', pages, library };
    }
    const legacy = storage.getItem(LEGACY_SCENE_KEY);
    const scene = legacy ? fromJson(legacy) : null;
    if (scene != null) return { version: 2, active: 'page_1', pages: [{ id: 'page_1', scene }], library };
    return library.length > 0 ? { version: 2, active: '', pages: [], library } : null;
  } catch {
    return null;
  }
}
