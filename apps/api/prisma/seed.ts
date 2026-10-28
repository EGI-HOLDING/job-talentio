import { PrismaClient, DegreeLevel, SkillLevel, CompanySize } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

import { DEMO_COMPANY_INDUSTRY_SLUGS as COMPANY_INDUSTRY_OVERRIDES } from '../src/common/demo-company-industries';
import { demoCompanyLogoKey, isDemoCompanyLogoSlug } from '../src/common/company-logo-map';
import { backfillCompanyLogos } from '../src/common/company-logo-backfill';
import { createDemoLogoUploaderFromEnv } from '../src/common/demo-logo-storage';
import { backfillNews } from '../src/common/news-backfill';

import { backfillJobLocale } from '../src/common/i18n/job-locale-backfill';
import { EGI_HOSPITALITY_DEMO_COMPANIES } from '../src/common/egi-hospitality-demo';

const prisma = new PrismaClient();

function avatar(n: number) {
  return `https://i.pravatar.cc/300?img=${n}`;
}

const demoLogoUploader = createDemoLogoUploaderFromEnv();

function logo(slug: string, name: string, color: string) {
  if (isDemoCompanyLogoSlug(slug)) {
    return demoLogoUploader.publicUrlForKey(demoCompanyLogoKey(slug));
  }
  return `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(name)}&backgroundColor=${color}`;
}

type SeedCompany = {
  name: string;
  slug: string;
  industry: string;
  city: string;
  color: string;
  size: CompanySize;
  mailDomain: string;
  website?: string;
  description?: string;
};

