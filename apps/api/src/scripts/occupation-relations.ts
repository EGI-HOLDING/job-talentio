import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import {PrismaService} from '../prisma/prisma.service';
import {OccupationRelationsService} from '../matching/occupation-relations.service';
import {VacancyTasksService} from '../matching/vacancy-tasks.service';
async function main(){
 const args=process.argv.slice(2),db=new PrismaService(),service=new OccupationRelationsService(db);
 const value=(flag:string)=>args.includes(flag)?args[args.indexOf(flag)+1]:undefined;
 try{
  const output=value('--report');if(!output)throw Error('--report PATH required');
  const stage=args.includes('--stage'),apply=args.includes('--apply'),restore=value('--restore'),expected=value('--expected-id');
  if([stage,apply,Boolean(restore)].filter(Boolean).length>1)throw Error('Choose one of --stage, --apply or --restore');
  if((stage||apply)&&!expected)throw Error('Repeat the dry-run ID with --expected-id');
  let processed=0;
  if(stage&&args.includes('--prepare-tasks')){
   const dry=await service.build(true,false,expected);
   if(dry.id!==expected)throw Error('Catalog changed before preparation');
   const tasks=new VacancyTasksService(db,service);
   for(let batches=0;batches<10000;batches++){const count=await tasks.refresh();if(!count)break;processed+=count;}
  }
  const result=restore?await service.activate(restore):await service.build(!stage&&!apply,stage||apply,expected,apply);
  const report={...result,processed},file=path.resolve(output);
  fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  if(apply&&'pendingTasks' in result&&result.pendingTasks)throw Error('Release remains staged; current task evidence is incomplete');
 }finally{await db.$disconnect();}
}
void main().catch(e=>{console.error(e.message);process.exitCode=1});
