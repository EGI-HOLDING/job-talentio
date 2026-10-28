'use client';

import { useSyncExternalStore } from 'react';
import { getSession } from './api';

function subscribe(onChange: () => void) {
  window.addEventListener('jt-session-updated', onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener('jt-session-updated', onChange);
    window.removeEventListener('storage', onChange);
  };
}

export function useAccountRole(): string | null {
  return useSyncExternalStore(subscribe, () => getSession()?.user.role ?? null, () => null);
}
