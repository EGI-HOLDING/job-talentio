/**
 * Reset demo activity on a staging database between client test sessions.
 *
 * Removes chats, notifications, reports, views, saved jobs and every posting
 * (applications cascade), then recreates the demo postings and applications
 * from `common/demo-jobs`. Accounts, companies, profiles and catalogs stay.
 *
 * Deployable entrypoint: `ALLOW_DEMO_RESET=1 node dist/scripts/demo-reset.js`
 * (or `pnpm --filter @job-talentio/api prisma:demo-reset` locally).
 */
import { PrismaClient } from '@prisma/client';
import { DEMO_CITY_SLUGS, seedDemoApplications, seedDemoJobs } from '../common/demo-jobs';

const SEED_EMPLOYEE_EMAIL_SUFFIX = '@jobtalent.io';

async function wipeMeilisearchJobs(log: (msg: string) => void) {
  const host = (process.env.MEILI_HOST || '').replace(/\/$/, '');
  if (!host) return;
  const key = process.env.MEILI_MASTER_KEY;
  try {
    const res = await fetch(`${host}/indexes/jobs/documents`, {
      method: 'DELETE',
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      signal: AbortSignal.timeout(10_000),
    });
    log(`Meilisearch: cleared jobs index (${res.status}); the API reindexes on the next search`);
  } catch (err) {
    log(`Meilisearch: could not clear index (${(err as Error).message}); redeploy the API to reindex`);
  }
}

async function main() {
  if (process.env.ALLOW_DEMO_RESET !== '1') {
    console.error(
      'Refusing to reset: this deletes every job post, application, chat and notification. Set ALLOW_DEMO_RESET=1 to confirm.',
    );
    process.exit(2);
  }

  const prisma = new PrismaClient();
  const log = (msg: string) => console.log(msg);
  try {
    const purged = {
      messages: (await prisma.chatMessage.deleteMany({})).count,
      conversations: (await prisma.conversation.deleteMany({})).count,
      notifications: (await prisma.notification.deleteMany({})).count,
      reports: (await prisma.report.deleteMany({})).count,
      views: (await prisma.jobView.deleteMany({})).count,
      savedJobs: (await prisma.savedJob.deleteMany({})).count,
      jobs: (await prisma.jobPost.deleteMany({})).count,
    };
    log(`Purged: ${JSON.stringify(purged)}`);

    const [companies, cities, categories, skills, benefits, profiles] = await Promise.all([
      prisma.company.findMany({
        where: { isBanned: false, subscription: { isNot: null } },
        select: { id: true, name: true, slug: true, cityId: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.city.findMany({ where: { slug: { in: DEMO_CITY_SLUGS } } }),
      prisma.jobCategory.findMany({ select: { id: true, slug: true } }),
      prisma.skill.findMany({ select: { id: true, slug: true, name: true } }),
      prisma.benefit.findMany({ select: { id: true } }),
      prisma.employeeProfile.findMany({
        where: { user: { email: { endsWith: SEED_EMPLOYEE_EMAIL_SUFFIX } } },
        select: { id: true },
      }),
    ]);

    // Keep the seed's round-robin order so the same companies get the same roles.
    const citiesOrdered = DEMO_CITY_SLUGS.map((slug) => cities.find((c) => c.slug === slug)).filter(
      (c): c is (typeof cities)[number] => Boolean(c),
    );

    const result = await seedDemoJobs(prisma, {
      companies,
      cities: citiesOrdered.map((c) => ({ id: c.id, name: c.name, slug: c.slug })),
      catMap: Object.fromEntries(categories.map((c) => [c.slug, c])),
      skillMap: Object.fromEntries(skills.map((s) => [s.slug, s])),
      benefits,
      log,
    });
    const heroIds = new Set(result.heroJobs.map((j) => j.id));
    const ordered = [...result.heroJobs, ...result.jobs.filter((j) => !heroIds.has(j.id))];
    const applications = await seedDemoApplications(prisma, { jobs: ordered, profiles, log });

    const published = ordered.filter((j) => j.status === 'PUBLISHED');
    for (let i = 0; i < Math.min(300, published.length * 4); i++) {
      await prisma.jobView.create({
        data: {
          jobPostId: published[i % published.length].id,
          createdAt: new Date(Date.now() - i * 3_600_000),
        },
      });
    }

    await wipeMeilisearchJobs(log);

    log(
      `Demo reset complete: jobs=${result.jobs.length} (hero=${result.heroJobs.length}, skipped=${result.skipped}) applications=${applications} profiles=${profiles.length} companies=${companies.length}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
