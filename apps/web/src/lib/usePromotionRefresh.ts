'use client';
import { useEffect, useRef } from 'react';
import type { JobPromotion } from '@job-talentio/shared';

/** Focus and the next server-specified transition refresh the whole result context. */
export function usePromotionRefresh(rows: ReadonlyArray<{ promotion?: JobPromotion | null }>, refresh: () => void) {
  const callback = useRef(refresh);
  callback.current = refresh;
  const last = useRef(0);
  const transition = rows.map(row => Date.parse(row.promotion?.revalidateAt ?? '')).filter(Number.isFinite).sort((a,b) => a-b)[0];
  useEffect(() => {
    const run = (deadline = false) => {
      if (document.visibilityState !== 'visible' || (!deadline && Date.now() - last.current < 750)) return;
      last.current = Date.now(); callback.current();
    };
    const focus = () => run();
    let timer: number | undefined;
    const arm = () => {
      if (transition === undefined) return;
      timer = window.setTimeout(() => { if (transition > Date.now()) arm(); else run(true); }, Math.min(2_147_483_647, Math.max(0, transition - Date.now()) + 50));
    };
    arm();
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);
    return () => { if (timer !== undefined) window.clearTimeout(timer); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); };
  }, [transition]);
}
