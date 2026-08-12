import { PrismaClient, PlanCode, ExperienceLevel, EmploymentType, WorkMode, DegreeLevel, SkillLevel, CompanySize } from '@prisma/client';
import { BENEFIT_ICONS, CATEGORY_ICONS } from '@job-talentio/shared';
import * as bcrypt from 'bcryptjs';
import { normalizeJobTitleKey, resolveJobTitle } from '../src/common/title-resolve';
import { jobFingerprint } from '../src/common/dedupe';
import { upsertUzbekistanGeo } from '../src/common/geo-catalog';
import { backfillIndustries } from '../src/common/industry-backfill';
import { backfillJobLanguages } from '../src/common/job-language-backfill';
import { COMPANY_INDUSTRY_OVERRIDES } from '../src/common/industry-catalog';
import { demoCompanyLogoKey, isDemoCompanyLogoSlug } from '../src/common/company-logo-map';
import { backfillCompanyLogos } from '../src/common/company-logo-backfill';
import { createDemoLogoUploaderFromEnv } from '../src/common/demo-logo-storage';
import { backfillNews } from '../src/common/news-backfill';
import { backfillCatalogI18n } from '../src/common/i18n/catalog-i18n-backfill';
import { backfillJobLocale } from '../src/common/i18n/job-locale-backfill';

/** Orthographic aliases → canonical title name (seeded after jobs resolve). */
const JOB_TITLE_ALIASES: Array<{ alias: string; canonical: string }> = [
  { alias: 'Front End Developer', canonical: 'Frontend Developer' },
  { alias: 'Front-End Developer', canonical: 'Frontend Developer' },
  { alias: 'Frontend Dev', canonical: 'Frontend Developer' },
  { alias: 'CPP Developer', canonical: 'C++ Developer' },
  { alias: 'C Plus Plus Developer', canonical: 'C++ Developer' },
  { alias: 'Full Stack Developer', canonical: 'Full-stack Developer' },
  { alias: 'Fullstack Developer', canonical: 'Full-stack Developer' },
];

const prisma = new PrismaClient();

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60);
}

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

/** Primary hubs used for round-robin seed of jobs/companies/profiles */
const SEED_CITY_SLUGS = [
  'tashkent',
  'samarkand',
  'bukhara',
  'andijan',
  'namangan',
  'fergana',
  'nukus',
  'urgench',
  'navoi',
  'karshi',
  'termez',
  'jizzakh',
  'gulistan',
  'chirchiq',
  'angren',
];

const CATEGORIES = [
  { name: 'IT & Software', slug: 'it-software', icon: CATEGORY_ICONS['it-software'] },
  { name: 'Finance & Banking', slug: 'finance', icon: CATEGORY_ICONS.finance },
  { name: 'Sales & Marketing', slug: 'sales-marketing', icon: CATEGORY_ICONS['sales-marketing'] },
  { name: 'Design & Creative', slug: 'design', icon: CATEGORY_ICONS.design },
  { name: 'HR & Recruiting', slug: 'hr', icon: CATEGORY_ICONS.hr },
  { name: 'Education', slug: 'education', icon: CATEGORY_ICONS.education },
  { name: 'Healthcare', slug: 'healthcare', icon: CATEGORY_ICONS.healthcare },
  { name: 'Engineering', slug: 'engineering', icon: CATEGORY_ICONS.engineering },
  { name: 'Customer Support', slug: 'customer-support', icon: CATEGORY_ICONS['customer-support'] },
  { name: 'Logistics', slug: 'logistics', icon: CATEGORY_ICONS.logistics },
  { name: 'Legal', slug: 'legal', icon: CATEGORY_ICONS.legal },
  { name: 'Hospitality', slug: 'hospitality', icon: CATEGORY_ICONS.hospitality },
];

const SKILLS: Array<{ name: string; category: string }> = [
  { name: 'TypeScript', category: 'Programming' },
  { name: 'JavaScript', category: 'Programming' },
  { name: 'Python', category: 'Programming' },
  { name: 'Java', category: 'Programming' },
  { name: 'Go', category: 'Programming' },
  { name: 'PHP', category: 'Programming' },
  { name: 'C#', category: 'Programming' },
  { name: 'C++', category: 'Programming' },
  { name: 'Kotlin', category: 'Programming' },
  { name: 'Swift', category: 'Programming' },
  { name: 'React', category: 'Frontend' },
  { name: 'Next.js', category: 'Frontend' },
  { name: 'Vue.js', category: 'Frontend' },
  { name: 'Angular', category: 'Frontend' },
  { name: 'NestJS', category: 'Backend' },
  { name: 'Node.js', category: 'Backend' },
  { name: 'Django', category: 'Backend' },
  { name: 'Spring Boot', category: 'Backend' },
  { name: 'Laravel', category: 'Backend' },
  { name: 'PostgreSQL', category: 'Database' },
  { name: 'MongoDB', category: 'Database' },
  { name: 'Redis', category: 'Database' },
  { name: 'MySQL', category: 'Database' },
  { name: 'Docker', category: 'DevOps' },
  { name: 'Kubernetes', category: 'DevOps' },
  { name: 'AWS', category: 'DevOps' },
  { name: 'CI/CD', category: 'DevOps' },
  { name: 'Linux', category: 'DevOps' },
  { name: 'GraphQL', category: 'API' },
  { name: 'REST API', category: 'API' },
  { name: 'Figma', category: 'Design' },
  { name: 'UI/UX', category: 'Design' },
  { name: 'Adobe Photoshop', category: 'Design' },
  { name: 'Product Management', category: 'Business' },
  { name: 'Agile', category: 'Business' },
  { name: 'Scrum', category: 'Business' },
  { name: 'Project Management', category: 'Business' },
  { name: 'Sales', category: 'Business' },
  { name: 'Digital Marketing', category: 'Marketing' },
  { name: 'SEO', category: 'Marketing' },
  { name: 'Content Writing', category: 'Marketing' },
  { name: 'SMM', category: 'Marketing' },
  { name: 'Google Analytics', category: 'Marketing' },
  { name: 'Accounting', category: 'Finance' },
  { name: 'Financial Analysis', category: 'Finance' },
  { name: 'Excel', category: 'Finance' },
  { name: '1C', category: 'Finance' },
  { name: 'Customer Support', category: 'Support' },
  { name: 'English', category: 'Language' },
  { name: 'Russian', category: 'Language' },
  { name: 'Uzbek', category: 'Language' },
  { name: 'Communication', category: 'Soft' },
  { name: 'Leadership', category: 'Soft' },
  { name: 'Problem Solving', category: 'Soft' },
  { name: 'Teamwork', category: 'Soft' },
  { name: 'Machine Learning', category: 'Data' },
  { name: 'Data Analysis', category: 'Data' },
  { name: 'SQL', category: 'Data' },
  { name: 'Tableau', category: 'Data' },
  { name: 'Power BI', category: 'Data' },
  { name: 'QA Testing', category: 'QA' },
  { name: 'Selenium', category: 'QA' },
  { name: 'Cypress', category: 'QA' },
  { name: 'Mobile Development', category: 'Mobile' },
  { name: 'Flutter', category: 'Mobile' },
  { name: 'React Native', category: 'Mobile' },
  { name: 'HR Management', category: 'HR' },
  { name: 'Recruiting', category: 'HR' },
  { name: 'Legal Research', category: 'Legal' },
  { name: 'Contract Law', category: 'Legal' },
  { name: 'Supply Chain', category: 'Logistics' },
  { name: 'Nursing', category: 'Healthcare' },
  { name: 'Patient Care', category: 'Healthcare' },
  { name: 'Clinical Research', category: 'Healthcare' },
  { name: 'Pharmacy', category: 'Healthcare' },
  { name: 'Teaching', category: 'Education' },
  { name: 'Curriculum Design', category: 'Education' },
  { name: 'Hospitality Management', category: 'Hospitality' },
  { name: 'Food Safety', category: 'Hospitality' },
  { name: 'AutoCAD', category: 'Engineering' },
  { name: 'Mechanical Design', category: 'Engineering' },
  { name: 'Electrical Engineering', category: 'Engineering' },
];

