'use client';
import { useEffect } from 'react';
import { trackJobEvent } from '@/lib/hr-events';
export function JobImpressions() {
  useEffect(() => {
    const observed = new Set<Element>(),
      visible = new Set<Element>(),
      timers = new Map<Element, ReturnType<typeof setTimeout>>();
    function cancel(node: Element) {
      const timer = timers.get(node);
      if (timer) clearTimeout(timer);
      timers.delete(node);
    }
    function start(node: Element) {
      cancel(node);
      if (document.visibilityState !== 'visible') return;
      timers.set(
        node,
        setTimeout(() => {
          timers.delete(node);
          const jobId = node.getAttribute('data-job-impression');
          if (
            node.isConnected &&
            visible.has(node) &&
            document.visibilityState === 'visible' &&
            jobId
          )
            void trackJobEvent(jobId, 'IMPRESSION');
        }, 1000),
      );
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
            visible.add(entry.target);
            start(entry.target);
          } else {
            visible.delete(entry.target);
            cancel(entry.target);
          }
        }
      },
      { threshold: [0, 0.5, 1] },
    );
    function scan() {
      for (const node of observed)
        if (!node.isConnected) {
          observer.unobserve(node);
          cancel(node);
          observed.delete(node);
          visible.delete(node);
        }
      document.querySelectorAll('[data-job-impression]').forEach((node) => {
        if (!observed.has(node)) {
          observed.add(node);
          observer.observe(node);
        }
      });
    }
    const mutation = new MutationObserver(scan);
    mutation.observe(document.body, { childList: true, subtree: true });
    scan();
    function visibility() {
      for (const node of visible)
        document.visibilityState === 'visible' ? start(node) : cancel(node);
    }
    document.addEventListener('visibilitychange', visibility);
    return () => {
      observer.disconnect();
      mutation.disconnect();
      for (const node of timers.keys()) cancel(node);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  return null;
}