const COMPANIES: SeedCompany[] = [
  { name: 'Apex Soft Tashkent', slug: 'demo-tech-tashkent', industry: COMPANY_INDUSTRY_OVERRIDES['demo-tech-tashkent'], city: 'tashkent', color: '4f46e5', size: 'SIZE_51_200' as CompanySize, mailDomain: 'apexsoft.uz' },
  { name: 'UzPay Fintech', slug: 'uzpay-fintech', industry: COMPANY_INDUSTRY_OVERRIDES['uzpay-fintech'], city: 'tashkent', color: '059669', size: 'SIZE_51_200' as CompanySize, mailDomain: 'uzpay.uz' },
  { name: 'Silk Road Commerce', slug: 'silk-road-commerce', industry: COMPANY_INDUSTRY_OVERRIDES['silk-road-commerce'], city: 'tashkent', color: 'd97706', size: 'SIZE_201_1000' as CompanySize, mailDomain: 'silkroad.uz' },
  { name: 'Tashkent Soft Labs', slug: 'tashkent-soft-labs', industry: COMPANY_INDUSTRY_OVERRIDES['tashkent-soft-labs'], city: 'tashkent', color: '2563eb', size: 'SIZE_11_50' as CompanySize, mailDomain: 'softlabs.uz' },
  { name: 'Samarkand Digital', slug: 'samarkand-digital', industry: COMPANY_INDUSTRY_OVERRIDES['samarkand-digital'], city: 'samarkand', color: 'db2777', size: 'SIZE_11_50' as CompanySize, mailDomain: 'samdigital.uz' },
  { name: 'Orient Bank Digital', slug: 'orient-bank', industry: COMPANY_INDUSTRY_OVERRIDES['orient-bank'], city: 'tashkent', color: '0f766e', size: 'SIZE_1000_PLUS' as CompanySize, mailDomain: 'orientbank.uz' },
  { name: 'Fergana Logistics', slug: 'fergana-logistics', industry: COMPANY_INDUSTRY_OVERRIDES['fergana-logistics'], city: 'fergana', color: '7c3aed', size: 'SIZE_51_200' as CompanySize, mailDomain: 'ferganalogistics.uz' },
  { name: 'EduNest Uzbekistan', slug: 'edunest-uz', industry: COMPANY_INDUSTRY_OVERRIDES['edunest-uz'], city: 'tashkent', color: 'ea580c', size: 'SIZE_11_50' as CompanySize, mailDomain: 'edunest.uz' },
  { name: 'MediCare IT', slug: 'medicare-it', industry: COMPANY_INDUSTRY_OVERRIDES['medicare-it'], city: 'tashkent', color: '0891b2', size: 'SIZE_51_200' as CompanySize, mailDomain: 'medicare-it.uz' },
  { name: 'Navoi Engineering', slug: 'navoi-engineering', industry: COMPANY_INDUSTRY_OVERRIDES['navoi-engineering'], city: 'navoi', color: '64748b', size: 'SIZE_201_1000' as CompanySize, mailDomain: 'navoieng.uz' },
  { name: 'Andijan AgroTech', slug: 'andijan-agrotech', industry: COMPANY_INDUSTRY_OVERRIDES['andijan-agrotech'], city: 'andijan', color: '65a30d', size: 'SIZE_51_200' as CompanySize, mailDomain: 'agrotech.uz' },
  { name: 'Bukhara Heritage Hotels', slug: 'bukhara-heritage', industry: COMPANY_INDUSTRY_OVERRIDES['bukhara-heritage'], city: 'bukhara', color: 'b45309', size: 'SIZE_11_50' as CompanySize, mailDomain: 'bukhotels.uz' },
  { name: 'ClickPay Solutions', slug: 'clickpay-solutions', industry: COMPANY_INDUSTRY_OVERRIDES['clickpay-solutions'], city: 'tashkent', color: '0ea5e9', size: 'SIZE_51_200' as CompanySize, mailDomain: 'clickpay.uz' },
  { name: 'Namangan Textile Group', slug: 'namangan-textile', industry: COMPANY_INDUSTRY_OVERRIDES['namangan-textile'], city: 'namangan', color: 'be185d', size: 'SIZE_201_1000' as CompanySize, mailDomain: 'namtextile.uz' },
  { name: 'UzTelecom Digital', slug: 'uztelecom-digital', industry: COMPANY_INDUSTRY_OVERRIDES['uztelecom-digital'], city: 'tashkent', color: '1d4ed8', size: 'SIZE_1000_PLUS' as CompanySize, mailDomain: 'uztelecom.uz' },
  { name: 'Khorezm Green Energy', slug: 'khorezm-green', industry: COMPANY_INDUSTRY_OVERRIDES['khorezm-green'], city: 'urgench', color: '15803d', size: 'SIZE_11_50' as CompanySize, mailDomain: 'khorezmgreen.uz' },
  { name: 'Tashkent Legal Partners', slug: 'tashkent-legal', industry: COMPANY_INDUSTRY_OVERRIDES['tashkent-legal'], city: 'tashkent', color: '334155', size: 'SIZE_11_50' as CompanySize, mailDomain: 'tlpartners.uz' },
  { name: 'Caravan Marketplace', slug: 'caravan-marketplace', industry: COMPANY_INDUSTRY_OVERRIDES['caravan-marketplace'], city: 'tashkent', color: 'c2410c', size: 'SIZE_51_200' as CompanySize, mailDomain: 'caravan.uz' },
  { name: 'Nukus Smart City', slug: 'nukus-smart-city', industry: COMPANY_INDUSTRY_OVERRIDES['nukus-smart-city'], city: 'nukus', color: '0369a1', size: 'SIZE_11_50' as CompanySize, mailDomain: 'nukussmart.uz' },
  { name: 'Chirchiq Pharma Lab', slug: 'chirchiq-pharma', industry: COMPANY_INDUSTRY_OVERRIDES['chirchiq-pharma'], city: 'chirchiq', color: '0f766e', size: 'SIZE_51_200' as CompanySize, mailDomain: 'chirchiqpharma.uz' },
  ...EGI_HOSPITALITY_DEMO_COMPANIES.map((c) => ({
    name: c.name,
    slug: c.slug,
    industry: COMPANY_INDUSTRY_OVERRIDES[c.slug],

    city: c.city,
    color: c.color,
    size: c.size,
    mailDomain: c.mailDomain,
    website: c.website,
    description: c.description,
  })),
];

type SeedPerson = { first: string; last: string; email: string };

function workEmail(first: string, last: string, domain: string): string {
  return `${first.toLowerCase()}.${last.toLowerCase()}@${domain}`;
}

