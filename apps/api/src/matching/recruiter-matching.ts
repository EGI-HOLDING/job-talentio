import { languageLevelRank, type MatchEvidence } from '@job-talentio/shared';
import { normalizeSkillKey } from '../common/skill-resolve';
import { normalizeJobTitleKey } from '../common/title-resolve';
import { OccupationIndex, experienceNeedsReview, type EmployeeMatchJob, type EmployeeMatchProfile } from './employee-matching';

export const RECRUITER_MATCH_VERSION = 'hr-evidence-v1';
export type RecruiterProfile = EmployeeMatchProfile;
export type RecruiterJob = EmployeeMatchJob;
type Status = 'MET' | 'UNMET' | 'UNKNOWN';
export type RecruiterBreakdown = {
  version: string; evaluatedAt: string; total: number; assessable: boolean; positiveCore: boolean;
  skills: number; title: number; experience: number; location: number; education: number; language: number;
  optionalScore: number; evidenceCoverage: number; evidence: MatchEvidence[];
  components: Array<{ key: string; earned: number; maximum: number }>;
  details: {
    matchedSkills: string[]; missingRequiredSkills: string[]; unknownRequiredSkills: string[];
    matchedLanguages: string[]; missingRequiredLanguages: string[]; unknownRequiredLanguages: string[];
    experienceYears: number; requiredYears: number | null; relevantExperienceYears: number | null;
    requiredSkills: { met: number; unknown: number; unmet: number; total: number };
    reviewExperienceIds: string[]; hasJobRequirements: boolean;
  };
};
const LEVELS = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'];
const keys = (skill: RecruiterJob['jobSkills'][number]['skill']) => new Set([
  skill.normalizedKey, skill.name, skill.slug, skill.nameId, skill.nameUz, skill.nameRu,
  ...(skill.aliases ?? []).map(a => a.aliasKey),
].filter((value): value is string => Boolean(value)).map(normalizeSkillKey).filter(Boolean));
const overlaps = (a: Set<string>, b: Set<string>) => [...a].some(key => b.has(key));
const yearsUnion = (rows: RecruiterProfile['experiences'], now: Date) => {
  const intervals = rows.map(row => [new Date(row.startDate).getTime(), row.isCurrent ? now.getTime() : new Date(row.endDate!).getTime()])
    .sort((a,b) => a[0]-b[0]);
  let covered = 0, end = -Infinity;
  for (const [start, finish] of intervals) { covered += Math.max(0, finish - Math.max(start,end)); end = Math.max(end,finish); }
  return covered / 31557600000;
};

/** An evidence index, not a probability of hiring. Only authored requirements
 * receive weight; optional skills never compensate for required skills. */
