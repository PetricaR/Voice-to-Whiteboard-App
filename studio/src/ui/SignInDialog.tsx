/**
 * Asks for a Google sign-in before the first Live session on a deployed studio
 * (locally the server needs none). Drawing by hand, blueprints and export work
 * without an account; only Gemini, which spends the studio's API key, needs one.
 */
import { useEffect, useRef, useState } from 'react';
import { signInWithGoogle } from '../voice/liveToken';
import { Icon, IconButton, useStudio } from './context';
import { closeTopLayerElement, useDialogLightDismiss } from './domTransitions';
import { renderGoogleButton } from './googleSignIn';

function resolveDark(mode: string): boolean {
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

export function SignInDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { auth, settings, refreshLiveKey, notify } = useStudio();
  const ref = useRef<HTMLDialogElement>(null);
  const buttonRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [darkScheme, setDarkScheme] = useState(() => resolveDark(settings.themeMode));
  const clientId = auth.required && auth.configured ? auth.clientId : null;

  // Keep Google Sign-In button theme synchronized with both manual theme & live OS preference changes
  useEffect(() => {
    setDarkScheme(resolveDark(settings.themeMode));
    if (settings.themeMode !== 'system' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setDarkScheme(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [settings.themeMode]);

  useEffect(() => {
    const d = ref.current;
    if (d == null) return;
    if (open) {
      d.removeAttribute('data-closing');
      if (!d.open) {
        setError(null);
        d.showModal();
      }
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
  }, [open]);

  useDialogLightDismiss(ref, onClose);

  useEffect(() => {
    const el = buttonRef.current;
    if (!open || el == null || clientId == null) return;
    let cancelled = false;
    renderGoogleButton(el, clientId, async (credential) => {
      setBusy(true);
      setError(null);
      try {
        const account = await signInWithGoogle(credential);
        if (cancelled) return;
        refreshLiveKey();
        onClose();
        notify(`Signed in as ${account.email}`);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, darkScheme).catch((e: unknown) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e));
    });
    return () => {
      cancelled = true;
    };
  }, [open, clientId, darkScheme, refreshLiveKey, onClose, notify]);

  return (
    <dialog
      ref={ref}
      className="dialog sign-in-dialog"
      closedby="any"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClose={onClose}
      aria-labelledby="sign-in-title"
    >
      <header className="dialog-header">
        <h2 id="sign-in-title">Sign in to talk</h2>
        <IconButton icon="close" label="Close" onClick={onClose} />
      </header>
      {clientId == null ? (
        <p className="sign-in-text">
          Sign-in is not set up on this studio server yet, so voice and typed requests are off. You can still open
          blueprints, edit diagrams by hand and export them.
        </p>
      ) : (
        <>
          <p className="sign-in-text">
            Gemini draws and edits your diagrams. Sign in with your Google account to use it
            {auth.required && auth.configured ? ` — the free plan includes ${auth.freeDaily} voice sessions a day` : ''}.
          </p>
          <div className="sign-in-button" ref={buttonRef} aria-busy={busy} />
          {error && (
            <p className="sign-in-error" role="alert">
              <Icon name="error" size={18} /> <span>{error}</span>
            </p>
          )}
          <p className="sign-in-note">
            The studio keeps your name, e-mail address and how many sessions you started today. Your diagrams stay in
            this browser.
          </p>
        </>
      )}
    </dialog>
  );
}
