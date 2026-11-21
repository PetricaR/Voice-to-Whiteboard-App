/**
 * What a tab shows: the project in its address, or the project list.
 *
 * Opening a project reads it from this browser's storage before the studio
 * starts, so the studio always begins with that project's own pages. Another
 * project opens by navigating, so nothing of one project stays in memory when
 * the next one opens.
 */
import { lazy, Suspense, useEffect, useState } from 'react';
import type { SavedWorkspace } from '../engine/workspace';
import { ensureFirstProject, projectIdFromUrl, projectUrl } from '../projects/boot';
import { takeOverProject, tryLockProject, type ProjectLock } from '../projects/projectLock';
import { defaultSources, openProjectStore, type ProjectMeta, type ProjectStore } from '../projects/projectStore';
import { HomeView, ProjectLoading, StorageBlocked } from './projects/HomeView';
import { ProjectBusy } from './projects/ProjectBusy';
import { requestPersistentStorage } from './projects/projectActions';
import { loadSettings } from './settings';
import { applyTheme } from './theme';

const App = lazy(() => import('./App').then((m) => ({ default: m.App })));

type Boot =
  | { kind: 'loading' }
  | { kind: 'home'; store: ProjectStore; notice?: string }
  | { kind: 'project'; store?: ProjectStore; project: ProjectMeta; saved: SavedWorkspace | null; lock?: ProjectLock }
  /** The project is open in another tab. */
  | { kind: 'busy'; store: ProjectStore; project: ProjectMeta }
  | { kind: 'blocked'; message: string };

function localStorageOrNull(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Reads the project once this tab owns it, so it starts from the last save of any tab. */
async function loadOwned(store: ProjectStore, project: ProjectMeta, lock: ProjectLock): Promise<Boot> {
  const saved = await store.loadWorkspace(project.id);
  const opened = (await store.updateProject(project.id, { lastOpenedAt: Date.now() })) ?? project;
  return { kind: 'project', store, project: opened, saved, lock };
}

async function openProject(store: ProjectStore, id: string): Promise<Boot> {
  const project = await store.getProject(id);
  if (project == null) {
    window.history.replaceState(null, '', projectUrl(null));
    return { kind: 'home', store, notice: 'That project is not in this browser (it may have been deleted).' };
  }
  const lock = await tryLockProject(id);
  if (lock == null) return { kind: 'busy', store, project };
  return loadOwned(store, project, lock);
}

async function boot(): Promise<Boot> {
  let store: ProjectStore;
  try {
    store = await openProjectStore();
  } catch (e) {
    return { kind: 'blocked', message: e instanceof Error ? e.message : String(e) };
  }
  const id = projectIdFromUrl(window.location.href);
  if (id != null) return openProject(store, id);
  // A first start lands straight in the first project (made from earlier work, if any)
  const first = await ensureFirstProject(store, localStorageOrNull());
  if (first != null) {
    requestPersistentStorage();
    window.history.replaceState(null, '', projectUrl(first.id));
    return openProject(store, first.id);
  }
  return { kind: 'home', store };
}

// Once per page load, also under StrictMode's double effects (a first start must not make two projects)
let booting: Promise<Boot> | null = null;

/** A project that lives only in this tab, when the browser blocks storage. */
function unsavedProject(): ProjectMeta {
  const now = Date.now();
  return {
    id: 'unsaved',
    name: 'Unsaved project',
    brief: '',
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
    pageCount: 0,
    sources: defaultSources({ includeSamples: true }),
  };
}

export function Root() {
  const [state, setState] = useState<Boot>({ kind: 'loading' });

  useEffect(() => {
    const s = loadSettings();
    applyTheme(s.seedColor, s.themeMode);
  }, []);

  useEffect(() => {
    let cancelled = false;
    booting ??= boot().catch((e: unknown): Boot => ({ kind: 'blocked', message: e instanceof Error ? e.message : String(e) }));
    void booting.then((s) => {
      if (!cancelled) setState(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  switch (state.kind) {
    case 'loading':
      return <ProjectLoading />;
    case 'home':
      return <HomeView store={state.store} notice={state.notice} />;
    case 'blocked':
      return (
        <StorageBlocked
          message={state.message}
          onContinue={() => setState({ kind: 'project', project: unsavedProject(), saved: null })}
        />
      );
    case 'busy':
      return (
        <ProjectBusy
          name={state.project.name}
          onUseHere={async () => {
            const lock = await takeOverProject(state.project.id);
            setState(await loadOwned(state.store, state.project, lock));
          }}
        />
      );
    case 'project':
      return (
        <Suspense fallback={<ProjectLoading />}>
          <App key={state.project.id} project={state.project} projects={state.store} saved={state.saved} lock={state.lock} />
        </Suspense>
      );
  }
}
