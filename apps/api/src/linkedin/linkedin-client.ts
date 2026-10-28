import { Injectable } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { LinkedInSettings } from './linkedin-settings';
import { publicIp, retryAt, validateLinkedInUploadUrl } from './linkedin-security';
import type { LinkedInTelemetry, LinkedInRequestMetric } from './linkedin-observability';

export class LinkedInFailure extends Error {
  constructor(readonly code: string, message: string, readonly options: {
    retryable?: boolean; ambiguous?: boolean; status?: number; retryAt?: Date;
  } = {}) { super(message); }
}

export type LinkedInQuotaCheck = (member: string, endpoint: string) => Promise<void>;
const POST_URN = /^urn:li:(share|ugcPost):\d{1,30}$/;
export const validPostUrn = (value: string) => POST_URN.test(value);

/** No provider bodies, tokens, authorization codes or signed URLs enter errors. */
@Injectable()
export class LinkedInClient {
  private quota?: LinkedInQuotaCheck;
  private telemetry?: LinkedInTelemetry;
  constructor(private settings: LinkedInSettings) {}
  setQuota(check: LinkedInQuotaCheck) { this.quota = check; }
  setTelemetry(record: LinkedInTelemetry) { this.telemetry = record; }

  private async guard(member: string, endpoint: string) {
    if (!this.quota) throw new LinkedInFailure('QUEUE_UNAVAILABLE', 'Sharing is waiting for its background service.', { retryable: true });
    await this.quota(member, endpoint);
  }
  private headers(token: string) {
    return { Authorization: `Bearer ${token}`, 'Linkedin-Version': this.settings.version, 'X-Restli-Protocol-Version': '2.0.0', 'Content-Type': 'application/json' };
  }
  private async send(url: string, init: RequestInit, final = false): Promise<Response> {
    const parsed=new URL(url);
    const endpoint:LinkedInRequestMetric['endpoint'] | null=parsed.pathname==='/rest/posts'?'posts':parsed.pathname==='/rest/images'?'imageInitialize':parsed.pathname.startsWith('/rest/images/')?'imageRead':init.method==='PUT'?'imageUpload':null;
    const started=Date.now();let status:number|null=null;
    try {return await this.sendRequest(url,init,final,value=>{status=value;});}
    finally {
      // Telemetry never changes the outcome of a final publish request.
      if(endpoint && this.telemetry)void this.telemetry({endpoint,status,durationMs:Math.max(0,Date.now()-started)}).catch(()=>undefined);
    }
  }
  private async sendRequest(url: string, init: RequestInit, final:boolean,received:(status:number)=>void): Promise<Response> {
    let response: Response;
    try { response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(20_000) }); }
    catch { throw new LinkedInFailure(final ? 'PUBLISH_RESULT_UNKNOWN' : 'PROVIDER_UNAVAILABLE', final ? 'The posting result is uncertain. Check your LinkedIn feed before taking further action.' : 'LinkedIn could not be reached.', { ambiguous: final, retryable: !final }); }
    received(response.status);
    if (response.ok) return response;
    const status = response.status;
    const ambiguous = final && (status >= 500 || status === 408);
    if (status === 429) throw new LinkedInFailure('RATE_LIMITED', 'LinkedIn is limiting requests. Sharing will wait before retrying.', { status, retryable: true, retryAt: retryAt(response.headers.get('retry-after')) });
    if (status === 401) throw new LinkedInFailure('RECONNECT_REQUIRED', 'Reconnect your LinkedIn account.', { status });
    if (status === 403) throw new LinkedInFailure('ACCESS_DENIED', 'LinkedIn did not allow this action. Check the app permissions and account connection.', { status });
    if (ambiguous) throw new LinkedInFailure('PUBLISH_RESULT_UNKNOWN', 'LinkedIn may have accepted the post. Check your feed before taking further action.', { status, ambiguous: true });
    if (final && status === 400) {
      const body = await response.json().catch(() => null) as { code?: string } | null;
      if (body?.code && ['IMAGE_NOT_READY','CONTENT_NOT_READY','RESOURCE_NOT_READY'].includes(body.code)) throw new LinkedInFailure('IMAGE_PROCESSING', 'The poster is still processing on LinkedIn.', { status, retryable: true });
    }
    throw new LinkedInFailure(status >= 500 ? 'PROVIDER_UNAVAILABLE' : 'INVALID_PROVIDER_REQUEST', status >= 500 ? 'LinkedIn is temporarily unavailable.' : 'LinkedIn rejected the request. Review the posting configuration.', { status, retryable: status >= 500 });
  }

  async exchange(code: string) {
    const response = await this.send('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: this.settings.redirectUri, client_id: this.settings.clientId, client_secret: this.settings.clientSecret }),
    });
    const token = await response.json() as { access_token?: unknown; expires_in?: unknown; scope?: unknown };
    if (typeof token.access_token !== 'string' || !token.access_token || token.access_token.length > 16000 || !Number.isFinite(Number(token.expires_in)) || Number(token.expires_in) <= 0 || Number(token.expires_in) > 366 * 86400) throw new LinkedInFailure('INVALID_TOKEN_RESPONSE', 'LinkedIn returned an invalid authorization response.');
    // LinkedIn's consent is all requested scopes, or denied. Some token responses omit scope.
    const scopes = typeof token.scope === 'string' ? token.scope.split(/[ ,]+/).filter(Boolean) : [...this.settings.scopes];
    if (!this.settings.scopes.every(scope => scopes.includes(scope))) throw new LinkedInFailure('MISSING_SCOPES', 'LinkedIn did not grant the permissions required for sharing.');
    const identityResponse = await this.send('https://api.linkedin.com/v2/userinfo', { headers: { Authorization: `Bearer ${token.access_token}` } });
    const identity = await identityResponse.json() as { sub?: unknown; name?: unknown; picture?: unknown };
    if (typeof identity.sub !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(identity.sub)) throw new LinkedInFailure('INVALID_IDENTITY', 'LinkedIn did not return a valid member identity.');
    let avatarUrl: string | null = null;
    if (typeof identity.picture === 'string') {
      try { const picture = new URL(identity.picture); if (picture.protocol === 'https:' && (picture.hostname === 'media.licdn.com' || picture.hostname.endsWith('.licdn.com'))) avatarUrl = picture.toString(); } catch { /* optional avatar */ }
    }
    return { accessToken: token.access_token, scopes, expiresAt: new Date(Date.now() + Number(token.expires_in) * 1000), subject: identity.sub, authorUrn: `urn:li:person:${identity.sub}`, displayName: typeof identity.name === 'string' ? identity.name.trim().slice(0,160) : 'LinkedIn member', avatarUrl };
  }

  async initializeImage(token: string, author: string) {
    await this.guard(author, 'imageInitialize');
    const response = await this.send('https://api.linkedin.com/rest/images?action=initializeUpload', { method: 'POST', headers: this.headers(token), body: JSON.stringify({ initializeUploadRequest: { owner: author } }) });
    const body = await response.json() as { value?: { uploadUrl?: string; uploadUrlExpiresAt?: number; image?: string } };
    const value = body.value;
    if (!value?.uploadUrl || !value.image || !/^urn:li:image:[a-zA-Z0-9_-]+$/.test(value.image) || !Number.isFinite(value.uploadUrlExpiresAt) || value.uploadUrlExpiresAt! <= Date.now() + 20_000) throw new LinkedInFailure('INVALID_UPLOAD_RESPONSE', 'LinkedIn returned an invalid or expired poster upload.');
    try { validateLinkedInUploadUrl(value.uploadUrl); } catch { throw new LinkedInFailure('UNTRUSTED_UPLOAD', 'LinkedIn returned an untrusted poster destination.'); }
    return { imageUrn: value.image, uploadUrl: value.uploadUrl, expiresAt: value.uploadUrlExpiresAt! };
  }
  async uploadImage(token: string, author: string, uploadUrl: string, bytes: Buffer, expiresAt: number) {
    if (expiresAt <= Date.now() + 20_000) throw new LinkedInFailure('UPLOAD_EXPIRED', 'The poster upload expired.', { retryable: true });
    let url: URL;
    try {
      url = validateLinkedInUploadUrl(uploadUrl);
      const addresses = await lookup(url.hostname, { all: true });
      if (!addresses.length || addresses.some(value => !publicIp(value.address))) throw new Error('Non-public destination');
    } catch { throw new LinkedInFailure('UNTRUSTED_UPLOAD', 'The poster destination could not be verified.'); }
    await this.guard(author, 'imageUpload');
    await this.send(url.toString(), { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/png' }, body: new Uint8Array(bytes) });
  }
  async imageReady(token: string, author: string, imageUrn: string): Promise<'available' | 'processing' | 'unreadable'> {
    await this.guard(author, 'imageRead');
    try {
      const response = await this.send(`https://api.linkedin.com/rest/images/${encodeURIComponent(imageUrn)}`, { headers: this.headers(token) });
      const image = await response.json() as { status?: string };
      if (image.status === 'PROCESSING_FAILED') throw new LinkedInFailure('IMAGE_REJECTED', 'LinkedIn could not process the poster.');
      return image.status === 'AVAILABLE' ? 'available' : 'processing';
    } catch (error) {
      // w_member_social is write-only on the versioned images gateway.
      if (error instanceof LinkedInFailure && error.options.status === 403) return 'unreadable';
      throw error;
    }
  }
  async publish(token: string, author: string, caption: string, imageUrn: string, altText: string) {
    await this.guard(author, 'posts');
    const response = await this.send('https://api.linkedin.com/rest/posts', {
      method: 'POST', headers: this.headers(token), body: JSON.stringify({ author, commentary: caption, visibility: 'PUBLIC', distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] }, content: { media: { id: imageUrn, altText: altText.slice(0,120) } }, lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false }),
    }, true);
    const urn = response.headers.get('x-restli-id');
    if (response.status !== 201 || !urn || !validPostUrn(urn)) throw new LinkedInFailure('PUBLISH_RESULT_UNKNOWN', 'LinkedIn accepted the request but did not return a verifiable post identifier. Check your feed.', { ambiguous: true });
    return urn;
  }
}
