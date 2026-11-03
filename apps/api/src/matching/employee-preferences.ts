import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { EmployeeOccupationIndex, intentRoleInclude } from './employee-occupation';
import { canonicalRoleNames } from '../common/title-resolve';
type Db = Pick<Prisma.TransactionClient, 'jobTitle'>;
export const desiredRolesInclude = { include: { jobTitle: { include: { family: true } } } } as const;
export async function employeePreferenceUpdate(db: Db, input: {
    desiredJobTitleIds?: string[];
    desiredPositions?: string[];
    desiredPosition?: string;
}) {
    if (input.desiredJobTitleIds === undefined && input.desiredPositions === undefined && input.desiredPosition === undefined)
        return {};
    const rows = await db.jobTitle.findMany({ include: intentRoleInclude });
    const index = new EmployeeOccupationIndex(rows);
    const strict = input.desiredJobTitleIds !== undefined;
    const texts = input.desiredPositions ?? (input.desiredPosition ? [input.desiredPosition] : []);
    const resolved = strict ? input.desiredJobTitleIds! : texts.map(text => index.resolve(text));
    const ids = [...new Set(resolved.filter((id): id is string => Boolean(id)))];
    if (ids.length > 10 || strict && input.desiredJobTitleIds!.some(id => !index.identity(id)))
        throw new BadRequestException('Select reviewed positions from the catalog');
    const canonical = [...new Set(ids.map(id => index.identity(id)?.canonicalRoleId).filter((id): id is string => Boolean(id)))];
    const reviewed = resolved.length > 0 && resolved.every(id => id && index.identity(id));
    const names = strict || reviewed ? canonical.map(id => index.roles.get(id)!.name) : await canonicalRoleNames(db, texts);
    return { matchingPreferencesReviewed: Boolean(reviewed), desiredPositions: names, desiredPosition: names[0] ?? null,
        desiredRoles: { deleteMany: {}, create: canonical.map(jobTitleId => ({ jobTitle: { connect: { id: jobTitleId } } })) } };
}
