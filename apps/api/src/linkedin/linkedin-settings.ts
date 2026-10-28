import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LinkedInTokenVault } from './linkedin-security';
import { isIP } from 'node:net';
import { publicIp } from './linkedin-security';

@Injectable()
export class LinkedInSettings {
  readonly enabled: boolean;
  readonly accessVerified: boolean;
  readonly version: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly webUrl: string;
  readonly vault?: LinkedInTokenVault;
  readonly configured: boolean;
  readonly publicSite: boolean;
  readonly scopes = ['openid', 'profile', 'w_member_social'];

  constructor(config: ConfigService) {
    this.enabled = config.get('LINKEDIN_ENABLED') === 'true';
    this.accessVerified = config.get('LINKEDIN_ACCESS_VERIFIED') === 'true';
    this.version = config.get('LINKEDIN_API_VERSION', '202610');
    this.clientId = config.get('LINKEDIN_CLIENT_ID', '');
    this.clientSecret = config.get('LINKEDIN_CLIENT_SECRET', '');
    this.redirectUri = config.get('LINKEDIN_REDIRECT_URI', '');
    this.webUrl = config.get('WEB_URL', 'http://localhost:3000').replace(/\/$/, '');
    const version = config.get('LINKEDIN_TOKEN_KEY_VERSION', 'v1');
    const rawKeys = config.get<string>('LINKEDIN_TOKEN_KEYS', '');
    let valid = false;
    try {
      const callback = new URL(this.redirectUri);
      const web = new URL(this.webUrl);
      const keys: unknown = JSON.parse(rawKeys);
      if (!keys || typeof keys !== 'object' || Array.isArray(keys) || Object.values(keys).some(key => typeof key !== 'string')) throw new Error('Invalid keyring');
      this.vault = new LinkedInTokenVault(keys as Record<string,string>, version);
      valid = Boolean(this.clientId && this.clientSecret && /^20\d{2}(0[1-9]|1[0-2])$/.test(this.version)
        && callback.protocol === 'https:' && !callback.username && !callback.password && !callback.search && !callback.hash
        && callback.pathname === '/api/integrations/linkedin/callback'
        && !web.username && !web.password && web.pathname === '/' && !web.search && !web.hash
        && (web.protocol === 'https:' || (config.get('NODE_ENV') !== 'production' && ['localhost','127.0.0.1'].includes(web.hostname))));
    } catch { valid = false; }
    this.configured = valid;
    let publicSite=false;
    try {const url=new URL(this.webUrl);const host=url.hostname.replace(/^\[|\]$/g,'');publicSite=url.protocol==='https:' && !['localhost','::1'].includes(host) && !/\.(localhost|local|internal|test|invalid|example)$/.test(host) && (isIP(host)?publicIp(host):host.includes('.'));}catch{/* invalid configuration remains unavailable */}
    this.publicSite=publicSite;
    // Fail closed for this integration while keeping portal publication available.
    if (this.enabled && !valid) new Logger(LinkedInSettings.name).error('LinkedIn sharing disabled: HTTPS callback, credentials, API version, WEB_URL or encryption keyring is invalid');
  }
  get canConnect() { return this.enabled && this.configured; }
  get canShare() { return this.canConnect && this.accessVerified && this.publicSite; }
}
