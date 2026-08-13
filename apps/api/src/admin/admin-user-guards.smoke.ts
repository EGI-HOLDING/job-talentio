import { accessTokenIsCurrent } from '../auth/access-token';
import { supportTargetError } from './admin-user-guards';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function supportTargetRefusesSelfAndAdmins() {
  assert(
    supportTargetError('me', { id: 'me', role: 'EMPLOYEE' }) === 'Cannot do this to your own account',
    'self must be refused',
  );
  assert(
    supportTargetError('me', { id: 'peer', role: 'SUPER_ADMIN' }) ===
      'Cannot do this to a super admin',
    'peer super admin must be refused',
  );
  assert(supportTargetError('me', { id: 'seeker', role: 'EMPLOYEE' }) === null, 'employee is allowed');
  assert(
    supportTargetError('me', { id: 'hire', role: 'RECRUITER' }) === null,
    'recruiter is allowed',
  );
}

function staleAccessTokenIsRejected() {
  assert(accessTokenIsCurrent(undefined, 0), 'legacy JWTs without tv stay valid at version 0');
  assert(!accessTokenIsCurrent(undefined, 1), 'legacy JWT must die after a version bump');
  assert(accessTokenIsCurrent(1, 1), 'matching tv is current');
  assert(!accessTokenIsCurrent(0, 1), 'old tv is stale');
}

supportTargetRefusesSelfAndAdmins();
staleAccessTokenIsRejected();
console.log('api: admin-user-guards smoke ok');
