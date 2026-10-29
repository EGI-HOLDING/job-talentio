'use client';

import { useEffect, useState } from 'react';
import { getSession } from '@/lib/api';

/** Account changes must invalidate private resource reads, including another tab's login. */
export function useSessionIdentity() {
  const [identity, setIdentity] = useState(() => getSession()?.user.id || '');
  useEffect(() => {
    const update = () => setIdentity(getSession()?.user.id || '');
    update();
    window.addEventListener('jt-session-updated', update);
    window.addEventListener('storage', update);
    return () => { window.removeEventListener('jt-session-updated', update); window.removeEventListener('storage', update); };
  }, []);
  return identity;
}
