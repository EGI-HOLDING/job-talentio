import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OccupationIndex } from './employee-matching';
import { evaluateRecruiter, type RecruiterJob, type RecruiterProfile } from './recruiter-matching';
import { cvSourceInclude, discoveryVersion, withCvFacts } from '../profiles/cv-evidence';
import { hrEnabled, evaluateHr, HR_PARSER, type HrProfile } from './recruiter-ranking';
import { loadHrCatalog } from './recruiter-ranking.service';
import { freezeHrSubmission, hrApplicationProfile } from './recruiter-evidence';
import { withRecruiterGroupScope } from './job-group-scope';

export const recruiterProfileInclude = {
  ...cvSourceInclude,
  skills:{include:{skill:{include:{aliases:{select:{aliasKey:true}}}}}}, experiences:true,
  languages:{include:{language:true}},preferredCountries:{select:{id:true}},
  city:{include:{province:{select:{countryId:true}}}},
} satisfies Prisma.EmployeeProfileInclude;
export const recruiterJobInclude = {
  jobSkills:{include:{skill:{include:{aliases:{select:{aliasKey:true}}}}}},
  jobLanguages:{include:{language:true}},city:{include:{province:{select:{countryId:true}}}},
} satisfies Prisma.JobPostInclude;

@Injectable()
export class RecruiterMatchingService {
  constructor(private db:PrismaService) {}
  async index(db:Prisma.TransactionClient=this.db) {
    return new OccupationIndex(await db.jobTitle.findMany({select:{id:true,name:true,nameId:true,nameUz:true,nameRu:true,normalizedKey:true,matchingMetadata:true,aliases:{select:{alias:true,aliasKey:true}}}}));
  }
  async scoreInputs(profile:RecruiterProfile,job:RecruiterJob,db:Prisma.TransactionClient=this.db) {
    job=await withRecruiterGroupScope(db,job);
    if(hrEnabled())return evaluateHr(profile as HrProfile,job,await loadHrCatalog(db));
    return evaluateRecruiter(profile,job,await this.index(db));
  }
  async historicalInputs(profile:RecruiterProfile,job:RecruiterJob,db:Prisma.TransactionClient=this.db){return evaluateRecruiter(profile,await withRecruiterGroupScope(db,job),await this.index(db));}
  async databaseInputs(profiles:RecruiterProfile[]){
    const catalog=await loadHrCatalog(this.db);
    const inputs=profiles.map(profile=>'cvSource' in profile?profile:withCvFacts(profile,discoveryVersion(profile as typeof profile & Parameters<typeof discoveryVersion>[0])));
    const ids=[...new Set(inputs.flatMap(p=>p.cvSource?.versionId?[p.cvSource.versionId]:[]))];
    const versions=await this.db.resumeVersion.findMany({where:{id:{in:ids}},include:{employeeEvidence:true,recruiterEvidence:{where:{parserVersion:HR_PARSER,catalogRevision:catalog.revision}}}});
    const byId=new Map(versions.map(v=>[v.id,v]));
    return inputs.map(p=>{const v=byId.get(p.cvSource?.versionId??''),s=freezeHrSubmission(v??null,{},new Date(new Date().toISOString().slice(0,10))),source=hrApplicationProfile(p,s,v,v?.recruiterEvidence[0],catalog);source.hr!.source='DATABASE_CV';return source;});
  }
  async databaseProfiles(profiles:RecruiterProfile[],jobId:string){
    const [inputs,catalog,job]=await Promise.all([this.databaseInputs(profiles),loadHrCatalog(this.db),this.job(jobId)]);
    return inputs.map(p=>evaluateHr(p,job,catalog));
  }
  async context(jobId:string) {
    const [job,index] = await Promise.all([this.job(jobId),this.index()]);
    return {job,index,now:new Date()};
  }
  private async job(jobId:string) {
    return withRecruiterGroupScope(this.db,await this.db.jobPost.findUniqueOrThrow({where:{id:jobId},include:recruiterJobInclude}));
  }
  async forProfile(profileId:string,jobId:string) {
    if(hrEnabled()){const p=await this.db.employeeProfile.findUniqueOrThrow({where:{id:profileId},include:recruiterProfileInclude});return (await this.databaseProfiles([p],jobId))[0];}
    const [profile,context] = await Promise.all([this.db.employeeProfile.findUniqueOrThrow({where:{id:profileId},include:recruiterProfileInclude}),this.context(jobId)]);
    return evaluateRecruiter(withCvFacts(profile,discoveryVersion(profile)),context.job,context.index,context.now);
  }
  async forProfiles(profiles:RecruiterProfile[],jobId:string) {
    if(hrEnabled())return this.databaseProfiles(profiles,jobId);
    const context = await this.context(jobId);
    return profiles.map(profile=>evaluateRecruiter('cvSource' in profile ? profile : withCvFacts(profile,discoveryVersion(profile as typeof profile & Parameters<typeof discoveryVersion>[0])),context.job,context.index,context.now));
  }
  async forEvidence(profiles:RecruiterProfile[],jobId:string){
    if(hrEnabled()){const [catalog,job]=await Promise.all([loadHrCatalog(this.db),this.job(jobId)]);return profiles.map(p=>evaluateHr(p as HrProfile,job,catalog));}
    const context=await this.context(jobId);
    return profiles.map(profile=>evaluateRecruiter(profile,context.job,context.index,context.now));
  }
}
