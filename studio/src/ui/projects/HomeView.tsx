/**
 * The project list, shown when a tab has no project in its address: open a
 * project (here or in a new tab), make, rename, duplicate, export, import or
 * delete one.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { projectUrl } from '../../projects/boot';
import { projectFromFile } from '../../projects/projectFile';
import { lockedProjects } from '../../projects/projectLock';
import type { ProjectMeta, ProjectStore } from '../../projects/projectStore';
import { Icon } from '../context';
import { usePopoverMenu } from '../domTransitions';
import { Snackbar, type Toast } from '../Snackbar';
import { ConfirmDeleteDialog, ProjectDialog } from './ProjectDialogs';
import { exportProject, projectSummary, requestPersistentStorage } from './projectActions';

function formatMb(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ProjectCard({
  project,
  openElsewhere,
  onRename,
  onDuplicate,
  onExport,
  onDelete,
}: {
  project: ProjectMeta;
  /** Another tab has the project open. */
  openElsewhere: boolean;
  onRename: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onDelete: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  usePopoverMenu({ open: menu, onOpenChange: setMenu, menuRef, triggerRef, placement: 'bottom-end' });
  const url = projectUrl(project.id);
  const act = (run: () => void) => () => {
    setMenu(false);
    run();
  };

  return (
    <article className="project-card">
      <a className="project-card-link" href={url}>
        <span className="project-card-icon" aria-hidden="true"><Icon name="folder_open" size={22} /></span>
        <h3>{project.name}</h3>
        {project.brief && <p>{project.brief}</p>}
        <span className="project-card-meta">
          {openElsewhere && <span className="project-card-badge">Open in a tab</span>}
          {projectSummary(project)}
        </span>
      </a>
      <div className="menu-anchor project-card-menu">
        <button
          ref={triggerRef}
          type="button"
          className="icon-btn standard"
          aria-label={`More actions for ${project.name}`}
          aria-haspopup="menu"
          aria-expanded={menu}
          data-tooltip="More actions"
          onClick={() => setMenu((v) => !v)}
        >
          <Icon name="more_vert" />
        </button>
        <div ref={menuRef} popover="auto" className="menu menu-popover menu-end" role="menu" aria-label={`${project.name} actions`}>
          <button type="button" role="menuitem" onClick={act(() => window.open(url, '_blank'))}>
            <Icon name="open_in_new" size={20} /><span>Open in a new tab</span>
          </button>
          <button type="button" role="menuitem" onClick={act(onRename)}>
            <Icon name="edit" size={20} /><span>Rename</span>
          </button>
          <button type="button" role="menuitem" onClick={act(onDuplicate)}>
            <Icon name="content_copy" size={20} /><span>Duplicate</span>
          </button>
          <button type="button" role="menuitem" onClick={act(onExport)}>
            <Icon name="download" size={20} /><span>Export<small>One file with pages and data, to back up or move</small></span>
          </button>
          <hr className="menu-divider" />
          <button type="button" role="menuitem" disabled={openElsewhere} onClick={act(onDelete)}>
            <Icon name="delete" size={20} />
            <span>Delete{openElsewhere && <small>Close the tab that has it open first</small>}</span>
          </button>
        </div>
      </div>
    </article>
  );
}

