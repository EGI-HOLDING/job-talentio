'use client';

import { createContext, useCallback, useContext, useMemo, useState, ReactNode } from 'react';

type Tone = 'ok' | 'error' | 'info';
type Toast = { id: number; tone: Tone; message: string };

type ToastApi = {
  notify: (message: string, tone?: Tone) => void;
};

const ToastContext = createContext<ToastApi>({ notify: () => undefined });

export function useToast() {
  return useContext(ToastContext);
}

const AUTO_DISMISS_MS = 6000;

export function Toaster({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback(
    (message: string, tone: Tone = 'ok') => {
      const id = Date.now() + Math.random();
      setToasts((prev) => [...prev, { id, tone, message }]);
      // Errors stay until dismissed; an admin needs to read what failed.
      if (tone !== 'error') {
        window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
      }
    },
    [dismiss],
  );

  const api = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.tone}`}>
            <span>{toast.message}</span>
            <button type="button" aria-label="Dismiss" onClick={() => dismiss(toast.id)}>
              x
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