export function evaluateRecruiter(profile: RecruiterProfile, job: RecruiterJob, index: OccupationIndex, now = new Date()): RecruiterBreakdown {
  const evidence: MatchEvidence[] = [];
  const parts: Array<{ key: string; weight: number; fraction: number; known: number }> = [];
  const review = profile.experiences.filter(row => experienceNeedsReview(row,now));
  const valid = profile.experiences.filter(row => !experienceNeedsReview(row,now));
  const roleTexts = [profile.headline, profile.desiredPosition, ...(profile.desiredPositions ?? []), ...valid.filter(row=>row.isCurrent).map(row=>row.title)].filter((v): v is string=>Boolean(v));
  const roleIds = new Set(roleTexts.flatMap(text=>[...index.resolve(text)]));
  const jobIds = job.jobTitleId ? new Set([job.jobTitleId]) : index.resolve(job.title);
  const direct = !job.jobTitleId && roleTexts.some(text=>normalizeJobTitleKey(text)===normalizeJobTitleKey(job.title));
  const exact = overlaps(roleIds,jobIds) || direct;
  const related = !exact && [...roleIds].some(from=>[...jobIds].some(to=>index.related(from,to)));
  const relevant = valid.filter(row=>overlaps(index.resolve(row.title),jobIds) || (!job.jobTitleId && normalizeJobTitleKey(row.title)===normalizeJobTitleKey(job.title)));
  const history = relevant.length > 0;
  const roleFraction = exact ? 1 : related || history ? 0.5 : 0;
  parts.push({key:'title',weight:15,fraction:roleFraction,known:roleFraction ? 1 : 0});
  evidence.push({kind:'ROLE',label:job.title,required:false,status:roleFraction ? 'MET' : 'UNKNOWN',code:exact?'ROLE_MATCH':history?'PAST_ROLE':related?'RELATED_ROLE':'NOT_LISTED',evidenceRefs:[`job:${job.id}:title`,`profile:${profile.id}:roles`]});

  // Catalog aliases may expose duplicate legacy rows. Do not double-count one skill.
  const requirements: RecruiterJob['jobSkills'] = [];
  for (const row of job.jobSkills) {
    const existing = requirements.find(other=>other.skillId===row.skillId || overlaps(keys(other.skill),keys(row.skill)));
    if (!existing) requirements.push({...row});
    else {
      existing.isRequired ||= row.isRequired;
      existing.weight = Math.max(existing.weight,row.weight);
      if (LEVELS.indexOf(row.minLevel ?? '') > LEVELS.indexOf(existing.minLevel ?? '')) existing.minLevel = row.minLevel;
    }
  }
  const required = requirements.filter(row=>row.isRequired);
  const scored = required.length ? required : requirements;
  const skillCounts = {met:0,unknown:0,unmet:0,total:required.length};
  let metWeight = 0, knownWeight = 0, totalWeight = 0, optionalScore = 0, coreSkill = false;
  for (const row of requirements) {
    const candidates = profile.skills.filter(ps=>ps.skillId===row.skillId || overlaps(keys(ps.skill),keys(row.skill)));
    const found = candidates.sort((a,b)=>Number(b.levelSource==='USER_CONFIRMED')-Number(a.levelSource==='USER_CONFIRMED') || LEVELS.indexOf(b.level)-LEVELS.indexOf(a.level))[0];
    let status: Status = found ? 'MET' : 'UNKNOWN';
    if (found && row.minLevel) status = found.levelSource !== 'USER_CONFIRMED' || !LEVELS.includes(found.level)
      ? 'UNKNOWN' : LEVELS.indexOf(found.level)>=LEVELS.indexOf(row.minLevel) ? 'MET' : 'UNMET';
    const weight = Number.isFinite(row.weight) && row.weight>0 ? row.weight : 1;
    if (scored.includes(row)) {
      totalWeight += weight;
      if (status !== 'UNKNOWN') knownWeight += weight;
      if (status === 'MET') { metWeight += weight; coreSkill = true; }
    } else if (status === 'MET') optionalScore += weight;
    if (row.isRequired) skillCounts[status==='MET'?'met':status==='UNMET'?'unmet':'unknown']++;
    evidence.push({kind:'SKILL',label:row.skill.name,labels:{en:row.skill.name,id:row.skill.nameId,uz:row.skill.nameUz,ru:row.skill.nameRu},status,required:row.isRequired,
      ...(row.minLevel ? {minimumLevel:row.minLevel}:{}),code:status==='MET'?'SKILL_MATCH':status==='UNMET'?'BELOW_REQUIREMENT':found?'LEVEL_UNCONFIRMED':'NOT_LISTED',
      evidenceRefs:[`jobSkill:${row.id ?? row.skillId}`,...(found?[`profileSkill:${found.id ?? found.skillId}`]:[])]});
  }
  if (totalWeight) parts.push({key:'skills',weight:40,fraction:metWeight/totalWeight,known:knownWeight/totalWeight});

  const minimum = job.experienceYearsMin != null && job.experienceYearsMin>0 ? job.experienceYearsMin : null;
  const years = yearsUnion(relevant,now);
  const experienceKnown = relevant.length>0 || profile.noExperience===true;
  if (minimum !== null) {
    const status: Status = experienceKnown ? years>=minimum?'MET':'UNMET' : 'UNKNOWN';
    parts.push({key:'experience',weight:15,fraction:experienceKnown?Math.min(1,years/minimum):0,known:experienceKnown?1:0});
    evidence.push({kind:'EXPERIENCE',label:String(minimum),status,required:true,code:status==='MET'?'EXPERIENCE_MATCH':status==='UNMET'?'BELOW_REQUIREMENT':'NOT_LISTED',evidenceRefs:relevant.map(row=>`experience:${row.id ?? row.title}`)});
  } else if (job.experienceLevel) evidence.push({kind:'EXPERIENCE',label:job.experienceLevel,status:'UNKNOWN',required:false,code:'NOT_LISTED',evidenceRefs:[`job:${job.id}:experienceLevel`]});

  const confirmedLanguages = job.jobLanguages.filter(row=>row.provenance==='EMPLOYER_CONFIRMED');
  const requiredLanguages = confirmedLanguages.filter(row=>row.isRequired);
  let languagesMet = 0, languagesKnown = 0;
  for (const row of job.jobLanguages) {
    const found = profile.languages.find(item=>item.language.code.toLowerCase()===row.language.code.toLowerCase());
    const confirmed = row.provenance==='EMPLOYER_CONFIRMED';
    const status: Status = !confirmed || !found ? 'UNKNOWN' : languageLevelRank(found.level as never)>=languageLevelRank(row.minLevel as never)?'MET':'UNMET';
    if (confirmed && row.isRequired) { if(status==='MET') languagesMet++; if(status!=='UNKNOWN') languagesKnown++; }
    if (confirmed && !row.isRequired && status==='MET') optionalScore += 1;
    evidence.push({kind:'LANGUAGE',label:`${row.language.name} ${row.minLevel}`,status,required:confirmed&&row.isRequired,
      code:!confirmed?'UNVERIFIED_REQUIREMENT':status==='MET'?'LANGUAGE_MATCH':status==='UNMET'?'BELOW_REQUIREMENT':'NOT_LISTED',evidenceRefs:[`jobLanguage:${row.id ?? row.language.code}`,...(found?[`profileLanguage:${found.id ?? found.language.code}`]:[])]});
  }
  if (requiredLanguages.length) parts.push({key:'language',weight:10,fraction:languagesMet/requiredLanguages.length,known:languagesKnown/requiredLanguages.length});

  const country = job.countryId ?? job.city?.province?.countryId;
  if (country || job.cityId) {
    const preferred = profile.preferredCountries?.map(row=>row.id) ?? [];
    const residence = profile.residenceCountryId ?? profile.city?.province?.countryId;
    const excluded = country && preferred.length>0 && !preferred.includes(country);
    const sameCity = job.cityId && job.cityId===profile.cityId;
    const matchCountry = country && (preferred.includes(country) || (job.workMode==='REMOTE' && residence===country));
    const status: Status = excluded ? 'UNMET' : sameCity || matchCountry ? 'MET' : 'UNKNOWN';
    parts.push({key:'location',weight:12,fraction:status==='MET'?1:0,known:status==='UNKNOWN'?0:1});
    evidence.push({kind:'LOCATION',label:sameCity?'CITY':'COUNTRY',status,required:false,code:status==='MET'?'LOCATION_MATCH':status==='UNMET'?'BELOW_REQUIREMENT':'NOT_LISTED',evidenceRefs:[`profile:${profile.id}:location`,`job:${job.id}:location`]});
  }
  const hasJobRequirements = requirements.length>0 || minimum!==null || requiredLanguages.length>0;
  const positiveCore = roleFraction>0 || coreSkill || relevant.length>0;
  const hasConfirmedAssessment = evidence.some(row=>row.required && row.status!=='UNKNOWN');
  const assessable = hasJobRequirements && (positiveCore || hasConfirmedAssessment);
  const weight = parts.reduce((sum,row)=>sum+row.weight,0);
  const components = parts.map(row=>({key:row.key,maximum:row.weight/weight*100,earned:row.weight*row.fraction/weight*100}));
  const component = (key:string) => components.find(row=>row.key===key)?.earned ?? 0;
  const skillsBy = (status:Status,requiredOnly=false) => evidence.filter(row=>row.kind==='SKILL'&&row.status===status&&(!requiredOnly||row.required)).map(row=>row.label);
  const languagesBy = (status:Status,requiredOnly=false) => evidence.filter(row=>row.kind==='LANGUAGE'&&row.status===status&&(!requiredOnly||row.required)).map(row=>row.label);
  return {
    version:RECRUITER_MATCH_VERSION,evaluatedAt:now.toISOString(),total:assessable?Math.round(components.reduce((sum,row)=>sum+row.earned,0)*10)/10:0,
    assessable,positiveCore,optionalScore,evidenceCoverage:Math.round(parts.reduce((sum,row)=>sum+row.weight*row.known,0)/weight*100),evidence,components,
    skills:component('skills'),title:component('title'),experience:component('experience'),location:component('location'),education:0,language:component('language'),
    details:{matchedSkills:skillsBy('MET'),missingRequiredSkills:skillsBy('UNMET',true),unknownRequiredSkills:skillsBy('UNKNOWN',true),matchedLanguages:languagesBy('MET'),missingRequiredLanguages:languagesBy('UNMET',true),unknownRequiredLanguages:languagesBy('UNKNOWN',true),experienceYears:years,requiredYears:minimum,relevantExperienceYears:experienceKnown?years:null,requiredSkills:skillCounts,reviewExperienceIds:review.map((row,i)=>row.id ?? `unidentified:${i}`),hasJobRequirements},
  };
}

export function compareRecruiterMatches(a: RecruiterBreakdown,b: RecruiterBreakdown):number {
  return Number(b.positiveCore)-Number(a.positiveCore) || b.total-a.total || b.optionalScore-a.optionalScore || b.evidenceCoverage-a.evidenceCoverage;
}
