import { BadRequestException, ConflictException, Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { JobPackageCode, Prisma, JobPurchaseOrder } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/auth.decorators';
import { BenefitsService } from './benefits.service';
import { OperationsService } from './operations.service';
import { PACKAGE_ORDER, BenefitPolicy } from './benefit-policy';
import { localCheckoutEnabled, PACKAGE_CATALOG_VERSION, PACKAGE_PRICES, packageAmount, PurchaseIntent } from './package-catalog';
import { JobPaymentProvider, VerifiedJobPayment } from './job-payment.provider';
import { assertHrFlowEnabled, hrFlowEnabled } from '../hr-flow/hr-flow.policy';

@Injectable()
export class JobCommerceService {
  constructor(private db: PrismaService, private benefits: BenefitsService,
    private operations: OperationsService, private provider: JobPaymentProvider) {}

  async catalog() {
    const packages = await Promise.all(PACKAGE_ORDER.map(async code => ({
      code, amount: PACKAGE_PRICES[code], currency: 'IDR', ...(await this.benefits.policy(code)),
      linkedin: code === 'PREMIUM',
      instagram: code === 'PREMIUM' ? 'COMING_SOON' : 'NOT_INCLUDED', candidateSearch: true, cvDatabase: true,
    })));
    return { version: PACKAGE_CATALOG_VERSION, hrFlowV2:hrFlowEnabled(),perJob: true, packages, enabled: await this.benefits.enabled(),
      testMode: localCheckoutEnabled(), paymentAvailable: this.provider.available };
  }
  private async job(actor: AuthUser, id: string, db: Prisma.TransactionClient = this.db) {
    const job = await db.jobPost.findUnique({ where: { id }, include: { company: true, benefit: true } });
    if (!job) throw new NotFoundException('Job not found');
    await this.benefits.member(actor, job.companyId, db);
    return job;
  }
  private validate(intent: PurchaseIntent, code: JobPackageCode, benefit: {code: JobPackageCode; startsAt: Date|null; expiresAt: Date|null} | null) {
    const expired = Boolean(benefit?.expiresAt && benefit.expiresAt <= new Date());
    if (intent === 'RENEW') {
      if (!expired) throw new ConflictException('Renewal is available after the publication period expires');
    } else if (expired) throw new ConflictException('This job has expired. Choose renewal to start a new period');
    else if (intent === 'UPGRADE') {
      if (!benefit || PACKAGE_ORDER.indexOf(code) <= PACKAGE_ORDER.indexOf(benefit.code))
        throw new ConflictException('Choose a higher package to upgrade');
    } else if (benefit && (benefit.startsAt || benefit.code !== 'FREE')) {
      throw new ConflictException('This job already has a package. Choose an upgrade or renewal');
    }
  }
  async create(actor: AuthUser, input: {jobId?: string; creationSessionId?:string; code: JobPackageCode; intent: PurchaseIntent}, key?: string) {
    await this.benefits.assertEnabled();
    if(input.creationSessionId)return this.createForSession(actor,input.creationSessionId,input.code,key);
    if(!input.jobId)throw new BadRequestException('A job or creation session is required');
    const before = await this.job(actor, input.jobId);
    return (await this.operations.transaction('job-order:' + actor.id, key, input, async db => {
      await db.$queryRaw`SELECT id FROM "Company" WHERE id=${before.companyId} FOR UPDATE`;
      const job = await this.job(actor, before.id, db);
      this.validate(input.intent, input.code, job.benefit);
      const policy = await this.benefits.policy(input.code, db);
      const amount = packageAmount(input.code, input.intent, job.benefit?.code ?? 'FREE');
      const pending = amount > 0 ? await db.jobPurchaseOrder.findFirst({where: {
        jobId: job.id, createdById: actor.id, code: input.code, intent: input.intent,
        status: 'PENDING', amount, catalogVersion: PACKAGE_CATALOG_VERSION, policyVersion: policy.version,
        expectedBenefitVersion: job.benefit?.updatedAt.toISOString() ?? null, expiresAt: {gt: new Date()},
      }, orderBy: {createdAt: 'desc'}}) : null;
      if (pending) return pending;
      const active=await db.$queryRaw<Array<{id:string}>>`
        SELECT o.id FROM "JobPurchaseOrder" o WHERE o."jobId"=${job.id} AND o.status IN ('PENDING','REVIEW')
          AND (o.provider IS NOT NULL OR EXISTS(SELECT 1 FROM "OperationKey" k WHERE k.scope='job-payment-session' AND k.key=o.id)) LIMIT 1`;
      if(active.length)throw new ConflictException('Reconcile or cancel the existing checkout before changing the package');
      const order = await db.jobPurchaseOrder.create({ data: {
        jobId:job.id,code:input.code,intent:input.intent,companyId: job.companyId, createdById: actor.id,
        jobTitle: job.title, companyName: job.company.name, amount,
        catalogVersion: PACKAGE_CATALOG_VERSION, policyVersion: policy.version,
        policySnapshot: policy.settings, expectedBenefitVersion: job.benefit?.updatedAt.toISOString() ?? null,
        expiresAt: new Date(Date.now() + 24 * 3600000),
      } });
      if (amount === 0) return this.fulfill(db, actor, order, 'free', 'free:' + order.id);
      return order;
    })).value;
  }
  private async createForSession(actor:AuthUser,sessionId:string,code:JobPackageCode,key?:string){
    assertHrFlowEnabled();
    const before=await this.db.jobCreationSession.findUnique({where:{id:sessionId}});
    if(!before)throw new NotFoundException('Draft not found');
    return (await this.operations.transaction('creation-order:'+actor.id,key,{sessionId,code},async db=>{
      await db.$queryRaw`SELECT id FROM "Company" WHERE id=${before.companyId} FOR UPDATE`;
      const company=await this.benefits.member(actor,before.companyId,db);
      const session=await db.jobCreationSession.findUniqueOrThrow({where:{id:sessionId}});
      if(session.jobId)throw new ConflictException('This job is already published');
      const previous=session.orderId?await db.jobPurchaseOrder.findUnique({where:{id:session.orderId}}):null;
      if(previous?.status==='PAID'){
        if(previous.code!==code)throw new ConflictException('This draft already has a confirmed package');
        return previous;
      }
      if(previous?.status==='REVIEW')throw new ConflictException('The existing payment needs reconciliation');
      if(previous?.status==='PENDING'&&previous.expiresAt>new Date()&&previous.code===code)return previous;
      if(previous?.status==='PENDING'&&(previous.paymentRedirectUrl||await db.operationKey.findUnique({where:{scope_key:{scope:'job-payment-session',key:previous.id}}})))throw new ConflictException('Cancel or finish the existing checkout before choosing another package');
      if(previous?.status==='PENDING')await db.jobPurchaseOrder.update({where:{id:previous.id},data:{status:'CANCELLED'}});
      const policy=await this.benefits.policy(code,db),amount=PACKAGE_PRICES[code];
      const order=await db.jobPurchaseOrder.create({data:{creationSessionId:sessionId,companyId:company.id,createdById:actor.id,code,intent:'PURCHASE',amount,catalogVersion:PACKAGE_CATALOG_VERSION,policyVersion:policy.version,policySnapshot:policy.settings,companyName:company.name,jobTitle:'Lowongan baru',expiresAt:new Date(Date.now()+86400000),...(amount===0?{status:'PAID',provider:'free',providerReference:'free:'+sessionId,paidAt:new Date()}:{})}});
      await db.jobCreationSession.update({where:{id:sessionId},data:{orderId:order.id,phase:amount===0?'JOB':'CHECKOUT',revision:{increment:1}}});
      return order;
    })).value;
  }
  async get(actor: AuthUser, id: string) {
    const order = await this.db.jobPurchaseOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('Order not found');
    await this.benefits.member(actor, order.companyId);
    if (order.status === 'PENDING' && order.expiresAt <= new Date())
      return this.db.jobPurchaseOrder.update({ where: { id, status: 'PENDING' }, data: { status: 'EXPIRED' } }).catch(() => this.db.jobPurchaseOrder.findUniqueOrThrow({ where: {id} }));
    return order;
  }
  async list(actor: AuthUser, companyId: string) {
    await this.benefits.member(actor, companyId);
    const orders = await this.db.jobPurchaseOrder.findMany({ where: { companyId }, orderBy: [{createdAt: 'desc'}, {id:'desc'}], take: 100 });
    return orders.map(order => ({...order, status: order.status === 'PENDING' && order.expiresAt <= new Date() ? 'EXPIRED' : order.status}));
  }
  async history(actor: AuthUser, companyId: string, page: number) {
    await this.benefits.member(actor, companyId);
    const [orders, total] = await this.db.$transaction([
      this.db.jobPurchaseOrder.findMany({where:{companyId},orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(page-1)*20,take:20}),
      this.db.jobPurchaseOrder.count({where:{companyId}}),
    ], {isolationLevel:'RepeatableRead'});
    return {items:orders.map(order=>({...order,status:order.status==='PENDING'&&order.expiresAt<=new Date()?'EXPIRED':order.status})),total,page,limit:20};
  }
  async cancel(actor: AuthUser, id: string) {
    const before = await this.get(actor, id);
    if(before.status==='PENDING'&&before.paymentRedirectUrl){
      const confirmed=await this.settle(this.provider.name,await this.provider.cancel(id));
      if(confirmed.status==='PAID'||confirmed.status==='REVIEW')throw new ConflictException('Payment received. Review the existing order.');
      return confirmed;
    }
    return this.db.$transaction(async db => {
      await db.$queryRaw`SELECT id FROM "Company" WHERE id=${before.companyId} FOR UPDATE`;
      await this.benefits.member(actor, before.companyId, db);
      const order = await db.jobPurchaseOrder.findUniqueOrThrow({ where: {id} });
      if (order.status === 'CANCELLED') return order;
      if (order.status !== 'PENDING') throw new ConflictException('Only pending orders can be cancelled');
      if(await db.operationKey.findUnique({where:{scope_key:{scope:'job-payment-session',key:id}}}))throw new ConflictException('A provider transaction exists or needs reconciliation. Check its status before cancelling.');
      return db.jobPurchaseOrder.update({ where: {id}, data: {status: 'CANCELLED'} });
    });
  }
  private async fulfill(db: Prisma.TransactionClient, actor: AuthUser, order: JobPurchaseOrder, provider: string, reference: string) {
    if(!order.jobId)throw new ConflictException('This order is bound to a creation session');
    const job = await this.job(actor, order.jobId, db);
    if ((job.benefit?.updatedAt.toISOString() ?? null) !== order.expectedBenefitVersion)
      throw new ConflictException('Job package changed. Review this order before continuing');
    this.validate(order.intent as PurchaseIntent, order.code, job.benefit);
    await this.benefits.applyPurchase(actor, order.jobId, order.code, order.intent as PurchaseIntent,
      {version: order.policyVersion, settings: order.policySnapshot as unknown as BenefitPolicy}, db);
    await db.jobPurchaseOrder.updateMany({where: {jobId: order.jobId, id: {not: order.id}, status: 'PENDING'}, data: {status: 'CANCELLED'}});
    await db.auditLog.create({ data: {actorId: actor.id, action: 'JOB_ORDER_FULFILLED', entityType: 'JobPurchaseOrder', entityId: order.id,
      metadata: {jobId: order.jobId, code: order.code, intent: order.intent, amount: order.amount, currency: order.currency, provider} } });
    return db.jobPurchaseOrder.update({ where: {id: order.id}, data: {
      status: 'PAID', paidAt: new Date(), fulfilledAt: new Date(), provider, providerReference: reference,
    } });
  }
  /** Called only after adapter verification (or the explicit local test route).
   * Duplicate events never repeat grants. Paid but unfulfillable orders remain
   * REVIEW for reconciliation rather than silently losing a payment. */
  async settle(provider: string, event: VerifiedJobPayment) {
    if (!event.eventId || !event.reference || !Number.isSafeInteger(event.amount)) throw new BadRequestException('Invalid payment event');
    const before = await this.db.jobPurchaseOrder.findUnique({ where: {id: event.orderId} });
    if (!before) throw new NotFoundException('Order not found');
    if(before.creationSessionId)return this.settleCreation(provider,event,before);
    if(event.status&&event.status!=='PAID')return this.nonPaid(provider,event,before);
    return this.db.$transaction(async db => {
      await db.$queryRaw`SELECT id FROM "Company" WHERE id=${before.companyId} FOR UPDATE`;
      const order = await db.jobPurchaseOrder.findUniqueOrThrow({ where: {id: event.orderId} });
      if (order.amount !== event.amount || order.currency !== event.currency) throw new BadRequestException('Payment amount or currency does not match the order');
      const priorEvent = await db.jobPaymentEvent.findUnique({where: {provider_eventId: {provider, eventId: event.eventId}}});
      if (priorEvent && priorEvent.orderId !== order.id) throw new ConflictException('Payment event belongs to another order');
      if (priorEvent) return order;
      if (order.status === 'PAID' || order.status === 'REVIEW') {
        await db.jobPaymentEvent.create({data: {orderId: order.id, provider, eventId: event.eventId, amount: event.amount, currency: event.currency}});
        if (order.providerReference !== provider + ':' + event.reference) {
          await db.auditLog.create({data: {action: 'JOB_DUPLICATE_PAYMENT_REVIEW', entityType: 'JobPurchaseOrder', entityId: order.id, metadata: {provider, eventId: event.eventId}}});
          return db.jobPurchaseOrder.update({where: {id: order.id}, data: {status: 'REVIEW'}});
        }
        return order;
      }
      const referenceOrder = await db.jobPurchaseOrder.findUnique({where: {providerReference: provider + ':' + event.reference}});
      if (referenceOrder && referenceOrder.id !== order.id) throw new ConflictException('Payment reference already used');
      await db.jobPaymentEvent.create({data: {orderId: order.id, provider, eventId: event.eventId, amount: event.amount, currency: event.currency}});
      const actor = await db.user.findUnique({where: {id: order.createdById}});
      const job = order.jobId?await db.jobPost.findUnique({where: {id: order.jobId}, include: {benefit: true, company: true}}):null;
      let eligible = Boolean(actor && !actor.isBanned && !actor.anonymizedAt && job && !job.company.isBanned && !job.company.anonymizedAt
        && (await db.companyMember.count({where: {companyId: order.companyId, userId: actor.id}}) || actor.role === 'SUPER_ADMIN')
        && (job.benefit?.updatedAt.toISOString() ?? null) === order.expectedBenefitVersion);
      try {this.validate(order.intent as PurchaseIntent, order.code, job?.benefit ?? null);} catch {eligible = false;}
      if (!eligible || order.status !== 'PENDING' || order.expiresAt <= new Date()) {
        await db.auditLog.create({data: {action: 'JOB_PAYMENT_REVIEW_REQUIRED', entityType: 'JobPurchaseOrder', entityId: order.id, metadata: {provider}}});
        return db.jobPurchaseOrder.update({where: {id: order.id}, data: {status: 'REVIEW', paidAt: new Date(), provider, providerReference: provider + ':' + event.reference}});
      }
      return this.fulfill(db, actor!, order, provider, provider + ':' + event.reference);
    }, {maxWait: 15000, timeout: 30000});
  }
  private async nonPaid(provider:string,event:VerifiedJobPayment,before:JobPurchaseOrder){
    return this.db.$transaction(async db=>{
      await db.$queryRaw`SELECT id FROM "Company" WHERE id=${before.companyId} FOR UPDATE`;
      const order=await db.jobPurchaseOrder.findUniqueOrThrow({where:{id:before.id}});
      if(order.amount!==event.amount||order.currency!==event.currency)throw new BadRequestException('Payment amount or currency mismatch');
      if(order.status==='PAID'&&event.status!=='REVIEW')return order;
      if(['REVIEW','CANCELLED','EXPIRED','FAILED'].includes(order.status)&&event.status==='PENDING')return order;
      return db.jobPurchaseOrder.update({where:{id:order.id},data:{status:event.status,provider,providerTransactionId:event.reference}});
    });
  }
  private async settleCreation(provider:string,event:VerifiedJobPayment,before:JobPurchaseOrder){
    return this.db.$transaction(async db=>{
      await db.$queryRaw`SELECT id FROM "Company" WHERE id=${before.companyId} FOR UPDATE`;
      const order=await db.jobPurchaseOrder.findUniqueOrThrow({where:{id:before.id}});
      if(order.provider&&order.provider!==provider)throw new BadRequestException('Payment environment mismatch');
      const old=await db.jobPaymentEvent.findUnique({where:{provider_eventId:{provider,eventId:event.eventId}}});
      if(old){if(old.orderId!==order.id)throw new ConflictException('Payment event belongs to another order');return order;}
      await db.jobPaymentEvent.create({data:{orderId:order.id,provider,eventId:event.eventId,amount:event.amount,currency:event.currency}});
      const mismatch=order.amount!==event.amount||order.currency!==event.currency;
      if(mismatch){
        await db.auditLog.create({data:{action:'JOB_PAYMENT_AMOUNT_REVIEW',entityType:'JobPurchaseOrder',entityId:order.id}});
        return db.jobPurchaseOrder.update({where:{id:order.id},data:{status:'REVIEW',provider,providerTransactionId:event.reference}});
      }
      if(order.status==='PAID'&&event.status!=='REVIEW'){
        if(order.providerTransactionId&&order.providerTransactionId!==event.reference)return db.jobPurchaseOrder.update({where:{id:order.id},data:{status:'REVIEW'}});
        return order;
      }
      const session=await db.jobCreationSession.findUnique({where:{id:order.creationSessionId!}});
      if(event.status&&event.status!=='PAID'){
        if(order.status!=='PENDING'&&event.status==='PENDING')return order;
        return db.jobPurchaseOrder.update({where:{id:order.id},data:{status:event.status,provider,providerTransactionId:event.reference}});
      }
      const actor=await db.user.findUnique({where:{id:order.createdById}});
      const company=await db.company.findUnique({where:{id:order.companyId}});
      const member=actor&&await db.companyMember.count({where:{companyId:order.companyId,userId:actor.id}});
      const eligible=order.status==='PENDING'&&order.expiresAt>new Date()&&session?.orderId===order.id&&!session.jobId&&actor&&!actor.isBanned&&!actor.anonymizedAt&&company&&!company.isBanned&&!company.anonymizedAt&&(member||actor.role==='SUPER_ADMIN');
      const paid=await db.jobPurchaseOrder.update({where:{id:order.id},data:{status:eligible?'PAID':'REVIEW',paidAt:new Date(),provider,providerReference:provider+':'+event.reference,providerTransactionId:event.reference}});
      if(eligible)await db.jobCreationSession.update({where:{id:session!.id},data:{phase:'JOB',revision:{increment:1}}});
      await db.auditLog.create({data:{action:eligible?'JOB_CREATION_PAYMENT_CONFIRMED':'JOB_PAYMENT_REVIEW_REQUIRED',entityType:'JobPurchaseOrder',entityId:order.id}});
      return paid;
    });
  }
  async reconcile(actor:AuthUser,id:string){
    const order=await this.get(actor,id);
    if(order.provider==='free')return order;
    return this.settle(this.provider.name,await this.provider.queryStatus(id));
  }
  async completeTest(actor: AuthUser, id: string) {
    if (!localCheckoutEnabled()) throw new ForbiddenException('Local test checkout is disabled');
    const order = await this.get(actor, id);
    if (order.status === 'PAID') return order;
    if (order.status !== 'PENDING') throw new ConflictException('This order cannot be completed');
    return this.settle('local-test', {orderId: id, eventId: 'local:' + id, reference: id, amount: order.amount, currency: order.currency});
  }
  async paymentSession(actor: AuthUser, id: string) {
    const before=await this.get(actor,id);
    if(!this.provider.available)throw new ConflictException('Payment gateway is not connected');
    return this.db.$transaction(async db=>{
      await db.$queryRaw`SELECT id FROM "Company" WHERE id=${before.companyId} FOR UPDATE`;
      await this.benefits.member(actor,before.companyId,db);
      const order=await db.jobPurchaseOrder.findUniqueOrThrow({where:{id}});
      if(order.status!=='PENDING'||order.expiresAt<=new Date())throw new ConflictException('This order cannot be paid');
      if(order.paymentRedirectUrl)return {redirectUrl:order.paymentRedirectUrl,reference:order.id};
      if(!order.creationSessionId){
        if(!order.jobId)throw new ConflictException('Missing order subject');
        const job=await this.job(actor,order.jobId,db);
        if((job.benefit?.updatedAt.toISOString()??null)!==order.expectedBenefitVersion)throw new ConflictException('Job package changed. Choose a new package before payment');
        this.validate(order.intent as PurchaseIntent,order.code,job.benefit);
      }
      // Keep cancellation/package changes behind the same company lock. The
      // operation claim survives an ambiguous network failure, preventing a
      // replacement transaction until the existing one has been reconciled.
      const value=await this.operations.external('job-payment-session',order.id,{orderId:order.id,amount:order.amount,currency:order.currency,provider:this.provider.name},async()=>{
        await this.db.jobPurchaseOrder.updateMany({where:{id:order.id,status:'PENDING'},data:{provider:this.provider.name}});
        return this.provider.checkout(order);
      });
      await db.jobPurchaseOrder.update({where:{id},data:{paymentRedirectUrl:value.redirectUrl,provider:this.provider.name}});
      return value;
    },{maxWait:15000,timeout:30000});
  }
}
