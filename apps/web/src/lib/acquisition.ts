/**
 * Remembers where a candidate came from (utm params on the job link) so the
 * application can carry it even after a login redirect on the way to apply.
 */
const KEY_PREFIX = 'jt.source.';
const SAFE = /[^a-z0-9_:-]/g;

export function sourceFromSearch(search: string): string | null {
  const params = new URLSearchParams(search);
  const source = params.get('utm_source')?.trim().toLowerCase();
  if (!source) return null;
  const medium = params.get('utm_medium')?.trim().toLowerCase();
  const value = (medium ? `${source}:${medium}` : source).replace(SAFE, '').slice(0, 40);
  return value || null;
}

export function rememberSource(jobId: string): void {
  if (typeof window === 'undefined') return;
  const source = sourceFromSearch(window.location.search);
  if (!source) return;
  try {
    window.sessionStorage.setItem(`${KEY_PREFIX}${jobId}`, source);
  } catch {
    // Private mode without storage: the current URL still carries the source.
  }
}

export function readSource(jobId: string): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const fromUrl = sourceFromSearch(window.location.search);
  if (fromUrl) return fromUrl;
  try {
    return window.sessionStorage.getItem(`${KEY_PREFIX}${jobId}`) || undefined;
  } catch {
    return undefined;
  }
}

/** Append utm params to a path that may already carry a query string. */
export function withUtm(path: string, source: string, medium?: string): string {
  const [base, query = ''] = path.split('?');
  const params = new URLSearchParams(query);
  params.set('utm_source', source);
  if (medium) params.set('utm_medium', medium);
  return `${base}?${params.toString()}`;
}
