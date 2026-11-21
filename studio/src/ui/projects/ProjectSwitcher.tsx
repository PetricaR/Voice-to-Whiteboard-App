/**
 * The project of this tab, at the start of the top bar: its name, and a menu
 * to switch to a recent project (here or in a new tab), make a new one,
 * rename this one, or see them all.
 */
import { useEffect, useRef, useState } from 'react';
import { projectUrl } from '../../projects/boot';
import { lockedProjects } from '../../projects/projectLock';
import type { ProjectMeta } from '../../projects/projectStore';
import { Icon, useStudio } from '../context';
import { usePopoverMenu } from '../domTransitions';
import { ProjectDialog } from './ProjectDialogs';
import { exportProject, projectSummary, requestPersistentStorage } from './projectActions';

const RECENT = 6;

export function ProjectSwitcher() {
  const { project, projects, updateProject, goToProject, notify } = useStudio();
  const [menu, setMenu] = useState(false);
  const [recent, setRecent] = useState<ProjectMeta[]>([]);
  const [openElsewhere, setOpenElsewhere] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<'new' | 'rename' | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  usePopoverMenu({ open: menu, onOpenChange: setMenu, menuRef, triggerRef, placement: 'bottom-start' });

  useEffect(() => {
    if (!menu || projects == null) return;
    let cancelled = false;
    projects.listProjects()
      .then((all) => {
        if (!cancelled) setRecent(all.filter((p) => p.id !== project.id).slice(0, RECENT));
      })
      .catch(() => undefined);
    lockedProjects()
      .then((ids) => {
        if (!cancelled) setOpenElsewhere(ids);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [menu, projects, project.id]);

  const fail = (e: unknown) => notify(e instanceof Error ? e.message : String(e));

  return (
    <div className="menu-anchor project-switcher-anchor">
      <button
        ref={triggerRef}
        type="button"
        className="project-switcher"
        aria-haspopup="menu"
        aria-expanded={menu}
        aria-label={`Project: ${project.name}`}
        data-tooltip="Switch project"
        onClick={() => setMenu((v) => !v)}
      >
        <Icon name="folder_open" size={18} />
        <span className="project-switcher-name">{project.name}</span>
        <Icon name="keyboard_arrow_down" size={18} />
      </button>
      <div ref={menuRef} popover="auto" className="menu menu-popover menu-start project-menu" role="menu" aria-label="Projects">
        <div className="project-menu-head">
          <strong>{project.name}</strong>
          {project.brief && <small>{project.brief}</small>}
          {projects == null && <small>Not saved: this browser blocks storage.</small>}
        </div>
        {recent.length > 0 && (
          <>
            <hr className="menu-divider" />
            <div className="menu-label">Recent projects</div>
            {recent.map((p) => (
              <div className="project-menu-row" key={p.id}>
                <button type="button" role="menuitem" onClick={() => { setMenu(false); goToProject(p.id); }}>
                  <Icon name="folder_open" size={20} />
                  <span><b>{p.name}</b><small>{openElsewhere.has(p.id) ? 'Open in another tab' : projectSummary(p)}</small></span>
                </button>
                <a
                  className="icon-btn standard"
                  href={projectUrl(p.id)}
                  target="_blank"
                  rel="noopener"
                  aria-label={`Open ${p.name} in a new tab`}
                  data-tooltip="Open in a new tab"
                  onClick={() => setMenu(false)}
                >
                  <Icon name="open_in_new" size={18} />
                </a>
              </div>
            ))}
          </>
        )}
        <hr className="menu-divider" />
        {projects != null && (
          <>
            <button type="button" role="menuitem" onClick={() => { setMenu(false); setDialog('new'); }}>
              <Icon name="add" size={20} /><span>New project…</span>
            </button>
            <button type="button" role="menuitem" onClick={() => { setMenu(false); setDialog('rename'); }}>
              <Icon name="edit" size={20} /><span>Rename project…</span>
            </button>
            <button type="button" role="menuitem" onClick={() => {
              setMenu(false);
              exportProject(projects, project).catch(fail);
            }}>
              <Icon name="download" size={20} /><span>Export project<small>One file with pages and data</small></span>
            </button>
          </>
        )}
        <button type="button" role="menuitem" onClick={() => { setMenu(false); goToProject(null); }}>
          <Icon name="grid_view" size={20} /><span>All projects</span>
        </button>
      </div>

      <ProjectDialog
        open={dialog === 'new'}
        title="New project"
        submitLabel="Create"
        onSubmit={async ({ name, brief }) => {
          if (projects == null) return;
          const p = await projects.createProject({ name, brief });
          requestPersistentStorage();
          goToProject(p.id);
        }}
        onClose={() => setDialog(null)}
      />
      <ProjectDialog
        open={dialog === 'rename'}
        title="Rename project"
        submitLabel="Save"
        initial={{ name: project.name, brief: project.brief }}
        onSubmit={({ name, brief }) => updateProject({ name, brief })}
        onClose={() => setDialog(null)}
      />
    </div>
  );
}
