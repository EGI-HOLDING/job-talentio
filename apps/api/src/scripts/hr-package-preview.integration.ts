import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { JobPackageCode, JobPurchaseOrder } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import type { AuthUser } from '../common/auth.decorators';
import { PrismaService } from '../prisma/prisma.service';
import { BenefitsService } from '../benefits/benefits.service';
import { OperationsService } from '../benefits/operations.service';
import { HrAnalyticsService } from '../benefits/hr-analytics.service';
import { HrSupportService } from '../benefits/hr-support.service';
import { JobCommerceService } from '../benefits/job-commerce.service';
import { JobPaymentProvider, type VerifiedJobPayment } from '../benefits/job-payment.provider';
import { DAY_MS } from '../benefits/benefit-policy';
import { activeCompanyFeatures } from '../benefits/company-featured';
import { localCheckoutEnabled, packageCatalog } from '../benefits/package-catalog';
import { CompaniesService } from '../companies/companies.service';
import { LinkedInSettings } from '../linkedin/linkedin-settings';
import { LinkedInClient } from '../linkedin/linkedin-client';
import { LinkedInService } from '../linkedin/linkedin.service';
import { LinkedInWorkerService } from '../linkedin/linkedin-worker.service';
import { StorageService } from '../storage/storage.service';
import { JobContentAiService } from '../job-content-ai/job-content-ai.service';
import { generateJobContentSchema } from '../job-content-ai/job-content-ai.schema';

const database = new URL(process.env.DATABASE_URL ?? '');
assert.equal(database.hostname, '127.0.0.1');
assert.equal(database.pathname, '/talentio_hr_package_preview');
assert.equal(process.env.MIDTRANS_ENV, 'sandbox');
const db = new PrismaService();
const operations = new OperationsService(db);
const benefits = new BenefitsService(db, operations);
const analytics = new HrAnalyticsService(db, benefits);
const support = new HrSupportService(db, benefits, operations);
const receipts = path.join(path.dirname(process.env.HR_PACKAGE_PREVIEW_ACCOUNT_FILE!), 'integration-report.json');
const sampleId = randomUUID();
const payment = (order: JobPurchaseOrder, status: VerifiedJobPayment['status'] = 'PAID'): VerifiedJobPayment => ({
  orderId: order.id, eventId: randomUUID(), reference: randomUUID(), amount: order.amount, currency: order.currency, status,
});

class FixtureProvider extends JobPaymentProvider {
  result?: VerifiedJobPayment;

  override queryStatus(id: string): Promise<VerifiedJobPayment> {
    assert.equal(this.result?.orderId, id);
    return Promise.resolve(this.result!);
  }
}

async function linkedinRecovery(hr: AuthUser, companyId: string, jobId: string) {
  const config = new ConfigService();
  const settings = new LinkedInSettings(config);
  assert.equal(settings.simulated, true);
  const storage = new StorageService(config);
  const client = new LinkedInClient(settings);
  client.setQuota(async () => undefined);
  const shares = new LinkedInService(db, settings, client, storage);
  const worker = new LinkedInWorkerService(db, settings, client, shares, storage, config);
  const connection = await shares.startConnection(hr, '/id/dashboard/recruiter/jobs/' + jobId, companyId);
  const authorization = new URL(connection.authorizationUrl);
  const callback = { state: authorization.searchParams.get('state')!, code: authorization.searchParams.get('code')! };
  assert.equal(new URL(await shares.callback(callback, connection.cookie)).searchParams.get('linkedin'), 'connected');
  const [page] = await shares.companyPages(hr, companyId);
  await shares.selectCompanyPage(hr, companyId, page.urn);
  const preview = await shares.preview(hr, jobId, 'id');
  const queued = await db.$transaction(async tx => {
    const post = await shares.enqueueApproved(tx, hr, jobId, preview.id);
    // Hold the fixture in the outbox while the worker under test simulates loss of page access.
    await tx.linkedInOutbox.update({
      where: { socialPostId: post.id }, data: { nextDispatchAt: new Date(Date.now() + DAY_MS) },
    });
    return post;
  });
  const authorizedPages = client.organizationUrns.bind(client);
  client.organizationUrns = async () => [];
  await worker.process(queued.id);
  const cancelled = await db.linkedInSocialPost.findUniqueOrThrow({ where: { id: queued.id } });
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal(cancelled.errorCode, 'ACCESS_REVOKED');
  assert.equal(cancelled.providerPostUrn, null);

  client.organizationUrns = authorizedPages;
  const refreshed = await shares.preview(hr, jobId, 'id');
  assert.equal((await shares.retry(hr, queued.id, refreshed.id)).id, queued.id);
  await worker.process(queued.id);
  const [sent] = await shares.list(hr, jobId);
  assert.equal(sent.status, 'PUBLISHED');
  assert.equal((await shares.requestShare(hr, jobId, refreshed.id)).id, sent.id);
  assert.equal(await db.linkedInSocialPost.count({ where: { jobId } }), 1);
}

