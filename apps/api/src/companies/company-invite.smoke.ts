import {
  companyInviteSchema,
  googleOAuthSchema,
  registerSchema,
} from '@job-talentio/shared';
import { sha256 } from '../common/dedupe';

const token = 'a'.repeat(64);

const join = registerSchema.safeParse({
  email: 'teammate@co.uz',
  password: 'Password123!',
  fullName: 'New Recruiter',
  role: 'RECRUITER',
  acceptTerms: true,
  inviteToken: token,
});
if (!join.success) {
  throw new Error('recruiter register with inviteToken must not require companyName');
}

const ownerMissingCompany = registerSchema.safeParse({
  email: 'owner@co.uz',
  password: 'Password123!',
  fullName: 'Owner',
  role: 'RECRUITER',
  acceptTerms: true,
});
if (ownerMissingCompany.success) {
  throw new Error('recruiter register without companyName or inviteToken must fail');
}

const owner = registerSchema.safeParse({
  email: 'owner@co.uz',
  password: 'Password123!',
  fullName: 'Owner',
  role: 'RECRUITER',
  acceptTerms: true,
  companyName: 'Apex Soft',
});
if (!owner.success) throw new Error('owner register with companyName must pass');

const googleJoin = googleOAuthSchema.safeParse({
  idToken: 'g'.repeat(40),
  inviteToken: token,
});
if (!googleJoin.success) {
  throw new Error('google OAuth with inviteToken must not require companyName');
}

const invite = companyInviteSchema.parse({ email: 'teammate@co.uz' });
if (invite.role !== 'RECRUITER') throw new Error('invite role must default to RECRUITER');

const adminInvite = companyInviteSchema.parse({ email: 'lead@co.uz', role: 'ADMIN' });
if (adminInvite.role !== 'ADMIN') throw new Error('invite must accept ADMIN');

const ownerInvite = companyInviteSchema.safeParse({ email: 'x@co.uz', role: 'OWNER' });
if (ownerInvite.success) throw new Error('invite must reject OWNER');

if (sha256('invite-a') === sha256('invite-b')) {
  throw new Error('invite token hashes must differ');
}

console.log('company-invite schema smoke ok');
