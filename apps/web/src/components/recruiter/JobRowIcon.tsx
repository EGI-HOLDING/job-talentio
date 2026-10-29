import type { ReactNode } from 'react';
import { WorkspaceIcon } from '@/components/employee/WorkspaceIcon';

export function JobRowIcon({ kind }: { kind: string }) {
  const paths: Record<string, ReactNode> = {
    boost: <path d="m13 2-9 12h7l-1 8L20 9h-7l1-7Z" />,
    copy: <><rect x="8" y="8" width="13" height="13" rx="2" /><path d="M16 8V3H3v13h5" /></>,
    pause: <><path d="M8 5v14M16 5v14" /></>,
    play: <path d="m8 4 12 8-12 8V4Z" />,
    more: <><circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" /></>,
  };
  return paths[kind] ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind]}</svg> : <WorkspaceIcon kind={kind} />;
}