async function validateWebhook() {
  const original = process.env.MIDTRANS_SERVER_KEY;
  const fixtureKey = 'SB-Midtrans-fixture-only';
  process.env.MIDTRANS_SERVER_KEY = fixtureKey;
  try {
    const provider = new FixtureProvider();
    const orderId = 'local-fixture-' + randomUUID();
    const body = { order_id: orderId, status_code: '200', gross_amount: '49000.00' };
    const signature = createHash('sha512').update(orderId + body.status_code + body.gross_amount + fixtureKey).digest('hex');
    const signed = JSON.stringify({ ...body, signature_key: signature });
    provider.result = { orderId, status: 'PAID', amount: 49000, eventId: randomUUID(), reference: randomUUID(), currency: 'IDR' };
    assert.deepEqual(await provider.verify({}, Buffer.from(signed)), provider.result);
    await assert.rejects(() => provider.verify({}, Buffer.from(JSON.stringify({
      ...body, gross_amount: '149000.00', signature_key: signature,
    }))), /Invalid payment signature/);
  } finally {
    if (original) process.env.MIDTRANS_SERVER_KEY = original;
    else delete process.env.MIDTRANS_SERVER_KEY;
  }
}

async function transactions() {
  assert.equal(packageCatalog().version, 2);
  assert.ok(packageCatalog().previewCapacities);
  const deployed = { ...process.env, NODE_ENV: 'production', CHECKOUT_TEST_MODE: 'true' };
  assert.deepEqual(packageCatalog(deployed).offers, ['LITE', 'STANDARD', 'PREMIUM']);
  assert.equal(packageCatalog(deployed).previewCapacities, undefined);
  assert.equal(localCheckoutEnabled(deployed), false);
  assert.deepEqual(packageCatalog({ ...deployed, HR_PACKAGE_CATALOG_V2: 'false' }).offers, ['FREE', 'STANDARD', 'PREMIUM']);
  assert.equal(packageCatalog({ ...deployed, HR_FLOW_MARKET: 'uz' }).version, 1);
  const provider = new FixtureProvider();
  const commerce = new JobCommerceService(db, benefits, operations, provider);
  const [hr, outsider] = await Promise.all([
    db.user.create({ data: { fullName: 'HR fixture ' + sampleId, role: 'RECRUITER' } }),
    db.user.create({ data: { fullName: 'Other company fixture ' + sampleId, role: 'RECRUITER' } }),
  ]);
  const company = await db.company.create({ data: {
    name: 'Package integrity fixture', slug: 'package-fixture-' + sampleId, members: { create: { userId: hr.id, role: 'OWNER' } },
  } });
  const draft = () => db.jobPost.create({ data: {
    title: 'Operations Coordinator ' + randomUUID(), companyId: company.id, workMode: 'REMOTE', locale: 'id',
    description: 'Operasikan jadwal, periksa data, dan buat ringkasan hasil untuk tim.',
  } });
  const publish = async (jobId: string) => db.$transaction(async tx => {
    await benefits.publish(jobId, tx);
    await tx.jobPost.update({ where: { id: jobId }, data: { status: 'PUBLISHED', publishedAt: new Date() } });
  });
  try {
    const lite = await draft();
    const input = { jobId: lite.id, code: 'LITE' as const, intent: 'PURCHASE' as const };
    await assert.rejects(() => commerce.create(outsider, input, randomUUID()));
    await assert.rejects(() => commerce.create(hr, { ...input, code: 'FREE' }, randomUUID()), /not offered/);
    const key = randomUUID();
    const [one, two] = await Promise.all([commerce.create(hr, input, key), commerce.create(hr, input, key)]);
    assert.equal(one.id, two.id);
    assert.equal(one.catalogVersion, 2);
    assert.equal(one.amount, 49000);
    await assert.rejects(() => commerce.completeTest(hr, one.id), /disabled/);
    await assert.rejects(() => commerce.get(outsider, one.id));
    const confirmed = payment(one);
    await Promise.all([commerce.settle('fixture', confirmed), commerce.settle('fixture', confirmed)]);
    assert.equal(await db.jobPaymentEvent.count({ where: { orderId: one.id } }), 1);
    await publish(lite.id);
    await publish(lite.id);
    const first = await db.jobPublicationPeriod.findUniqueOrThrow({ where: { jobId_cycle: { jobId: lite.id, cycle: 1 } } });
    assert.equal(first.expiresAt.getTime() - first.startsAt.getTime(), 30 * DAY_MS);
    assert.equal(first.featuredEndsAt!.getTime() - first.startsAt.getTime(), 3 * DAY_MS);
    assert.equal((await benefits.job(hr, lite.id)).activeBoost, null);
    assert.equal((await benefits.job(hr, lite.id)).boostRemainingSeconds, 86400);
    const boostKey = randomUUID();
    await Promise.all([benefits.boost(hr, lite.id, boostKey), benefits.boost(hr, lite.id, boostKey)]);
    assert.equal(await db.boostEpisode.count({ where: { benefit: { jobId: lite.id } } }), 1);
    assert.equal(await db.jobPublicationPeriod.count({ where: { jobId: lite.id } }), 1);
    const liteReport = await analytics.summary(hr, company.id, lite.id);
    assert.equal(liteReport.capabilities.conversions, false);
    assert.equal(liteReport.capabilities.reports, false);
    await assert.rejects(() => analytics.csv(hr, company.id, lite.id));

    const upgrade = await commerce.create(hr, { ...input, code: 'STANDARD', intent: 'UPGRADE' }, randomUUID());
    assert.equal(upgrade.amount, 100000);
    await commerce.settle('fixture', payment(upgrade));
    const standard = await db.jobPublicationPeriod.findUniqueOrThrow({ where: { jobId_cycle: { jobId: lite.id, cycle: 1 } } });
    assert.equal(standard.expiresAt.getTime(), first.expiresAt.getTime());
    assert.equal(standard.featuredEndsAt!.getTime() - standard.featuredStartsAt!.getTime(), 14 * DAY_MS);
    assert.equal((await analytics.summary(hr, company.id, lite.id)).capabilities.conversions, true);
    await assert.rejects(() => analytics.csv(hr, company.id, lite.id));
    await assert.rejects(() => commerce.create(hr, { ...input, intent: 'RENEW' }, randomUUID()), /after/);
    const expiration = new Date(Date.now() - 1000);
    await db.jobBenefit.update({ where: { jobId: lite.id }, data: { expiresAt: expiration } });
    await db.jobPublicationPeriod.update({ where: { id: standard.id }, data: { expiresAt: expiration } });
    const renew = await commerce.create(hr, { ...input, code: 'PREMIUM', intent: 'RENEW' }, randomUUID());
    assert.equal(renew.amount, 299000);
    await commerce.settle('fixture', payment(renew));
    assert.equal((await db.jobPost.findUniqueOrThrow({ where: { id: lite.id } })).status, 'DRAFT');
    await publish(lite.id);
    const premium = await db.jobPublicationPeriod.findUniqueOrThrow({ where: { jobId_cycle: { jobId: lite.id, cycle: 2 } } });
    assert.equal(premium.expiresAt.getTime() - premium.startsAt.getTime(), 30 * DAY_MS);
    assert.deepEqual(premium.featuredEndsAt, premium.expiresAt);
    assert.equal((await benefits.job(hr, lite.id)).boostRemainingSeconds, 7 * 86400);
    assert.ok((await analytics.csv(hr, company.id, lite.id)).length > 0);
    const ticket = await support.create(hr, {
      companyId: company.id, jobId: lite.id, title: 'Package preview support', body: 'Isolated entitlement test',
    }, randomUUID());
    assert.equal(ticket.priority, true);
    await linkedinRecovery(hr, company.id, lite.id);

    const second = await draft();
    const secondOrder = await commerce.create(hr, { ...input, jobId: second.id }, randomUUID());
    await commerce.settle('fixture', payment(secondOrder));
    await publish(second.id);
    const directory = new CompaniesService(db, {} as never, {} as never, {} as never, {} as never, {} as never);
    const ownFeatured = async () => (await directory.browse({ sort: 'featured', q: company.slug, page: 1, limit: 24 })).items;
    assert.equal((await ownFeatured()).length, 1, 'Multiple promoted jobs yield one company card');
    await db.jobPublicationPeriod.updateMany({ where: { jobId: second.id }, data: { featuredEndsAt: expiration } });
    await db.jobPublicationPeriod.update({ where: { id: premium.id }, data: { featuredEndsAt: expiration } });
    assert.deepEqual(await ownFeatured(), []);
    assert.equal((await db.jobPost.findUniqueOrThrow({ where: { id: lite.id } })).status, 'PUBLISHED');
    await db.jobPublicationPeriod.update({ where: { id: premium.id }, data: { featuredEndsAt: premium.featuredEndsAt } });
    await db.jobPost.update({ where: { id: lite.id }, data: { status: 'CLOSED' } });
    assert.equal((await benefits.company(hr, company.id)).featuredUntil, null);

    for (const status of ['FAILED', 'EXPIRED'] as const) {
      const job = await draft();
      const pending = await commerce.create(hr, { ...input, jobId: job.id }, randomUUID());
      const result = await commerce.settle('fixture', payment(pending, status));
      assert.equal(result.status, status);
      await assert.rejects(() => publish(job.id), /PACKAGE_REQUIRED/);
      assert.equal(await db.jobBenefit.count({ where: { jobId: job.id, selectionConfirmedAt: { not: null } } }), 0);
    }

    const legacy = await draft();
    const flag = process.env.HR_PACKAGE_CATALOG_V2;
    let legacyOrder: JobPurchaseOrder;
    delete process.env.HR_PACKAGE_CATALOG_V2;
    try {
      legacyOrder = await commerce.create(hr, { jobId: legacy.id, code: 'FREE', intent: 'PURCHASE' }, randomUUID());
    } finally { process.env.HR_PACKAGE_CATALOG_V2 = flag!; }
    assert.equal(legacyOrder.status, 'PAID');
    assert.equal(legacyOrder.catalogVersion, 1);
    await publish(legacy.id);
    const historic = await commerce.history(hr, company.id, 1);
    assert.ok(historic.items.some(order => order.id === legacyOrder.id && order.code === 'FREE'));
    await validateWebhook();
  } finally {
    await db.jobPost.updateMany({ where: { companyId: company.id }, data: { status: 'CLOSED' } });
    await db.company.update({ where: { id: company.id }, data: { isBanned: true } });
  }
}

