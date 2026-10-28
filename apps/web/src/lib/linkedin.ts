import { api, ApiError } from './api';

export type LinkedInConnection = {
  enabled:boolean;sharingEnabled:boolean;unavailableReason:string|null;connected:boolean;
  status:'CONNECTED'|'EXPIRING'|'EXPIRED'|'REVOKED'|'DISCONNECTED';displayName:string|null;avatarUrl:string|null;
  expiresAt:string|null;autoShareEnabled:boolean;
};
export type LinkedInPreview = { id:string;caption:string;jobUrl:string;fingerprint:string;posterDataUrl:string;expiresAt:string;isAnonymous:boolean;displayName:string|null };
export type LinkedInPost = { id:string;jobId:string;status:'PENDING'|'RENDERING'|'UPLOADING'|'PUBLISHING'|'PUBLISHED'|'FAILED'|'UNKNOWN'|'CANCELLED';attempts:number;retrySafe:boolean;errorCode:string|null;errorSummary:string|null;nextAttemptAt:string;providerPostUrn:string|null;publishedAt:string|null;reconciledAt:string|null;reviewAfter:string|null;createdAt:string;updatedAt:string };
export const activeLinkedInPost = (post:LinkedInPost) => ['PENDING','RENDERING','UPLOADING','PUBLISHING'].includes(post.status);
export function linkedInActionError(error:unknown,t:(key:string)=>string) {
  if(error instanceof ApiError && error.status===409)return t('li.previewChanged');
  if(error instanceof ApiError && error.status===403)return t('li.accessLost');
  if(error instanceof ApiError && error.status===429)return t('li.waitRetry');
  if(error instanceof ApiError && error.status===503)return t('li.serviceUnavailable');
  return t('li.actionFailed');
}
export async function connectLinkedIn(returnTo:string) {
  const result=await api<{authorizationUrl:string}>('/integrations/linkedin/connect',{method:'POST',credentials:'include',body:JSON.stringify({returnTo})});
  const url=new URL(result.authorizationUrl);
  if(url.origin!=='https://www.linkedin.com' || url.pathname!=='/oauth/v2/authorization')throw new Error('Invalid authorization destination');
  window.location.assign(url.toString());
}
