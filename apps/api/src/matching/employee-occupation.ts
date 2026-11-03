import { catalogTitleIdentityKey } from '../common/title-resolve';
import { createHash } from 'node:crypto';
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
    matchingMetadata?: unknown;
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
export const intentRoleInclude = { family: true, aliases: { select: { alias: true, aliasKey:true, matchingApproved: true } } } as const;
/** Semantic catalog identity is independent of DB row timestamps and ordering. */
export function employeeOccupationRevision(roles: IntentRole[]) {
 const rows=[...roles].sort((a,b)=>a.id.localeCompare(b.id)).map(r=>[r.id,r.name,r.nameId||null,r.nameUz||null,r.nameRu||null,r.familyId,r.canonicalRoleId,r.matchingApproved,!!r.archivedAt,!!r.family?.archivedAt,
   r.aliases.filter(a=>a.matchingApproved).map(a=>catalogTitleIdentityKey(a.alias)).sort()]);
 return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
/** Relation edits invalidate ranking, never the CV identity/parser revision. */
export function employeeRecommendationRevision(roles: IntentRole[]) {
 return createHash('sha256').update(JSON.stringify([employeeOccupationRevision(roles),
  [...roles].sort((a,b)=>a.id.localeCompare(b.id)).map(r=>[r.id, reviewedRelatedRoles(r).sort((a,b)=>a.id.localeCompare(b.id))])])).digest('hex');
}
export function reviewedRelatedRoles(role: IntentRole) {
 const metadata=role.matchingMetadata as {relatedRoles?:Array<{id:string;kind:string;reference:string;approved:boolean;score?:number}>}|null;
 return (Array.isArray(metadata?.relatedRoles)?metadata.relatedRoles:[]).filter(r=>r && r.kind==='RELATED' && r.approved===true && typeof r.id==='string' && typeof r.reference==='string' && r.reference.trim().length>=3);
}
export const currentRoleSelect = {
  id:true,familyId:true,canonicalRoleId:true,matchingApproved:true,archivedAt:true,family:{select:{archivedAt:true}},
  canonicalRole:{select:{id:true,familyId:true,canonicalRoleId:true,matchingApproved:true,archivedAt:true,family:{select:{archivedAt:true}}}},
} as const;
export function currentRoleIdentity(role: {id:string;familyId:string|null;canonicalRoleId:string|null;matchingApproved:boolean;archivedAt:Date|null;family:{archivedAt:Date|null}|null;canonicalRole?:{id:string;familyId:string|null;canonicalRoleId:string|null;matchingApproved:boolean;archivedAt:Date|null;family:{archivedAt:Date|null}|null}|null}|null) {
  if(!role||!role.matchingApproved||role.archivedAt||!role.familyId||!role.family||role.family.archivedAt)return null;
  const root=role.canonicalRoleId?role.canonicalRole:role;
  if(!root||!root.matchingApproved||root.archivedAt||root.canonicalRoleId||root.familyId!==role.familyId||!root.family||root.family.archivedAt)return null;
  return {canonicalRoleId:root.id,familyId:role.familyId};
}
/** Strict identities for employee intent. Never infer equivalence from shared skills or ISCO. */
export class EmployeeOccupationIndex {
    readonly roles: Map<string, IntentRole>;
    private labels = new Map<string, Set<string>>();
    constructor(roles: IntentRole[], readonly allowRelated = false) {
        this.roles = new Map(roles.map(role => [role.id, role]));
        for (const role of roles) {
            if (role.archivedAt) continue;
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
        const choices = [...new Set(selectedIds)].sort().map(id => this.identity(id)).filter((id): id is NonNullable<typeof id> => Boolean(id));
        const exact = choices.find(choice=>choice.canonicalRoleId===job.canonicalRoleId && choice.familyId===job.familyId);
        if(exact)return {eligible:true,reason:'MATCH',...job,matchType:'EXACT',selectedRoleId:exact.canonicalRoleId,selectedRoleName:this.roles.get(exact.canonicalRoleId)!.name};
        const relatedMatches:EmployeeEligibility[]=[];
        if(this.allowRelated)for(const choice of choices){
          const source=this.roles.get(choice.canonicalRoleId)!;
          const relation=reviewedRelatedRoles(source).find(r=>r.id===job.canonicalRoleId && r.id!==source.id && this.identity(r.id)?.canonicalRoleId===r.id);
          if(relation)relatedMatches.push({eligible:true,reason:'MATCH',...job,matchType:'RELATED',selectedRoleId:source.id,selectedRoleName:source.name,relationReference:relation.reference,relationScore:relation.score});
        }
        if(relatedMatches.length)return relatedMatches.sort((a,b)=>(b.relationScore||0)-(a.relationScore||0)||a.selectedRoleId!.localeCompare(b.selectedRoleId!))[0];
        if (!choices.some(choice => choice.canonicalRoleId === job.canonicalRoleId))
            return { eligible: false, reason: 'POSITION_MISMATCH', ...job };
        if (!choices.some(choice => choice.canonicalRoleId === job.canonicalRoleId && choice.familyId === job.familyId))
            return { eligible: false, reason: 'FAMILY_MISMATCH', ...job };
        return { eligible: true, reason: 'MATCH', ...job };
    }
}
