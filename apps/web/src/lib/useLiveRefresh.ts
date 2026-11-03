'use client';

import { useEffect, useRef } from 'react';

export type LiveResource = 'chat' | 'applications' | 'notifications';
export const LIVE_REFRESH_EVENT = 'talentio:resource-changed';

/** Serialize refreshes; recover missed socket hints after reconnect/focus and by polling. */
export function useLiveRefresh(resource: LiveResource, refresh: () => Promise<unknown>, enabled = true, context = '') {
  const latest = useRef(refresh);
  latest.current = refresh;
  useEffect(() => {
    if (!enabled) return;
    let disposed = false, running = false, queued = false, checked = Date.now();
    const run = async (force = false) => {
      if (disposed || document.visibilityState === 'hidden') return;
      if (running) { queued = true; return; }
      if(resource==='applications'&&!force&&Date.now()-checked<30_000)return;
      checked=Date.now();
      running = true;
      try { await latest.current(); } catch { /* The resource owns its error/retry UI. */ }
      finally {
        running = false;
        if (queued && !disposed) { queued = false; void run(true); }
      }
    };
    const hint = (event: Event) => {
      const value = (event as CustomEvent<{resource?: string}>).detail?.resource;
      if (!value || value === resource) void run(true);
    };
    const visible = () => { if (document.visibilityState !== 'hidden') void run(); };
    const focus = () => { void run(); };
    window.addEventListener(LIVE_REFRESH_EVENT, hint);
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', visible);
    const interval = window.setInterval(focus, resource === 'applications' ? 30_000 : 5000);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener(LIVE_REFRESH_EVENT, hint);
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [resource, enabled, context]);
}
