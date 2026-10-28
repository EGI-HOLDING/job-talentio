import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BenefitsService } from './benefits.service';
import { OperationsService } from './operations.service';
import { JobCommerceService } from './job-commerce.service';
import { JobPaymentProvider } from './job-payment.provider';
import { HrAnalyticsService } from './hr-analytics.service';
import { HrSupportService } from './hr-support.service';
import { DAY_MS } from './benefit-policy';

/** Runs only inside disposable PostgreSQL; does not enable a real payment provider. */
export async function runPackageReadinessFaults(db: PrismaService) {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/talentio_hr_it_\d+$/);
  await db.featureFlag.updateMany({where:{key:{in:['hr_support','hr_analytics']}},data:{enabled:true}});
  const operations = new OperationsService(db), benefits = new BenefitsService(db, operations);
  const commerce = new JobCommerceService(db, benefits, operations, new JobPaymentProvider());
  const hr = await db.user.create({data:{fullName:'Fault suite HR',role:'RECRUITER'}});
  const member = await db.user.create({data:{fullName:'Fault suite member',role:'RECRUITER'}});
  const admin = await db.user.create({data:{fullName:'Fault suite admin',role:'SUPER_ADMIN'}});
  const company = await db.company.create({data:{name:'Fault suite company',slug:'fault-'+randomUUID(),members:{create:[{userId:hr.id,role:'OWNER'},{userId:member.id,role:'RECRUITER'}]}}});
  const job = () => db.jobPost.create({data:{companyId:company.id,title:'Fault isolation '+randomUUID(),description:'Isolated package and recovery verification.',workMode:'REMOTE'}});
  const pending = async (jobId:string,code:'STANDARD'|'PREMIUM'='STANDARD') => commerce.create(hr,{jobId,code,intent:'PURCHASE'},randomUUID());
  const payment = (id:string,reference=id,amount=149000) => ({orderId:id,eventId:reference,reference,amount,currency:'IDR'});

  const a=await job(),order=await pending(a.id),original=benefits.applyPurchase.bind(benefits);
  benefits.applyPurchase=async(...args:Parameters<BenefitsService['applyPurchase']>)=>{await original(...args);throw Error('Injected entitlement persistence failure');};
  await assert.rejects(()=>commerce.settle('fixture',payment(order.id)),/Injected/);
  benefits.applyPurchase=original;
  assert.equal((await db.jobPurchaseOrder.findUniqueOrThrow({where:{id:order.id}})).status,'PENDING');
  assert.equal(await db.jobPaymentEvent.count({where:{orderId:order.id}}),0);
  assert.equal(await db.jobBenefit.count({where:{jobId:a.id}}),0);
  assert.equal((await commerce.settle('fixture',payment(order.id))).status,'PAID');
  const benefit=await db.jobBenefit.findUniqueOrThrow({where:{jobId:a.id}});
  assert.equal(await db.jobPackageGrant.count({where:{benefitId:benefit.id}}),1);
  await commerce.settle('fixture',payment(order.id));
  assert.equal(await db.jobPackageGrant.count({where:{benefitId:benefit.id}}),1);

  const b=await job(),duplicate=await pending(b.id);
  await Promise.all([commerce.settle('fixture',payment(duplicate.id,'charge-one')),commerce.settle('fixture',payment(duplicate.id,'charge-two'))]);
  assert.equal((await db.jobPurchaseOrder.findUniqueOrThrow({where:{id:duplicate.id}})).status,'REVIEW');
  assert.equal(await db.jobPackageGrant.count({where:{benefit:{jobId:b.id}}}),1);
  await assert.rejects(()=>commerce.settle('fixture',{...payment(order.id),eventId:'charge-one'}),/belongs to another/);
  await assert.rejects(()=>commerce.settle('fixture',{...payment(order.id),currency:'USD'}),/currency/);

  const c=await job(),revoked=await commerce.create(member,{jobId:c.id,code:'PREMIUM',intent:'PURCHASE'},randomUUID());
  await db.companyMember.delete({where:{companyId_userId:{companyId:company.id,userId:member.id}}});
  assert.equal((await commerce.settle('fixture',payment(revoked.id,'revoked-member',299000))).status,'REVIEW');
  assert.equal(await db.jobBenefit.count({where:{jobId:c.id}}),0);
  const d=await job(),expired=await pending(d.id);
  await db.jobPurchaseOrder.update({where:{id:expired.id},data:{expiresAt:new Date(Date.now()-1)}});
  assert.equal((await commerce.settle('fixture',payment(expired.id,'expired-charge'))).status,'REVIEW');
  assert.equal(await db.jobBenefit.count({where:{jobId:d.id}}),0);

  let calls=0;
  class AmbiguousProvider extends JobPaymentProvider {
    override readonly name='ambiguous-fixture';override readonly available=true;
    override async checkout():Promise<{redirectUrl:string;reference:string}>{calls++;throw Error('Injected lost provider response');}
  }
  const e=await job(),ambiguous=await pending(e.id),connected=new JobCommerceService(db,benefits,operations,new AmbiguousProvider());
  await assert.rejects(()=>connected.paymentSession(hr,ambiguous.id),/lost provider/);
  await assert.rejects(()=>connected.paymentSession(hr,ambiguous.id),/needs review/);
  assert.equal(calls,1);assert.equal((await commerce.get(hr,ambiguous.id)).status,'PENDING');
  assert.equal((await db.operationKey.findUniqueOrThrow({where:{scope_key:{scope:'job-payment-session',key:ambiguous.id}}})).state,'REVIEW');

  const f=await job(),premium=await pending(f.id,'PREMIUM');await commerce.settle('fixture',payment(premium.id,'premium-empty',299000));
  await db.$transaction(async tx=>{await benefits.publish(f.id,tx);await tx.jobPost.update({where:{id:f.id},data:{status:'PUBLISHED',publishedAt:new Date()}});});
  const analytics=new HrAnalyticsService(db,benefits),start=performance.now();
  const summary=await analytics.summary(hr,company.id,f.id);const elapsed=Math.round(performance.now()-start);
  assert.equal(summary.totalApplications,0);assert.equal(summary.views,0);assert.equal(summary.conversionSessions,0);assert.equal(summary.capabilities.reports,true);
  assert.ok(!/NaN|Infinity/.test(JSON.stringify(summary)));
  const title='\t=HYPERLINK("https://invalid.test") Indonesia Русский O‘zbek 😀\nSecond line';
  await db.jobPost.update({where:{id:f.id},data:{title}});
  const csv=await analytics.csv(hr,company.id,f.id);assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes("'\t=HYPERLINK"));assert.ok(csv.includes('Русский O‘zbek 😀'));assert.ok(csv.includes('""https://invalid.test""'));
  const support=new HrSupportService(db,benefits,operations),ticketKey=randomUUID();
  const ticketInput={companyId:company.id,jobId:f.id,title:'Known priority delivery',body:'A synthetic request for priority support.'};
  const ticket=await support.create(hr,ticketInput,ticketKey);assert.equal(ticket.priority,true);
  assert.equal((await support.create(hr,ticketInput,ticketKey)).id,ticket.id);
  assert.ok((await support.list(admin)).items.some(item=>item.id===ticket.id));
  await support.update(admin,ticket.id,{status:'IN_PROGRESS',assignedToId:admin.id});
  await support.reply(admin,ticket.id,'A verified admin response.',randomUUID());assert.equal((await support.get(hr,ticket.id)).status,'WAITING_HR');
  await support.reply(hr,ticket.id,'Follow-up from the recruiter.',randomUUID());assert.equal((await support.get(admin,ticket.id)).status,'OPEN');
  await support.update(admin,ticket.id,{status:'RESOLVED'});assert.ok(!(await support.list(hr,company.id)).items.some(item=>item.id===ticket.id));
  assert.ok((await support.list(hr,company.id,1,'ALL')).items.some(item=>item.id===ticket.id));
  await db.jobBenefit.update({where:{jobId:f.id},data:{expiresAt:new Date(Date.now()-DAY_MS)}});
  const ordinary=await support.create(hr,{...ticketInput,title:'After package expiry'},randomUUID());assert.equal(ordinary.priority,false);
  assert.equal((await support.get(hr,ticket.id)).priority,true);
  const directUpgradeJob=await job();
  await commerce.create(hr,{jobId:directUpgradeJob.id,code:'FREE',intent:'PURCHASE'},randomUUID());
  await db.$transaction(async tx=>{await benefits.publish(directUpgradeJob.id,tx);await tx.jobPost.update({where:{id:directUpgradeJob.id},data:{status:'PUBLISHED',publishedAt:new Date()}});});
  const freePeriod=await db.jobBenefit.findUniqueOrThrow({where:{jobId:directUpgradeJob.id}});
  const directUpgrade=await commerce.create(hr,{jobId:directUpgradeJob.id,code:'PREMIUM',intent:'UPGRADE'},randomUUID());
  assert.equal(directUpgrade.amount,299000);await commerce.settle('fixture',payment(directUpgrade.id,'free-to-premium',299000));
  const premiumPeriod=await db.jobBenefit.findUniqueOrThrow({where:{jobId:directUpgradeJob.id}});
  assert.equal(premiumPeriod.code,'PREMIUM');assert.equal(premiumPeriod.expiresAt!.getTime(),freePeriod.expiresAt!.getTime());assert.equal(premiumPeriod.boostGrantedSeconds,7*86400);
  const snapshotJob=await job(),snapshotOrder=await pending(snapshotJob.id),oldPolicy=await benefits.policy('STANDARD');
  const changedPolicy=await db.packagePolicy.create({data:{code:'STANDARD',version:oldPolicy.version+1,settings:{...oldPolicy.settings,boostDays:2}}});
  try {
    await commerce.settle('fixture',payment(snapshotOrder.id,'immutable-policy'));
    const purchased=await db.jobBenefit.findUniqueOrThrow({where:{jobId:snapshotJob.id}});
    assert.equal(purchased.policyVersion,snapshotOrder.policyVersion);assert.deepEqual(purchased.policySnapshot,snapshotOrder.policySnapshot);
  } finally {await db.packagePolicy.delete({where:{id:changedPolicy.id}});}
  // History beyond the previous 100-row UI cap must remain reachable with stable ordering.
  const {id:sourceId,createdAt:sourceCreated,updatedAt:sourceUpdated,...template}=order;
  await db.jobPurchaseOrder.createMany({data:Array.from({length:112},()=>({...template,policySnapshot:order.policySnapshot as Prisma.InputJsonValue,id:'history-'+randomUUID(),status:'CANCELLED',createdAt:new Date('2020-01-01T00:00:00Z')}))});
  const seen:string[]=[];const history=await commerce.history(hr,company.id,1);
  assert.ok(history.total>100);assert.equal(history.items.length,20);
  for(let page=1;page<=Math.ceil(history.total/20);page++)seen.push(...(await commerce.history(hr,company.id,page)).items.map(item=>item.id));
  assert.equal(seen.length,history.total);assert.equal(new Set(seen).size,history.total);
  assert.deepEqual(seen,(await db.jobPurchaseOrder.findMany({where:{companyId:company.id},orderBy:[{createdAt:'desc'},{id:'desc'}],select:{id:true}})).map(item=>item.id));
  await assert.rejects(()=>commerce.history(member,company.id,1),/membership/);
  console.log('PASS deep package faults: atomic rollback/retry, duplicate charges, revoked member, late payment, uncertain provider at-most-once, empty/multilingual CSV, zero metrics, priority HR/admin lifecycle. Empty-report latency '+elapsed+'ms.');
}
