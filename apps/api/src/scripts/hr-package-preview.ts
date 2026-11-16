import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';

const target = new URL(process.env.DATABASE_URL ?? '');
assert.equal(target.hostname, '127.0.0.1');
assert.equal(target.pathname, '/talentio_hr_package_preview');
const account = JSON.parse(readFileSync(process.env.HR_PACKAGE_PREVIEW_ACCOUNT_FILE!, 'utf8')) as {email:string;password:string};
const db = new PrismaClient();

async function seed() {
  const passwordHash = await hash(account.password, 10);
  const hr = await db.user.upsert({where:{email:account.email},update: {passwordHash},create:{
    email:account.email,passwordHash,fullName:'Dewi HR Preview',role:'RECRUITER',locale:'id',emailVerified:true,
  }});
  await db.user.upsert({where:{email:'admin@packages-preview.talentio.test'},update:{passwordHash},create:{
    email:'admin@packages-preview.talentio.test',passwordHash,fullName:'Admin Paket Preview',role:'SUPER_ADMIN',locale:'id',emailVerified:true,
  }});
  const onboardingEmail = 'onboarding@packages-preview.talentio.test';
  const newcomer = await db.user.upsert({where:{email:onboardingEmail},update:{passwordHash},create:{
    email:onboardingEmail,passwordHash,fullName:'HR Onboarding Preview',role:'RECRUITER',locale:'id',emailVerified:true,
  }});
  const country = await db.country.upsert({where:{iso2:'ID'},update:{},create:{
    name:'Indonesia',nameId:'Indonesia',slug:'indonesia',iso2:'ID',iso3:'IDN',phoneCode:'+62',currencyCode:'IDR',
  }});
  const province = await db.province.upsert({where:{countryId_slug:{countryId:country.id,slug:'jakarta-preview'}},update:{},create:{
    name:'Jakarta',nameId:'Jakarta',slug:'jakarta-preview',countryId:country.id,
  }});
  const city = await db.city.upsert({where:{slug:'jakarta-package-preview'},update:{},create:{
    name:'Jakarta',nameId:'Jakarta',slug:'jakarta-package-preview',provinceId:province.id,
  }});
  const group = await db.industryGroup.upsert({where:{slug:'technology-preview'},update:{},create:{name:'Technology',slug:'technology-preview'}});
  const industry = await db.industry.upsert({where:{slug:'software-preview'},update:{},create:{name:'Software',slug:'software-preview',groupId:group.id}});
  for (const [code,name] of [['lite','Studio Rintis'],['standard','Tim Nusa'],['premium','Teknologi Arunika']]) {
    const slug = 'package-preview-'+code;
    const company = await db.company.upsert({where:{slug},update:{},create:{
      slug,name,description:'Perusahaan sintetis untuk preview paket lowongan Talentio.',size:'SIZE_11_50',cityId:city.id,industryId:industry.id,
    }});
    await db.companyMember.upsert({where:{companyId_userId:{companyId:company.id,userId:hr.id}},update:{},create:{companyId:company.id,userId:hr.id,role:'OWNER'}});
    if (code === 'lite') {
      await db.recruiterOnboarding.upsert({where:{userId:hr.id},update:{},create:{
        userId:hr.id,companyId:company.id,status:'COMPLETE',step:3,completedAt:new Date(),
      }});
      await db.companyMember.upsert({where:{companyId_userId:{companyId:company.id,userId:newcomer.id}},update:{},create:{
        companyId:company.id,userId:newcomer.id,role:'RECRUITER',
      }});
      await db.recruiterOnboarding.upsert({where:{userId:newcomer.id},update:{},create:{
        userId:newcomer.id,companyId:company.id,status:'IN_PROGRESS',step:2,flowVersion:2,phase:'PACKAGE',
      }});
    }
  }
  for (const key of ['hr_packages','hr_promotions','hr_analytics','hr_support']) {
    await db.featureFlag.upsert({where:{key},update:{enabled:true},create:{key,enabled:true}});
  }
  console.log('Isolated package sandbox fixtures are ready.');
}
seed().catch(error => {console.error(error);process.exitCode=1;}).finally(() => db.$disconnect());