async function verifySandboxReceipts() {
  const expected: Array<[JobPackageCode, number, number, number]> =
    [['LITE', 49000, 1, 3], ['STANDARD', 149000, 3, 14], ['PREMIUM', 299000, 7, 30]];
  const slugs = expected.map(([code]) => 'package-preview-' + code.toLowerCase());
  const companies = await db.company.findMany({ where: { slug: { in: slugs } } });
  const hrId = (await db.user.findUniqueOrThrow({
    where: { email: JSON.parse(readFileSync(process.env.HR_PACKAGE_PREVIEW_ACCOUNT_FILE!, 'utf8')).email },
  })).id;
  const hr: AuthUser = { id: hrId, role: 'RECRUITER', email: null, fullName: 'HR Preview', isBanned: false };
  const jobAi = new JobContentAiService(db, {
    assertMember: (actor: AuthUser, companyId: string) => benefits.member(actor, companyId),
  } as unknown as CompaniesService, {} as never, new ConfigService(), {
    enabled: true, chatJson: async () => ({ description: 'Mengelola operasi dan menyusun laporan hasil untuk tim.' }),
  } as never);
  const validated = [];
  for (const [code, price, boostDays, featuredDays] of expected) {
    const company = companies.find(row => row.slug === 'package-preview-' + code.toLowerCase())!;
    const order = await db.jobPurchaseOrder.findFirst({
      where: { code, companyId: company.id, status: 'PAID', provider: 'midtrans-sandbox', fulfilledAt: { not: null } },
      orderBy: { fulfilledAt: 'desc' },
    });
    if (!order?.jobId) continue;
    assert.equal(order.amount, price);
    assert.equal(order.catalogVersion, 2);
    assert.ok(order.providerTransactionId);
    assert.equal(await db.jobPaymentEvent.count({ where: { orderId: order.id, provider: 'midtrans-sandbox' } }), 1);
    const job = await db.jobPost.findUniqueOrThrow({ where: { id: order.jobId } });
    assert.equal(job.status, 'PUBLISHED');
    const actual = await benefits.job(hr, job.id);
    assert.equal(actual.code, code);
    assert.equal(actual.expiresAt!.getTime() - actual.startsAt!.getTime(), 30 * DAY_MS);
    const period = await db.jobPublicationPeriod.findUniqueOrThrow({ where: { jobId_cycle: { jobId: job.id, cycle: 1 } } });
    assert.equal(period.featuredEndsAt!.getTime() - period.startsAt.getTime(), featuredDays * DAY_MS);
    const snapshot = period.policySnapshot as { boostDays: number };
    assert.equal(snapshot.boostDays, boostDays);
    assert.equal(actual.conversions, code !== 'LITE');
    assert.equal(actual.reports, code === 'PREMIUM');
    assert.equal(actual.companyPageLinkedIn, code === 'PREMIUM');
    const generated = await jobAi.generate(hr, generateJobContentSchema.parse({
      companyId: company.id, target: 'description', locale: 'id', outputLanguage: 'id', job: {
        title: job.title, seniority: null, experienceMin: null, experienceMax: null,
        description: '', responsibilities: [], kpis: [], specificExpectations: '', skills: [],
      },
    }));
    assert.equal(generated.target, 'description', 'An HR member can draft with AI at every tier');
    validated.push({ code, jobId: job.id, orderId: order.id, featuredDays, boostDays });
  }
  const active = await db.$queryRaw<Array<{ companyId: string; code: JobPackageCode }>>`
    SELECT DISTINCT ON ("companyId") "companyId", code
    FROM (${activeCompanyFeatures(new Date())}) features
    ORDER BY "companyId", code DESC, "endsAt" DESC`;
  for (const row of validated) {
    assert.equal(active.find(feature => feature.companyId === companies.find(company => company.slug === 'package-preview-' + row.code.toLowerCase())?.id)?.code, row.code);
  }
  return validated;
}

async function main() {
  await transactions();
  const mids = await verifySandboxReceipts();
  const report = { isolatedTransactions: 'passed', verifiedMidtransSandboxPurchases: mids };
  writeFileSync(receipts, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  if (!process.argv.includes('--fixtures-only')) assert.equal(mids.length, 3, 'Three actual Sandbox receipts must be fulfilled');
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
