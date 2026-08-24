import type { CompanySize, PrismaClient, WorkMode } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { contentHash, jobFingerprint } from './dedupe';
import { resolveJobTitle } from './title-resolve';
import {
  backfillCompanyLogos,
  type DemoLogoUploader,
} from './company-logo-backfill';

/** Showcase hospitality brands for demo / staging (VIP + homepage). */
export const EGI_HOSPITALITY_DEMO_COMPANIES = [
  {
    name: 'Hadith Hotel',
    slug: 'hadith-hotel',
    website: 'https://hadith-hotel.com/',
    description:
      'HADITH Hotel is a contemporary hotel at the Imam Al Bukhari Complex in Samarkand. Guests stay in 114 rooms and suites, with dining, wellness, and event spaces beside a major pilgrimage landmark.',
    city: 'samarkand',
    size: 'SIZE_51_200' as CompanySize,
    color: '1e3a5f',
    mailDomain: 'hadith-hotel.com',
    ownerFirst: 'Anvar',
    ownerLast: 'Bekmurodov',
    jobs: [
      { title: 'Hotel Front Office Manager', workMode: 'ONSITE' as WorkMode },
      { title: 'Guest Relations Officer', workMode: 'HYBRID' as WorkMode },
    ],
  },
  {
    name: 'Kampoeng Indonesia',
    slug: 'kampoeng-indonesia',
    website: 'https://hotel-kampoengindonesia.com/en',
    description:
      'Hotel Kampoeng Indonesia is a boutique stay at the Imam Al Bukhari Memorial in Samarkand. It brings Indonesian hospitality to pilgrims and travelers visiting the complex.',
    city: 'samarkand',
    size: 'SIZE_11_50' as CompanySize,
    color: '9a3412',
    mailDomain: 'hotel-kampoengindonesia.com',
    ownerFirst: 'Zuhra',
    ownerLast: 'Alimova',
    jobs: [
      { title: 'Guest Relations Officer', workMode: 'ONSITE' as WorkMode },
      { title: 'Hotel Front Office Manager', workMode: 'HYBRID' as WorkMode },
    ],
  },
  {
    name: '7oz Espresso Cafe',
    slug: '7oz-espresso',
    website: 'https://7oz-espresso.com/',
    description:
      '7Oz Espresso Cafe brings Indonesian coffee craft to Uzbekistan, with rooms in Tashkent and at partner hotels. The menu covers espresso, seasonal drinks, and pastry.',
    city: 'tashkent',
    size: 'SIZE_11_50' as CompanySize,
    color: '111827',
    mailDomain: '7oz-espresso.com',
    ownerFirst: 'Ravshan',
    ownerLast: 'Qodirov',
    jobs: [
      { title: 'F&B Operations Lead', workMode: 'ONSITE' as WorkMode },
      { title: 'Restaurant Supervisor', workMode: 'HYBRID' as WorkMode },
    ],
  },
  {
    name: 'Saji Nusantara',
    slug: 'saji-nusantara',
    website: 'https://saji-nusantara.com/en',
    description:
      'Saji Nusantara serves Indonesian dishes in Uzbekistan, including nasi goreng, sate, and soto, with dining rooms at Hadith Hotel, Kampoeng Indonesia, and Mecca Hotel.',
    city: 'tashkent',
    size: 'SIZE_11_50' as CompanySize,
    color: 'b45309',
    mailDomain: 'saji-nusantara.com',
    ownerFirst: 'Munisa',
    ownerLast: 'Ergasheva',
    jobs: [
      { title: 'Restaurant Supervisor', workMode: 'ONSITE' as WorkMode },
      { title: 'F&B Operations Lead', workMode: 'HYBRID' as WorkMode },
    ],
  },
] as const;

export const EGI_HOSPITALITY_DEMO_SLUGS = EGI_HOSPITALITY_DEMO_COMPANIES.map((c) => c.slug);

export const EGI_HOSPITALITY_DEMO_MAIL_DOMAINS = EGI_HOSPITALITY_DEMO_COMPANIES.map(
  (c) => c.mailDomain,
);

const DEMO_PASSWORD = 'Password123!';

type Db = Pick<
  PrismaClient,
  | 'user'
  | 'company'
  | 'companyMember'
  | 'subscription'
  | 'city'
  | 'industry'
  | 'jobCategory'
  | 'jobPost'
  | 'jobTitle'
  | 'jobTitleAlias'
>;

export async function needsEgiHospitalityDemoBackfill(db: Db): Promise<boolean> {
  const slugs = [...EGI_HOSPITALITY_DEMO_SLUGS];
  const rows = await db.company.findMany({
    where: { slug: { in: slugs } },
    select: {
      slug: true,
      logoUrl: true,
      _count: { select: { jobPosts: { where: { status: 'PUBLISHED' } } } },
    },
  });
  if (rows.length < slugs.length) return true;
  return rows.some((r) => r._count.jobPosts < 1 || !r.logoUrl);
}

