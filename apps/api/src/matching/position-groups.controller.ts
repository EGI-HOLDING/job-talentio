import {Body,Controller,Get,Param,Post,Patch,Query,UseGuards,BadRequestException} from '@nestjs/common';
import {z} from 'zod';
import {CurrentUser,JwtAuthGuard,Roles,RolesGuard,type AuthUser} from '../common/auth.decorators';
import {RawLocaleNames} from '../common/locale.interceptor';
import {parseDto} from '../common/utils';
import {PrismaService} from '../prisma/prisma.service';
import {EmployeeCatalogSnapshot} from './employee-catalog-snapshot';
import {PositionGroupService} from './position-group.service';
import { PositionCatalogService } from './position-catalog.service';
import {catalogTitleIdentityKey} from '../common/title-resolve';
import {intentRoleInclude} from './employee-occupation';
import {positionRoleRevision} from './position-groups';

const querySchema=z.object({q:z.string().max(160).default(''),page:z.coerce.number().int().min(1).max(100000).default(1),limit:z.coerce.number().int().min(1).max(100).default(30)});
@Controller('meta/position-groups')
@RawLocaleNames()
export class PositionGroupsController {
  constructor(private service:PositionGroupService,private catalog:EmployeeCatalogSnapshot, private positions: PositionCatalogService){}
  @Get()async list(@Query()input:unknown){const q=parseDto(querySchema,input);const catalog=await this.catalog.get();const snapshot=await this.service.snapshot(catalog.roles);const items=(snapshot?.groups??[]).filter(g=>!q.q||[g.nameEn,g.definition].some(label=>catalogTitleIdentityKey(label).includes(catalogTitleIdentityKey(q.q))));return {items:items.slice((q.page-1)*q.limit,q.page*q.limit).map(g=>({id:g.id,kind:'GROUP',name:g.nameEn,definition:g.definition,memberCount:snapshot!.choices.find(c=>c.id===g.id)?.members.length??0})),total:items.length,page:q.page,totalPages:Math.max(1,Math.ceil(items.length/q.limit)),groupReleaseVersion:snapshot?.releaseId??null};}
  // Compatibility for tabs opened before the unified catalog release.
  @Get('options')
  options(@Query() input: unknown) {
    return this.positions.search({ ...parseDto(querySchema, input), scope: 'candidate', reviewedOnly: true });
  }

  @Get(':id/members')
  members(@Param('id') groupId: string, @Query() input: unknown) {
    return this.positions.search({ ...parseDto(querySchema, input), scope: 'role', groupId });
  }
}

@Controller('admin/position-groups')
@UseGuards(JwtAuthGuard,RolesGuard)
@Roles('SUPER_ADMIN')
@RawLocaleNames()
export class PositionGroupsAdminController {
  constructor(private service:PositionGroupService,private db:PrismaService){}
  @Get()async status(){return {state:await this.db.positionGroupState.findUnique({where:{id:'indonesia'}}),releases:await this.db.positionGroupRelease.findMany({orderBy:{createdAt:'desc'},take:10})};}
  @Post('build')async build(@Body()input:unknown){const q=parseDto(z.object({dryRun:z.boolean().default(true),expectedReleaseId:z.string().max(100).optional()}).strict(),input);if(!q.dryRun&&!q.expectedReleaseId)throw new BadRequestException('Stage requires the release ID from a dry run');const result=await this.service.build(q.dryRun,q.expectedReleaseId);return {id:result.id,summary:result.summary};}
  @Patch('labels/:roleId')async label(@Param('roleId')jobTitleId:string,@Body()input:unknown,@CurrentUser()user:AuthUser){const q=parseDto(z.object({nameEn:z.string().trim().min(1).max(160),reason:z.string().trim().min(5).max(1000),source:z.record(z.unknown())}).strict(),input);const role=await this.db.jobTitle.findUnique({where:{id:jobTitleId}});if(!role||role.archivedAt||role.canonicalRoleId)throw new BadRequestException('Select an active canonical role');const correction=await this.db.positionGroupCorrection.create({data:{groupId:'label:en',jobTitleId,enabled:true,reason:q.reason,source:{...q.source,nameEn:q.nameEn} as never,actorId:user.id}});return {correction,state:'PENDING_RELEASE'};}
  @Post(':id/activate')activate(@Param('id')id:string,@Body()input:unknown,@CurrentUser()user:AuthUser){const q=parseDto(z.object({expectedRevision:z.number().int().nonnegative()}).strict(),input);return this.service.activate(id,q.expectedRevision,user.id);}
  @Post(':id/rollback')rollback(@Param('id')id:string,@Body()input:unknown,@CurrentUser()user:AuthUser){const q=parseDto(z.object({expectedRevision:z.number().int().nonnegative()}).strict(),input);return this.service.rollback(id,q.expectedRevision,user.id);}
  @Patch(':groupId/:roleId')
  async correct(@Param('groupId')groupId:string,@Param('roleId')jobTitleId:string,@Body()input:unknown,@CurrentUser()user:AuthUser){
    const q=parseDto(z.object({enabled:z.boolean(),reason:z.string().trim().min(5).max(1000),source:z.record(z.unknown())}).strict(),input);
    const [group,role]=await Promise.all([
      this.db.positionGroup.findUnique({where:{id:groupId}}),
      this.db.jobTitle.findUnique({where:{id:jobTitleId},include:intentRoleInclude}),
    ]);
    if(!group||group.archivedAt||!role||role.archivedAt||role.canonicalRoleId)throw new BadRequestException('Select an active group and canonical role');
    const proof=z.object({workScope:z.string().trim().min(12).max(4000),reference:z.string().trim().min(5).max(1000)});
    const source=q.enabled?{...q.source,...parseDto(proof,q.source),roleRevision:positionRoleRevision(role)}:q.source;
    return this.db.positionGroupCorrection.create({data:{groupId,jobTitleId,enabled:q.enabled,reason:q.reason,source:source as never,actorId:user.id}});
  }
}