export function HomeView({ store, notice }: { store: ProjectStore; notice?: string }) {
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null);
  const [openElsewhere, setOpenElsewhere] = useState<Set<string>>(new Set());
  const [usage, setUsage] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<ProjectMeta | null>(null);
  const [deleting, setDeleting] = useState<ProjectMeta | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastId = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const notify = useCallback((message: string, action?: Toast['action']) => {
    setToast({ id: ++toastId.current, message, action });
  }, []);
  const fail = useCallback((e: unknown) => notify(e instanceof Error ? e.message : String(e)), [notify]);

  const reload = useCallback(() => {
    store.listProjects().then(setProjects).catch(fail);
    lockedProjects().then(setOpenElsewhere).catch(() => undefined);
    navigator.storage?.estimate?.().then((e) => setUsage(e.usage ?? null)).catch(() => undefined);
  }, [store, fail]);

  useEffect(reload, [reload]);
  useEffect(() => {
    if (notice) notify(notice);
  }, [notice, notify]);
  useEffect(() => {
    document.title = 'Projects — Voice Whiteboard Studio';
  }, []);
  // Another tab may have made, renamed or deleted a project
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [reload]);

  const create = async ({ name, brief }: { name: string; brief: string }) => {
    const p = await store.createProject({ name, brief });
    requestPersistentStorage();
    window.location.assign(projectUrl(p.id));
  };

  return (
    <div className="home">
      <header className="home-bar">
        <div className="brand" aria-hidden="true"><Icon name="graphic_eq" size={22} /></div>
        <span className="home-product">Voice Whiteboard Studio</span>
        <div className="spacer" />
        <button type="button" className="tonal-btn" onClick={() => fileRef.current?.click()}>
          <Icon name="upload_file" size={18} /> Import
        </button>
        <button type="button" className="filled-btn" onClick={() => setCreating(true)}>
          <Icon name="add" size={18} /> New project
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file == null) return;
            const parsed = projectFromFile(await file.text(), file.name);
            if (parsed == null) {
              notify('That file is not a studio project or studio file.');
              return;
            }
            try {
              const p = await store.createProject(parsed);
              requestPersistentStorage();
              reload();
              notify(`Imported “${p.name}”`, { label: 'Open', run: () => window.location.assign(projectUrl(p.id)) });
            } catch (err) {
              fail(err);
            }
          }}
        />
      </header>

      <div className="home-scroll">
        <main className="home-main">
          <div className="home-heading">
            <div>
              <h1>Projects</h1>
              <p>Each project keeps its own pages, dashboards, diagrams and data. Open one per browser tab.</p>
            </div>
          </div>

          {projects != null && projects.length === 0 && (
            <div className="home-empty">
              <Icon name="folder_open" size={40} />
              <h2>No projects yet</h2>
              <p>Start one for each question you work on.</p>
              <button type="button" className="filled-btn" onClick={() => setCreating(true)}>
                <Icon name="add" size={18} /> New project
              </button>
            </div>
          )}

          {projects != null && projects.length > 0 && (
            <div className="project-grid">
              {projects.map((p) => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  openElsewhere={openElsewhere.has(p.id)}
                  onRename={() => setRenaming(p)}
                  onDuplicate={() => {
                    store.duplicateProject(p.id)
                      .then((copy) => {
                        reload();
                        if (copy) notify(`Made “${copy.name}”`);
                      })
                      .catch(fail);
                  }}
                  onExport={() => {
                    exportProject(store, p).catch(fail);
                  }}
                  onDelete={() => setDeleting(p)}
                />
              ))}
            </div>
          )}

          {usage != null && usage > 0 && (
            <p className="home-footer">
              Saved in this browser only · {formatMb(usage)} used. Export a project to back it up or move it to another browser.
            </p>
          )}
        </main>
      </div>

      <ProjectDialog
        open={creating}
        title="New project"
        submitLabel="Create"
        onSubmit={create}
        onClose={() => setCreating(false)}
      />
      <ProjectDialog
        open={renaming != null}
        title="Rename project"
        submitLabel="Save"
        initial={renaming ? { name: renaming.name, brief: renaming.brief } : undefined}
        onSubmit={async ({ name, brief }) => {
          if (renaming == null) return;
          await store.updateProject(renaming.id, { name, brief });
          reload();
        }}
        onClose={() => setRenaming(null)}
      />
      <ConfirmDeleteDialog
        projectName={deleting?.name ?? null}
        onConfirm={async () => {
          if (deleting == null) return;
          if ((await lockedProjects()).has(deleting.id)) {
            notify(`“${deleting.name}” is open in another tab. Close it there first.`);
            setDeleting(null);
            reload();
            return;
          }
          try {
            await store.deleteProject(deleting.id);
            notify(`Deleted “${deleting.name}”`);
            setDeleting(null);
            reload();
          } catch (e) {
            fail(e);
          }
        }}
        onClose={() => setDeleting(null)}
      />
      <Snackbar toast={toast} onDone={() => setToast(null)} />
    </div>
  );
}

/** Shown while a project opens. */
export function ProjectLoading() {
  return <div className="home-loading" aria-busy="true" aria-label="Opening the project" />;
}

/** The browser blocks storage (e.g. a locked-down private window): the studio still works, unsaved. */
export function StorageBlocked({ message, onContinue }: { message: string; onContinue: () => void }) {
  return (
    <div className="crash-screen" role="alert">
      <h1>This browser does not let the studio save projects</h1>
      <p>
        Storage is turned off for this site (often in a private window or by a browser setting), so projects cannot be
        saved or opened. You can still work, but nothing is kept when you close the tab — export your pages to keep them.
      </p>
      <pre>{message}</pre>
      <div className="crash-actions">
        <button type="button" className="filled-btn" onClick={onContinue}>Continue without saving</button>
        <button type="button" className="text-btn" onClick={() => window.location.reload()}>Try again</button>
      </div>
    </div>
  );
}