/**
 * Idempotent: create the four hospitality demo companies, owners, VIP plans,
 * and at least one published job so they appear on the homepage VIP strip.
 */
export async function backfillEgiHospitalityDemo(
  db: Db,
  opts?: { log?: (msg: string) => void; logoUploader?: DemoLogoUploader },
): Promise<{ companies: number; jobs: number; logosUploaded: number; logosUpdated: number }> {
  const log = opts?.log ?? (() => undefined);
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const hospitality = await db.industry.findFirst({
    where: { slug: 'hospitality-restaurants' },
    select: { id: true },
  });
  const category = await db.jobCategory.findFirst({
    where: { slug: 'hospitality' },
    select: { id: true },
  });
  if (!hospitality || !category) {
    log('EGI hospitality demo skipped: industry or category missing');
    return { companies: 0, jobs: 0, logosUploaded: 0, logosUpdated: 0 };
  }

  let companies = 0;
  let jobs = 0;

  for (const spec of EGI_HOSPITALITY_DEMO_COMPANIES) {
    const city = await db.city.findFirst({
      where: { slug: spec.city },
      select: { id: true, name: true },
    });
    if (!city) {
      log(`EGI hospitality demo skipped ${spec.slug}: city ${spec.city} missing`);
      continue;
    }

    const email = `${spec.ownerFirst.toLowerCase()}.${spec.ownerLast.toLowerCase()}@${spec.mailDomain}`;
    const owner = await db.user.upsert({
      where: { email },
      update: {
        passwordHash,
        fullName: `${spec.ownerFirst} ${spec.ownerLast}`,
        role: 'RECRUITER',
        emailVerified: true,
      },
      create: {
        email,
        passwordHash,
        fullName: `${spec.ownerFirst} ${spec.ownerLast}`,
        role: 'RECRUITER',
        locale: 'en',
        emailVerified: true,
      },
    });

    const company = await db.company.upsert({
      where: { slug: spec.slug },
      update: {
        name: spec.name,
        description: spec.description,
        locale: 'en',
        website: spec.website,
        cityId: city.id,
        industryId: hospitality.id,
        size: spec.size,
        isVerified: true,
      },
      create: {
        name: spec.name,
        slug: spec.slug,
        description: spec.description,
        locale: 'en',
        website: spec.website,
        cityId: city.id,
        industryId: hospitality.id,
        size: spec.size,
        isVerified: true,
      },
    });
    companies += 1;

    await db.subscription.upsert({
      where: { companyId: company.id },
      update: { plan: 'VIP', status: 'ACTIVE' },
      create: { companyId: company.id, plan: 'VIP', status: 'ACTIVE' },
    });
    await db.companyMember.upsert({
      where: { companyId_userId: { companyId: company.id, userId: owner.id } },
      update: { role: 'OWNER' },
      create: { companyId: company.id, userId: owner.id, role: 'OWNER' },
    });

    const published = await db.jobPost.count({
      where: { companyId: company.id, status: 'PUBLISHED' },
    });
    if (published > 0) continue;

    for (const opening of spec.jobs) {
      const resolved = await resolveJobTitle(db, { name: opening.title });
      const title = resolved.jobTitle.name;
      const description = `${spec.name} is hiring a ${title} in ${city.name}.\n\nAbout the role:\nYou will welcome guests and keep daily operations running smoothly.\n\nRequirements:\n- Hospitality experience\n- Communication in Uzbek, Russian, or English\n- Comfortable with a guest-facing shift`;
      const fingerprint = jobFingerprint({
        title,
        workMode: opening.workMode,
        cityId: city.id,
      });
      const clash = await db.jobPost.findFirst({
        where: {
          companyId: company.id,
          fingerprint,
          status: { in: ['DRAFT', 'PUBLISHED', 'PAUSED'] },
        },
        select: { id: true },
      });
      if (clash) {
        log(
          `Skip hospitality job "${title}" for ${spec.slug}: active fingerprint exists (${clash.id})`,
        );
        continue;
      }
      await db.jobPost.create({
        data: {
          companyId: company.id,
          jobTitleId: resolved.jobTitle.id,
          title,
          description,
          cityId: city.id,
          categoryId: category.id,
          locale: 'en',
          employmentType: 'FULL_TIME',
          workMode: opening.workMode,
          salaryPeriod: 'MONTHLY',
          currency: 'UZS',
          status: 'PUBLISHED',
          publishedAt: new Date(),
          fingerprint,
          contentHash: contentHash(description),
        },
      });
      jobs += 1;
    }
  }

  log(`EGI hospitality demo: companies=${companies} jobsCreated=${jobs}`);
  let logosUploaded = 0;
  let logosUpdated = 0;
  if (opts?.logoUploader) {
    const logos = await backfillCompanyLogos(db, opts.logoUploader, { log });
    logosUploaded = logos.uploaded;
    logosUpdated = logos.updated;
  }
  return { companies, jobs, logosUploaded, logosUpdated };
}
