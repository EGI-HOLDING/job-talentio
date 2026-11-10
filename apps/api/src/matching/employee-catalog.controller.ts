import { BadRequestException, ConflictException, Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PositionCatalogService } from './position-catalog.service';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard, Roles, RolesGuard } from '../common/auth.decorators';
import { RawLocaleNames } from '../common/locale.interceptor';
import { parseDto } from '../common/utils';
import { catalogTitleIdentityKey } from '../common/title-resolve';
import { intentRoleInclude } from './employee-occupation';
// Compatibility for older tabs. Ranking and labels come from the same catalog as the new picker.
@Controller('meta/employee-positions')
@RawLocaleNames()
export class EmployeePositionController {
    constructor(private catalog: PositionCatalogService) {}

    @Get()
    async list(@Query() query: unknown) {
        const input = parseDto(z.object({
            q: z.string().max(160).default(''),
            page: z.coerce.number().int().min(1).max(100000).default(1),
            limit: z.coerce.number().int().min(1).max(100).default(100),
        }), query);
        const result = await this.catalog.search({ ...input, scope: 'role', reviewedOnly: true });
        return { ...result, items: result.items.map(row => ({
            ...row, canonicalRoleId: row.id, matchingEligible: row.selectable,
            family: row.family ? { name: row.family } : null,
        })) };
    }
}

const familySchema = z.object({ code: z.string().regex(/^\d{3}$/), name: z.string().min(1).max(160), nameId: z.string().max(160).nullable().optional(), nameUz: z.string().max(160).nullable().optional(), nameRu: z.string().max(160).nullable().optional(), source: z.string().min(1).max(500), sourceVersion: z.string().min(1).max(100) }).strict();
const identitySchema = z.object({ familyId: z.string().min(1), canonicalRoleId: z.string().min(1).nullable(), approved: z.boolean(), approvedAliasIds: z.array(z.string()).max(200) }).strict();
@Controller('admin/employee-matching')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
@RawLocaleNames()
export class EmployeeCatalogController {
    constructor(private db: PrismaService) { }
    @Get('families')
    families() { return this.db.jobFamily.findMany({ orderBy: { code: 'asc' } }); }
    @Post('families')
    family(
    @Body()
    body: unknown) { const data = parseDto(familySchema, body); return this.db.jobFamily.upsert({ where: { code: data.code }, create: { ...data, id: 'isco:' + data.code }, update: { ...data, revision: { increment: 1 } } }); }
    @Get('roles/:id')
    async role(
    @Param('id')
    id: string) { const role = await this.db.jobTitle.findUniqueOrThrow({ where: { id }, include: { family: true, aliases: true } }); return { id: role.id, familyId: role.familyId, canonicalRoleId: role.canonicalRoleId, approved: role.matchingApproved, approvedAliasIds: role.aliases.filter(a => a.matchingApproved).map(a => a.id), aliases: role.aliases }; }
    @Patch('roles/:id')
    async update(
    @Param('id')
    id: string, 
    @Body()
    body: unknown) {
        const data = parseDto(identitySchema, body);
        return this.db.$transaction(async (tx) => {
            // Serialize graph/alias edits; a concurrent pair of edits cannot create a cycle.
            await tx.$executeRaw(Prisma.sql `SELECT pg_advisory_xact_lock(742159744)`);
            const role = await tx.jobTitle.findUniqueOrThrow({ where: { id }, include: { aliases: true } });
            if (role.archivedAt || !await tx.jobFamily.findFirst({ where: { id: data.familyId, archivedAt: null } }))
                throw new BadRequestException('Active role and family required');
            if (data.canonicalRoleId) {
                const root = await tx.jobTitle.findUnique({ where: { id: data.canonicalRoleId } });
                if (!root || root.id === id || root.archivedAt || root.canonicalRoleId || !root.matchingApproved || root.familyId !== data.familyId || await tx.jobTitle.count({ where: { canonicalRoleId: id } }))
                    throw new BadRequestException('Canonical role must be an approved root in the same family; chains and cycles are forbidden');
            }
            const children = await tx.jobTitle.count({ where: { canonicalRoleId: id } });
            if (children && (role.familyId !== data.familyId || !data.approved))
                throw new BadRequestException('Review equivalent roles before changing this root');
            if (data.approvedAliasIds.some(aliasId => !role.aliases.some(a => a.id === aliasId)))
                throw new BadRequestException('Alias does not belong to this role');
            const rows = await tx.jobTitle.findMany({ include: intentRoleInclude });
            const rootId = data.canonicalRoleId ?? id;
            const labels = [role.name, role.nameId, role.nameUz, role.nameRu, ...role.aliases.filter(a => data.approvedAliasIds.includes(a.id)).map(a => a.alias)].filter((s): s is string => Boolean(s)).map(catalogTitleIdentityKey);
            if (data.approved)
                for (const other of rows) {
                    if (other.id === id || (other.canonicalRoleId ?? other.id) === rootId)
                        continue;
                    const otherLabels = [other.name, other.nameId, other.nameUz, other.nameRu, ...other.aliases.filter(a => a.matchingApproved).map(a => a.alias)].filter((s): s is string => Boolean(s));
                    if (otherLabels.some(s => labels.includes(catalogTitleIdentityKey(s))))
                        throw new BadRequestException('Occupation label conflicts with another identity; review equivalence first');
                }
            await tx.jobTitleAlias.updateMany({ where: { jobTitleId: id }, data: { matchingApproved: false } });
            for (const aliasId of data.approvedAliasIds) {
                const alias = role.aliases.find(a => a.id === aliasId)!;
                const changed = await tx.jobTitleAlias.updateMany({ where: { id: aliasId, jobTitleId: id, alias: alias.alias, aliasKey: alias.aliasKey }, data: { matchingApproved: true } });
                if (!changed.count)
                    throw new ConflictException('Alias changed; reload the catalog before approval');
            }
            const changed = await tx.jobTitle.updateMany({ where: { id, name: role.name, nameId: role.nameId, nameUz: role.nameUz, nameRu: role.nameRu, archivedAt: null }, data: { familyId: data.familyId, canonicalRoleId: data.canonicalRoleId, matchingApproved: data.approved } });
            if (!changed.count)
                throw new ConflictException('Position labels changed; reload before approval');
            return { ok: true };
        });
    }
    @Patch('skills/:id')
    skill(
    @Param('id')
    id: string, 
    @Body()
    body: unknown) { const { matchingKind } = parseDto(z.object({ matchingKind: z.enum(['PROFESSIONAL', 'GENERAL', 'UNREVIEWED']) }).strict(), body); return this.db.skill.update({ where: { id }, data: { matchingKind }, select: { id: true, matchingKind: true } }); }
}
