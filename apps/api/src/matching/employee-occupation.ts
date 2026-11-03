import { catalogTitleIdentityKey } from '../common/title-resolve';
import type { EmployeeEligibility } from '@job-talentio/shared';
export type IntentRole = {
    id: string;
    name: string;
    nameId?: string | null;
    nameUz?: string | null;
    nameRu?: string | null;
    familyId: string | null;
    canonicalRoleId: string | null;
    matchingApproved: boolean;
    archivedAt?: Date | null;
    family?: {
        id: string;
        name: string;
        nameId?: string | null;
        archivedAt: Date | null;
    } | null;
    aliases: Array<{
        alias: string;
        matchingApproved: boolean;
    }>;
};
export const intentRoleInclude = { family: true, aliases: { select: { alias: true, matchingApproved: true } } } as const;
/** Strict identities for employee intent. Never infer equivalence from shared skills or ISCO. */
export class EmployeeOccupationIndex {
    readonly roles: Map<string, IntentRole>;
    private labels = new Map<string, Set<string>>();
    constructor(roles: IntentRole[]) {
        this.roles = new Map(roles.map(role => [role.id, role]));
        for (const role of roles) {
            for (const label of [role.name, role.nameId, role.nameUz, role.nameRu, ...role.aliases.filter(a => a.matchingApproved).map(a => a.alias)]) {
                if (!label)
                    continue;
                const key = catalogTitleIdentityKey(label);
                const ids = this.labels.get(key) ?? new Set<string>();
                ids.add(role.id);
                this.labels.set(key, ids);
            }
        }
    }
    identity(id: string): {
        canonicalRoleId: string;
        familyId: string;
    } | null {
        const role = this.roles.get(id);
        if (!role || role.archivedAt || !role.matchingApproved || !role.familyId || !role.family || role.family.archivedAt)
            return null;
        const root = role.canonicalRoleId ? this.roles.get(role.canonicalRoleId) : role;
        if (!root || root.archivedAt || !root.matchingApproved || root.canonicalRoleId || root.familyId !== role.familyId || !root.family || root.family.archivedAt)
            return null;
        return { canonicalRoleId: root.id, familyId: role.familyId };
    }
    resolve(text: string): string | null {
        const ids = this.labels.get(catalogTitleIdentityKey(text));
        if (!ids?.size)
            return null;
        const identities = [...ids].map(id => this.identity(id));
        // An unresolved collision must not become an arbitrary approved identity.
        if (identities.some(i => !i))
            return null;
        const keys = new Set(identities.map(i => `${i!.familyId}:${i!.canonicalRoleId}`));
        return keys.size === 1 ? identities[0]!.canonicalRoleId : null;
    }
    resolveEvidence(text: string): string | null {
        const exact = this.resolve(text);
        if (exact)
            return exact;
        // Preserve occupation words such as Staff, Lead, Manager and Principal.
        const withoutLevel = text.replace(/\b(?:junior|senior|jr\.?|sr\.?|mid[- ]level)\b/giu, ' ').replace(/\s+/g, ' ').trim();
        const resolved = this.resolve(withoutLevel);
        if (resolved)
            return resolved;
        const part = withoutLevel.split(/\s+(?:at|di|@|—|–)\s+/iu)[0];
        return part !== withoutLevel ? this.resolve(part) : null;
    }
    eligibility(selectedIds: string[], jobTitleId: string | null | undefined): EmployeeEligibility {
        const job = jobTitleId ? this.identity(jobTitleId) : null;
        if (!job)
            return { eligible: false, reason: 'UNREVIEWED_ROLE' };
        const choices = selectedIds.map(id => this.identity(id)).filter((id): id is NonNullable<typeof id> => Boolean(id));
        if (!choices.some(choice => choice.canonicalRoleId === job.canonicalRoleId))
            return { eligible: false, reason: 'POSITION_MISMATCH', ...job };
        if (!choices.some(choice => choice.canonicalRoleId === job.canonicalRoleId && choice.familyId === job.familyId))
            return { eligible: false, reason: 'FAMILY_MISMATCH', ...job };
        return { eligible: true, reason: 'MATCH', ...job };
    }
}
