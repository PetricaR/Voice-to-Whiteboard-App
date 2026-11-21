import { ReactFlowProvider } from '@xyflow/react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { VoiceAgent } from '../agent/session';
import { setProjectScope, setScopeHooks } from '../data/projectScope';
import { invalidateDataSourcesCache, syncSampleTables, type QueryExecutionResult } from '../data/sqlEngine';
import { Workspace, type SavedWorkspace } from '../engine/workspace';
import { projectUrl } from '../projects/boot';
import type { ProjectLock } from '../projects/projectLock';
import { ProjectGoneError, type ProjectMeta, type ProjectPatch, type ProjectSources, type ProjectStore } from '../projects/projectStore';
import { fetchServerStatus, onAccountChange, signOut as serverSignOut, type ServerStatus } from '../voice/liveToken';
import { DiagramCanvas } from './canvas/DiagramCanvas';
import { StudioContext, useStudio, type Studio } from './context';
import type { DataModalTab } from './dashboard/DataSourceModal';
import { DocView } from './DocView';
import { prefersReducedMotion } from './domTransitions';
import { EmptyState } from './EmptyState';
import { download, fileName, pagesToJson } from './export';
import type { DeckCommand } from './deck/DeckView';
import { PageTabs } from './PageTabs';
import { loadSettings, saveSettings, type Settings } from './settings';
import { SettingsDialog } from './SettingsDialog';
import { SignInDialog } from './SignInDialog';
import { forgetGoogleAccount } from './googleSignIn';
import { MovedAwayDialog } from './projects/ProjectBusy';
import { SampleDataDialog } from './projects/SampleDataDialog';
import { SidePanel, type PanelTab } from './SidePanel';
import { Snackbar, type Toast } from './Snackbar';
import { applyTheme } from './theme';
import { TopBar } from './TopBar';
import { VoiceDock } from './VoiceDock';
import { ZoomControls } from './ZoomControls';

// The dashboard, deck and data surfaces load when they are first shown, so
// the page starts with the canvas and the voice dock only
const DashboardView = lazy(() => import('./dashboard/DashboardView').then((m) => ({ default: m.DashboardView })));
const DeckView = lazy(() => import('./deck/DeckView').then((m) => ({ default: m.DeckView })));
const DataSourceModal = lazy(() => import('./dashboard/DataSourceModal').then((m) => ({ default: m.DataSourceModal })));
/** True from the first time `value` is: a dialog is loaded when first opened and then stays mounted to animate out. */
function useOnceTrue(value: boolean): boolean {
  const seen = useRef(false);
  if (value) seen.current = true;
  return seen.current;
}

const UI_KEY = 'studio.ui';

interface UiPrefs {
  panelOpen: boolean;
  panelTab: PanelTab;
  minimap: boolean;
}

function loadPrefs(): UiPrefs {
  const defaults: UiPrefs = { panelOpen: typeof window !== 'undefined' && window.innerWidth >= 1100, panelTab: 'diagrams', minimap: false };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(UI_KEY) ?? '{}') };
  } catch {
    return defaults;
  }
}

/** Global shortcuts: undo/redo, Space to talk, / to type (zoom shortcuts are in ZoomControls). */
function Shortcuts({ focusComposer }: { focusComposer: () => void }) {
  const { store, workspace, toggleVoice } = useStudio();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable="true"], dialog')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) store.redo(); else store.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        store.redo();
      } else if (e.key === ' ' && !mod && !e.repeat) {
        e.preventDefault();
        toggleVoice();
      } else if (e.key === '/') {
        e.preventDefault();
        focusComposer();
      } else if (e.key === 'Escape' && workspace.view === 'diagram') {
        // In documentation, dashboard, or deck views Escape does not clear diagram selection
        store.setSelection([]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store, workspace, toggleVoice, focusComposer]);
  return null;
}

