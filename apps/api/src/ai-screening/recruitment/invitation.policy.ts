import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
export const INVITATION_TTL_MS=7*24*60*60*1000;
export const invitationCreateSchema=z.object({mode:z.enum(['TEXT','VOICE']),requestKey:z.string().min(10).max(100),email:z.string().email().max(254).optional()}).strict();
export function invitationNonce(){return randomBytes(24).toString('base64url');}
export function invitationToken(id:string,nonce:string,secret:string){
 if(secret.length<32)throw Error('INVITATION_SIGNING_KEY_NOT_CONFIGURED');
 return id+'.'+createHmac('sha256',secret).update('talentio-screening-v1:'+id+':'+nonce).digest('base64url');
}
export const tokenHash=(token:string)=>createHash('sha256').update(token).digest('hex');
export function validInvitationToken(token:string,expectedHash:string){const actual=tokenHash(token);return actual.length===expectedHash.length&&timingSafeEqual(Buffer.from(actual),Buffer.from(expectedHash));}
export const invitationId=(token:string)=>/^[a-zA-Z0-9_-]{10,80}\.[a-zA-Z0-9_-]{43}$/.test(token)?token.split('.')[0]:null;
