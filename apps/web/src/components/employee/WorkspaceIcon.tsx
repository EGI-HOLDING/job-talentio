import type { ReactNode } from 'react';
import { ProfileIcon } from '@/components/profile/ProfileIcon';

export function WorkspaceIcon({ kind }: { kind: string }) {
  const paths: Record<string, ReactNode> = {
    chevronUp: <path d="m6 15 6-6 6 6" />,
    chevronDown: <path d="m6 9 6 6 6-6" />,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
    left: <path d="m14 6-6 6 6 6" />,
    right: <path d="m9 6 6 6-6 6" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4m10-4v4M3 11h18" /></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 6 9 7 9-7" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>,
    telegram: <path d="m21 3-4 18-6-5-4 3v-6L3 11 21 3Zm0 0L7 13m4 3 5-7" />,
    bookmark: <path d="M6 3h12v18l-6-4-6 4V3Z" />,
    message: <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H3l2.2-4.3A8.5 8.5 0 1 1 21 11.5Z" />,
    send: <path d="m21 3-7 18-3-8-8-3L21 3Zm0 0L11 13" />,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    shield: <><path d="m12 3 8 4v6c0 5-8 8-8 8S4 18 4 13V7l8-4Z" /><path d="m8 12 3 3 5-6" /></>,
    sort: <path d="M7 3v18m-4-4 4 4 4-4M17 21V3m-4 4 4-4 4 4" />,
  };
  if (!paths[kind]) return <ProfileIcon kind={kind} />;
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind]}</svg>;
}
