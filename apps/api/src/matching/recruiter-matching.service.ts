import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OccupationIndex } from './employee-matching';
import { evaluateRecruiter, type RecruiterJob, type RecruiterProfile } from './recruiter-matching';

export const recruiterProfileInclude = {
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
    return evaluateRecruiter(profile,job,await this.index(db));
  }
  async context(jobId:string) {
    const [job,index] = await Promise.all([this.db.jobPost.findUniqueOrThrow({where:{id:jobId},include:recruiterJobInclude}),this.index()]);
    return {job,index,now:new Date()};
  }
  async forProfile(profileId:string,jobId:string) {
    const [profile,context] = await Promise.all([this.db.employeeProfile.findUniqueOrThrow({where:{id:profileId},include:recruiterProfileInclude}),this.context(jobId)]);
    return evaluateRecruiter(profile,context.job,context.index,context.now);
  }
  async forProfiles(profiles:RecruiterProfile[],jobId:string) {
    const context = await this.context(jobId);
    return profiles.map(profile=>evaluateRecruiter(profile,context.job,context.index,context.now));
  }
}