/** Job seekers — demo inboxes on @jobtalent.io (verified for pipeline email tests). */
const EMPLOYEE_PEOPLE: SeedPerson[] = [
  { first: 'Madina', last: 'Karimova', email: 'madina.karimova@jobtalent.io' },
  { first: 'Dilshod', last: 'Rahimov', email: 'dilshod_rahimov@jobtalent.io' },
  { first: 'Aziza', last: 'Tursunova', email: 'a.tursunova@jobtalent.io' },
  { first: 'Jasur', last: 'Umarov', email: 'jasur.umarov93@jobtalent.io' },
  { first: 'Nilufar', last: 'Saidova', email: 'nilufar.saidova@jobtalent.io' },
  { first: 'Bobur', last: 'Yusupov', email: 'bobur_yusupov@jobtalent.io' },
  { first: 'Sevara', last: 'Ergasheva', email: 's.ergasheva@jobtalent.io' },
  { first: 'Timur', last: 'Abdullayev', email: 'timur.abdullayev97@jobtalent.io' },
  { first: 'Malika', last: 'Nazarova', email: 'malika.nazarova@jobtalent.io' },
  { first: 'Sardor', last: 'Ismoilov', email: 'sardor_ismoilov@jobtalent.io' },
  { first: 'Kamola', last: 'Hasanova', email: 'k.hasanova@jobtalent.io' },
  { first: 'Rustam', last: 'Aliyev', email: 'rustam.aliyev91@jobtalent.io' },
  { first: 'Zarina', last: 'Qosimova', email: 'zarina.qosimova@jobtalent.io' },
  { first: 'Alisher', last: 'Mirzayev', email: 'alisher_mirzayev@jobtalent.io' },
  { first: 'Dilnoza', last: 'Shukurova', email: 'd.shukurova@jobtalent.io' },
  { first: 'Farrukh', last: 'Karimov', email: 'farrukh.karimov95@jobtalent.io' },
  { first: 'Gulnora', last: 'Rakhimova', email: 'gulnora.rakhimova@jobtalent.io' },
  { first: 'Islom', last: 'Tursunov', email: 'islom_tursunov@jobtalent.io' },
  { first: 'Lola', last: 'Bekova', email: 'l.bekova@jobtalent.io' },
  { first: 'Muzaffar', last: 'Ergashev', email: 'muzaffar.ergashev99@jobtalent.io' },
  { first: 'Nargiza', last: 'Abdullayeva', email: 'nargiza.abdullayeva@jobtalent.io' },
  { first: 'Oybek', last: 'Nazarov', email: 'oybek_nazarov@jobtalent.io' },
  { first: 'Parvina', last: 'Ismoilova', email: 'p.ismoilova@jobtalent.io' },
  { first: 'Quvonch', last: 'Yuldashev', email: 'quvonch.yuldashev93@jobtalent.io' },
  { first: 'Rayhon', last: 'Sattorova', email: 'rayhon.sattorova@jobtalent.io' },
  { first: 'Shohruh', last: 'Hakimov', email: 'shohruh_hakimov@jobtalent.io' },
  { first: 'Umida', last: 'Rasulova', email: 'u.rasulova@jobtalent.io' },
  { first: 'Valijon', last: 'Sobirov', email: 'valijon.sobirov97@jobtalent.io' },
  { first: 'Yulduz', last: 'Ganiyeva', email: 'yulduz.ganiyeva@jobtalent.io' },
  { first: 'Zafar', last: 'Mahmudov', email: 'zafar_mahmudov@jobtalent.io' },
  { first: 'Asal', last: 'Ibragimova', email: 'a.ibragimova@jobtalent.io' },
  { first: 'Bekzod', last: 'Xolmatov', email: 'bekzod.xolmatov91@jobtalent.io' },
  { first: 'Dildora', last: 'Jumaniyozova', email: 'dildora.jumaniyozova@jobtalent.io' },
  { first: 'Eldor', last: 'Qodirov', email: 'eldor_qodirov@jobtalent.io' },
  { first: 'Feruza', last: 'Mamatova', email: 'f.mamatova@jobtalent.io' },
  { first: 'Golib', last: 'Saidov', email: 'golib.saidov95@jobtalent.io' },
  { first: 'Hilola', last: 'Usmanova', email: 'hilola.usmanova@jobtalent.io' },
  { first: 'Izzat', last: 'Rahmatov', email: 'izzat_rahmatov@jobtalent.io' },
  { first: 'Jahongir', last: 'Olimov', email: 'j.olimov@jobtalent.io' },
  { first: 'Komila', last: 'Davlatova', email: 'komila.davlatova99@jobtalent.io' },
  { first: 'Laziz', last: 'Shodiyev', email: 'laziz.shodiyev@jobtalent.io' },
  { first: 'Mohira', last: 'Yunusova', email: 'mohira_yunusova@jobtalent.io' },
  { first: 'Nodir', last: 'Abdullayev', email: 'n.abdullayev@jobtalent.io' },
  { first: 'Oydin', last: 'Karimova', email: 'oydin.karimova93@jobtalent.io' },
  { first: 'Polat', last: 'Toshmatov', email: 'polat.toshmatov@jobtalent.io' },
  { first: 'Qunduz', last: 'Mirzayeva', email: 'qunduz_mirzayeva@jobtalent.io' },
  { first: 'Rano', last: 'Ismoilova', email: 'r.ismoilova@jobtalent.io' },
  { first: 'Suhrob', last: 'Ergashev', email: 'suhrob.ergashev97@jobtalent.io' },
  { first: 'Tohir', last: 'Nazarov', email: 'tohir.nazarov@jobtalent.io' },
  { first: 'Ulugbek', last: 'Rahimov', email: 'ulugbek_rahimov@jobtalent.io' },
  { first: 'Vasila', last: 'Tursunova', email: 'v.tursunova@jobtalent.io' },
  { first: 'Xurshida', last: 'Aliyeva', email: 'xurshida.aliyeva91@jobtalent.io' },
  { first: 'Yoqub', last: 'Hasanov', email: 'yoqub.hasanov@jobtalent.io' },
  { first: 'Zilola', last: 'Qurbonova', email: 'zilola_qurbonova@jobtalent.io' },
  { first: 'Anvar', last: 'Sodiqov', email: 'a.sodiqov@jobtalent.io' },
  { first: 'Barno', last: 'Murodova', email: 'barno.murodova95@jobtalent.io' },
  { first: 'Davron', last: 'Ismoilov', email: 'davron.ismoilov@jobtalent.io' },
  { first: 'Ezoza', last: 'Raximova', email: 'ezoza_raximova@jobtalent.io' },
  { first: 'Farida', last: 'Ganiyeva', email: 'f.ganiyeva@jobtalent.io' },
  { first: 'Gulchehra', last: 'Nurmatova', email: 'gulchehra.nurmatova99@jobtalent.io' },
];

