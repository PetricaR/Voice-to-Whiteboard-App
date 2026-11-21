/**
 * The account button at the end of the top bar, shown only when the studio
 * server requires sign-in: "Sign in", or the user's picture with a top-layer
 * popover menu of the plan, today's sessions and Sign out.
 */
import { useEffect, useRef, useState } from 'react';
import { deleteAccount, type Account } from '../voice/liveToken';
import { Icon, IconButton, useStudio } from './context';
import { closeTopLayerElement, useDialogLightDismiss, usePopoverMenu } from './domTransitions';

const PLAN: Record<Account['plan'], string> = { free: 'Free plan', pro: 'Pro plan', owner: 'Owner' };

function Avatar({ account, size }: { account: Account; size: number }) {
  const [failed, setFailed] = useState(false);
  const initial = (account.name || account.email).trim().charAt(0).toUpperCase();
  if (account.picture && !failed) {
    return (
      <img className="avatar" src={account.picture} alt="" width={size} height={size}
        referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    );
  }
  return <span className="avatar initial" style={{ width: size, height: size }} aria-hidden="true">{initial}</span>;
}

export function AccountMenu() {
  const { auth, requestSignIn, signOut, notify } = useStudio();
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const confirmDialogRef = useRef<HTMLDialogElement>(null);

  usePopoverMenu({
    open,
    onOpenChange: setOpen,
    menuRef,
    triggerRef,
    placement: 'bottom-end',
  });

  useEffect(() => {
    const d = confirmDialogRef.current;
    if (!d) return;
    if (confirmDelete) {
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
  }, [confirmDelete]);

  useDialogLightDismiss(confirmDialogRef, () => setConfirmDelete(false), deleting);

  if (!auth.required) return null;
  const account = auth.configured ? auth.account : null;
  if (account == null) {
    return (
      <button type="button" className="tonal-btn sign-in-btn" onClick={requestSignIn}>
        <Icon name="login" size={18} /> Sign in
      </button>
    );
  }

  const handleDeleteAccount = () => {
    setDeleting(true);
    deleteAccount()
      .then(() => {
        setConfirmDelete(false);
        signOut();
      })
      .catch((e: unknown) => notify(e instanceof Error ? e.message : String(e)))
      .finally(() => setDeleting(false));
  };

  const usage = account.limit == null
    ? `${account.used} ${account.used === 1 ? 'session' : 'sessions'} today`
    : `${account.used} of ${account.limit} sessions used today`;
  return (
    <div className="menu-anchor">
      <button
        ref={triggerRef}
        type="button"
        className="account-btn"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${account.email}`}
        data-tooltip={account.email}
      >
        <Avatar account={account} size={32} />
      </button>
      <div ref={menuRef} popover="auto" className="menu menu-popover menu-end account-menu" role="menu" aria-label="Account">
        <div className="account-head">
          <Avatar account={account} size={40} />
          <span>
            {account.name && <strong>{account.name}</strong>}
            <small>{account.email}</small>
          </span>
        </div>
        <div className="account-plan">
          <Icon name="workspace_premium" size={20} />
          <span>{PLAN[account.plan]}<small>{usage}</small></span>
        </div>
        {account.limit != null && (
          <div className="account-meter" role="meter" aria-label="Sessions used today"
            aria-valuemin={0} aria-valuemax={account.limit} aria-valuenow={account.used}>
            <i style={{ width: `${Math.min(100, (account.used / Math.max(1, account.limit)) * 100)}%` }} />
          </div>
        )}
        <hr className="menu-divider" />
        <button type="button" role="menuitem" onClick={() => { setOpen(false); signOut(); }}>
          <Icon name="logout" size={20} /><span>Sign out</span>
        </button>
        <button type="button" role="menuitem" onClick={() => { setOpen(false); setConfirmDelete(true); }}>
          <Icon name="delete" size={20} /><span>Delete account</span>
        </button>
      </div>

      <dialog
        ref={confirmDialogRef}
        className="dialog sign-in-dialog"
        closedby={deleting ? 'none' : 'any'}
        onCancel={(e) => {
          e.preventDefault();
          if (!deleting) setConfirmDelete(false);
        }}
        onClose={() => setConfirmDelete(false)}
        aria-labelledby="delete-account-title"
      >
        <header className="dialog-header">
          <h2 id="delete-account-title">Delete your studio account?</h2>
          <IconButton icon="close" label="Close" disabled={deleting} onClick={() => setConfirmDelete(false)} />
        </header>
        <p className="sign-in-text">
          Your profile is removed from the studio server. Today&rsquo;s session count stays until it expires, so the daily
          allowance is not reset. The pages saved in this browser stay.
        </p>
        <footer className="dialog-actions">
          <button
            type="button"
            className="text-btn danger"
            disabled={deleting}
            onClick={handleDeleteAccount}
          >
            {deleting ? 'Deleting…' : 'Delete account'}
          </button>
          <button
            type="button"
            className="filled-btn"
            autoFocus
            disabled={deleting}
            onClick={() => setConfirmDelete(false)}
          >
            Cancel
          </button>
        </footer>
      </dialog>
    </div>
  );
}