export function App({
  project: openedProject,
  projects,
  saved,
  lock,
  notice,
}: {
  /** The project of this tab. */
  project: ProjectMeta;
  /** Where it is saved; undefined when the browser blocks storage. */
  projects?: ProjectStore;
  /** Its pages and diagram history as last saved. */
  saved: SavedWorkspace | null;
  /** This tab's ownership of the project (none when the browser blocks storage). */
  lock?: ProjectLock;
  /** Said once the studio is shown (e.g. a table of the project could not be loaded). */
  notice?: string;
}) {
  const workspace = useMemo(() => new Workspace(saved), []);
  const [project, setProject] = useState(openedProject);
  const projectId = openedProject.id;
  const projectRef = useRef(project);
  projectRef.current = project;
  // Re-render when another page is shown (each page has its own canvas state)
  const activeId = useSyncExternalStore((l) => workspace.subscribe(l), () => workspace.activeId);
  // Active surface of the page ('diagram' | 'dashboard' | 'board' | 'deck' | 'doc')
  const activeView = useSyncExternalStore((l) => workspace.subscribe(l), () => workspace.view);
  const nonCanvasOpen = activeView !== 'diagram';
  const page = workspace.active;
  const store = page.store;
  const [settings, setSettingsState] = useState<Settings>(loadSettings);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const agent = useMemo(() => new VoiceAgent(workspace, () => settingsRef.current), [workspace]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dataModalOpen, setDataModalOpen] = useState(false);
  const dataModalUsed = useOnceTrue(dataModalOpen);
  const [dataModalTab, setDataModalTab] = useState<DataModalTab>('bigquery');
  const openDataSources = useCallback((tab: DataModalTab = 'bigquery') => {
    setDataModalTab(tab);
    setDataModalOpen(true);
  }, []);
  const [prefs, setPrefs] = useState<UiPrefs>(loadPrefs);
  // Bumped by "/" to focus the request field of the dock
  const [focusRequest, setFocusRequest] = useState(0);
  const focusComposer = useCallback(() => setFocusRequest((n) => n + 1), []);
  const [empty, setEmpty] = useState(true);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastId = useRef(0);

  // Live SQL query cache & cross-surface UI controls for the Dashboard Inspector and the Deck
  const [dashboardResults, setDashboardResults] = useState<Record<string, QueryExecutionResult | undefined>>({});
  const dashboardResultsRef = useRef(dashboardResults);
  dashboardResultsRef.current = dashboardResults;
  const [inspectorWidgetRequest, setInspectorWidgetRequest] = useState<string | null>(null);
  const [deckCommand, setDeckCommand] = useState<DeckCommand | null>(null);
  const [dashboardMounted, setDashboardMounted] = useState(activeView === 'dashboard');
  const prevActiveIdRef = useRef(activeId);

  useEffect(() => {
    setDashboardResults({});
    setInspectorWidgetRequest(null);
    if (prevActiveIdRef.current !== activeId) {
      prevActiveIdRef.current = activeId;
      setDashboardMounted(activeView === 'dashboard');
    }
  }, [activeId, activeView]);

  useEffect(() => {
    if (activeView === 'dashboard') {
      setDashboardMounted(true);
      return;
    }
    if (!dashboardMounted) return;
    const ms = prefersReducedMotion() ? 100 : 230;
    const t = window.setTimeout(() => setDashboardMounted(false), ms);
    return () => window.clearTimeout(t);
  }, [activeView, dashboardMounted]);

  useEffect(() => {
    agent.studio = {
      inspectWidget: (widgetId: string) => {
        workspace.showView('dashboard');
        setInspectorWidgetRequest(widgetId);
      },
      controlDeck: (action, slide) => {
        workspace.showView('deck');
        setDeckCommand({ id: Date.now() + Math.random(), action, slide });
      },
      getDashboardResults: () => dashboardResultsRef.current,
    };
    return () => {
      agent.studio = undefined;
    };
  }, [agent, workspace]);

  useEffect(() => applyTheme(settings.seedColor, settings.themeMode), [settings.seedColor, settings.themeMode]);

  const updatePrefs = useCallback((patch: Partial<UiPrefs>) => {
    setPrefs((p) => {
      const next = { ...p, ...patch };
      try {
        localStorage.setItem(UI_KEY, JSON.stringify(next));
      } catch {
        // not persisted
      }
      return next;
    });
  }, []);

  // Every change of the project is saved in this browser: its pages and diagram history
  const saveNow = useRef<() => Promise<void>>(async () => undefined);
  // Once the project went to another tab, nothing here is saved any more
  const savingOff = useRef(false);
  const [movedAway, setMovedAway] = useState(false);
  useEffect(() => {
    if (projects == null) return;
    let timer = 0;
    let pending = false;
    // Said once until a save succeeds again, not after every change
    let warned = false;
    let gone = false;
    const exportPages = () => {
      const pages = workspace.pages.map((p) => p.store.scene);
      download(fileName(pages[0], 'json'), pagesToJson(pages), 'application/json');
    };
    const save = async () => {
      window.clearTimeout(timer);
      if (!pending || gone || savingOff.current) return;
      pending = false;
      try {
        await projects.saveWorkspace(projectId, workspace.serialize());
        warned = false;
      } catch (e) {
        if (e instanceof ProjectGoneError) {
          gone = true;
          setToast({
            id: ++toastId.current,
            message: 'This project was deleted in another tab, so changes are no longer saved. Export the pages to keep them.',
            action: { label: 'Export', run: exportPages },
          });
          return;
        }
        // Storage full or unavailable: the work would be lost on reload
        pending = true;
        if (warned) return;
        warned = true;
        setToast({
          id: ++toastId.current,
          message: 'Changes can no longer be saved in this browser (storage is full). Export the pages to keep them.',
          action: { label: 'Export', run: exportPages },
        });
      }
    };
    saveNow.current = save;
    const unsubscribe = workspace.subscribe(() => {
      pending = true;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void save(), 400);
    });
    // Leaving the tab (switching, closing, reloading) saves at once
    const onHidden = () => {
      if (document.visibilityState === 'hidden') void save();
    };
    const onPageHide = () => void save();
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', onPageHide);
      void save();
    };
  }, [workspace, projects, projectId]);

  useEffect(() => {
    document.title = `${project.name} — Voice Whiteboard Studio`;
  }, [project.name]);

  // Another tab asks for the project: save, stop talking, then let it go
  useEffect(() => {
    if (lock == null) return;
    const offHandoff = lock.onHandoffRequest(async () => {
      agent.stop();
      await saveNow.current();
      savingOff.current = true;
    });
    const offLost = lock.onLost(() => {
      savingOff.current = true;
      agent.stop();
      setMovedAway(true);
    });
    return () => {
      offHandoff();
      offLost();
    };
  }, [lock, agent]);

  const updateProject = useCallback(async (patch: ProjectPatch) => {
    const before = projectRef.current;
    let next: ProjectMeta;
    if (projects == null) {
      next = { ...before, ...patch };
    } else {
      const saved = await projects.updateProject(projectId, patch);
      if (saved == null) throw new Error('This project no longer exists (it was deleted in another tab).');
      next = saved;
    }
    projectRef.current = next;
    setProject(next);
    // The data layer follows at once, so the next query already sees the change
    setProjectScope({ projectId, name: next.name, brief: next.brief, sources: next.sources });
    if (JSON.stringify(before.sources) !== JSON.stringify(next.sources)) {
      invalidateDataSourcesCache();
      await syncSampleTables();
    }
  }, [projects, projectId]);

  // Source changes run one after another, each from the latest state
  const sourcesQueue = useRef<Promise<void>>(Promise.resolve());
  const editSources = useCallback((change: (sources: ProjectSources) => ProjectSources) => {
    const run = sourcesQueue.current.then(() => updateProject({ sources: change(projectRef.current.sources) }));
    sourcesQueue.current = run.catch(() => undefined);
    return run;
  }, [updateProject]);

  const [sampleRequest, setSampleRequest] = useState<{ what: string; run: () => void } | null>(null);
  const requireSampleData = useCallback((what: string, run: () => void) => {
    if (projectRef.current.sources.includeSamples) run();
    else setSampleRequest({ what, run });
  }, []);

  const goToProject = useCallback((id: string | null) => {
    agent.stop();
    void saveNow.current().finally(() => window.location.assign(projectUrl(id)));
  }, [agent]);

  useEffect(() => () => agent.stop(), [agent]);

  const notify = useCallback((message: string, action?: Toast['action']) => {
    setToast({ id: ++toastId.current, message, action });
  }, []);

  // The agent and the data layer reach the project through these
  useEffect(() => {
    setScopeHooks({
      attachSource: (id) => editSources((s) => (s.remote.includes(id) ? s : { ...s, remote: [...s.remote, id] })),
      onSaveError: (name) => notify(`“${name}” works now, but it could not be saved with the project (browser storage is full).`),
    });
  }, [editSources, notify]);

  useEffect(() => {
    if (notice) notify(notice);
  }, [notice, notify]);

  // A closed page (by hand or by voice) can be brought back
  useEffect(() => workspace.onPageRemoved((r) => {
    const title = r.page.store.scene.title;
    notify(title ? `Closed “${title}”` : 'Closed the page', { label: 'Undo', run: () => workspace.restorePage(r) });
  }), [workspace, notify]);

  // For automated UI tests in development
  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as unknown as { __studio: unknown }).__studio = {
        workspace, agent,
        get store() {
          return workspace.store;
        },
      };
    }
  }, [workspace, agent]);

  // The key stays on the studio server; the page only learns whether there is one,
  // and, on a deployment, who is signed in and how many sessions are left today
  const [server, setServer] = useState<ServerStatus>({ key: 'unknown', auth: { required: false } });
  const serverRef = useRef(server);
  serverRef.current = server;
  const liveKey = server.key;
  const auth = server.auth;
  const refreshLiveKey = useCallback(() => {
    fetchServerStatus().then(setServer).catch(() => undefined);
  }, []);
  useEffect(refreshLiveKey, [refreshLiveKey]);
  useEffect(() => {
    onAccountChange((account) => setServer((s) => (s.auth.required && s.auth.configured && s.auth.account
      ? { ...s, auth: { ...s.auth, account } }
      : s)));
    return () => onAccountChange(null);
  }, []);
  const [signInOpen, setSignInOpen] = useState(false);
  const requestSignIn = useCallback(() => setSignInOpen(true), []);
  const closeSignIn = useCallback(() => setSignInOpen(false), []);
  /** True when Gemini can be asked now; otherwise it asks for what is missing (sign-in or a key) and returns false. */
  const ensureCanTalk = useCallback((): boolean => {
    const s = serverRef.current;
    if (s.auth.required && !(s.auth.configured && s.auth.account)) {
      setSignInOpen(true);
      return false;
    }
    if (s.key === 'missing') {
      setSettingsOpen(true);
      notify('Add a Gemini API key to the studio server to start talking.');
      return false;
    }
    return true;
  }, [notify]);
  const signOut = useCallback(() => {
    agent.stop();
    serverSignOut()
      .then(() => {
        forgetGoogleAccount();
        notify('Signed out');
      })
      .catch((e: unknown) => notify(e instanceof Error ? e.message : String(e)))
      .finally(refreshLiveKey);
  }, [agent, notify, refreshLiveKey]);

  const setSettings = useCallback((s: Settings) => {
    const restart = agent.active && (s.model !== settingsRef.current.model ||
      s.voice !== settingsRef.current.voice || s.silenceDurationMs !== settingsRef.current.silenceDurationMs);
    setSettingsState(s);
    saveSettings(s);
    if (restart) {
      agent.stop();
      notify('Settings saved. Start talking again to use them.');
    }
  }, [agent, notify]);

  const toggleVoice = useCallback(() => {
    if (agent.snapshot.micOn || agent.snapshot.status === 'connecting') {
      agent.stop();
      return;
    }
    if (!ensureCanTalk()) return;
    agent.start(true).catch(() => undefined);
  }, [agent, ensureCanTalk]);

  // Errors of the voice session are shown in the dock (with Settings, Sign in or Try again);
  // a key or sign-in problem also re-checks the server, and an expired session asks to sign in again
  useEffect(() => {
    let last: string | null = null;
    return agent.subscribe(() => {
      const s = agent.snapshot;
      const error = s.status === 'error' ? s.error : null;
      if (error && error !== last) {
        if (/key/i.test(error) || s.errorCode === 'signed-out' || s.errorCode === 'daily-limit' || s.errorCode === 'auth-not-configured') {
          refreshLiveKey();
        }
        if (s.errorCode === 'signed-out') {
          // The session cookie expired or was revoked: signed out until the user signs in again
          setServer((v) => (v.auth.required && v.auth.configured ? { ...v, auth: { ...v.auth, account: null } } : v));
          setSignInOpen(true);
        }
      }
      last = error;
    });
  }, [agent, refreshLiveKey]);

  const studio: Studio = useMemo(() => ({
    project, projects, updateProject, goToProject, editSources, requireSampleData,
    workspace, store, agent, settings, setSettings, liveKey, googleClientId: server.googleClientId, refreshLiveKey, notify, toggleVoice,
    openSettings: () => setSettingsOpen(true),
    openDataSources,
    auth, requestSignIn, signOut, ensureCanTalk,
  }), [project, projects, updateProject, goToProject, editSources, requireSampleData, workspace, store, agent, settings, setSettings, liveKey, server.googleClientId, refreshLiveKey, notify, toggleVoice, openDataSources, auth, requestSignIn, signOut, ensureCanTalk]);

  const togglePanel = useCallback(() => updatePrefs({ panelOpen: !prefs.panelOpen }), [prefs.panelOpen, updatePrefs]);
  const appRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);

  // Keep fixed top-layer drawers aligned flush under the top bar + page tabs (even when tabs wrap on small screens)
  useEffect(() => {
    const appEl = appRef.current;
    const wsEl = workspaceRef.current;
    if (!appEl || !wsEl) return;
    const update = () => {
      const top = Math.max(56, Math.round(wsEl.getBoundingClientRect().top));
      appEl.style.setProperty('--workspace-top', `${top}px`);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(appEl);
    ro.observe(wsEl);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  return (
    <StudioContext.Provider value={studio}>
      <ReactFlowProvider>
        <div ref={appRef} className={`app${prefs.panelOpen ? ' with-sheet' : ''}`}>
          <TopBar
            panelOpen={prefs.panelOpen}
            togglePanel={togglePanel}
            dashboardResults={dashboardResults}
          />
          <PageTabs />
          <main ref={workspaceRef} className="workspace">
            <div className="canvas">
              <div className="canvas-layer" inert={nonCanvasOpen}>
                <DiagramCanvas
                  key={activeId}
                  viewport={page.viewport}
                  onLeave={(v) => { page.viewport = v; }}
                  minimap={prefs.minimap}
                  onEmptyChange={setEmpty}
                  hidden={nonCanvasOpen}
                />
              </div>
              {empty && activeView === 'diagram' && <EmptyState />}
              <ZoomControls minimap={prefs.minimap} setMinimap={(minimap) => updatePrefs({ minimap })} hidden={nonCanvasOpen} />
              <Suspense fallback={null}>
                {(activeView === 'dashboard' || (dashboardMounted && prevActiveIdRef.current === activeId)) && (
                  <DashboardView
                    key={`dash-${activeId}`}
                    closing={activeView !== 'dashboard'}
                    onResultsChange={setDashboardResults}
                    inspectorWidgetRequest={inspectorWidgetRequest}
                    onClearInspectorRequest={() => setInspectorWidgetRequest(null)}
                  />
                )}
                {activeView === 'board' && (
                  <DashboardView key={`board-${activeId}`} surface="board" />
                )}
                {activeView === 'deck' && (
                  <DeckView
                    key={`deck-${activeId}`}
                    dashboardResults={dashboardResults}
                    command={deckCommand}
                  />
                )}
              </Suspense>
              {activeView === 'doc' && <DocView key={activeId} />}
              <VoiceDock focusRequest={focusRequest} />
              <Snackbar toast={toast} onDone={() => setToast(null)} />
            </div>
            {prefs.panelOpen && (
              <SidePanel tab={prefs.panelTab} setTab={(panelTab) => updatePrefs({ panelTab })} onClose={() => updatePrefs({ panelOpen: false })} />
            )}
          </main>
          <Shortcuts focusComposer={focusComposer} />
          <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
          <Suspense fallback={null}>
            {dataModalUsed && (
              <DataSourceModal open={dataModalOpen} initialTab={dataModalTab} onClose={() => setDataModalOpen(false)} />
            )}
          </Suspense>
          <SignInDialog open={signInOpen} onClose={closeSignIn} />
          <MovedAwayDialog open={movedAway} projectId={projectId} name={project.name} />
          <SampleDataDialog
            request={sampleRequest}
            projectName={project.name}
            onConfirm={async () => {
              const r = sampleRequest;
              await editSources((s) => ({ ...s, includeSamples: true }));
              setSampleRequest(null);
              r?.run();
            }}
            onClose={() => setSampleRequest(null)}
          />
        </div>
      </ReactFlowProvider>
    </StudioContext.Provider>
  );
}
