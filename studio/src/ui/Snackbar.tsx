import { useEffect } from 'react';

export interface Toast {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}

export function Snackbar({ toast, onDone }: { toast: Toast | null; onDone: () => void }) {
  useEffect(() => {
    if (toast == null) return;
    const t = setTimeout(onDone, toast.action ? 6000 : 4000);
    return () => clearTimeout(t);
  }, [toast, onDone]);
  if (toast == null) return null;
  return (
    <div className="snackbar" role="status" key={toast.id}>
      <span>{toast.message}</span>
      {toast.action && (
        <button type="button" className="text-btn inverse" onClick={() => { toast.action!.run(); onDone(); }}>
          {toast.action.label}
        </button>
      )}
    </div>
  );
}
