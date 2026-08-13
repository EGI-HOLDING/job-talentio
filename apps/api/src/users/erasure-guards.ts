export const ANONYMIZED_DISPLAY_NAME = 'Deleted user';

export type OpenOwnedCompany = {
  companyId: string;
  companyName: string;
  memberCount: number;
};

export function eraseBlockedByOpenCompany(owned: OpenOwnedCompany | null) {
  if (!owned) return null;
  return {
    message:
      owned.memberCount > 1
        ? 'Transfer ownership before deleting this account'
        : 'Close this company before deleting this account',
    companyId: owned.companyId,
    companyName: owned.companyName,
    memberCount: owned.memberCount,
  };
}

export function closeCompanyBlocked(input: {
  alreadyClosed: boolean;
  memberCount: number;
  typedName: string;
  companyName: string;
}): string | null {
  if (input.alreadyClosed) return 'Company already closed';
  if (input.memberCount > 1) {
    return 'Transfer ownership or remove other members before closing this company';
  }
  if (input.typedName.trim().toLowerCase() !== input.companyName.trim().toLowerCase()) {
    return 'Type the company name to confirm';
  }
  return null;
}

export function transferOwnershipBlocked(input: {
  actorId: string;
  targetUserId: string;
  targetIsMember: boolean;
}): string | null {
  if (input.actorId === input.targetUserId) return 'Cannot transfer ownership to yourself';
  if (!input.targetIsMember) return 'User is not a member of this company';
  return null;
}

export function confirmationMatchesAccount(input: {
  confirmation: string;
  email: string | null;
  fullName: string;
}): boolean {
  const typed = input.confirmation.trim().toLowerCase();
  if (!typed) return false;
  if (input.email) return typed === input.email.trim().toLowerCase();
  return typed === input.fullName.trim().toLowerCase();
}
