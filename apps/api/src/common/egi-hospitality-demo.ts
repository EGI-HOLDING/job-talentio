import type { CompanySize, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import {
  backfillCompanyLogos,
  type DemoLogoUploader,
} from './company-logo-backfill';

/** Showcase hospitality brands for demo / staging. */
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
  | 'city'
  | 'industry'
>;

export async function needsEgiHospitalityDemoBackfill(db: Db): Promise<boolean> {
  const slugs = [...EGI_HOSPITALITY_DEMO_SLUGS];
  const rows = await db.company.findMany({
    where: { slug: { in: slugs } },
    select: { slug: true, logoUrl: true },
  });
  if (rows.length < slugs.length) return true;
  return rows.some((r) => !r.logoUrl);
}

/**
 * Idempotent: create the four hospitality demo companies and owners.
 * Demo jobs are intentionally created only through the employer workflow.
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
  let companies = 0;

  for (const spec of EGI_HOSPITALITY_DEMO_COMPANIES) {
    const city = await db.city.findFirst({
      where: { slug: spec.city },
      select: { id: true },
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
        ...(hospitality ? { industryId: hospitality.id } : {}),
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
        ...(hospitality ? { industryId: hospitality.id } : {}),
        size: spec.size,
        isVerified: true,
      },
    });
    companies += 1;

    await db.companyMember.upsert({
      where: { companyId_userId: { companyId: company.id, userId: owner.id } },
      update: { role: 'OWNER' },
      create: { companyId: company.id, userId: owner.id, role: 'OWNER' },
    });

  }

  log(`EGI hospitality demo: companies=${companies} jobsCreated=0`);
  let logosUploaded = 0;
  let logosUpdated = 0;
  if (opts?.logoUploader) {
    const logos = await backfillCompanyLogos(db, opts.logoUploader, { log });
    logosUploaded = logos.uploaded;
    logosUpdated = logos.updated;
  }
  return { companies, jobs: 0, logosUploaded, logosUpdated };
}
