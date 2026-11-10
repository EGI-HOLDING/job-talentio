import {writeFileSync} from 'node:fs';
import {PrismaService} from '../prisma/prisma.service';
import {OccupationRelationsService} from '../matching/occupation-relations.service';
import {PositionGroupService} from '../matching/position-group.service';

async function main(){
  const args=process.argv.slice(2),apply=args.includes('--apply'),activate=args.includes('--activate');
  const value=(name:string)=>{const at=args.indexOf(name);return at<0?undefined:args[at+1];};
  const db=new PrismaService(),service=new PositionGroupService(db,new OccupationRelationsService(db));
  try{
    if(activate){const id=value('--release'),revision=Number(value('--expected-revision'));if(!id||!Number.isInteger(revision)||revision<0)throw new Error('Activation requires --release and --expected-revision');const result=await service.activate(id,revision,null);console.log(JSON.stringify({activated:result}));return;}
    const dry=await service.build(true);
    if('heads' in dry&&value('--output'))writeFileSync(value('--output')!,JSON.stringify(dry,null,2));
    const expected=value('--expected-release');
    if(apply&&!expected)throw new Error('Apply requires the release ID from a dry run via --expected-release');
    if(expected&&expected!==dry.id)throw new Error('Catalog or mapping changed since dry run');
    if(apply)await service.build(false,expected);
    console.log(JSON.stringify({id:dry.id,applied:apply,summary:dry.summary}));
  }finally{await db.$disconnect();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
