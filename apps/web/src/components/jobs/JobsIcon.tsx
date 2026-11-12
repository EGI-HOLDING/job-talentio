import { DirectionalIcon } from '@/components/ui/DirectionalIcon';
import type { ReactNode } from 'react';

export function JobsIcon({ kind = 'search' }: { kind?: string }) {
  if (kind === 'chevron') return <DirectionalIcon direction="down" />;
  if (kind === 'back') return <DirectionalIcon direction="left" size={17} />;
  if (kind === 'refresh') return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false"
      style={{ mask: "url('/icons/reload.png') center / contain no-repeat" }}>
      <rect width="24" height="24" fill="currentColor" />
    </svg>
  );
  const paths: Record<string, ReactNode> = {
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
    pin: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2.4" /></>,
    clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
    briefcase: <><rect x="3" y="7" width="18" height="14" rx="2" /><path d="M8 7V3h8v4M3 12c5 3 13 3 18 0m-9 0v4" /></>,
    document: <path d="M5 2h9l5 5v15H5V2Zm9 0v6h5M8 12h8m-8 4h6" />,
    bookmark: <path d="M6 3h12v18l-6-4-6 4V3Z" />,
    external: <path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    filter: <><path d="M3 6h18M3 12h18M3 18h18" /><path d="M8 3v6m8 0v6m-6 0v6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    sparkles: <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Zm7 0v4m-2-2h4" />,
  };
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind] || paths.search}</svg>;
}
