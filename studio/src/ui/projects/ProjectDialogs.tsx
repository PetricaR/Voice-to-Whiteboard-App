/**
 * The dialogs of projects: name and brief (new / rename), and the confirm
 * before a project is deleted.
 */
import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { MAX_BRIEF_LENGTH, MAX_NAME_LENGTH } from '../../projects/projectStore';
import { IconButton } from '../context';
import { closeTopLayerElement, useDialogLightDismiss } from '../domTransitions';

/** Shows the <dialog> as a modal while `open`, and animates it out when closed. */
export function useModalDialog(ref: RefObject<HTMLDialogElement | null>, open: boolean): void {
  useEffect(() => {
    const d = ref.current;
    if (d == null) return;
    if (open) {
      d.removeAttribute('data-closing');
      if (!d.open) d.showModal();
      return;
    }
    if (!d.open) return;
    let cancelled = false;
    void closeTopLayerElement(d, () => {
      if (!cancelled && d.open) d.close();
    }, 240);
    return () => {
      cancelled = true;
    };
  }, [ref, open]);
}

export interface ProjectFields {
  name: string;
  brief: string;
}

export function ProjectDialog({
  open,
  title,
  submitLabel,
  initial,
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  submitLabel: string;
  initial?: ProjectFields;
  /** Resolves when done (the dialog then closes); a thrown error is shown in the dialog. */
  onSubmit: (fields: ProjectFields) => Promise<void>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [name, setName] = useState('');
  const [brief, setBrief] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? '');
    setBrief(initial?.brief ?? '');
    setError(null);
    setBusy(false);
  }, [open, initial?.name, initial?.brief]);

  useModalDialog(ref, open);
  useDialogLightDismiss(ref, onClose, busy);

  return (
    <dialog
      ref={ref}
      className="dialog project-dialog"
      closedby={busy ? 'none' : 'any'}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClose={onClose}
      aria-labelledby={`${id}-title`}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError(null);
          onSubmit({ name, brief })
            .then(onClose)
            .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
            .finally(() => setBusy(false));
        }}
      >
        <header className="dialog-header">
          <h2 id={`${id}-title`}>{title}</h2>
          <IconButton icon="close" label="Close" disabled={busy} onClick={onClose} />
        </header>
        <label className="field">
          <span>Name</span>
          <input
            value={name}
            maxLength={MAX_NAME_LENGTH}
            required
            autoFocus
            placeholder="e.g. Q4 churn analysis"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field">
          <span>What is it about? (optional)</span>
          <textarea
            value={brief}
            rows={3}
            maxLength={MAX_BRIEF_LENGTH}
            placeholder="The question this project answers, for whom, and with which data"
            onChange={(e) => setBrief(e.target.value)}
          />
          <small>Gemini reads this to keep its work on the project’s topic.</small>
        </label>
        {error && <p className="dialog-error" role="alert">{error}</p>}
        <footer className="dialog-actions">
          <button type="button" className="text-btn" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" className="filled-btn" disabled={busy || name.trim() === ''}>{submitLabel}</button>
        </footer>
      </form>
    </dialog>
  );
}

export function ConfirmDeleteDialog({
  projectName,
  onConfirm,
  onClose,
}: {
  /** The project to delete; null when the dialog is closed. */
  projectName: string | null;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [busy, setBusy] = useState(false);
  // The name stays while the dialog animates out
  const [shown, setShown] = useState(projectName);
  useEffect(() => {
    if (projectName != null) setShown(projectName);
  }, [projectName]);
  useModalDialog(ref, projectName != null);
  useDialogLightDismiss(ref, onClose, busy);

  return (
    <dialog
      ref={ref}
      className="dialog project-dialog"
      closedby={busy ? 'none' : 'any'}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClose={onClose}
      aria-labelledby={`${id}-title`}
    >
      <header className="dialog-header">
        <h2 id={`${id}-title`}>Delete “{shown}”?</h2>
        <IconButton icon="close" label="Close" disabled={busy} onClick={onClose} />
      </header>
      <p className="dialog-text">
        Its pages, dashboards, diagrams and uploaded data are removed from this browser. This cannot be undone —
        export the project first to keep a copy.
      </p>
      <footer className="dialog-actions">
        <button
          type="button"
          className="text-btn danger"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            onConfirm().finally(() => setBusy(false));
          }}
        >
          {busy ? 'Deleting…' : 'Delete project'}
        </button>
        <button type="button" className="filled-btn" autoFocus disabled={busy} onClick={onClose}>Cancel</button>
      </footer>
    </dialog>
  );
}
