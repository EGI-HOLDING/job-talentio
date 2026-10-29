'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { JobBenefitSummary } from './jobRowPolicy';

type ReadState = { context: string; phase: 'loading' | 'ready' | 'error' | 'unavailable'; data: JobBenefitSummary | null };

/** One read state shared by a row, its menu and its dialogs. */
export function useJobRowBenefits(companyId: string, jobId: string, status: string, locale: string) {
  const context = [companyId, jobId, status, locale].join(':');
  const current = useRef(context); current.current = context;
  const alive = useRef(false);
  const generation = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const [state, setState] = useState<ReadState>({ context, phase: 'loading', data: null });
  useEffect(() => { alive.current = true; return () => { alive.current = false; ++generation.current; pending.current?.abort(); }; }, []);
  const refresh = useCallback(async (): Promise<JobBenefitSummary | null> => {
    const version = ++generation.current;
    if (!alive.current || current.current !== context) return null;
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    let timer: ReturnType<typeof setTimeout>;
    setState({ context, phase: 'loading', data: null });
    try {
      const value = await Promise.race([
        api<JobBenefitSummary>('/benefits/jobs/' + encodeURIComponent(jobId), { signal: controller.signal }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Benefit read timed out')); }, 15000); }),
      ]);
      if (!alive.current || current.current !== context || version !== generation.current) return null;
      setState({ context, phase: 'ready', data: value });
      return value;
    } catch (reason) {
      if (alive.current && current.current === context && version === generation.current) {
        setState({ context, phase: reason instanceof ApiError && reason.status === 404 ? 'unavailable' : 'error', data: null });
      }
      return null;
    } finally {
      clearTimeout(timer!);
      if (pending.current === controller) pending.current = null;
    }
  }, [context, jobId]);
  useEffect(() => {
    void refresh();
    const focus = () => { void refresh(); };
    window.addEventListener('focus', focus);
    return () => { ++generation.current; pending.current?.abort(); window.removeEventListener('focus', focus); };
  }, [refresh]);
  const data = state.context === context && state.phase === 'ready' ? state.data : null;
  useEffect(() => {
    if (!data) return;
    const now = Date.now();
    const next = [data.expiresAt, data.activeBoost?.endsAt].filter(Boolean).map(value => Date.parse(value!)).filter(value => value > now).sort((a, b) => a - b)[0];
    if (!next) return;
    const timer = setTimeout(() => { void refresh(); }, Math.min(86400000, Math.max(100, next - now + 50)));
    return () => clearTimeout(timer);
  }, [data, refresh]);
  return { data, phase: state.context === context ? state.phase : 'loading' as const, refresh };
}