/** Company owners — corporate @company.uz addresses. */
const RECRUITER_PEOPLE: SeedPerson[] = (
  [
    ['Jasur', 'Tursunov'],
    ['Sevara', 'Abdullayeva'],
    ['Timur', 'Nazarov'],
    ['Kamola', 'Ergasheva'],
    ['Rustam', 'Ismoilov'],
    ['Farrukh', 'Saidov'],
    ['Islom', 'Rahimov'],
    ['Muzaffar', 'Yusupov'],
    ['Oybek', 'Karimov'],
    ['Shohruh', 'Umarov'],
    ['Dilfuza', 'Ahmadova'],
    ['Azamat', 'Berdiyev'],
    ['Shahnoza', 'Qodirova'],
    ['Javlon', 'Mamatov'],
    ['Nodira', 'Usmanova'],
    ['Bahodir', 'Xolmatov'],
    ['Gulbahor', 'Saidova'],
    ['Akmal', 'Rakhimov'],
    ['Lola', 'Nazarova'],
    ['Sardor', 'Aliyev'],
    ...EGI_HOSPITALITY_DEMO_COMPANIES.map((c) => [c.ownerFirst, c.ownerLast] as const),
  ] as const
).map(([first, last], i) => ({
  first,
  last,
  email: workEmail(first, last, COMPANIES[i].mailDomain),
}));

const HR_PEOPLE: SeedPerson[] = [
  { first: 'Nargiza', last: 'Hasanova', email: workEmail('Nargiza', 'Hasanova', COMPANIES[0].mailDomain) },
  { first: 'Bekzod', last: 'Aliyev', email: workEmail('Bekzod', 'Aliyev', COMPANIES[1].mailDomain) },
  { first: 'Madina', last: 'Sobirova', email: workEmail('Madina', 'Sobirova', COMPANIES[2].mailDomain) },
  { first: 'Jamshid', last: 'Qodirov', email: workEmail('Jamshid', 'Qodirov', COMPANIES[5].mailDomain) },
];

/** Quick-login accounts after seed (Password123! except admin). */
const DEMO = {
  admin: {
    email: (process.env.SUPERADMIN_EMAIL ?? 'sarvar.adminov@jobtalentio.uz').toLowerCase(),
    password: process.env.SUPERADMIN_PASSWORD ?? 'Admin123!',
    fullName: 'Sarvar Adminov',
  },
  employee: EMPLOYEE_PEOPLE[0],
  recruiter: RECRUITER_PEOPLE[0],
};

const PREVIOUS_EMPLOYERS = [
  'Startup Hub Tashkent',
  'IT Park Uzbekistan',
  'Click',
  'Payme',
  'Uzum',
  'Olcha.uz',
  'EPAM Uzbekistan',
  'Itransition',
  'Beeline Uzbekistan',
  'Ucell',
  'Kapitalbank',
  'Asakabank',
  'Artel Electronics',
  'Coca-Cola IHM Uzbekistan',
  'Humans',
];

