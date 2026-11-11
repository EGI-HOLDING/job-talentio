import {Body,Controller,Get,Header,Param,Patch,Post,Query,UseGuards} from '@nestjs/common';
import {z} from 'zod';
import {CurrentUser,JwtAuthGuard,Roles,RolesGuard,type AuthUser} from '../common/auth.decorators';
import {parseDto} from '../common/utils';
import {PrismaService} from '../prisma/prisma.service';
import {OccupationRelationsService} from './occupation-relations.service';
import {EmployeeIntentService} from './employee-intent.service';

@Controller('admin/occupation-relations')
@UseGuards(JwtAuthGuard,RolesGuard)
@Roles('SUPER_ADMIN')
export class OccupationRelationsController {
 constructor(private service:OccupationRelationsService,private db:PrismaService,private intent:EmployeeIntentService){}
 @Get('trace') @Header('Cache-Control','private, no-store') trace(@Query()input:unknown){const q=parseDto(z.object({profileId:z.string().min(1).max(100),jobId:z.string().min(1).max(100)}).strict(),input);return this.intent.traceSelection(q.profileId,q.jobId);}
 @Get()async list(@Query()input:unknown){const q=parseDto(z.object({fromRoleId:z.string().max(100).optional(),page:z.coerce.number().int().min(1).default(1),limit:z.coerce.number().int().min(1).max(100).default(25)}),input);const state=await this.db.occupationRelationState.findUnique({where:{id:'employee'}});const release=state?.activeReleaseId?await this.db.occupationRelationRelease.findUnique({where:{id:state.activeReleaseId}}):null;const where={releaseId:state?.activeReleaseId||'none',...(q.fromRoleId?{fromRoleId:q.fromRoleId}:{})};const [items,total,overrides]=await Promise.all([this.db.occupationProfessionRelation.findMany({where,orderBy:[{score:'desc'},{fromRoleId:'asc'},{toRoleId:'asc'}],skip:(q.page-1)*q.limit,take:q.limit}),this.db.occupationProfessionRelation.count({where}),this.db.occupationRelationOverride.findMany({where:q.fromRoleId?{fromRoleId:q.fromRoleId}:{}})]);const names=await this.db.jobTitle.findMany({where:{id:{in:[...new Set(items.flatMap(r=>[r.fromRoleId,r.toRoleId]))]}},select:{id:true,name:true}});const labels=new Map(names.map(n=>[n.id,n.name]));return {release,items:items.map(r=>({...r,fromName:labels.get(r.fromRoleId),toName:labels.get(r.toRoleId)})),overrides,total,page:q.page,totalPages:Math.max(1,Math.ceil(total/q.limit))};}
 @Patch(':fromRoleId/:toRoleId')correct(@Param('fromRoleId')from:string,@Param('toRoleId')to:string,@Body()input:unknown,@CurrentUser()user:AuthUser){const p=parseDto(z.object({enabled:z.boolean(),reason:z.string().trim().min(3).max(1000)}).strict(),input);return this.service.correct(from,to,p.enabled,p.reason,user.id);}
 @Post('restore/:releaseId')restore(@Param('releaseId')id:string,@CurrentUser()user:AuthUser){return this.service.activate(id,user.id);}
}
