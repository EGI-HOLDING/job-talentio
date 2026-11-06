import 'reflect-metadata';
import assert from 'node:assert/strict';
import { Module } from '@nestjs/common';
import { NestFactory,Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from '../auth/jwt.strategy';
import { RolesGuard,type AuthUser } from '../common/auth.decorators';
import { PrismaService } from '../prisma/prisma.service';
import { MetaService } from '../meta/meta.service';
import { MetaController } from '../meta/meta.controller';
import { CompaniesService } from '../companies/companies.service';
import { CompaniesController } from '../companies/companies.controller';
import { JobsService } from '../jobs/jobs.service';
import { JobsController } from '../jobs/jobs.controller';
import { RecruiterOnboardingController } from '../benefits/recruiter-onboarding.controller';
import { RecruiterOnboardingService } from '../benefits/recruiter-onboarding.service';
import { SearchRateLimitGuard } from '../rate-limit/search-rate-limit.guard';

export async function runBusinessCatalogHttp(input:{db:any;meta:MetaService;companies:CompaniesService;jobs:JobsService;onboarding:RecruiterOnboardingService;actor:AuthUser;outsider:AuthUser;companyId:string;jobId:string;tag:string}){
 const config=new ConfigService({JWT_SECRET:'local-business-catalog-http-authentication-2026'});
 const jwt=new JwtService({secret:config.get('JWT_SECRET')});
 const token=(actor:AuthUser)=>jwt.sign({sub:actor.id,tv:0},{expiresIn:'5m'});
 // Explicit wiring for tsx; production controllers, JWT authentication and roles are used.
 Reflect.defineMetadata('design:paramtypes',[MetaService],MetaController);
 Reflect.defineMetadata('design:paramtypes',[CompaniesService],CompaniesController);
 Reflect.defineMetadata('design:paramtypes',[JobsService,PrismaService],JobsController);
 Reflect.defineMetadata('design:paramtypes',[RecruiterOnboardingService],RecruiterOnboardingController);
 Reflect.defineMetadata('design:paramtypes',[Reflector],RolesGuard);
 Reflect.defineMetadata('design:paramtypes',[Object,ConfigService],SearchRateLimitGuard);
 class LocalHttpModule{};Module({})(LocalHttpModule);
 const app=await NestFactory.create({module:LocalHttpModule,imports:[PassportModule.register({defaultStrategy:'jwt'})],controllers:[MetaController,CompaniesController,JobsController,RecruiterOnboardingController],providers:[
  {provide:PrismaService,useValue:input.db},{provide:ConfigService,useValue:config},{provide:JwtStrategy,useValue:new JwtStrategy(config,input.db)},
  {provide:MetaService,useValue:input.meta},{provide:CompaniesService,useValue:input.companies},{provide:JobsService,useValue:input.jobs},{provide:RecruiterOnboardingService,useValue:input.onboarding},
  {provide:RolesGuard,useValue:new RolesGuard(new Reflector())},{provide:SearchRateLimitGuard,useValue:{canActivate:()=>true}},
 ]},{logger:['error'],abortOnError:false});
 app.setGlobalPrefix('api');await app.listen(0,'127.0.0.1');const base=await app.getUrl();let assertions=0;
 const request=async(path:string,method='GET',body?:unknown,actor?:AuthUser)=>{
  const response=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',...(actor?{Authorization:'Bearer '+token(actor)}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  return {status:response.status,body:await response.json()};
 };
 try{
  const groups=await request('/meta/industry-groups');assert.equal(groups.status,200);assert.equal(groups.body.groups.length,29);assertions+=2;
  const levels=await request('/meta/seniority-levels');assert.equal(levels.status,200);assert.equal(levels.body.levels.length,14);assertions+=2;
  assert.equal((await request('/meta/industries?group=1')).body.groups.length,4);assertions++;
  const path='/companies/'+input.companyId;
  assert.equal((await request(path,'PATCH',{industryGroupCode:'MANUFACTURING'})).status,401);assertions++;
  assert.equal((await request(path,'PATCH',{industryGroupCode:'MANUFACTURING'},input.outsider)).status,403);assertions++;
  assert.equal((await request(path,'PATCH',{industrySlug:'missing-industry'},input.actor)).status,400);assertions++;
  assert.equal((await request(path,'PATCH',{industryGroupCode:'MISSING'},input.actor)).status,400);assertions++;
  assert.equal((await request(path,'PATCH',{industryGroupCode:'MANUFACTURING'},input.actor)).body.industryGroup.code,'MANUFACTURING');assertions++;
  for(const sort of ['name','featured']){
   const result=await request('/companies?'+new URLSearchParams({q:input.tag,industryGroupCode:'MANUFACTURING',sort}));
   assert.equal(result.status,200);assert.equal(result.body.total,2);assertions+=2;
  }
  const jobPath='/jobs/'+input.jobId;
  for(const body of [{seniorityYearsMin:0},{seniorityVersion:'spoofed'},{seniorityYearsMax:999},{seniorityLevelCode:'L99'}]){
   assert.equal((await request(jobPath,'PATCH',body,input.actor)).status,400);assertions++;
  }
  assert.equal((await request(jobPath,'PATCH',{seniorityLevelCode:'L3',experienceYearsMin:1},input.actor)).status,400);assertions++;
  const update=await request(jobPath,'PATCH',{seniorityLevelCode:'L3'},input.actor);assert.equal(update.status,200);assert.equal(update.body.seniorityYearsMin,4);assert.equal(update.body.seniorityYearsMax,7);assertions+=3;
  assert.equal((await request(jobPath,'PATCH',{seniorityLevelCode:'L3'},input.outsider)).status,403);assertions++;
  const filtered=await request('/jobs?'+new URLSearchParams({company:input.tag,industryGroupCode:'MANUFACTURING',sort:'newest'}));assert.equal(filtered.status,200);assert.equal(filtered.body.total,2);assertions+=2;
  await request(path,'PATCH',{industryGroupCode:'AGRICULTURE_NATURAL_RESOURCES'},input.actor);
  await request(jobPath,'PATCH',{seniorityLevelCode:null},input.actor);
  return assertions;
 }finally{await app.close();}
}
