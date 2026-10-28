import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';

export const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

/** AES-GCM authenticates both ciphertext and the owning HR/member identity. */
export class LinkedInTokenVault {
  private readonly keys = new Map<string, Buffer>();
  constructor(keys: Record<string, string>, readonly currentVersion: string) {
    for (const [version, encoded] of Object.entries(keys)) {
      if (!/^[a-zA-Z0-9_-]{1,32}$/.test(version)) throw new Error('Invalid LinkedIn key version');
      const key = Buffer.from(encoded, 'base64');
      if (key.length !== 32 || key.toString('base64') !== encoded) throw new Error('LinkedIn encryption keys must be canonical base64, 32 bytes');
      this.keys.set(version, key);
    }
    if (!this.keys.has(currentVersion)) throw new Error('LinkedIn active encryption key is missing');
  }
  encrypt(token: string, identity: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.keys.get(this.currentVersion)!, iv);
    cipher.setAAD(Buffer.from(identity));
    const bytes = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    return { ciphertext: [iv, cipher.getAuthTag(), bytes].map(value => value.toString('base64url')).join('.'), keyVersion: this.currentVersion };
  }
  decrypt(ciphertext: string, version: string, identity: string) {
    const key = this.keys.get(version);
    if (!key) throw new Error('LinkedIn decryption key unavailable');
    const parts = ciphertext.split('.');
    if (parts.length !== 3) throw new Error('Invalid LinkedIn ciphertext');
    const [iv, tag, bytes] = parts.map(value => Buffer.from(value, 'base64url'));
    if (iv.length !== 12 || tag.length !== 16) throw new Error('Invalid LinkedIn ciphertext');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(identity));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(bytes), decipher.final()]).toString('utf8');
  }
}

export function safeLinkedInReturnTo(value: unknown, webUrl: string): string {
  const fallback = '/en/settings#integrations';
  if (typeof value !== 'string' || value.length > 2000 || !value.startsWith('/') || value.startsWith('//') || /[\\\r\n]/.test(value)) return fallback;
  const url = new URL(value, webUrl);
  if (url.origin !== new URL(webUrl).origin || !/^\/(id|en|uz|ru)\/(settings|employers|dashboard\/recruiter)(\/|$)/.test(url.pathname)) return fallback;
  return url.pathname + url.search + url.hash;
}

export function validateLinkedInUploadUrl(value: string): URL {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  const allowed = ['linkedin.com', 'licdn.com'].some(domain => host === domain || host.endsWith('.' + domain));
  if (url.protocol !== 'https:' || !allowed || url.username || url.password || url.hash || (url.port && url.port !== '443') || isIP(host)) throw new Error('Untrusted LinkedIn upload destination');
  return url;
}

export function publicIp(address: string): boolean {
  if (isIP(address) === 4) {
    const [a,b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || b === 2)) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0));
  }
  if (isIP(address) === 6) {
    // LinkedIn upload DNS must resolve to global unicast, not mapped/local IPs.
    return /^2[0-9a-f]{3}:/i.test(address) && !/^2001:db8:/i.test(address);
  }
  return false;
}

export function nextUtcReset(now = Date.now()) { return new Date(new Date(now).setUTCHours(24, 0, 0, 0)); }
export function retryAt(header: string | null, now = Date.now()): Date | undefined {
  if (!header) return undefined;
  const milliseconds = /^\d+(\.\d+)?$/.test(header) ? now + Number(header) * 1000 : Date.parse(header);
  if (!Number.isFinite(milliseconds) || milliseconds <= now) return undefined;
  return new Date(Math.min(milliseconds, now + 24 * 60 * 60 * 1000));
}
