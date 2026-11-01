import { LanguageLevel, Prisma } from '@prisma/client';
import { levelsAtOrAbove, parseLanguagesCsv } from '@job-talentio/shared';
import { PrismaService } from '../prisma/prisma.service';
export type ApplicantFilters = {
  q?: string;
  country?: string;
  city?: string;
  skills?: string;
  skillMode?: 'AND' | 'OR';
  degree?: string;
  languages?: string;
  hasCertification?: boolean;
  experienceYearsMin?: number;
  experienceYearsMax?: number;
};
export async function applicantFilter(
  db: PrismaService,
  filters: ApplicantFilters,
): Promise<Prisma.ApplicationWhereInput> {
  const and:Prisma.ApplicationWhereInput[]=[];
  const csv=(v?:string)=>(v||'').split(',').map(s=>s.trim()).filter(Boolean);
  if(filters.q?.trim())and.push({OR:[{profile:{user:{fullName:{contains:filters.q.trim(),mode:'insensitive'}}}},{resumeVersion:{searchText:{contains:filters.q.trim(),mode:'insensitive'}}}]});
  if(csv(filters.country).length)and.push({profile:{OR:[{residenceCountry:{slug:{in:csv(filters.country)}}},{residenceCountryId:null,city:{province:{country:{slug:{in:csv(filters.country)}}}}}]}});
  if(csv(filters.city).length)and.push({profile:{city:{slug:{in:csv(filters.city)}}}});
  const slugs=csv(filters.skills);if(slugs.length){const found=await db.skill.findMany({where:{slug:{in:slugs}},select:{id:true}});const ids=found.map(s=>s.id);and.push({resumeVersion:{parseStatus:'READY',skillIds:filters.skillMode==='AND'?{hasEvery:ids}:{hasSome:ids}}});if(filters.skillMode==='AND'&&found.length!==slugs.length)and.push({id:'__unknown_skill__'});}
  if(filters.degree)and.push({resumeVersion:{parseStatus:'READY',degreeLevels:{has:filters.degree}}});
  if(filters.hasCertification)and.push({profile:{certifications:{some:{}}}});
  const langs=parseLanguagesCsv(filters.languages);if(langs.length)and.push({profile:{OR:langs.map(token=>({languages:{some:{language:{code:token.code},level:{in:levelsAtOrAbove(token.minLevel) as LanguageLevel[]}}}}))}});
  if(filters.experienceYearsMin!==undefined||filters.experienceYearsMax!==undefined)and.push({resumeVersion:{parseStatus:'READY',experienceYears:{gte:filters.experienceYearsMin,lte:filters.experienceYearsMax}}});
  return {AND:and};
}
