import {
  closeCompanyBlocked,
  confirmationMatchesAccount,
  eraseBlockedByOpenCompany,
  transferOwnershipBlocked,
} from './erasure-guards';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function ownerOfOpenCompanyCannotErase() {
  const sole = eraseBlockedByOpenCompany({
    companyId: 'co1',
    companyName: 'Acme',
    memberCount: 1,
  });
  assert(sole?.message.includes('Close this company'), 'sole owner must close first');
  const team = eraseBlockedByOpenCompany({
    companyId: 'co1',
    companyName: 'Acme',
    memberCount: 3,
  });
  assert(team?.message.includes('Transfer ownership'), 'team owner must transfer first');
  assert(eraseBlockedByOpenCompany(null) === null, 'no open company is allowed');
}

function soleOwnerCanCloseAfterTypingName() {
  assert(
    closeCompanyBlocked({
      alreadyClosed: false,
      memberCount: 1,
      typedName: 'acme',
      companyName: 'Acme',
    }) === null,
    'matching name on a sole-owner company is allowed',
  );
  assert(
    closeCompanyBlocked({
      alreadyClosed: true,
      memberCount: 1,
      typedName: 'Acme',
      companyName: 'Acme',
    }) === 'Company already closed',
    'already closed is refused',
  );
  assert(
    Boolean(
      closeCompanyBlocked({
        alreadyClosed: false,
        memberCount: 2,
        typedName: 'Acme',
        companyName: 'Acme',
      }),
    ),
    'extra members block close',
  );
  assert(
    closeCompanyBlocked({
      alreadyClosed: false,
      memberCount: 1,
      typedName: 'wrong',
      companyName: 'Acme',
    }) === 'Type the company name to confirm',
    'name mismatch is refused',
  );
}

function transferPromotesAnotherMember() {
  assert(
    transferOwnershipBlocked({ actorId: 'a', targetUserId: 'a', targetIsMember: true }) ===
      'Cannot transfer ownership to yourself',
    'self transfer is refused',
  );
  assert(
    transferOwnershipBlocked({ actorId: 'a', targetUserId: 'b', targetIsMember: false }) ===
      'User is not a member of this company',
    'non-member is refused',
  );
  assert(
    transferOwnershipBlocked({ actorId: 'a', targetUserId: 'b', targetIsMember: true }) === null,
    'member transfer is allowed',
  );
}

function confirmationUsesEmailOrName() {
  assert(
    confirmationMatchesAccount({
      confirmation: 'Ada@Co.uz',
      email: 'ada@co.uz',
      fullName: 'Ada',
    }),
    'email match is case-insensitive',
  );
  assert(
    !confirmationMatchesAccount({
      confirmation: 'Ada',
      email: 'ada@co.uz',
      fullName: 'Ada',
    }),
    'name is not enough when email exists',
  );
  assert(
    confirmationMatchesAccount({
      confirmation: 'Ada Lovelace',
      email: null,
      fullName: 'Ada Lovelace',
    }),
    'passwordless without email confirms the name',
  );
}

ownerOfOpenCompanyCannotErase();
soleOwnerCanCloseAfterTypingName();
transferPromotesAnotherMember();
confirmationUsesEmailOrName();
console.log('api: erasure-guards smoke ok');
