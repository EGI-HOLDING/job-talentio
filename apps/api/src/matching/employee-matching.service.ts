import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeeIntentService, type RecommendationOptions } from './employee-intent.service';
import { compareIntent,type IntentEvaluation } from './employee-intent';
type IntentContext=Awaited<ReturnType<EmployeeIntentService['context']>>;
/** The sole candidate recommendation engine is V3.2. There is no version selector or legacy fallback. */
@Injectable()
export class EmployeeMatchingService {
  constructor(private prisma:PrismaService,private intent:EmployeeIntentService=new EmployeeIntentService(prisma)) {}
  async warmCatalog(){await this.intent.catalog();}
  intentSearchScope(profileId:string){return this.intent.context(profileId,true,true);}
  intentExplanation(profileId:string,jobId:string){return this.intent.explain(profileId,jobId);}
  compare(a:unknown,b:unknown){return a&&b?compareIntent(a as IntentEvaluation,b as IntentEvaluation):Number(!!b)-Number(!!a);}
  scoreJobsForProfile(profileId:string,ids:string[],provided?:IntentContext|null){return this.intent.scoreJobsForProfile(profileId,ids,provided||undefined);}
  async forJob(profileId:string,jobId:string){return (await this.scoreJobsForProfile(profileId,[jobId])).get(jobId)??null;}
  recommend(profileId:string,page?:number,limit?:number,feed?:'recommendations'|'related'|'salary-unverified',options?:RecommendationOptions):ReturnType<EmployeeIntentService['recommend']>;
  recommend(profileId:string,page:number|undefined,limit:number|undefined,feed:'exploration',options?:RecommendationOptions):ReturnType<EmployeeIntentService['explore']>;
  recommend(profileId:string,page:number|undefined,limit:number|undefined,feed:'recommendations'|'related'|'exploration'|'salary-unverified',options?:RecommendationOptions):ReturnType<EmployeeIntentService['recommend']>|ReturnType<EmployeeIntentService['explore']>;
  recommend(profileId:string,page=1,limit=24,feed:'recommendations'|'related'|'exploration'|'salary-unverified'='recommendations',options:RecommendationOptions={}){
    return feed==='exploration'?this.intent.explore(profileId,page,limit):this.intent.recommend(profileId,page,limit,undefined,feed,options);
  }
}
