import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import {PrismaService} from '../prisma/prisma.service';
import {OccupationRelationsService} from '../matching/occupation-relations.service';
async function main(){const args=process.argv.slice(2),db=new PrismaService(),service=new OccupationRelationsService(db);try{const at=args.indexOf('--report');if(at<0||!args[at+1])throw Error('--report PATH required');const result=args.includes('--restore')?await service.activate(args[args.indexOf('--restore')+1]):await service.build(!args.includes('--apply'),args.includes('--apply'),args.includes('--expected-id')?args[args.indexOf('--expected-id')+1]:undefined);const file=path.resolve(args[at+1]);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(result,null,2));console.log(JSON.stringify(result));}finally{await db.$disconnect();}}void main().catch(e=>{console.error(e.message);process.exitCode=1});
