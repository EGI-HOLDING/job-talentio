// Shared loads survive Strict Mode and page navigation. Failed loads can be retried.
const loads = new Map<string, Promise<void>>();

export function loadAuthSdk(src: string, ready: () => boolean): Promise<void> {
  if (ready()) return Promise.resolve();
  const current = loads.get(src);
  if (current) return current;
  const pending = new Promise<void>((resolve, reject) => {
    let script = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (script?.dataset.authSdk === 'failed') { script.remove(); script = null; }
    const element = script || document.createElement('script');
    const cleanup = () => {
      window.clearTimeout(timeout);
      element.removeEventListener('load', loaded);
      element.removeEventListener('error', failed);
    };
    const failed = () => { cleanup(); element.dataset.authSdk = 'failed'; reject(new Error('AUTH_SDK_UNAVAILABLE')); };
    const loaded = () => { if (!ready()) { failed(); return; } cleanup(); element.dataset.authSdk = 'ready'; resolve(); };
    const timeout = window.setTimeout(failed, 12_000);
    element.addEventListener('load', loaded, { once: true });
    element.addEventListener('error', failed, { once: true });
    if (!script) { element.src = src; element.async = true; element.defer = true; document.head.appendChild(element); }
    else if (element.dataset.authSdk === 'ready') loaded();
  });
  loads.set(src, pending);
  void pending.catch(() => { if (loads.get(src) === pending) loads.delete(src); });
  return pending;
}
