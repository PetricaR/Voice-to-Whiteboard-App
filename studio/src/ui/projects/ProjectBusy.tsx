/**
 * One tab per project, as the user sees it: the screen of a tab that opens a
 * project another tab has, and the dialog of the tab that handed it over.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { projectUrl } from '../../projects/boot';
import { takeOverProject } from '../../projects/projectLock';
import { Icon } from '../context';
import { useModalDialog } from './ProjectDialogs';

const WHY = 'A project is open in one tab at a time, so edits in two tabs never overwrite each other.';

/** This tab asked for a project that another tab has open. */
export function ProjectBusy({ name, onUseHere }: { name: string; onUseHere: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    document.title = `${name} — open in another tab`;
  }, [name]);
  return (
    <div className="project-busy" role="alert">
      <span className="project-busy-icon" aria-hidden="true"><Icon name="open_in_new" size={28} /></span>
      <h1>“{name}” is open in another tab</h1>
      <p>{WHY} Use it here and the other tab saves its work and stops editing.</p>
      {error && <p className="dialog-error">{error}</p>}
      <div className="crash-actions">
        <button
          type="button"
          className="filled-btn"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            onUseHere().catch((e: unknown) => {
              setError(e instanceof Error ? e.message : String(e));
              setBusy(false);
            });
          }}
        >
          {busy ? 'Taking it over…' : 'Use it here'}
        </button>
        <button type="button" className="text-btn" disabled={busy} onClick={() => window.location.assign(projectUrl(null))}>
          All projects
        </button>
      </div>
    </div>
  );
}

/** Shown over the studio once the project went to another tab: nothing here is saved any more. */
export function MovedAwayDialog({ open, projectId, name }: { open: boolean; projectId: string; name: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [busy, setBusy] = useState(false);
  useModalDialog(ref, open);
  useEffect(() => {
    if (open) document.title = `${name} — open in another tab`;
  }, [open, name]);
  return (
    <dialog
      ref={ref}
      className="dialog project-dialog moved-dialog"
      closedby="none"
      onCancel={(e) => e.preventDefault()}
      aria-labelledby={`${id}-title`}
    >
      <header className="dialog-header">
        <h2 id={`${id}-title`}>“{name}” is open in another tab now</h2>
      </header>
      <p className="dialog-text">
        {WHY} Your work up to now is saved; changes made here from now on are not.
      </p>
      <footer className="dialog-actions">
        <button type="button" className="text-btn" disabled={busy} onClick={() => window.location.assign(projectUrl(null))}>
          All projects
        </button>
        <button
          type="button"
          className="filled-btn"
          autoFocus
          disabled={busy}
          onClick={() => {
            setBusy(true);
            // Take it back, then start again from what the other tab saved
            takeOverProject(projectId)
              .then(() => window.location.reload())
              .catch(() => setBusy(false));
          }}
        >
          {busy ? 'Taking it back…' : 'Use it here'}
        </button>
      </footer>
    </dialog>
  );
}
