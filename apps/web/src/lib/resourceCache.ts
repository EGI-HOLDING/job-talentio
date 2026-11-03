type Entry = { value?: unknown; at: number; pending?: Promise<unknown>; controller?: AbortController; waiters: number };

/** Memory only; private keys include the account and locale. */
export class ResourceCache {
  private entries = new Map<string, Entry>();
  private listeners = new Map<string, Set<() => void>>();
  constructor(readonly capacity = 200, private now = () => Date.now()) {}
  peek<T>(key: string): T | undefined { return this.entries.get(key)?.value as T | undefined; }
  fresh(key: string, ttl: number) { const e = this.entries.get(key); return !!e && e.value !== undefined && this.now() - e.at < ttl; }
  subscribe(key: string, listener: () => void) {
    const group = this.listeners.get(key) || new Set(); group.add(listener); this.listeners.set(key, group);
    return () => { group.delete(listener); if (!group.size) this.listeners.delete(key); };
  }
  private emit(key: string) { this.listeners.get(key)?.forEach(fn => fn()); }
  invalidate(predicate: (key: string) => boolean) {
    for (const [key, entry] of [...this.entries]) if (predicate(key)) { this.entries.delete(key); entry.controller?.abort(); this.emit(key); }
  }
  async read<T>(key: string, load: (signal: AbortSignal) => Promise<T>, ttl: number, signal?: AbortSignal, force = false): Promise<T> {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    let entry = this.entries.get(key);
    if (!force && this.fresh(key, ttl)) { this.entries.delete(key); this.entries.set(key, entry!); return entry!.value as T; }
    if (!entry) { entry = { at: 0, waiters: 0 }; this.entries.set(key, entry); }
    if (!entry.pending) {
      const current = entry, controller = new AbortController(); current.controller = controller;
      current.pending = Promise.resolve().then(() => load(controller.signal)).then(value => {
        if (this.entries.get(key) === current && !controller.signal.aborted) { current.value = value; current.at = this.now(); this.emit(key); }
        return value;
      }).finally(() => { if (this.entries.get(key) === current) { current.pending = undefined; current.controller = undefined; } });
    }
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value!; const old = this.entries.get(oldest)!;
      this.entries.delete(oldest); old.controller?.abort();
    }
    const current = entry; current.waiters++;
    return new Promise<T>((resolve, reject) => {
      let done = false;
      const finish = (error: unknown, value?: T) => {
        if (done) return; done = true; signal?.removeEventListener('abort', abort); current.waiters--;
        if (!current.waiters && current.pending && this.entries.get(key) === current && error instanceof DOMException && error.name === 'AbortError') {
          this.entries.delete(key); current.controller?.abort();
        }
        if (error) reject(error); else resolve(value!);
      };
      const abort = () => finish(new DOMException('Aborted', 'AbortError'));
      signal?.addEventListener('abort', abort, { once: true });
      current.pending!.then(value => finish(null, value as T), error => finish(error));
    });
  }
}

export const resourceCache = new ResourceCache();
