'use client';
import { DirectionalIcon } from '@/components/ui/DirectionalIcon';
import { useId, useLayoutEffect, useSyncExternalStore } from 'react';
import type { ButtonHTMLAttributes, CSSProperties } from 'react';
import s from './HrFlow.module.css';

// Presentation only. Nested onboarding/creation screens restore their parent context.
const surfaces = new Map<string, string>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => surfaces.size ? [...surfaces.values()].at(-1)! : null;
export function useHrFlowSurface(companyName = '') {
  const id = useId();
  useLayoutEffect(() => {
    surfaces.set(id, companyName); notify();
    return () => { surfaces.delete(id); notify(); };
  }, [id, companyName]);
}
export function useHrFlowContext() { return useSyncExternalStore(subscribe, snapshot, () => null); }

type AssistantSurface = { companyId: string; companyName: string };
const assistantSurfaces = new Map<string, AssistantSurface>();
const assistantSnapshot = () => assistantSurfaces.size ? [...assistantSurfaces.values()].at(-1)! : null;
export function useHrAssistantSurface(companyId: string, companyName: string) {
  const id = useId();
  useLayoutEffect(() => {
    assistantSurfaces.set(id, { companyId, companyName }); notify();
    return () => { assistantSurfaces.delete(id); notify(); };
  }, [id, companyId, companyName]);
}
export function useHrAssistantContext() { return useSyncExternalStore(subscribe, assistantSnapshot, () => null); }

export function HrAddItemButton({ children, fullWidth=false, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {fullWidth?:boolean}) {
  return <button {...props} type="button" className={fullWidth?s.addRow:s.addItem} data-hr-add-item><HrIcon kind="plus" size={16}/><span>{children}</span></button>;
}

export function HrIcon({ kind, size = 20, style }: { kind: 'building'|'upload'|'file'|'image'|'check'|'next'|'back'|'info'|'chevron'|'briefcase'|'shield'|'plus'; size?: number; style?: CSSProperties }) {
  if (kind === 'next') return <DirectionalIcon direction="right" size={size} style={style} />;
  if (kind === 'back') return <DirectionalIcon direction="left" size={size} style={style} />;
  if (kind === 'chevron') return <DirectionalIcon direction="down" size={size} style={style} />;
  const paths: Record<string, React.ReactNode> = {
    plus: <path d="M12 5v14M5 12h14"/>,
    building: <><path d="M4 21V5l9-2v18M13 9h7v12M2 21h20M7 7h2M7 11h2M7 15h2M16 12h1M16 16h1M8 21v-3"/></>,
    upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm0 0v6h6M8 13h8M8 17h6"/></>,
    image: <><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1"/><path d="m3 16 5-5 4 4 4-6 5 7"/></>,
    check: <><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.01"/></>,
    briefcase: <><rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V4h8v3M3 12a22 22 0 0 0 18 0M12 11v4"/></>,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{flexShrink:0,...style}}>{paths[kind]}</svg>;
}

export function HrIntroIllustration() {
  return <svg viewBox="0 0 430 400" fill="none" aria-hidden="true">
    <ellipse cx="217" cy="358" rx="180" ry="23" fill="#ede8ff"/>
    <rect x="66" y="89" width="240" height="257" rx="24" transform="rotate(-9 66 89)" fill="#f0eaff" stroke="#6540db" strokeWidth="3"/>
    <rect x="120" y="45" width="256" height="300" rx="24" transform="rotate(4 120 45)" fill="white" stroke="#5831d4" strokeWidth="3"/>
    <g transform="translate(142 88) rotate(4)"><rect width="88" height="76" rx="14" fill="#eee8ff"/><rect x="21" y="25" width="46" height="32" rx="5" stroke="#6136df" strokeWidth="5"/><path d="M34 25v-9h20v9M21 39h46M44 36v9" stroke="#6136df" strokeWidth="5" strokeLinejoin="round"/>
    <path d="M110 15h67M110 36h53M110 57h61" stroke="#c7b7f6" strokeWidth="10" strokeLinecap="round"/>
    <path d="M2 103h174M2 123h145" stroke="#ddd3f7" strokeWidth="9" strokeLinecap="round"/>
    {[163,193,223].map(y=><g key={y}><circle cx="6" cy={y} r="5" stroke="#b69cf1" strokeWidth="3"/><path d={`M25 ${y}h138`} stroke="#e1d8f8" strokeWidth="8" strokeLinecap="round"/></g>)}
    <rect x="4" y="248" width="180" height="24" rx="12" fill="#a885ef"/></g>
    <path d="m357 22 4-20m18 32 15-17m-2 36 21-6" stroke="#ff8d24" strokeWidth="7" strokeLinecap="round"/>
  </svg>;
}
