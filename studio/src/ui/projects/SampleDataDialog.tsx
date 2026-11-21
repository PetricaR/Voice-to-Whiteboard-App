/**
 * Asks to turn on the sample tables, when an example (a starter dashboard, a
 * gallery chart) needs them and the project leaves them out.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { IconButton } from '../context';
import { useDialogLightDismiss } from '../domTransitions';
import { useModalDialog } from './ProjectDialogs';

export function SampleDataDialog({
  request,
  projectName,
  onConfirm,
  onClose,
}: {
  /** What asked for the sample data; null when the dialog is closed. */
  request: { what: string } | null;
  projectName: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The text stays while the dialog animates out
  const [what, setWhat] = useState('');
  useEffect(() => {
    if (request != null) {
      setWhat(request.what);
      setError(null);
    }
  }, [request]);
  useModalDialog(ref, request != null);
  useDialogLightDismiss(ref, onClose, busy);

  return (
    <dialog
      ref={ref}
      className="dialog project-dialog sample-data-dialog"
      closedby={busy ? 'none' : 'any'}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClose={onClose}
      aria-labelledby={`${id}-title`}
    >
      <header className="dialog-header">
        <h2 id={`${id}-title`}>Turn on the sample data?</h2>
        <IconButton icon="close" label="Close" disabled={busy} onClick={onClose} />
      </header>
      <p className="dialog-text">
        {what} runs on the built-in sample tables (SaaS revenue, e-commerce, cloud FinOps, sales CRM), which are off
        in “{projectName}”. Turning them on makes them part of this project, for you and for Gemini. You can turn them
        off again in Data sources.
      </p>
      {error && <p className="dialog-error" role="alert">{error}</p>}
      <footer className="dialog-actions">
        <button type="button" className="text-btn" disabled={busy} onClick={onClose}>Cancel</button>
        <button
          type="button"
          className="filled-btn"
          autoFocus
          disabled={busy}
          onClick={() => {
            setBusy(true);
            onConfirm()
              .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
              .finally(() => setBusy(false));
          }}
        >
          Turn on
        </button>
      </footer>
    </dialog>
  );
}
