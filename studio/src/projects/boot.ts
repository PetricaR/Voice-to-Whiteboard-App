/**
 * Which project a tab opens. The address says it (`?project=<id>`), so every
 * tab can work on its own project and a project can be bookmarked; without
 * one the tab shows the project list.
 */
import { isProjectId, type ProjectMeta, type ProjectStore } from './projectStore';
import { readLegacyWorkspace } from './workspaceData';

export const PROJECT_PARAM = 'project';
/** Set once the first project was made (from an earlier version's work, or empty). */
export const FIRST_RUN_KEY = 'studio.projects.firstRun';
export const FIRST_PROJECT_NAME = 'My first project';

export function projectIdFromUrl(href: string): string | null {
  try {
    const id = new URL(href).searchParams.get(PROJECT_PARAM);
    return isProjectId(id) ? id : null;
  } catch {
    return null;
  }
}

/** The address of a project (or of the project list), keeping the rest of the current address. */
export function projectUrl(id: string | null, href: string = window.location.href): string {
  const url = new URL(href);
  url.hash = '';
  if (id == null) url.searchParams.delete(PROJECT_PARAM);
  else url.searchParams.set(PROJECT_PARAM, id);
  return url.pathname + url.search;
}

/**
 * On the very first start with projects: the work an earlier version kept in
 * this browser becomes the first project, or an empty first project is made,
 * so a new user lands in the studio rather than an empty list. Returns null
 * when projects exist or were made before.
 */
export async function ensureFirstProject(
  store: ProjectStore,
  storage: Pick<Storage, 'getItem' | 'setItem'> | null,
): Promise<ProjectMeta | null> {
  if ((await store.listProjects()).length > 0) return null;
  let marked = false;
  try {
    marked = storage?.getItem(FIRST_RUN_KEY) === '1';
  } catch {
    // storage blocked: treat as a first run
  }
  if (marked) return null;
  const legacy = storage ? readLegacyWorkspace(storage) : null;
  const project = await store.createProject({
    name: FIRST_PROJECT_NAME,
    // Earlier versions always had the sample tables, so the work keeps them
    sources: { includeSamples: true },
    workspace: legacy,
  });
  try {
    // The earlier keys stay one more release as a backup
    storage?.setItem(FIRST_RUN_KEY, '1');
  } catch {
    // not persisted: the next start finds the project and does nothing
  }
  return project;
}