const EDUCATION_FIELDS = [
  'Computer Science',
  'Software Engineering',
  'Information Systems',
  'Economics',
  'Finance',
  'Marketing',
  'Business Administration',
  'Industrial Engineering',
  'Law',
  'Applied Mathematics',
  'Design',
  'Communications',
];

const SCHOOLS = ['TUIT', 'NUUz', 'Westminster International University in Tashkent', 'INHA University in Tashkent', 'Amity University Tashkent', 'Turin Polytechnic University in Tashkent'];
const LEVELS: SkillLevel[] = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'];
const DEMO_PROFILE_TITLES = [
  'Software Engineer',
  'Accountant',
  'Sales Manager',
  'Product Designer',
  'HR Recruiter',
  'English Teacher',
  'Data Analyst',
  'Customer Support Specialist',
];

async function main() {
  console.log('Seeding Job Talentio...');
  const passwordHash = await bcrypt.hash('Password123!', 10);

  // Geo hierarchy (Country → Province → City)
  // Import a reviewed geographic dataset separately before seeding demo profiles.
  const cityMapRows = await prisma.city.findMany({ where: { archivedAt: null, kind: { in: ['CITY', 'REGENCY'] }, province: { archivedAt: null, country: { isActive: true, archivedAt: null } } }, orderBy: { name: 'asc' } });
  if (!cityMapRows.length) throw new Error('Import the reviewed geographic catalog before seeding demo profiles.');
  const cityMap = Object.fromEntries(cityMapRows.map((c) => [c.slug, c]));
  const cities = cityMapRows;

  // Product catalogs are managed by Admin. Seed may reuse existing rows for
  // demo profile relations, but it never creates or aliases catalog entries.
  const categories = await prisma.jobCategory.findMany({
    where: { archivedAt: null },
    orderBy: { name: 'asc' },
  });

  const industries = await prisma.industry.findMany({ where: { archivedAt: null } });
  const indMap = Object.fromEntries(industries.map((i) => [i.slug, i]));

  // Push bundled demo logos to MinIO/S3 before company.logoUrl is set.
  const logoSeed = await backfillCompanyLogos(prisma, demoLogoUploader, {
    log: (msg) => console.warn(msg),
  });
  console.log(`Demo logos: uploaded=${logoSeed.uploaded} dbUpdated=${logoSeed.updated}`);

  const skills = await prisma.skill.findMany({
    where: { archivedAt: null },
    orderBy: { name: 'asc' },
  });
  const languages = await prisma.language.findMany({
    where: { archivedAt: null },
    orderBy: { name: 'asc' },
  });
  const langMap = Object.fromEntries(languages.map((l) => [l.code, l]));

  // Remove legacy sequential demo emails from earlier seeds
  await prisma.user.deleteMany({
    where: {
      OR: [
        { email: { endsWith: '@demo.uz' } },
        { email: 'admin@jobtalentio.local' },
      ],
    },
  });

  // Admin
  await prisma.user.upsert({
    where: { email: DEMO.admin.email },
    update: {
      role: 'SUPER_ADMIN',
      fullName: DEMO.admin.fullName,
      passwordHash: await bcrypt.hash(DEMO.admin.password, 10),
      emailVerified: false,
    },
    create: {
      email: DEMO.admin.email,
      passwordHash: await bcrypt.hash(DEMO.admin.password, 10),
      fullName: DEMO.admin.fullName,
      role: 'SUPER_ADMIN',
      emailVerified: false,
      avatarUrl: avatar(1),
    },
  });

  // Companies + recruiters
  const companyRecords = [];
  const recruiterUsers = [];
  for (let i = 0; i < COMPANIES.length; i++) {
    const c = COMPANIES[i];
    const person = RECRUITER_PEOPLE[i];
    const recruiter = await prisma.user.upsert({
      where: { email: person.email },
      update: {
        fullName: `${person.first} ${person.last}`,
        avatarUrl: avatar(10 + i),
        role: 'RECRUITER',
        passwordHash,
        emailVerified: true,
      },
      create: {
        email: person.email,
        passwordHash,
        fullName: `${person.first} ${person.last}`,
        role: 'RECRUITER',
        locale: 'uz',
        emailVerified: true,
        avatarUrl: avatar(10 + i),
      },
    });
    recruiterUsers.push(recruiter);

    // Extra recruiter for some companies
    let extra = null;
    const hrIndex = HR_PEOPLE.findIndex((_, idx) => [0, 1, 2, 5][idx] === i);
    if (hrIndex >= 0) {
      const hr = HR_PEOPLE[hrIndex];
      extra = await prisma.user.upsert({
        where: { email: hr.email },
        update: {
          passwordHash,
          role: 'RECRUITER',
          fullName: `${hr.first} ${hr.last}`,
          emailVerified: true,
        },
        create: {
          email: hr.email,
          passwordHash,
          fullName: `${hr.first} ${hr.last}`,
          role: 'RECRUITER',
          emailVerified: true,
          avatarUrl: avatar(20 + i),
        },
      });
    }

    const companyIndustry = indMap[c.industry];
    const company = await prisma.company.upsert({
      where: { slug: c.slug },
      update: {
        name: c.name,
        description:
          c.description ??
          `${c.name} is a leading ${c.industry} company in Uzbekistan, building modern products for the Central Asian market.`,
        // The blurb below is English; without this it would claim to be Uzbek.
        locale: 'en',
        website: c.website ?? `https://${c.slug}.uz`,
        cityId: cityMap[c.city].id,
        ...(companyIndustry ? { industryId: companyIndustry.id } : {}),
        size: c.size,
        logoUrl: logo(c.slug, c.name, c.color),
      },
      create: {
        name: c.name,
        slug: c.slug,
        description:
          c.description ??
          `${c.name} is a leading ${c.industry} company in Uzbekistan, building modern products for the Central Asian market.`,
        locale: 'en',
        website: c.website ?? `https://${c.slug}.uz`,
        cityId: cityMap[c.city].id,
        ...(companyIndustry ? { industryId: companyIndustry.id } : {}),
        size: c.size,
        logoUrl: logo(c.slug, c.name, c.color),
        isVerified: false,
        members: {
          create: [
            { userId: recruiter.id, role: 'OWNER' },
            ...(extra ? [{ userId: extra.id, role: 'RECRUITER' as const }] : []),
          ],
        },
      },
    });

    // Ensure membership without changing historical subscriptions.
    await prisma.companyMember.upsert({
      where: { companyId_userId: { companyId: company.id, userId: recruiter.id } },
      update: { role: 'OWNER' },
      create: { companyId: company.id, userId: recruiter.id, role: 'OWNER' },
    });
    if (extra) {
      await prisma.companyMember.upsert({
        where: { companyId_userId: { companyId: company.id, userId: extra.id } },
        update: {},
        create: { companyId: company.id, userId: extra.id, role: 'RECRUITER' },
      });
    }


    companyRecords.push(company);
  }

  // Employees
  const employeeProfiles = [];
  const employeeUsers = [];
  for (let i = 0; i < EMPLOYEE_PEOPLE.length; i++) {
    const person = EMPLOYEE_PEOPLE[i];
    const city = cities[i % cities.length];
    const skillStart = (i * 3) % Math.max(1, skills.length - 8);
    const skillPick = skills.slice(skillStart, skillStart + 4 + (i % 5));
    const user = await prisma.user.upsert({
      where: { email: person.email },
      update: {
        passwordHash,
        fullName: `${person.first} ${person.last}`,
        avatarUrl: avatar(30 + (i % 40)),
        role: 'EMPLOYEE',
        emailVerified: true,
      },
      create: {
        email: person.email,
        passwordHash,
        fullName: `${person.first} ${person.last}`,
        role: 'EMPLOYEE',
        locale: (['uz', 'ru', 'en', 'uz'] as const)[i % 4],
        emailVerified: true,
        avatarUrl: avatar(30 + (i % 40)),
      },
    });
    employeeUsers.push(user);

    const headline = DEMO_PROFILE_TITLES[i % DEMO_PROFILE_TITLES.length];
    const yearsExp = 1 + (i % 8);
    const skillFocus = skillPick.slice(0, 2).map((skill) => skill.name).join(' & ') || 'team delivery';
    const summaryVariants = [
      `${headline} with ${yearsExp}+ years of experience, currently based in ${city.name}. Open to hybrid and remote roles across Uzbekistan.`,
      `Results-driven ${headline.toLowerCase()} focused on ${skillFocus}. Previously delivered projects for local product teams.`,
      `Bilingual professional (${i % 2 ? 'Uzbek/Russian' : 'Uzbek/English'}) seeking ${headline} opportunities in ${city.name} and beyond.`,
      `Career-focused professional with a foundation in ${skillFocus}, ready to grow inside a product team.`,
    ];
    const summary = summaryVariants[i % summaryVariants.length];
    const visibility = (['PUBLIC', 'TO_REGISTERED_RECRUITERS', 'TO_REGISTERED_RECRUITERS', 'PRIVATE'] as const)[i % 4];
    let profile = await prisma.employeeProfile.findUnique({ where: { userId: user.id } });
    if (!profile) {
      profile = await prisma.employeeProfile.create({
        data: {
          userId: user.id,
          headline,
          summary,
          cityId: city.id,
          phone: `+9989${String(10 + (i % 90)).padStart(2, '0')}${String(1000000 + i * 17).slice(0, 7)}`,
          desiredPosition: headline,
          desiredSalaryMin: 6_000_000 + yearsExp * 1_500_000 + (i % 5) * 500_000,
          visibility,
        },
      });
    } else {
      profile = await prisma.employeeProfile.update({
        where: { id: profile.id },
        data: {
          headline,
          summary,
          cityId: city.id,
          desiredPosition: headline,
          desiredSalaryMin: 6_000_000 + yearsExp * 1_500_000 + (i % 5) * 500_000,
          visibility,
        },
      });
    }

    // Skills
    await prisma.profileSkill.deleteMany({ where: { profileId: profile.id } });
    for (let s = 0; s < skillPick.length; s++) {
      await prisma.profileSkill.create({
        data: {
          profileId: profile.id,
          skillId: skillPick[s].id,
          level: LEVELS[Math.min(3, 1 + (s % 3))],
        },
      });
    }

    // Experience
    await prisma.workExperience.deleteMany({ where: { profileId: profile.id } });
    await prisma.workExperience.create({
      data: {
        profileId: profile.id,
        companyName: COMPANIES[i % COMPANIES.length].name,
        title: headline,
        description: `Owned delivery for ${skillFocus} initiatives and collaborated with cross-functional teams.`,
        cityId: city.id,
        startDate: new Date(2021 - (i % 4), i % 12, 1),
        isCurrent: true,
      },
    });
    if (i % 2 === 0) {
      await prisma.workExperience.create({
        data: {
          profileId: profile.id,
          companyName: PREVIOUS_EMPLOYERS[i % PREVIOUS_EMPLOYERS.length],
          title: i % 3 === 0 ? 'Specialist' : `Associate ${headline}`,
          cityId: cityMap['tashkent']?.id ?? city.id,
          startDate: new Date(2017 + (i % 3), 0, 1),
          endDate: new Date(2020, 11, 1),
          isCurrent: false,
        },
      });
    }
    if (i % 5 === 0) {
      await prisma.workExperience.create({
        data: {
          profileId: profile.id,
          companyName: PREVIOUS_EMPLOYERS[(i + 3) % PREVIOUS_EMPLOYERS.length],
          title: 'Trainee',
          cityId: cities[(i + 2) % cities.length].id,
          startDate: new Date(2016, 6, 1),
          endDate: new Date(2016, 11, 30),
          isCurrent: false,
        },
      });
    }

    // Education
    await prisma.education.deleteMany({ where: { profileId: profile.id } });
    await prisma.education.create({
      data: {
        profileId: profile.id,
        school: SCHOOLS[i % SCHOOLS.length],
        degree: (['BACHELOR', 'MASTER', 'BACHELOR', 'VOCATIONAL'] as DegreeLevel[])[i % 4],
        field: EDUCATION_FIELDS[i % EDUCATION_FIELDS.length],
        startDate: new Date(2015, 8, 1),
        endDate: new Date(2019, 5, 1),
      },
    });

    // Languages
    await prisma.profileLanguage.deleteMany({ where: { profileId: profile.id } });
    const profileLanguages = [
      ['uz', 'NATIVE'],
      ['ru', i % 2 ? 'C1' : 'B2'],
      ['en', i % 3 ? 'B2' : 'B1'],
    ] as const;
    for (const [code, level] of profileLanguages) {
      const language = langMap[code];
      if (!language) continue;
      await prisma.profileLanguage.create({
        data: { profileId: profile.id, languageId: language.id, level },
      });
    }

    // Cert + resume
    if (i % 3 === 0) {
      await prisma.certification.deleteMany({ where: { profileId: profile.id } });
      await prisma.certification.create({
        data: {
          profileId: profile.id,
          name: 'AWS Cloud Practitioner',
          issuer: 'Amazon',
          issuedAt: new Date(2023, 5, 1),
        },
      });
    }

    await prisma.resume.deleteMany({ where: { profileId: profile.id } });
    await prisma.resume.create({
      data: {
        profileId: profile.id,
        title: 'Primary CV',
        content: `${headline}\n\nBased in ${city.name}. Skills: ${skillPick.map((s) => s.name).join(', ')}`,
        isPrimary: true,
      },
    });

    employeeProfiles.push(profile);
  }

  // Keep the legacy language requirement backfill, which only links existing
  // language rows to existing job posts. It never creates catalog entries.

  for (let i = 0; i < 20; i++) {
    const user = employeeUsers[i];
    if (!user) continue;
    const alert = await prisma.jobAlert.create({
      data: {
        userId: user.id,
        name: `Alert ${i + 1}`,
        query: 'Open roles',
        cityId: cities[i % cities.length].id,
        ...(categories.length ? { categoryId: categories[i % categories.length].id } : {}),
        frequency: i % 2 ? 'WEEKLY' : 'DAILY',
      },
    });
    const skill = skills.length ? skills[i % skills.length] : null;
    if (skill) {
      await prisma.jobAlertSkill.create({
        data: { alertId: alert.id, skillId: skill.id },
      });
    }
  }

  for (let i = 0; i < 45; i++) {
    const user = employeeUsers[i % employeeUsers.length];
    if (!user) continue;
    await prisma.companyFollower.upsert({
      where: {
        userId_companyId: {
          userId: user.id,
          companyId: companyRecords[i % companyRecords.length].id,
        },
      },
      create: {
        userId: user.id,
        companyId: companyRecords[i % companyRecords.length].id,
      },
      update: {},
    });
  }

  // Welcome notifications only; application and interview events require real jobs.
  const emp = employeeUsers[0];
  const rec = recruiterUsers[0];
  if (emp) {
    await prisma.notification.create({
      data: {
        userId: emp.id,
        type: 'SYSTEM',
        title: 'Welcome to Job Talentio',
        body: 'Your candidate profile is ready.',
      },
    });
  }
  if (rec) {
    await prisma.notification.create({
      data: {
        userId: rec.id,
        type: 'SYSTEM',
        title: 'Welcome to Job Talentio',
        body: 'Your recruiter dashboard is ready.',
      },
    });
  }

  // Chat
  if (emp && rec) {
    const conv = await prisma.conversation.create({
      data: {
        userAId: emp.id,
        userBId: rec.id,
        companyId: companyRecords[0].id,
        initiatedBy: emp.id,
        isColdOutreach: false,
        messages: {
          create: [
            {
              senderId: emp.id,
              body: 'Hello! I would like to learn more about your company and future opportunities.',
            },
            { senderId: rec.id, body: 'Hi! Thanks for reaching out. Please share the kind of role you are looking for.' },
          ],
        },
      },
    });
    void conv;
  }

  // Reports
  if (rec && emp) {
    await prisma.report.create({
      data: {
        reporterId: rec.id,
        entityType: 'USER',
        entityId: emp!.id,
        reason: 'Suspicious application spam pattern',
        status: 'OPEN',
      },
    });
  }

  const news = await backfillNews(prisma);
  const jobLocales = await backfillJobLocale(prisma);
  const catalogI18nRows = 0; // Geographic names are managed in the database.
  const [jobsKept, applicationsKept] = await Promise.all([
    prisma.jobPost.count(),
    prisma.application.count(),
  ]);

  await prisma.featureFlag.upsert({
    where: { key: 'candidate_matching' },
    update: { enabled: true },
    create: { key: 'candidate_matching', enabled: true },
  });

  console.log(`Seed complete:
  - ${cities.length} cities; existing catalogs reused: ${categories.length} categories, ${skills.length} skills, ${languages.length} languages
  - ${companyRecords.length} companies, ${employeeUsers.length} employees; demo job/app creation disabled
  - Existing jobs retained: ${jobsKept}; existing applications retained: ${applicationsKept}
  - ${news.upserted} news articles (+ ${news.translations} uz/ru versions)
  - ${catalogI18nRows} catalog rows with uz/ru display names
  - ${jobLocales.corrected} job posts relabelled to their actual language
  Quick login:
    Admin     ${DEMO.admin.email} / ${DEMO.admin.password}
    Recruiter ${DEMO.recruiter.email} / Password123!
    Employee  ${DEMO.employee.email} / Password123!`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
