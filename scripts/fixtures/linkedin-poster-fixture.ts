import fs from 'node:fs';
import path from 'node:path';
import {buildShareContent,renderSharePoster,shareCaption,ShareLocale} from '../../apps/api/src/linkedin/linkedin-content';
const output=path.resolve(__dirname,'../../output/linkedin-audit');fs.mkdirSync(output,{recursive:true});
for(const locale of ['id','en','ru','uz'] as ShareLocale[]){
  const content=buildShareContent({id:'fixture-job',title:'Senior Frontend Developer',company:{name:'Talentio Design Studio'},isAnonymous:false,locale,city:{name:'Jakarta'},country:{name:'Indonesia'},employmentType:'FULL_TIME',workMode:'HYBRID',salaryMin:20000000,salaryMax:30000000,salaryPeriod:'MONTHLY',currency:'IDR'},locale,'https://jobtalent.io');
  fs.writeFileSync(path.join(output,'poster-'+locale+'.png'),renderSharePoster(content));
  fs.writeFileSync(path.join(output,'fixture-'+locale+'.json'),JSON.stringify({caption:shareCaption(content),jobUrl:content.jobUrl}));
}