/** alias string → skill slug */
const SKILL_ALIASES: Array<{ alias: string; skillSlug: string }> = [
  { alias: 'React.JS', skillSlug: 'react' },
  { alias: 'ReactJS', skillSlug: 'react' },
  { alias: 'CPP', skillSlug: 'cplusplus' },
  { alias: 'C plus plus', skillSlug: 'cplusplus' },
  { alias: 'NodeJS', skillSlug: 'node-js' },
  { alias: 'Node', skillSlug: 'node-js' },
  { alias: 'NextJS', skillSlug: 'next-js' },
  { alias: 'VueJS', skillSlug: 'vue-js' },
  { alias: 'k8s', skillSlug: 'kubernetes' },
  { alias: 'Postgres', skillSlug: 'postgresql' },
  { alias: 'JS', skillSlug: 'javascript' },
  { alias: 'TS', skillSlug: 'typescript' },
];

function skillSlugifySeed(name: string) {
  let s = name.trim().toLowerCase();
  s = s.replace(/c\+\+/gi, 'cplusplus').replace(/c#/gi, 'csharp');
  return slugify(s);
}

function normalizeSkillKeySeed(input: string): string {
  let s = input
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
  s = s
    .replace(/c\+\+/g, 'cplusplus')
    .replace(/c#/g, 'csharp')
    .replace(/\.js\b/g, 'js')
    .replace(/\.ts\b/g, 'ts');
  s = s.replace(/[^a-z0-9]+/g, '');
  const synonyms: Record<string, string> = {
    reactjs: 'react',
    cpp: 'cplusplus',
    cplusplus: 'cplusplus',
    nodejs: 'nodejs',
    nextjs: 'nextjs',
    vuejs: 'vuejs',
    js: 'javascript',
    ts: 'typescript',
  };
  return synonyms[s] ?? s;
}

const LANGUAGES = [
  { name: 'Uzbek', code: 'uz' },
  { name: 'Russian', code: 'ru' },
  { name: 'English', code: 'en' },
  { name: 'Kazakh', code: 'kk' },
  { name: 'Turkish', code: 'tr' },
  { name: 'German', code: 'de' },
  { name: 'French', code: 'fr' },
  { name: 'Korean', code: 'ko' },
  { name: 'Chinese', code: 'zh' },
  { name: 'Arabic', code: 'ar' },
];

const BENEFITS = [
  { name: 'Health Insurance', slug: 'health-insurance', icon: BENEFIT_ICONS['health-insurance'] },
  { name: 'Remote Work', slug: 'remote-work', icon: BENEFIT_ICONS['remote-work'] },
  { name: 'Flexible Hours', slug: 'flexible-hours', icon: BENEFIT_ICONS['flexible-hours'] },
  { name: 'Meal Allowance', slug: 'meal-allowance', icon: BENEFIT_ICONS['meal-allowance'] },
  { name: 'Learning Budget', slug: 'learning-budget', icon: BENEFIT_ICONS['learning-budget'] },
  { name: 'Gym Membership', slug: 'gym', icon: BENEFIT_ICONS.gym },
  { name: 'Paid Vacation', slug: 'paid-vacation', icon: BENEFIT_ICONS['paid-vacation'] },
  { name: 'Stock Options', slug: 'stock-options', icon: BENEFIT_ICONS['stock-options'] },
  { name: 'Relocation Support', slug: 'relocation', icon: BENEFIT_ICONS.relocation },
  { name: 'Equipment Budget', slug: 'equipment', icon: BENEFIT_ICONS.equipment },
  { name: 'Parental Leave', slug: 'parental-leave', icon: BENEFIT_ICONS['parental-leave'] },
  { name: 'Performance Bonus', slug: 'bonus', icon: BENEFIT_ICONS.bonus },
];

const COMPANIES = [
  { name: 'Apex Soft Tashkent', slug: 'demo-tech-tashkent', industry: COMPANY_INDUSTRY_OVERRIDES['demo-tech-tashkent'], plan: 'STANDARD' as PlanCode, city: 'tashkent', color: '4f46e5', size: 'SIZE_51_200' as CompanySize, mailDomain: 'apexsoft.uz' },
  { name: 'UzPay Fintech', slug: 'uzpay-fintech', industry: COMPANY_INDUSTRY_OVERRIDES['uzpay-fintech'], plan: 'VIP' as PlanCode, city: 'tashkent', color: '059669', size: 'SIZE_51_200' as CompanySize, mailDomain: 'uzpay.uz' },
  { name: 'Silk Road Commerce', slug: 'silk-road-commerce', industry: COMPANY_INDUSTRY_OVERRIDES['silk-road-commerce'], plan: 'STANDARD' as PlanCode, city: 'tashkent', color: 'd97706', size: 'SIZE_201_1000' as CompanySize, mailDomain: 'silkroad.uz' },
  { name: 'Tashkent Soft Labs', slug: 'tashkent-soft-labs', industry: COMPANY_INDUSTRY_OVERRIDES['tashkent-soft-labs'], plan: 'PREMIUM' as PlanCode, city: 'tashkent', color: '2563eb', size: 'SIZE_11_50' as CompanySize, mailDomain: 'softlabs.uz' },
  { name: 'Samarkand Digital', slug: 'samarkand-digital', industry: COMPANY_INDUSTRY_OVERRIDES['samarkand-digital'], plan: 'FREE' as PlanCode, city: 'samarkand', color: 'db2777', size: 'SIZE_11_50' as CompanySize, mailDomain: 'samdigital.uz' },
  { name: 'Orient Bank Digital', slug: 'orient-bank', industry: COMPANY_INDUSTRY_OVERRIDES['orient-bank'], plan: 'VIP' as PlanCode, city: 'tashkent', color: '0f766e', size: 'SIZE_1000_PLUS' as CompanySize, mailDomain: 'orientbank.uz' },
  { name: 'Fergana Logistics', slug: 'fergana-logistics', industry: COMPANY_INDUSTRY_OVERRIDES['fergana-logistics'], plan: 'STANDARD' as PlanCode, city: 'fergana', color: '7c3aed', size: 'SIZE_51_200' as CompanySize, mailDomain: 'ferganalogistics.uz' },
  { name: 'EduNest Uzbekistan', slug: 'edunest-uz', industry: COMPANY_INDUSTRY_OVERRIDES['edunest-uz'], plan: 'FREE' as PlanCode, city: 'tashkent', color: 'ea580c', size: 'SIZE_11_50' as CompanySize, mailDomain: 'edunest.uz' },
  { name: 'MediCare IT', slug: 'medicare-it', industry: COMPANY_INDUSTRY_OVERRIDES['medicare-it'], plan: 'STANDARD' as PlanCode, city: 'tashkent', color: '0891b2', size: 'SIZE_51_200' as CompanySize, mailDomain: 'medicare-it.uz' },
  { name: 'Navoi Engineering', slug: 'navoi-engineering', industry: COMPANY_INDUSTRY_OVERRIDES['navoi-engineering'], plan: 'FREE' as PlanCode, city: 'navoi', color: '64748b', size: 'SIZE_201_1000' as CompanySize, mailDomain: 'navoieng.uz' },
  { name: 'Andijan AgroTech', slug: 'andijan-agrotech', industry: COMPANY_INDUSTRY_OVERRIDES['andijan-agrotech'], plan: 'STANDARD' as PlanCode, city: 'andijan', color: '65a30d', size: 'SIZE_51_200' as CompanySize, mailDomain: 'agrotech.uz' },
  { name: 'Bukhara Heritage Hotels', slug: 'bukhara-heritage', industry: COMPANY_INDUSTRY_OVERRIDES['bukhara-heritage'], plan: 'FREE' as PlanCode, city: 'bukhara', color: 'b45309', size: 'SIZE_11_50' as CompanySize, mailDomain: 'bukhotels.uz' },
  { name: 'ClickPay Solutions', slug: 'clickpay-solutions', industry: COMPANY_INDUSTRY_OVERRIDES['clickpay-solutions'], plan: 'VIP' as PlanCode, city: 'tashkent', color: '0ea5e9', size: 'SIZE_51_200' as CompanySize, mailDomain: 'clickpay.uz' },
  { name: 'Namangan Textile Group', slug: 'namangan-textile', industry: COMPANY_INDUSTRY_OVERRIDES['namangan-textile'], plan: 'STANDARD' as PlanCode, city: 'namangan', color: 'be185d', size: 'SIZE_201_1000' as CompanySize, mailDomain: 'namtextile.uz' },
  { name: 'UzTelecom Digital', slug: 'uztelecom-digital', industry: COMPANY_INDUSTRY_OVERRIDES['uztelecom-digital'], plan: 'VIP' as PlanCode, city: 'tashkent', color: '1d4ed8', size: 'SIZE_1000_PLUS' as CompanySize, mailDomain: 'uztelecom.uz' },
  { name: 'Khorezm Green Energy', slug: 'khorezm-green', industry: COMPANY_INDUSTRY_OVERRIDES['khorezm-green'], plan: 'FREE' as PlanCode, city: 'urgench', color: '15803d', size: 'SIZE_11_50' as CompanySize, mailDomain: 'khorezmgreen.uz' },
  { name: 'Tashkent Legal Partners', slug: 'tashkent-legal', industry: COMPANY_INDUSTRY_OVERRIDES['tashkent-legal'], plan: 'STANDARD' as PlanCode, city: 'tashkent', color: '334155', size: 'SIZE_11_50' as CompanySize, mailDomain: 'tlpartners.uz' },
  { name: 'Caravan Marketplace', slug: 'caravan-marketplace', industry: COMPANY_INDUSTRY_OVERRIDES['caravan-marketplace'], plan: 'VIP' as PlanCode, city: 'tashkent', color: 'c2410c', size: 'SIZE_51_200' as CompanySize, mailDomain: 'caravan.uz' },
  { name: 'Nukus Smart City', slug: 'nukus-smart-city', industry: COMPANY_INDUSTRY_OVERRIDES['nukus-smart-city'], plan: 'FREE' as PlanCode, city: 'nukus', color: '0369a1', size: 'SIZE_11_50' as CompanySize, mailDomain: 'nukussmart.uz' },
  { name: 'Chirchiq Pharma Lab', slug: 'chirchiq-pharma', industry: COMPANY_INDUSTRY_OVERRIDES['chirchiq-pharma'], plan: 'STANDARD' as PlanCode, city: 'chirchiq', color: '0f766e', size: 'SIZE_51_200' as CompanySize, mailDomain: 'chirchiqpharma.uz' },
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

/** ~4 templates per category → even mix when JOB_COUNT is a multiple of length */
/** Role-only titles — seniority lives on experienceLevel */
const JOB_TITLES = [
  // IT & Software (4)
  { title: 'Full-stack Developer', skills: ['typescript', 'react', 'nestjs', 'postgresql'], cat: 'it-software', level: 'SENIOR' as ExperienceLevel, years: 5 },
  { title: 'DevOps Engineer', skills: ['docker', 'kubernetes', 'aws', 'ci-cd'], cat: 'it-software', level: 'SENIOR' as ExperienceLevel, years: 4 },
  { title: 'Java Developer', skills: ['java', 'spring-boot', 'sql'], cat: 'it-software', level: 'JUNIOR' as ExperienceLevel, years: 0 },
  { title: 'C++ Systems Engineer', skills: ['cplusplus', 'linux', 'problem-solving'], cat: 'it-software', level: 'MIDDLE' as ExperienceLevel, years: 3 },
  // Finance (4)
  { title: 'Financial Analyst', skills: ['financial-analysis', 'excel', 'accounting'], cat: 'finance', level: 'MIDDLE' as ExperienceLevel, years: 2 },
  { title: 'Accountant', skills: ['accounting', '1c', 'excel'], cat: 'finance', level: 'MIDDLE' as ExperienceLevel, years: 3 },
  { title: 'Credit Risk Analyst', skills: ['financial-analysis', 'excel', 'sql'], cat: 'finance', level: 'SENIOR' as ExperienceLevel, years: 4 },
  { title: 'Banking Associate', skills: ['excel', 'communication', 'customer-support'], cat: 'finance', level: 'JUNIOR' as ExperienceLevel, years: 1 },
  // Sales & Marketing (4)
  { title: 'Digital Marketing Specialist', skills: ['digital-marketing', 'seo', 'smm'], cat: 'sales-marketing', level: 'JUNIOR' as ExperienceLevel, years: 1 },
  { title: 'Sales Manager', skills: ['sales', 'communication', 'excel'], cat: 'sales-marketing', level: 'MIDDLE' as ExperienceLevel, years: 3 },
  { title: 'SEO Specialist', skills: ['seo', 'google-analytics', 'content-writing'], cat: 'sales-marketing', level: 'JUNIOR' as ExperienceLevel, years: 1 },
  { title: 'SMM Manager', skills: ['smm', 'digital-marketing', 'content-writing'], cat: 'sales-marketing', level: 'MIDDLE' as ExperienceLevel, years: 2 },
  // Design (4)
  { title: 'UI/UX Designer', skills: ['figma', 'ui-ux', 'adobe-photoshop'], cat: 'design', level: 'MIDDLE' as ExperienceLevel, years: 2 },
  { title: 'Graphic Designer', skills: ['adobe-photoshop', 'figma', 'ui-ux'], cat: 'design', level: 'JUNIOR' as ExperienceLevel, years: 1 },
  { title: 'Product Designer', skills: ['figma', 'ui-ux', 'product-management'], cat: 'design', level: 'SENIOR' as ExperienceLevel, years: 4 },
  { title: 'Motion Designer', skills: ['adobe-photoshop', 'figma', 'communication'], cat: 'design', level: 'INTERN' as ExperienceLevel, years: 0 },
  // HR (4)
  { title: 'HR Recruiter', skills: ['recruiting', 'hr-management', 'communication'], cat: 'hr', level: 'JUNIOR' as ExperienceLevel, years: 1 },
  { title: 'Talent Acquisition Partner', skills: ['recruiting', 'hr-management', 'communication'], cat: 'hr', level: 'MIDDLE' as ExperienceLevel, years: 3 },
  { title: 'HR Business Partner', skills: ['hr-management', 'leadership', 'communication'], cat: 'hr', level: 'SENIOR' as ExperienceLevel, years: 5 },
  { title: 'People Operations Specialist', skills: ['hr-management', 'excel', 'teamwork'], cat: 'hr', level: 'MIDDLE' as ExperienceLevel, years: 2 },
  // Education (4)
  { title: 'English Teacher (Corporate)', skills: ['english', 'teaching', 'communication'], cat: 'education', level: 'MIDDLE' as ExperienceLevel, years: 2 },
  { title: 'Curriculum Designer', skills: ['curriculum-design', 'teaching', 'english'], cat: 'education', level: 'SENIOR' as ExperienceLevel, years: 4 },
  { title: 'Online Course Instructor', skills: ['teaching', 'content-writing', 'communication'], cat: 'education', level: 'MIDDLE' as ExperienceLevel, years: 2 },
  { title: 'Teaching Assistant', skills: ['teaching', 'uzbek', 'teamwork'], cat: 'education', level: 'JUNIOR' as ExperienceLevel, years: 0 },
  // Healthcare (4)
  { title: 'Registered Nurse', skills: ['nursing', 'patient-care', 'communication'], cat: 'healthcare', level: 'MIDDLE' as ExperienceLevel, years: 3 },
  { title: 'Clinical Research Associate', skills: ['clinical-research', 'excel', 'english'], cat: 'healthcare', level: 'MIDDLE' as ExperienceLevel, years: 2 },
  { title: 'Pharmacy Specialist', skills: ['pharmacy', 'patient-care', 'communication'], cat: 'healthcare', level: 'SENIOR' as ExperienceLevel, years: 4 },
  { title: 'Patient Care Coordinator', skills: ['patient-care', 'customer-support', 'communication'], cat: 'healthcare', level: 'JUNIOR' as ExperienceLevel, years: 1 },
  // Engineering (4)
  { title: 'Engineering Project Lead', skills: ['project-management', 'leadership', 'autocad'], cat: 'engineering', level: 'LEAD' as ExperienceLevel, years: 8 },
  { title: 'Mechanical Design Engineer', skills: ['mechanical-design', 'autocad', 'problem-solving'], cat: 'engineering', level: 'MIDDLE' as ExperienceLevel, years: 3 },
  { title: 'Electrical Engineer', skills: ['electrical-engineering', 'autocad', 'problem-solving'], cat: 'engineering', level: 'MIDDLE' as ExperienceLevel, years: 2 },
  { title: 'Site Engineer', skills: ['autocad', 'excel', 'teamwork'], cat: 'engineering', level: 'JUNIOR' as ExperienceLevel, years: 1 },
  // Customer Support (4)
  { title: 'Customer Support Lead', skills: ['customer-support', 'communication', 'leadership'], cat: 'customer-support', level: 'MIDDLE' as ExperienceLevel, years: 3 },
  { title: 'Support Specialist', skills: ['customer-support', 'communication', 'russian'], cat: 'customer-support', level: 'JUNIOR' as ExperienceLevel, years: 1 },
  { title: 'Technical Support Engineer', skills: ['customer-support', 'problem-solving', 'english'], cat: 'customer-support', level: 'MIDDLE' as ExperienceLevel, years: 2 },
  { title: 'Call Center Supervisor', skills: ['customer-support', 'leadership', 'communication'], cat: 'customer-support', level: 'SENIOR' as ExperienceLevel, years: 4 },
  // Logistics (4)
  { title: 'Logistics Coordinator', skills: ['supply-chain', 'excel', 'communication'], cat: 'logistics', level: 'JUNIOR' as ExperienceLevel, years: 1 },
  { title: 'Warehouse Supervisor', skills: ['supply-chain', 'leadership', 'excel'], cat: 'logistics', level: 'MIDDLE' as ExperienceLevel, years: 3 },
  { title: 'Supply Chain Analyst', skills: ['supply-chain', 'excel', 'data-analysis'], cat: 'logistics', level: 'MIDDLE' as ExperienceLevel, years: 2 },
  { title: 'Fleet Operations Manager', skills: ['supply-chain', 'leadership', 'project-management'], cat: 'logistics', level: 'SENIOR' as ExperienceLevel, years: 5 },
  // Legal (4)
  { title: 'Legal Counsel', skills: ['legal-research', 'contract-law', 'communication'], cat: 'legal', level: 'SENIOR' as ExperienceLevel, years: 5 },
  { title: 'Compliance Officer', skills: ['legal-research', 'contract-law', 'communication'], cat: 'legal', level: 'SENIOR' as ExperienceLevel, years: 5 },
  { title: 'Contract Specialist', skills: ['contract-law', 'excel', 'communication'], cat: 'legal', level: 'MIDDLE' as ExperienceLevel, years: 3 },
  { title: 'Paralegal Assistant', skills: ['legal-research', 'communication', 'english'], cat: 'legal', level: 'JUNIOR' as ExperienceLevel, years: 1 },
  // Hospitality (4)
  { title: 'Hotel Front Office Manager', skills: ['hospitality-management', 'customer-support', 'leadership'], cat: 'hospitality', level: 'MIDDLE' as ExperienceLevel, years: 3 },
  { title: 'Restaurant Supervisor', skills: ['food-safety', 'hospitality-management', 'leadership'], cat: 'hospitality', level: 'MIDDLE' as ExperienceLevel, years: 2 },
  { title: 'Guest Relations Officer', skills: ['hospitality-management', 'communication', 'english'], cat: 'hospitality', level: 'JUNIOR' as ExperienceLevel, years: 1 },
  { title: 'F&B Operations Lead', skills: ['food-safety', 'leadership', 'hospitality-management'], cat: 'hospitality', level: 'SENIOR' as ExperienceLevel, years: 4 },
];

const SCHOOLS = ['TUIT', 'NUUz', 'Westminster International University in Tashkent', 'INHA University in Tashkent', 'Amity University Tashkent', 'Turin Polytechnic University in Tashkent'];
const LEVELS: SkillLevel[] = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'];

async function main() {
  console.log('Seeding Job Talentio...');
  const passwordHash = await bcrypt.hash('Password123!', 10);

  // Geo hierarchy (Country → Province → City)
  const geo = await upsertUzbekistanGeo(prisma);
  console.log(
    `Geo: country=${geo.countryId} provinces=${geo.provincesUpserted} cities=${geo.citiesUpserted}`,
  );
  const cityMapRows = await prisma.city.findMany({
    where: { slug: { in: SEED_CITY_SLUGS } },
  });
  const cityMap = Object.fromEntries(cityMapRows.map((c) => [c.slug, c]));
  const cities = SEED_CITY_SLUGS.map((slug) => {
    const row = cityMap[slug];
    if (!row) throw new Error(`Missing seed city slug: ${slug}`);
    return row;
  });

  const categories = await Promise.all(
    CATEGORIES.map((c) =>
      prisma.jobCategory.upsert({
        where: { slug: c.slug },
        update: c,
        create: c,
      }),
    ),
  );
  const catMap = Object.fromEntries(categories.map((c) => [c.slug, c]));

  await backfillIndustries(prisma, { log: (msg) => console.warn(msg) });
  const industries = await prisma.industry.findMany();
  const indMap = Object.fromEntries(industries.map((i) => [i.slug, i]));

  // Push bundled demo logos to MinIO/S3 before company.logoUrl is set.
  const logoSeed = await backfillCompanyLogos(prisma, demoLogoUploader, {
    log: (msg) => console.warn(msg),
  });
  console.log(`Demo logos: uploaded=${logoSeed.uploaded} dbUpdated=${logoSeed.updated}`);

  const skills = await Promise.all(
    SKILLS.map((s) => {
      const slug = skillSlugifySeed(s.name);
      const normalizedKey = normalizeSkillKeySeed(s.name);
      return prisma.skill.upsert({
        where: { slug },
        update: { name: s.name, category: s.category, normalizedKey },
        create: { name: s.name, slug, category: s.category, normalizedKey },
      });
    }),
  );
  const skillMap = Object.fromEntries(skills.map((s) => [s.slug, s]));

  for (const a of SKILL_ALIASES) {
    const skill = skillMap[a.skillSlug];
    if (!skill) continue;
    const aliasKey = normalizeSkillKeySeed(a.alias);
    if (!aliasKey || aliasKey === skill.normalizedKey) continue;
    await prisma.skillAlias.upsert({
      where: { aliasKey },
      update: { alias: a.alias, skillId: skill.id },
      create: { alias: a.alias, aliasKey, skillId: skill.id },
    });
  }

  const languages = await Promise.all(
    LANGUAGES.map((l) =>
      prisma.language.upsert({
        where: { code: l.code },
        update: { name: l.name, normalizedKey: l.code },
        create: { ...l, normalizedKey: l.code },
      }),
    ),
  );
  const langMap = Object.fromEntries(languages.map((l) => [l.code, l]));
  for (const [alias, code] of [
    ['Uzbekcha', 'uz'],
    ['O\'zbek', 'uz'],
    ['Русский', 'ru'],
    ['English language', 'en'],
  ] as const) {
    const lang = langMap[code];
    if (!lang) continue;
    const aliasKey = alias.toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '');
    if (!aliasKey) continue;
    await prisma.languageAlias.upsert({
      where: { aliasKey },
      update: { alias, languageId: lang.id },
      create: { alias, aliasKey, languageId: lang.id },
    });
  }

  const benefits = await Promise.all(
    BENEFITS.map((b) => {
      const normalizedKey = b.slug.replace(/-/g, '');
      return prisma.benefit.upsert({
        where: { slug: b.slug },
        update: { ...b, normalizedKey },
        create: { ...b, normalizedKey },
      });
    }),
  );
  const benefitMap = Object.fromEntries(benefits.map((b) => [b.slug, b]));
  for (const [alias, slug] of [
    ['WFH', 'remote-work'],
    ['Work from home', 'remote-work'],
    ['Medical insurance', 'health-insurance'],
    ['Healthcare', 'health-insurance'],
    ['Annual leave', 'paid-vacation'],
  ] as const) {
    const benefit = benefitMap[slug];
    if (!benefit) continue;
    const aliasKey = alias.toLowerCase().replace(/[^a-z0-9]+/g, '');
    await prisma.benefitAlias.upsert({
      where: { aliasKey },
      update: { alias, benefitId: benefit.id },
      create: { alias, aliasKey, benefitId: benefit.id },
    });
  }

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

    const company = await prisma.company.upsert({
      where: { slug: c.slug },
      update: {
        name: c.name,
        description: `${c.name} is a leading ${c.industry} company in Uzbekistan, building modern products for the Central Asian market.`,
        // The blurb below is English; without this it would claim to be Uzbek.
        locale: 'en',
        website: `https://${c.slug}.uz`,
        cityId: cityMap[c.city].id,
        industryId: indMap[c.industry].id,
        size: c.size,
        logoUrl: logo(c.slug, c.name, c.color),
        isVerified: c.plan !== 'FREE',
      },
      create: {
        name: c.name,
        slug: c.slug,
        description: `${c.name} is a leading ${c.industry} company in Uzbekistan, building modern products for the Central Asian market.`,
        locale: 'en',
        website: `https://${c.slug}.uz`,
        cityId: cityMap[c.city].id,
        industryId: indMap[c.industry].id,
        size: c.size,
        logoUrl: logo(c.slug, c.name, c.color),
        isVerified: c.plan !== 'FREE',
        subscription: { create: { plan: c.plan, status: 'ACTIVE' } },
        members: {
          create: [
            { userId: recruiter.id, role: 'OWNER' },
            ...(extra ? [{ userId: extra.id, role: 'RECRUITER' as const }] : []),
          ],
        },
      },
    });

    // Ensure subscription & membership
    await prisma.subscription.upsert({
      where: { companyId: company.id },
      update: { plan: c.plan, status: 'ACTIVE' },
      create: { companyId: company.id, plan: c.plan, status: 'ACTIVE' },
    });
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

    if (c.plan !== 'FREE') {
      await prisma.payment.create({
        data: {
          companyId: company.id,
          purpose: `Plan ${c.plan}`,
          amountUzs:
            c.plan === 'VIP' ? 1_999_000 : c.plan === 'PREMIUM' ? 799_000 : 299_000,
          status: 'MOCKED',
          provider: 'mock',
        },
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

    const tpl = JOB_TITLES[i % JOB_TITLES.length];
    const resolvedRole = await resolveJobTitle(prisma, { name: tpl.title });
    const headline = resolvedRole.jobTitle.name;
    const yearsExp = tpl.years + (i % 3);
    const summaryVariants = [
      `${headline} with ${yearsExp}+ years of experience, currently based in ${city.name}. Open to hybrid and remote roles across Uzbekistan.`,
      `Results-driven ${headline.toLowerCase()} focused on ${tpl.skills.slice(0, 2).join(' & ')}. Previously delivered projects for fintech and e-commerce teams.`,
      `Bilingual professional (${i % 2 ? 'Uzbek/Russian' : 'Uzbek/English'}) seeking ${headline} opportunities in ${city.name} and beyond.`,
      `Career switcher into ${tpl.cat.replace('-', ' ')} - strong foundation in ${tpl.skills[0]} and eager to grow inside a product team.`,
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
        description: `Owned delivery for ${tpl.skills.slice(0, 2).join(' / ')} initiatives and collaborated with cross-functional teams.`,
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
          cityId: cityMap.tashkent.id,
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
    await prisma.profileLanguage.create({
      data: { profileId: profile.id, languageId: langMap.uz.id, level: 'NATIVE' },
    });
    await prisma.profileLanguage.create({
      data: { profileId: profile.id, languageId: langMap.ru.id, level: i % 2 ? 'C1' : 'B2' },
    });
    await prisma.profileLanguage.create({
      data: { profileId: profile.id, languageId: langMap.en.id, level: i % 3 ? 'B2' : 'B1' },
    });

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

  // Starter JobTitle catalog (role-only) — populated even before job posts exist
  const uniqueSeedTitles = [
    ...new Set([
      ...JOB_TITLES.map((t) => t.title),
      'Frontend Developer',
      'C++ Developer',
      'Backend Developer',
      'React Developer',
    ]),
  ];
  for (const name of uniqueSeedTitles) {
    await resolveJobTitle(prisma, { name });
  }

  // Jobs — refresh listings on each seed so counts stay predictable
  await prisma.jobPost.deleteMany({});
  // Applications cascade with jobs; hard-purge soft-deleted resumes that lost all refs
  {
    const soft = await prisma.resume.findMany({
      where: { deletedAt: { not: null } },
      include: { _count: { select: { applications: true } } },
    });
    for (const r of soft) {
      if (r._count.applications === 0) {
        await prisma.resume.delete({ where: { id: r.id } });
      }
    }
  }
  const jobRecords = [];
  // 96 = 2×48 templates → every category twice; cities round-robin all 15
  const JOB_COUNT = 96;
  for (let i = 0; i < JOB_COUNT; i++) {
    const tpl = JOB_TITLES[i % JOB_TITLES.length];
    const company = companyRecords[i % companyRecords.length];
    const city = cities[i % cities.length];
    const isHot = i < 10;
    const status = i % 14 === 0 ? 'DRAFT' : i % 16 === 0 ? 'CLOSED' : 'PUBLISHED';
    const employmentTypes: EmploymentType[] = ['FULL_TIME', 'FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP'];
    const workModes: WorkMode[] = ['ONSITE', 'HYBRID', 'REMOTE', 'HYBRID', 'ONSITE'];
    // ASCII-only separators — em-dash (U+2014) previously corrupted to "???" in some seed environments
    const resolvedTitle = await resolveJobTitle(prisma, { name: tpl.title });
    const title = resolvedTitle.jobTitle.name;

    const job = await prisma.jobPost.create({
      data: {
        companyId: company.id,
        jobTitleId: resolvedTitle.jobTitle.id,
        title,
        description: `${company.name} is hiring a ${title} in ${city.name}.\n\nAbout the role:\nYou will help build products used by customers across Uzbekistan and Central Asia.\n\nResponsibilities:\n- Own delivery for ${tpl.skills.slice(0, 2).join(' and ')} workstreams\n- Collaborate with product, design, and operations\n- Improve quality, documentation, and mentoring\n\nRequirements:\n- Hands-on experience with ${tpl.skills.join(', ')}\n- ${tpl.years}+ years relevant experience preferred\n- Communication in Uzbek/Russian/English\n\nBenefits include competitive pay, learning budget, and modern tooling.`,
        cityId: city.id,
        categoryId: catMap[tpl.cat].id,
        // The demo copy above is English; leaving this to the schema default
        // would label every seeded posting as Uzbek.
        locale: 'en',
        employmentType: employmentTypes[i % employmentTypes.length],
        workMode: workModes[i % workModes.length],
        salaryMin: 8_000_000 + (tpl.years || 0) * 2_000_000,
        salaryMax: 15_000_000 + (tpl.years || 0) * 3_000_000,
        salaryPeriod: 'MONTHLY',
        currency: 'UZS',
        experienceYearsMin: tpl.years,
        experienceLevel: tpl.level,
        status,
        publishedAt: status === 'PUBLISHED' ? new Date(Date.now() - i * 86_400_000) : null,
        boostWeight: isHot ? 1.2 : 0,
        boostUntil: isHot ? new Date(Date.now() + 14 * 86_400_000) : null,
        fingerprint: jobFingerprint({
          title,
          workMode: workModes[i % workModes.length],
          cityId: city.id,
        }),
      },
    });

    for (const slug of tpl.skills) {
      const skill = skillMap[slug];
      if (!skill) continue;
      await prisma.jobPostSkill.create({
        data: {
          jobPostId: job.id,
          skillId: skill.id,
          isRequired: true,
          weight: 1 + (slug === tpl.skills[0] ? 0.5 : 0),
        },
      });
    }

    // Benefits
    for (let b = 0; b < 3 + (i % 3); b++) {
      await prisma.jobPostBenefit.create({
        data: { jobPostId: job.id, benefitId: benefits[b % benefits.length].id },
      }).catch(() => undefined);
    }

    // Screening questions on ~15 jobs
    if (i % 3 === 0) {
      await prisma.jobQuestion.createMany({
        data: [
          { jobPostId: job.id, question: 'How many years of relevant experience do you have?', type: 'NUMBER', isRequired: true, sortOrder: 0 },
          { jobPostId: job.id, question: 'Are you available to start within 2 weeks?', type: 'YES_NO', isRequired: true, sortOrder: 1 },
          { jobPostId: job.id, question: 'Why do you want to join our team?', type: 'TEXT', isRequired: false, sortOrder: 2 },
        ],
      });
    }

    jobRecords.push(job);
  }

  await backfillJobLanguages(prisma, { log: (msg) => console.warn(msg) });

  // Job title aliases (Front End ≡ Frontend, CPP ≡ C++, …)
  for (const row of JOB_TITLE_ALIASES) {
    const resolved = await resolveJobTitle(prisma, { name: row.canonical });
    const aliasKey = normalizeJobTitleKey(row.alias);
    if (!aliasKey || aliasKey === resolved.jobTitle.normalizedKey) continue;
    await prisma.jobTitleAlias.upsert({
      where: { aliasKey },
      update: { alias: row.alias, jobTitleId: resolved.jobTitle.id },
      create: {
        alias: row.alias,
        aliasKey,
        jobTitleId: resolved.jobTitle.id,
      },
    });
  }

  // Applications + matching-ish scores
  const publishedJobs = jobRecords.filter((j) => j.status === 'PUBLISHED');
  let appCount = 0;
  for (let i = 0; i < 140; i++) {
    const job = publishedJobs[i % publishedJobs.length];
    const profile = employeeProfiles[i % employeeProfiles.length];
    try {
      const questions = await prisma.jobQuestion.findMany({ where: { jobPostId: job.id } });
      const matchScore = 40 + ((i * 7) % 55);
      const app = await prisma.application.create({
        data: {
          jobPostId: job.id,
          profileId: profile.id,
          coverLetter: 'I am excited to apply for this role and believe my skills are a strong match.',
          matchScore,
          matchBreakdown: {
            skills: Math.round(matchScore * 0.45),
            experience: Math.round(matchScore * 0.2),
            location: Math.round(matchScore * 0.15),
            education: Math.round(matchScore * 0.1),
            language: Math.round(matchScore * 0.1),
            total: matchScore,
          },
          status: (['NEW', 'IN_REVIEW', 'INTERVIEW', 'OFFER', 'REJECTED', 'NEW'] as const)[i % 6],
          events: {
            create: { toStatus: 'NEW', note: 'Application submitted' },
          },
          answers: {
            create: questions.map((q) => ({
              questionId: q.id,
              answer: q.type === 'YES_NO' ? 'Yes' : q.type === 'NUMBER' ? String(2 + (i % 5)) : 'I am motivated to grow with your company.',
            })),
          },
        },
      });
      appCount++;

      if (app.status === 'INTERVIEW' || i % 10 === 0) {
        await prisma.interview.create({
          data: {
            applicationId: app.id,
            scheduledAt: new Date(Date.now() + (i + 1) * 86_400_000),
            durationMins: 60,
            meetingUrl: 'https://meet.example.com/interview',
            note: 'Technical interview',
            status: 'SCHEDULED',
          },
        });
      }
    } catch {
      // unique constraint — skip duplicate profile/job
    }
  }

  // Saved jobs, alerts, follows, views, notifications, chats, reports
  for (let i = 0; i < 35; i++) {
    await prisma.savedJob.upsert({
      where: {
        profileId_jobPostId: {
          profileId: employeeProfiles[i].id,
          jobPostId: publishedJobs[i % publishedJobs.length].id,
        },
      },
      create: {
        profileId: employeeProfiles[i].id,
        jobPostId: publishedJobs[i % publishedJobs.length].id,
      },
      update: {},
    });
  }

  for (let i = 0; i < 20; i++) {
    const user = employeeUsers[i];
    if (!user) continue;
    const alert = await prisma.jobAlert.create({
      data: {
        userId: user.id,
        name: `Alert ${i + 1}`,
        query: JOB_TITLES[i % JOB_TITLES.length].title.split(' ')[0],
        cityId: cities[i % cities.length].id,
        categoryId: categories[i % categories.length].id,
        frequency: i % 2 ? 'WEEKLY' : 'DAILY',
      },
    });
    const skillSlug = JOB_TITLES[i % JOB_TITLES.length].skills[0];
    if (skillMap[skillSlug]) {
      await prisma.jobAlertSkill.create({
        data: { alertId: alert.id, skillId: skillMap[skillSlug].id },
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

  // Job views
  for (let i = 0; i < 400; i++) {
    await prisma.jobView.create({
      data: {
        jobPostId: publishedJobs[i % publishedJobs.length].id,
        viewerId: null,
        createdAt: new Date(Date.now() - i * 3_600_000),
      },
    });
  }

  // Notifications for primary demo employee & recruiter
  const emp = employeeUsers[0];
  const rec = recruiterUsers[0];
  if (emp) {
    await prisma.notification.createMany({
      data: [
        { userId: emp.id, type: 'APPLICATION_STATUS', title: 'Application in review', body: 'Your application is being reviewed', linkUrl: '/dashboard/employee' },
        { userId: emp.id, type: 'NEW_JOB_MATCH', title: 'New matching jobs', body: '3 jobs match your skills', linkUrl: '/jobs' },
        { userId: emp.id, type: 'INTERVIEW_SCHEDULED', title: 'Interview scheduled', body: 'Tomorrow at 10:00', linkUrl: '/dashboard/employee' },
      ],
    });
  }
  if (rec) {
    await prisma.notification.createMany({
      data: [
        { userId: rec.id, type: 'NEW_APPLICANT', title: 'New applicant', body: 'Someone applied to your job', linkUrl: '/dashboard/recruiter' },
        { userId: rec.id, type: 'SYSTEM', title: 'Welcome to Job Talentio', body: 'Your recruiter dashboard is ready' },
      ],
    });
  }

  // Chat
  if (emp && rec) {
    const conv = await prisma.conversation.create({
      data: {
        userAId: emp.id,
        userBId: rec.id,
        companyId: companyRecords[0].id,
        jobPostId: publishedJobs[0]?.id,
        initiatedBy: emp.id,
        isColdOutreach: false,
        messages: {
          create: [
            { senderId: emp.id, body: 'Hello! I applied to your Full-stack role and would love to discuss.' },
            { senderId: rec.id, body: 'Hi! Thanks for applying. Your profile looks promising. Are you available for a call this week?' },
          ],
        },
      },
    });
    void conv;
  }

  // Reports
  if (emp) {
    await prisma.report.create({
      data: {
        reporterId: emp.id,
        entityType: 'JOB_POST',
        entityId: publishedJobs[5]?.id ?? publishedJobs[0].id,
        reason: 'Suspected spam / unrealistic salary claim',
        status: 'OPEN',
      },
    });
  }
  if (rec) {
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
  const catalogI18n = await backfillCatalogI18n(prisma);
  const catalogI18nRows = Object.values(catalogI18n).reduce((sum, c) => sum + c.updated, 0);

  await prisma.featureFlag.upsert({
    where: { key: 'hot_jobs' },
    update: { enabled: true },
    create: { key: 'hot_jobs', enabled: true },
  });
  await prisma.featureFlag.upsert({
    where: { key: 'candidate_matching' },
    update: { enabled: true },
    create: { key: 'candidate_matching', enabled: true },
  });

  console.log(`Seed complete:
  - ${cities.length} cities, ${categories.length} categories, ${skills.length} skills
  - ${companyRecords.length} companies, ${employeeUsers.length} employees, ${jobRecords.length} jobs
  - ~${appCount} applications
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
