import {writeFileSync} from 'node:fs';
import {PrismaService} from '../prisma/prisma.service';
import {OccupationRelationsService} from '../matching/occupation-relations.service';
import {PositionGroupService} from '../matching/position-group.service';
import {buildPositionGroups} from '../matching/position-groups';
import {EmployeeOccupationIndex,intentRoleInclude} from '../matching/employee-occupation';
import {compileHierarchy,loadHierarchyManifest} from '../matching/employee-hierarchy';
import {liveJobWhere} from '../benefits/benefit-policy';
import {CandidateCache} from '../common/candidate-cache';
import {ConfigService} from '@nestjs/config';

async function audit(db:PrismaService,graph:ReturnType<typeof buildPositionGroups>){
  return db.$transaction(async tx=>{
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const [state,roles,jobs,activeGroups]=await Promise.all([
      tx.positionGroupState.findUnique({where:{id:'indonesia'},include:{activeRelease:{include:{memberships:true}}}}),
      tx.jobTitle.findMany({include:intentRoleInclude}),
      tx.jobPost.findMany({where:liveJobWhere(),select:{id:true,title:true,jobTitleId:true,positionGroupId:true,
        approvedPositionMembers:{select:{jobTitleId:true}}}}),
      tx.positionGroup.findMany({where:{archivedAt:null},select:{id:true}}),
    ]);
    const index=new EmployeeOccupationIndex(roles);
    const active=new Set(activeGroups.map(group=>group.id));
    const previous=state?.activeRelease?.memberships??[];
    const byKey=(rows:readonly {groupId:string;jobTitleId:string}[])=>new Set(rows.map(row=>JSON.stringify([row.groupId,row.jobTitleId])));
    const before=byKey(previous),after=byKey(graph.memberships);
    const related=(rows:readonly {groupId:string;jobTitleId:string}[])=>{
      const members=new Map<string,string[]>();
      for(const row of rows){
        if(!active.has(row.groupId))continue;
        const group=members.get(row.groupId)??[];
        group.push(row.jobTitleId);
        members.set(row.groupId,group);
      }
      const compiled=compileHierarchy(index,graph.heads.map(h=>({id:h.id,nameEn:h.nameEn,members:members.get(h.id)??[]})),loadHierarchyManifest());
      return {revision:compiled.revision,reasons:compiled.reasons,pairs:[...compiled.allowed.values()].reduce((n,targets)=>n+targets.size,0)};
    };
    const removed=previous.filter(row=>!after.has(JSON.stringify([row.groupId,row.jobTitleId])));
    const added=graph.memberships.filter(row=>!before.has(JSON.stringify([row.groupId,row.jobTitleId])));
    const jobsByRole=new Map<string,Array<{id:string;title:string}>>();
    for(const job of jobs){
      const id=job.jobTitleId&&index.identity(job.jobTitleId)?.canonicalRoleId;
      if(!id)continue;
      const list=jobsByRole.get(id)??[];
      list.push({id:job.id,title:job.title});
      jobsByRole.set(id,list);
    }
    const map=(row:{groupId:string;jobTitleId:string;basis:unknown})=>({groupId:row.groupId,roleId:row.jobTitleId,
      role:index.roles.get(row.jobTitleId)?.name,family:index.roles.get(row.jobTitleId)?.family?.name,
      proof:row.basis,activeJobs:jobsByRole.get(row.jobTitleId)??[]});
    const groupPostChanges=jobs.filter(job=>job.positionGroupId).flatMap(job=>{
      const revoked=job.approvedPositionMembers.filter(member=>{
        const key=JSON.stringify([job.positionGroupId,member.jobTitleId]);
        return before.has(key)&&!after.has(key);
      });
      return revoked.length?[{id:job.id,title:job.title,groupId:job.positionGroupId,revoked:revoked.map(row=>row.jobTitleId)}]:[];
    });
    const review=graph.report.dispositions.flatMap(role=>role.id!==role.canonicalRoleId?[]:role.decisions
      .filter(d=>d.reason==='PRIMARY_WORK_REVIEW_REQUIRED'||d.reason==='CORRECTION_REVIEW_REQUIRED')
      .map(d=>({...d,roleId:role.id,role:role.name,activeJobs:jobsByRole.get(role.id)??[]})));
    const groups=graph.heads.map(head=>{
      const old=previous.filter(row=>row.groupId===head.id),next=graph.memberships.filter(row=>row.groupId===head.id);
      return {id:head.id,before:old.length,after:next.length,retained:next.filter(row=>before.has(JSON.stringify([head.id,row.jobTitleId]))).length,
        review:review.filter(row=>row.groupId===head.id).length};
    });
    return {from:state?.activeReleaseId,to:graph.id,expectedRevision:state?.revision??0,groups,removed:removed.map(map),added:added.map(map),
      review,groupPostChanges,relatedBefore:related(previous),relatedAfter:related(graph.memberships)};
  },{timeout:60000});
}

async function main(){
  const args=process.argv.slice(2),apply=args.includes('--apply'),activate=args.includes('--activate'),rollback=args.includes('--rollback');
  const value=(name:string)=>{const at=args.indexOf(name);return at<0?undefined:args[at+1];};
  const db=new PrismaService();
  const cache=activate||rollback?new CandidateCache(new ConfigService(process.env)):undefined;
  const service=new PositionGroupService(db,new OccupationRelationsService(db),cache);
  try{
    if(activate||rollback){
      const id=value('--release'),revision=Number(value('--expected-revision'));
      if(!id||!Number.isInteger(revision)||revision<0||activate&&rollback)throw new Error('Choose activation or rollback with --release and --expected-revision');
      const result=await (activate?service.activate(id,revision,null):service.rollback(id,revision,null));
      console.log(JSON.stringify({operation:activate?'activated':'rolled back',state:result}));
      return;
    }
    const dry=await service.build(true);
    if('heads' in dry&&args.includes('--audit')){
      const report=await audit(db,dry);
      const output=value('--output');
      if(output)writeFileSync(output,JSON.stringify(report,null,2));
      console.log(JSON.stringify({from:report.from,id:report.to,expectedRevision:report.expectedRevision,groups:report.groups.length,
        oldMemberships:report.groups.reduce((n,g)=>n+g.before,0),newMemberships:dry.summary.memberships,
        retained:report.groups.reduce((n,g)=>n+g.retained,0),removed:report.removed.length,added:report.added.length,
        needsReview:report.review.length,emptyGroups:report.groups.filter(g=>!g.after).map(g=>g.id),
        removedLiveJobs:report.removed.flatMap(r=>r.activeJobs.map(job=>({groupId:r.groupId,...job}))),
        groupPostChanges:report.groupPostChanges,relatedBefore:report.relatedBefore,relatedAfter:report.relatedAfter}));
    }else if('heads' in dry&&value('--output'))writeFileSync(value('--output')!,JSON.stringify(dry,null,2));
    const expected=value('--expected-release');
    if(apply&&!expected)throw new Error('Apply requires the release ID from a dry run via --expected-release');
    if(expected&&expected!==dry.id)throw new Error('Catalog or mapping changed since dry run');
    if(apply)await service.build(false,expected);
    if(!args.includes('--audit')||apply)console.log(JSON.stringify({id:dry.id,applied:apply,summary:dry.summary}));
  }finally{cache?.onModuleDestroy();await db.$disconnect();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
