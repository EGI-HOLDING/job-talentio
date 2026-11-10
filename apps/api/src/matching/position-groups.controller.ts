import {Body,Controller,Get,Param,Post,Patch,Query,UseGuards,BadRequestException} from '@nestjs/common';
import {z} from 'zod';
import {CurrentUser,JwtAuthGuard,Roles,RolesGuard,type AuthUser} from '../common/auth.decorators';
import {RawLocaleNames} from '../common/locale.interceptor';
import {parseDto} from '../common/utils';
import {PrismaService} from '../prisma/prisma.service';
import {EmployeeCatalogSnapshot} from './employee-catalog-snapshot';
import {PositionGroupService} from './position-group.service';
import {positionSuggestionScore} from './employee-position-suggestions';
import {catalogTitleIdentityKey} from '../common/title-resolve';

const querySchema=z.object({q:z.string().max(160).default(''),page:z.coerce.number().int().min(1).max(100000).default(1),limit:z.coerce.number().int().min(1).max(100).default(30)});
@Controller('meta/position-groups')
@RawLocaleNames()
export class PositionGroupsController {
  constructor(private service:PositionGroupService,private catalog:EmployeeCatalogSnapshot){}
  @Get()async list(@Query()input:unknown){const q=parseDto(querySchema,input);const catalog=await this.catalog.get();const snapshot=await this.service.snapshot(catalog.roles);const items=(snapshot?.groups??[]).filter(g=>!q.q||[g.nameEn,g.definition].some(label=>catalogTitleIdentityKey(label).includes(catalogTitleIdentityKey(q.q))));return {items:items.slice((q.page-1)*q.limit,q.page*q.limit).map(g=>({id:g.id,kind:'GROUP',name:g.nameEn,definition:g.definition,memberCount:snapshot!.choices.find(c=>c.id===g.id)?.members.length??0})),total:items.length,page:q.page,totalPages:Math.max(1,Math.ceil(items.length/q.limit)),groupReleaseVersion:snapshot?.releaseId??null};}
  @Get('options')async options(@Query()input:unknown){
    const q=parseDto(querySchema,input),catalog=await this.catalog.get(),snapshot=await this.service.snapshot(catalog.roles);
    const needle=catalogTitleIdentityKey(q.q),seen=new Set<string>();
    const aliasesByCanonical=new Map<string,string[]>();
    for(const role of catalog.roles){const identity=catalog.index.identity(role.id);if(!identity)continue;const labels=aliasesByCanonical.get(identity.canonicalRoleId)??[];labels.push(...[role.name,role.nameId,role.nameUz,role.nameRu,...role.aliases.filter(a=>a.matchingApproved).map(a=>a.alias)].filter((s):s is string=>!!s));aliasesByCanonical.set(identity.canonicalRoleId,labels);}
    const entries:Array<{id:string;kind:'GROUP'|'ROLE';name:string;score:number;family?:unknown}>=[];
    for(const group of snapshot?.groups??[]){const head=group.sourceRoleId?catalog.index.roles.get(group.sourceRoleId):null;const source=group.source as {searchAliases?:string[]};const labels=[group.nameEn,...source.searchAliases??[],head?.nameId,...head?.aliases.filter(a=>a.matchingApproved).map(a=>a.alias)??[]].filter((s):s is string=>!!s);const score=Math.max(0,...labels.map(label=>positionSuggestionScore(needle,label)));if(score>0)entries.push({id:group.id,kind:'GROUP',name:group.nameEn,score});}
    for(const role of catalog.roles){const identity=catalog.index.identity(role.id);if(!identity||seen.has(identity.canonicalRoleId))continue;seen.add(identity.canonicalRoleId);const root=catalog.index.roles.get(identity.canonicalRoleId)!;const name=snapshot?.labels.get(root.id)??root.name;
      const score=Math.max(0,...[name,...aliasesByCanonical.get(root.id)??[]].map(label=>positionSuggestionScore(needle,label)));
      if(score>0)entries.push({id:root.id,kind:'ROLE',name,score,family:root.family});
    }
    entries.sort((a,b)=>b.score-a.score||Number(a.kind==='ROLE')-Number(b.kind==='ROLE')||a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
    return {items:entries.slice((q.page-1)*q.limit,q.page*q.limit).map(({score,...row})=>row),total:entries.length,page:q.page,totalPages:Math.max(1,Math.ceil(entries.length/q.limit)),groupReleaseVersion:snapshot?.releaseId??null};
  }
  @Get(':id/members')async members(@Param('id')id:string,@Query()input:unknown){const q=parseDto(querySchema,input),catalog=await this.catalog.get(),snapshot=await this.service.snapshot(catalog.roles);const group=snapshot?.choices.find(g=>g.id===id);if(!group)throw new BadRequestException('Unknown active group');const items=group.members.map(member=>({id:member,name:snapshot!.labels.get(member)??catalog.index.roles.get(member)!.name,kind:'ROLE'})).filter(row=>!q.q||catalogTitleIdentityKey(row.name).includes(catalogTitleIdentityKey(q.q))).sort((a,b)=>a.name.localeCompare(b.name));return {items:items.slice((q.page-1)*q.limit,q.page*q.limit),total:items.length,page:q.page,totalPages:Math.max(1,Math.ceil(items.length/q.limit)),groupReleaseVersion:snapshot!.releaseId};}
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
  @Patch(':groupId/:roleId')async correct(@Param('groupId')groupId:string,@Param('roleId')jobTitleId:string,@Body()input:unknown,@CurrentUser()user:AuthUser){const q=parseDto(z.object({enabled:z.boolean(),reason:z.string().trim().min(5).max(1000),source:z.record(z.unknown())}).strict(),input);const [group,role]=await Promise.all([this.db.positionGroup.findUnique({where:{id:groupId}}),this.db.jobTitle.findUnique({where:{id:jobTitleId}})]);if(!group||!role||role.archivedAt||role.canonicalRoleId)throw new BadRequestException('Select an active group and canonical role');return this.db.positionGroupCorrection.create({data:{groupId,jobTitleId,enabled:q.enabled,reason:q.reason,source:q.source as never,actorId:user.id}});}
}
