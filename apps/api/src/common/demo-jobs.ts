/**
 * Demo job postings shared by `prisma/seed.ts` and `scripts/demo-reset.ts`.
 *
 * Postings are written in the language the employer would actually use
 * (mostly Uzbek and Russian, some English), carry salary bands that match the
 * Tashkent market, and include a handful of hand-written "hero" vacancies that
 * the demo script walks through. Keep bullets ASCII (`-`): em dashes have
 * corrupted to "???" in some seed environments.
 */
import type {
  EmploymentType,
  ExperienceLevel,
  JobPost,
  PrismaClient,
  QuestionType,
  WorkMode,
} from '@prisma/client';
import { resolveJobTitle } from './title-resolve';
import { contentHash, jobFingerprint } from './dedupe';

export type DemoLocale = 'uz' | 'ru' | 'en';

export type DemoJobTemplate = {
  title: string;
  skills: string[];
  cat: string;
  level: ExperienceLevel;
  years: number;
};

/** Primary hubs used for round-robin seed of jobs, companies and profiles. */
export const DEMO_CITY_SLUGS = [
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

/** ~4 role-only templates per category; seniority lives on experienceLevel. */
export const DEMO_JOB_TEMPLATES: DemoJobTemplate[] = [
  // IT & Software
  { title: 'Full-stack Developer', skills: ['typescript', 'react', 'nestjs', 'postgresql'], cat: 'it-software', level: 'SENIOR', years: 5 },
  { title: 'DevOps Engineer', skills: ['docker', 'kubernetes', 'aws', 'ci-cd'], cat: 'it-software', level: 'SENIOR', years: 4 },
  { title: 'Java Developer', skills: ['java', 'spring-boot', 'sql'], cat: 'it-software', level: 'JUNIOR', years: 0 },
  { title: 'C++ Systems Engineer', skills: ['cplusplus', 'linux', 'problem-solving'], cat: 'it-software', level: 'MIDDLE', years: 3 },
  // Finance
  { title: 'Financial Analyst', skills: ['financial-analysis', 'excel', 'accounting'], cat: 'finance', level: 'MIDDLE', years: 2 },
  { title: 'Accountant', skills: ['accounting', '1c', 'excel'], cat: 'finance', level: 'MIDDLE', years: 3 },
  { title: 'Credit Risk Analyst', skills: ['financial-analysis', 'excel', 'sql'], cat: 'finance', level: 'SENIOR', years: 4 },
  { title: 'Banking Associate', skills: ['excel', 'communication', 'customer-support'], cat: 'finance', level: 'JUNIOR', years: 1 },
  // Sales & Marketing
  { title: 'Digital Marketing Specialist', skills: ['digital-marketing', 'seo', 'smm'], cat: 'sales-marketing', level: 'JUNIOR', years: 1 },
  { title: 'Sales Manager', skills: ['sales', 'communication', 'excel'], cat: 'sales-marketing', level: 'MIDDLE', years: 3 },
  { title: 'SEO Specialist', skills: ['seo', 'google-analytics', 'content-writing'], cat: 'sales-marketing', level: 'JUNIOR', years: 1 },
  { title: 'SMM Manager', skills: ['smm', 'digital-marketing', 'content-writing'], cat: 'sales-marketing', level: 'MIDDLE', years: 2 },
  // Design
  { title: 'UI/UX Designer', skills: ['figma', 'ui-ux', 'adobe-photoshop'], cat: 'design', level: 'MIDDLE', years: 2 },
  { title: 'Graphic Designer', skills: ['adobe-photoshop', 'figma', 'ui-ux'], cat: 'design', level: 'JUNIOR', years: 1 },
  { title: 'Product Designer', skills: ['figma', 'ui-ux', 'product-management'], cat: 'design', level: 'SENIOR', years: 4 },
  { title: 'Motion Designer', skills: ['adobe-photoshop', 'figma', 'communication'], cat: 'design', level: 'INTERN', years: 0 },
  // HR
  { title: 'HR Recruiter', skills: ['recruiting', 'hr-management', 'communication'], cat: 'hr', level: 'JUNIOR', years: 1 },
  { title: 'Talent Acquisition Partner', skills: ['recruiting', 'hr-management', 'communication'], cat: 'hr', level: 'MIDDLE', years: 3 },
  { title: 'HR Business Partner', skills: ['hr-management', 'leadership', 'communication'], cat: 'hr', level: 'SENIOR', years: 5 },
  { title: 'People Operations Specialist', skills: ['hr-management', 'excel', 'teamwork'], cat: 'hr', level: 'MIDDLE', years: 2 },
  // Education
  { title: 'English Teacher (Corporate)', skills: ['english', 'teaching', 'communication'], cat: 'education', level: 'MIDDLE', years: 2 },
  { title: 'Curriculum Designer', skills: ['curriculum-design', 'teaching', 'english'], cat: 'education', level: 'SENIOR', years: 4 },
  { title: 'Online Course Instructor', skills: ['teaching', 'content-writing', 'communication'], cat: 'education', level: 'MIDDLE', years: 2 },
  { title: 'Teaching Assistant', skills: ['teaching', 'uzbek', 'teamwork'], cat: 'education', level: 'JUNIOR', years: 0 },
  // Healthcare
  { title: 'Registered Nurse', skills: ['nursing', 'patient-care', 'communication'], cat: 'healthcare', level: 'MIDDLE', years: 3 },
  { title: 'Clinical Research Associate', skills: ['clinical-research', 'excel', 'english'], cat: 'healthcare', level: 'MIDDLE', years: 2 },
  { title: 'Pharmacy Specialist', skills: ['pharmacy', 'patient-care', 'communication'], cat: 'healthcare', level: 'SENIOR', years: 4 },
  { title: 'Patient Care Coordinator', skills: ['patient-care', 'customer-support', 'communication'], cat: 'healthcare', level: 'JUNIOR', years: 1 },
  // Engineering
  { title: 'Engineering Project Lead', skills: ['project-management', 'leadership', 'autocad'], cat: 'engineering', level: 'LEAD', years: 8 },
  { title: 'Mechanical Design Engineer', skills: ['mechanical-design', 'autocad', 'problem-solving'], cat: 'engineering', level: 'MIDDLE', years: 3 },
  { title: 'Electrical Engineer', skills: ['electrical-engineering', 'autocad', 'problem-solving'], cat: 'engineering', level: 'MIDDLE', years: 2 },
  { title: 'Site Engineer', skills: ['autocad', 'excel', 'teamwork'], cat: 'engineering', level: 'JUNIOR', years: 1 },
  // Customer Support
  { title: 'Customer Support Lead', skills: ['customer-support', 'communication', 'leadership'], cat: 'customer-support', level: 'MIDDLE', years: 3 },
  { title: 'Support Specialist', skills: ['customer-support', 'communication', 'russian'], cat: 'customer-support', level: 'JUNIOR', years: 1 },
  { title: 'Technical Support Engineer', skills: ['customer-support', 'problem-solving', 'english'], cat: 'customer-support', level: 'MIDDLE', years: 2 },
  { title: 'Call Center Supervisor', skills: ['customer-support', 'leadership', 'communication'], cat: 'customer-support', level: 'SENIOR', years: 4 },
  // Logistics
  { title: 'Logistics Coordinator', skills: ['supply-chain', 'excel', 'communication'], cat: 'logistics', level: 'JUNIOR', years: 1 },
  { title: 'Warehouse Supervisor', skills: ['supply-chain', 'leadership', 'excel'], cat: 'logistics', level: 'MIDDLE', years: 3 },
  { title: 'Supply Chain Analyst', skills: ['supply-chain', 'excel', 'data-analysis'], cat: 'logistics', level: 'MIDDLE', years: 2 },
  { title: 'Fleet Operations Manager', skills: ['supply-chain', 'leadership', 'project-management'], cat: 'logistics', level: 'SENIOR', years: 5 },
  // Legal
  { title: 'Legal Counsel', skills: ['legal-research', 'contract-law', 'communication'], cat: 'legal', level: 'SENIOR', years: 5 },
  { title: 'Compliance Officer', skills: ['legal-research', 'contract-law', 'communication'], cat: 'legal', level: 'SENIOR', years: 5 },
  { title: 'Contract Specialist', skills: ['contract-law', 'excel', 'communication'], cat: 'legal', level: 'MIDDLE', years: 3 },
  { title: 'Paralegal Assistant', skills: ['legal-research', 'communication', 'english'], cat: 'legal', level: 'JUNIOR', years: 1 },
  // Hospitality
  { title: 'Hotel Front Office Manager', skills: ['hospitality-management', 'customer-support', 'leadership'], cat: 'hospitality', level: 'MIDDLE', years: 3 },
  { title: 'Restaurant Supervisor', skills: ['food-safety', 'hospitality-management', 'leadership'], cat: 'hospitality', level: 'MIDDLE', years: 2 },
  { title: 'Guest Relations Officer', skills: ['hospitality-management', 'communication', 'english'], cat: 'hospitality', level: 'JUNIOR', years: 1 },
  { title: 'F&B Operations Lead', skills: ['food-safety', 'leadership', 'hospitality-management'], cat: 'hospitality', level: 'SENIOR', years: 4 },
];

/** Half of the generic postings are Uzbek, a third Russian, the rest English. */
export const DEMO_JOB_LOCALES: DemoLocale[] = ['uz', 'uz', 'ru', 'en', 'uz', 'ru'];

/** Monthly UZS band for a MIDDLE profile per category (Tashkent market, 2026). */
const SALARY_BASE: Record<string, { min: number; max: number }> = {
  'it-software': { min: 9_000_000, max: 16_000_000 },
  finance: { min: 6_000_000, max: 11_000_000 },
  'sales-marketing': { min: 5_000_000, max: 10_000_000 },
  design: { min: 6_000_000, max: 11_000_000 },
  hr: { min: 6_000_000, max: 10_000_000 },
  education: { min: 4_000_000, max: 7_000_000 },
  healthcare: { min: 4_000_000, max: 8_000_000 },
  engineering: { min: 7_000_000, max: 13_000_000 },
  'customer-support': { min: 4_000_000, max: 6_500_000 },
  logistics: { min: 5_000_000, max: 9_000_000 },
  legal: { min: 8_000_000, max: 14_000_000 },
  hospitality: { min: 4_000_000, max: 7_000_000 },
};

const LEVEL_FACTOR: Record<ExperienceLevel, number> = {
  INTERN: 0.5,
  JUNIOR: 0.75,
  MIDDLE: 1,
  SENIOR: 1.5,
  LEAD: 1.9,
  EXECUTIVE: 2.5,
};

function roundUzs(n: number): number {
  return Math.round(n / 100_000) * 100_000;
}

export function demoSalaryBand(cat: string, level: ExperienceLevel): { min: number; max: number } {
  const base = SALARY_BASE[cat] ?? { min: 5_000_000, max: 9_000_000 };
  const factor = LEVEL_FACTOR[level] ?? 1;
  return { min: roundUzs(base.min * factor), max: roundUzs(base.max * factor) };
}

export function formatUzsSpaced(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

const HEADINGS: Record<DemoLocale, { duties: string; requirements: string; conditions: string }> = {
  uz: { duties: 'Vazifalar:', requirements: 'Talablar:', conditions: 'Shartlar:' },
  ru: { duties: 'Обязанности:', requirements: 'Требования:', conditions: 'Условия:' },
  en: { duties: 'Responsibilities:', requirements: 'Requirements:', conditions: 'Conditions:' },
};

const WORK_MODE_LABEL: Record<DemoLocale, Record<WorkMode, string>> = {
  uz: { ONSITE: 'ofisda ish', HYBRID: 'gibrid grafik', REMOTE: 'masofaviy ish' },
  ru: { ONSITE: 'работа в офисе', HYBRID: 'гибридный формат', REMOTE: 'удалённая работа' },
  en: { ONSITE: 'on-site', HYBRID: 'hybrid schedule', REMOTE: 'remote' },
};

const EMPLOYMENT_LABEL: Record<DemoLocale, Record<EmploymentType, string>> = {
  uz: {
    FULL_TIME: 'to‘liq stavka',
    PART_TIME: 'qisman bandlik',
    CONTRACT: 'shartnoma asosida',
    INTERNSHIP: 'amaliyot',
    TEMPORARY: 'vaqtinchalik ish',
  },
  ru: {
    FULL_TIME: 'полная занятость',
    PART_TIME: 'частичная занятость',
    CONTRACT: 'работа по договору',
    INTERNSHIP: 'стажировка',
    TEMPORARY: 'временная занятость',
  },
  en: {
    FULL_TIME: 'full-time',
    PART_TIME: 'part-time',
    CONTRACT: 'contract',
    INTERNSHIP: 'internship',
    TEMPORARY: 'temporary',
  },
};

/** Three category-specific duty lines per language. */
const DUTIES: Record<string, Record<DemoLocale, string[]>> = {
  'it-software': {
    uz: [
      'Mavjud xizmatlarni qo‘llab-quvvatlash va yangi funksiyalarni ishlab chiqish',
      'Kod sifati, testlar va code review jarayonida ishtirok etish',
      'Mahsulot va dizayn jamoasi bilan talablarni kelishish',
    ],
    ru: [
      'Разрабатывать новые функции и поддерживать существующие сервисы',
      'Писать тесты, участвовать в code review и улучшать качество кода',
      'Согласовывать требования с продуктовой и дизайн-командой',
    ],
    en: [
      'Build new features and maintain existing services',
      'Write tests, take part in code review and raise code quality',
      'Align requirements with product and design',
    ],
  },
  finance: {
    uz: [
      'Buxgalteriya va moliyaviy hisobotlarni o‘z vaqtida tayyorlash',
      'Byudjet ijrosini tahlil qilish va rahbariyatga taqdim etish',
      'Soliq va nazorat organlari talablariga muvofiqlikni ta’minlash',
    ],
    ru: [
      'Готовить бухгалтерскую и финансовую отчётность в срок',
      'Анализировать исполнение бюджета и готовить материалы для руководства',
      'Обеспечивать соответствие требованиям налоговых и контролирующих органов',
    ],
    en: [
      'Prepare accounting and financial reports on time',
      'Analyse budget performance and brief management',
      'Keep the company compliant with tax and regulatory requirements',
    ],
  },
  'sales-marketing': {
    uz: [
      'Yangi mijozlarni jalb qilish va savdo voronkasini yuritish',
      'Marketing kampaniyalarini rejalashtirish va natijalarini o‘lchash',
      'Mijozlar bilan uzoq muddatli munosabatlarni rivojlantirish',
    ],
    ru: [
      'Привлекать новых клиентов и вести воронку продаж',
      'Планировать маркетинговые кампании и измерять их результат',
      'Развивать долгосрочные отношения с клиентами',
    ],
    en: [
      'Win new customers and manage the sales funnel',
      'Plan marketing campaigns and measure their results',
      'Grow long-term customer relationships',
    ],
  },
  design: {
    uz: [
      'Veb va mobil interfeyslar uchun maketlar va prototiplar yaratish',
      'Dizayn tizimini yuritish va brend uslubiga rioya qilish',
      'Foydalanuvchi tadqiqotlari asosida yechimlarni takomillashtirish',
    ],
    ru: [
      'Создавать макеты и прототипы для веб- и мобильных интерфейсов',
      'Поддерживать дизайн-систему и фирменный стиль',
      'Улучшать решения на основе пользовательских исследований',
    ],
    en: [
      'Create mock-ups and prototypes for web and mobile interfaces',
      'Maintain the design system and brand style',
      'Improve solutions based on user research',
    ],
  },
  hr: {
    uz: [
      'Bo‘sh ish o‘rinlari uchun nomzodlarni izlash, saralash va suhbat o‘tkazish',
      'Xodimlarni moslashtirish va rivojlantirish dasturlarini yuritish',
      'HR hujjatlari va kadrlar hisobini tartibda saqlash',
    ],
    ru: [
      'Искать, отбирать и собеседовать кандидатов на открытые вакансии',
      'Вести программы адаптации и развития сотрудников',
      'Поддерживать кадровый учёт и HR-документацию в порядке',
    ],
    en: [
      'Source, screen and interview candidates for open roles',
      'Run onboarding and development programmes',
      'Keep HR records and documentation in order',
    ],
  },
  education: {
    uz: [
      'Guruh va individual darslarni dastur asosida o‘tkazish',
      'Dars rejalari va o‘quv materiallarini tayyorlash',
      'O‘quvchilar natijalarini baholash va buyurtmachiga hisobot berish',
    ],
    ru: [
      'Проводить групповые и индивидуальные занятия по программе',
      'Готовить планы уроков и учебные материалы',
      'Оценивать прогресс учащихся и отчитываться заказчику',
    ],
    en: [
      'Teach group and one-to-one classes to the programme',
      'Prepare lesson plans and learning materials',
      'Assess learner progress and report to the client',
    ],
  },
  healthcare: {
    uz: [
      'Bemorlarga klinika standartlariga muvofiq tibbiy yordam ko‘rsatish',
      'Tibbiy hujjatlarni to‘g‘ri va o‘z vaqtida yuritish',
      'Shifokorlar va boshqa bo‘limlar bilan hamkorlikda ishlash',
    ],
    ru: [
      'Оказывать медицинскую помощь пациентам по стандартам клиники',
      'Вести медицинскую документацию точно и в срок',
      'Работать в связке с врачами и смежными отделениями',
    ],
    en: [
      'Provide patient care to clinic standards',
      'Keep medical records accurate and up to date',
      'Work closely with doctors and other departments',
    ],
  },
  engineering: {
    uz: [
      'Loyiha hujjatlarini AutoCAD va boshqa muhandislik dasturlarida tayyorlash',
      'Qurilish yoki ishlab chiqarish jarayonini nazorat qilish',
      'Texnik nazorat va mehnat xavfsizligi talablariga rioya qilish',
    ],
    ru: [
      'Разрабатывать проектную документацию в AutoCAD и смежных программах',
      'Контролировать ход строительства или производства',
      'Соблюдать требования технадзора и охраны труда',
    ],
    en: [
      'Prepare design documentation in AutoCAD and related tools',
      'Supervise construction or production progress',
      'Comply with technical supervision and safety requirements',
    ],
  },
  'customer-support': {
    uz: [
      'Mijozlar murojaatlarini telefon, chat va Telegram orqali hal qilish',
      'Murojaatlarni CRM tizimida qayd etish va kuzatish',
      'Ko‘p takrorlanadigan savollar bo‘yicha bilimlar bazasini yangilash',
    ],
    ru: [
      'Решать обращения клиентов по телефону, в чате и Telegram',
      'Фиксировать и отслеживать обращения в CRM',
      'Пополнять базу знаний по частым вопросам',
    ],
    en: [
      'Resolve customer requests by phone, chat and Telegram',
      'Log and track requests in the CRM',
      'Keep the knowledge base of frequent questions up to date',
    ],
  },
  logistics: {
    uz: [
      'Yuk tashish va yetkazib berish jarayonini rejalashtirish',
      'Omborlar va tashuvchilar bilan muvofiqlashtirish',
      'Xarajatlar va muddatlarni tahlil qilib, jarayonni takomillashtirish',
    ],
    ru: [
      'Планировать перевозки и доставку',
      'Координировать работу складов и перевозчиков',
      'Анализировать сроки и затраты, улучшать процессы',
    ],
    en: [
      'Plan shipments and deliveries',
      'Coordinate warehouses and carriers',
      'Analyse lead times and costs to improve the process',
    ],
  },
  legal: {
    uz: [
      'Shartnomalar va ichki hujjatlarni tayyorlash hamda ekspertizadan o‘tkazish',
      'Kompaniya faoliyatining qonunchilikka muvofiqligini nazorat qilish',
      'Davlat organlari va kontragentlar bilan yozishmalarni yuritish',
    ],
    ru: [
      'Готовить и проверять договоры и внутренние документы',
      'Следить за соответствием деятельности компании законодательству',
      'Вести переписку с государственными органами и контрагентами',
    ],
    en: [
      'Draft and review contracts and internal documents',
      'Keep company operations compliant with legislation',
      'Handle correspondence with authorities and counterparties',
    ],
  },
  hospitality: {
    uz: [
      'Mehmonlarga xizmat ko‘rsatish standartlarini ta’minlash',
      'Smenani boshqarish va jamoani yo‘naltirish',
      'Sanitariya va xavfsizlik talablariga rioya qilish',
    ],
    ru: [
      'Обеспечивать стандарты обслуживания гостей',
      'Управлять сменой и направлять команду',
      'Соблюдать санитарные нормы и требования безопасности',
    ],
    en: [
      'Deliver guest service to standard',
      'Run the shift and guide the team',
      'Follow hygiene and safety requirements',
    ],
  },
};

const FALLBACK_DUTIES: Record<DemoLocale, string[]> = {
  uz: ['Bo‘lim vazifalarini sifatli va o‘z vaqtida bajarish', 'Jamoa bilan hamkorlikda ishlash'],
  ru: ['Качественно и в срок выполнять задачи отдела', 'Работать в команде'],
  en: ['Deliver the team goals on time and to standard', 'Work closely with the team'],
};

export type DemoDescriptionInput = {
  locale: DemoLocale;
  companyName: string;
  cityName: string;
  title: string;
  cat: string;
  skillNames: string[];
  years: number;
  salaryMin: number;
  salaryMax: number;
  workMode: WorkMode;
  employmentType: EmploymentType;
};

export function buildDemoJobDescription(input: DemoDescriptionInput): string {
  const { locale } = input;
  const h = HEADINGS[locale];
  const duties = DUTIES[input.cat]?.[locale] ?? FALLBACK_DUTIES[locale];
  const skills = input.skillNames.join(', ');
  const salary = `${formatUzsSpaced(input.salaryMin)} - ${formatUzsSpaced(input.salaryMax)}`;
  const mode = WORK_MODE_LABEL[locale][input.workMode];
  const employment = EMPLOYMENT_LABEL[locale][input.employmentType];

  if (locale === 'uz') {
    const experience =
      input.years > 0
        ? `${input.years}+ yil tegishli tajriba`
        : 'Tajribasiz nomzodlar ham ko‘rib chiqiladi, o‘rgatamiz';
    return [
      `${input.companyName} ${input.cityName} shahrida ${input.title} lavozimiga xodim izlaydi.`,
      '',
      h.duties,
      ...duties.map((d) => `- ${d}`),
      '',
      h.requirements,
      `- ${skills} bilan amaliy tajriba`,
      `- ${experience}`,
      '- O‘zbek va rus tillari; ingliz tili afzallik',
      '',
      h.conditions,
      `- Maosh ${salary} so‘m, tajribaga qarab`,
      `- ${capitalize(employment)}, ${mode}`,
      '- Rasmiy ishga qabul va tibbiy sug‘urta',
      '- O‘quv byudjeti va zamonaviy ish vositalari',
    ].join('\n');
  }

  if (locale === 'ru') {
    const experience =
      input.years > 0 ? `Опыт от ${input.years} лет в смежной роли` : 'Рассматриваем кандидатов без опыта, обучаем';
    return [
      `${input.companyName} открывает вакансию ${input.title} (${input.cityName}).`,
      '',
      h.duties,
      ...duties.map((d) => `- ${d}`),
      '',
      h.requirements,
      `- Практический опыт с ${skills}`,
      `- ${experience}`,
      '- Русский и узбекский языки; английский будет плюсом',
      '',
      h.conditions,
      `- Зарплата ${salary} сум в зависимости от опыта`,
      `- ${capitalize(employment)}, ${mode}`,
      '- Официальное оформление и медицинская страховка',
      '- Бюджет на обучение и современные инструменты',
    ].join('\n');
  }

  const experience =
    input.years > 0 ? `${input.years}+ years in a similar role` : 'Open to candidates without experience; we train';
  return [
    `${input.companyName} is hiring a ${input.title} in ${input.cityName}.`,
    '',
    h.duties,
    ...duties.map((d) => `- ${d}`),
    '',
    h.requirements,
    `- Hands-on experience with ${skills}`,
    `- ${experience}`,
    '- Uzbek or Russian; working English is a plus',
    '',
    h.conditions,
    `- ${salary} UZS per month depending on experience`,
    `- ${capitalize(employment)}, ${mode}`,
    '- Official employment and health insurance',
    '- Learning budget and modern tooling',
  ].join('\n');
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export type DemoQuestion = {
  question: string;
  type: QuestionType;
  isRequired: boolean;
  sortOrder: number;
};

/** Generic screening trio in the posting's language. */
export function demoScreeningQuestions(locale: DemoLocale): DemoQuestion[] {
  const byLocale: Record<DemoLocale, [string, string, string]> = {
    uz: [
      'Tegishli ish tajribangiz necha yil?',
      '2 hafta ichida ishni boshlashga tayyormisiz?',
      'Nega bizning jamoaga qo‘shilmoqchisiz?',
    ],
    ru: [
      'Сколько лет у вас релевантного опыта?',
      'Готовы ли вы выйти на работу в течение 2 недель?',
      'Почему вы хотите присоединиться к нашей команде?',
    ],
    en: [
      'How many years of relevant experience do you have?',
      'Are you available to start within 2 weeks?',
      'Why do you want to join our team?',
    ],
  };
  const [q1, q2, q3] = byLocale[locale];
  return [
    { question: q1, type: 'NUMBER', isRequired: true, sortOrder: 0 },
    { question: q2, type: 'YES_NO', isRequired: true, sortOrder: 1 },
    { question: q3, type: 'TEXT', isRequired: false, sortOrder: 2 },
  ];
}

export function demoCoverLetter(locale: DemoLocale, index: number): string {
  const byLocale: Record<DemoLocale, string[]> = {
    uz: [
      'Assalomu alaykum! Ushbu lavozimga qiziqish bildiraman: tajribam va ko‘nikmalarim talablaringizga mos keladi deb hisoblayman. Suhbatga tayyorman.',
      'Salom! E’loningizni Telegramda ko‘rdim. Shu sohada ishlaganman va jamoangizga foyda keltira olaman. Qo‘shimcha ma’lumot bersam xursand bo‘laman.',
    ],
    ru: [
      'Здравствуйте! Заинтересовала ваша вакансия: мой опыт и навыки соответствуют требованиям. Готов(а) пройти собеседование в удобное время.',
      'Добрый день! Увидел(а) вакансию в Telegram. Работал(а) в этой сфере и уверен(а), что буду полезен(на) команде.',
    ],
    en: [
      'Hello! I am excited to apply for this role and believe my skills are a strong match. Happy to talk at your convenience.',
      'Hi! I saw the posting on Telegram. I have worked in this area and can add value to your team from day one.',
    ],
  };
  const options = byLocale[locale];
  return options[index % options.length];
}

export function demoAnswer(locale: DemoLocale, type: QuestionType, index: number): string {
  if (type === 'YES_NO') return index % 4 === 3 ? 'No' : 'Yes';
  if (type === 'NUMBER') return String(1 + (index % 6));
  const text: Record<DemoLocale, string[]> = {
    uz: [
      'Kompaniyangizning mahsulotlari va jamoadagi o‘sish imkoniyati meni qiziqtiradi.',
      'Bu soha bo‘yicha o‘z tajribamni yangi darajaga olib chiqmoqchiman.',
    ],
    ru: [
      'Меня привлекают ваши продукты и возможность расти в сильной команде.',
      'Хочу применить свой опыт в компании с понятными целями и процессами.',
    ],
    en: [
      'I am motivated by your products and the chance to grow with the team.',
      'I want to bring my experience to a company with clear goals and good processes.',
    ],
  };
  const options = text[locale];
  return options[index % options.length];
}

export type DemoHeroJob = {
  companySlug: string;
  title: string;
  locale: DemoLocale;
  cat: string;
  skills: string[];
  level: ExperienceLevel;
  years: number;
  salaryMin: number;
  salaryMax: number;
  workMode: WorkMode;
  employmentType: EmploymentType;
  /** Falls back to the company's city, then Tashkent. */
  citySlug?: string;
  description: string;
  questions: DemoQuestion[];
};

/**
 * Hand-written vacancies the demo script walks through. The first one mirrors
 * the CV used in the parse demo so the match score is high on purpose.
 */
export const DEMO_HERO_JOBS: DemoHeroJob[] = [
  {
    companySlug: 'demo-tech-tashkent',
    title: 'IT Infrastructure & Support Specialist',
    locale: 'uz',
    cat: 'it-software',
    skills: ['linux', 'problem-solving', 'customer-support', 'communication'],
    level: 'MIDDLE',
    years: 3,
    salaryMin: 9_000_000,
    salaryMax: 14_000_000,
    workMode: 'ONSITE',
    employmentType: 'FULL_TIME',
    citySlug: 'tashkent',
    description: [
      'Apex Soft Tashkent jamoasiga 150+ foydalanuvchiga xizmat ko‘rsatadigan IT infratuzilmani boshqaradigan mutaxassis izlaymiz.',
      '',
      'Vazifalar:',
      '- Serverlar, tarmoq uskunalari va ish stansiyalarining barqaror ishlashini ta’minlash',
      '- Boshqariladigan switchlar, Wi-Fi va VPN ulanishlarini sozlash va nosozliklarni bartaraf etish',
      '- Windows ish stansiyalari, printerlar, POS qurilmalari va IP-telefonlar bo‘yicha 1- va 2-darajali qo‘llab-quvvatlash',
      '- Microsoft 365 hisoblari, zaxira nusxalar va antivirus siyosatini yuritish',
      '- Hodisalarni tiket tizimida qayd etish va yechimlarni hujjatlashtirish',
      '',
      'Talablar:',
      '- Tizim administratori yoki IT support sohasida 3 yildan ortiq tajriba',
      '- Windows Server, Active Directory, TCP/IP va tarmoq asoslarini yaxshi bilish',
      '- O‘zbek va rus tillari; texnik hujjatlar uchun ingliz tili',
      '- Mustaqil qaror qabul qilish va foydalanuvchilar bilan xushmuomala muloqot',
      '',
      'Shartlar:',
      '- Maosh 9 000 000 - 14 000 000 so‘m, tajribaga qarab',
      '- 5/2 ish grafigi, Toshkent shahridagi ofis',
      '- Rasmiy ishga qabul, tibbiy sug‘urta, sertifikatlar uchun o‘quv byudjeti',
    ].join('\n'),
    questions: [
      { question: 'Windows Server va Active Directory bilan necha yil ishlagansiz?', type: 'NUMBER', isRequired: true, sortOrder: 0 },
      { question: 'Toshkent ofisida to‘liq stavkada ishlashga tayyormisiz?', type: 'YES_NO', isRequired: true, sortOrder: 1 },
      { question: 'Qanday tiket tizimlari bilan ishlagansiz?', type: 'TEXT', isRequired: false, sortOrder: 2 },
    ],
  },
  {
    companySlug: 'demo-tech-tashkent',
    title: 'Frontend Developer',
    locale: 'ru',
    cat: 'it-software',
    skills: ['typescript', 'react', 'communication'],
    level: 'MIDDLE',
    years: 3,
    salaryMin: 12_000_000,
    salaryMax: 20_000_000,
    workMode: 'HYBRID',
    employmentType: 'FULL_TIME',
    citySlug: 'tashkent',
    description: [
      'Apex Soft Tashkent ищет Frontend-разработчика в продуктовую команду: мы делаем веб-кабинеты для финтеха и ритейла Узбекистана.',
      '',
      'Обязанности:',
      '- Разрабатывать интерфейсы на React и TypeScript по макетам Figma',
      '- Поддерживать дизайн-систему и библиотеку компонентов',
      '- Оптимизировать производительность и доступность (Core Web Vitals, WCAG)',
      '- Писать unit- и e2e-тесты, участвовать в code review',
      '- Работать в связке с backend-командой (REST, WebSocket)',
      '',
      'Требования:',
      '- От 3 лет коммерческой разработки на React',
      '- Уверенный TypeScript, знание HTML/CSS, сборщиков и Git',
      '- Опыт с Next.js или другим SSR-фреймворком будет плюсом',
      '- Русский или узбекский язык; чтение технической документации на английском',
      '',
      'Условия:',
      '- 12 000 000 - 20 000 000 сум в зависимости от уровня',
      '- Гибрид: 3 дня в офисе (Ташкент, Мирзо-Улугбекский район), 2 дня удалённо',
      '- Официальное оформление, техника, бюджет на конференции и курсы',
    ].join('\n'),
    questions: [
      { question: 'Сколько лет коммерческого опыта с React у вас есть?', type: 'NUMBER', isRequired: true, sortOrder: 0 },
      { question: 'Готовы ли вы работать 3 дня в неделю из офиса в Ташкенте?', type: 'YES_NO', isRequired: true, sortOrder: 1 },
      { question: 'Ссылка на GitHub или портфолио', type: 'TEXT', isRequired: false, sortOrder: 2 },
    ],
  },
  {
    companySlug: 'uzpay-fintech',
    title: 'Sales Manager',
    locale: 'uz',
    cat: 'sales-marketing',
    skills: ['sales', 'communication', 'excel'],
    level: 'MIDDLE',
    years: 2,
    salaryMin: 6_000_000,
    salaryMax: 15_000_000,
    workMode: 'ONSITE',
    employmentType: 'FULL_TIME',
    citySlug: 'tashkent',
    description: [
      'UzPay Fintech to‘lov yechimlarini savdo va xizmat ko‘rsatish korxonalariga taklif qiladigan B2B savdo menejeri izlaydi.',
      '',
      'Vazifalar:',
      '- Yangi mijozlarni izlash: do‘konlar, restoranlar, xizmat ko‘rsatish tarmoqlari',
      '- Mahsulot taqdimoti, shartnoma tuzish va ulanishni kuzatish',
      '- CRM tizimida bitimlar voronkasini yuritish',
      '- Mavjud mijozlar bilan uzoq muddatli hamkorlikni rivojlantirish',
      '',
      'Talablar:',
      '- B2B savdoda 2 yildan ortiq tajriba, fintech yoki ritel afzal',
      '- Muzokara olib borish va e’tirozlar bilan ishlash ko‘nikmasi',
      '- O‘zbek va rus tillarida erkin muloqot',
      '- Haydovchilik guvohnomasi va Toshkent bo‘ylab safarga tayyorlik',
      '',
      'Shartlar:',
      '- 6 000 000 so‘m fiks + KPI, jami 15 000 000 so‘mgacha',
      '- 5/2, ofis Toshkent markazida, korporativ transport',
      '- Rasmiy ishga qabul va oylik bonuslar',
    ].join('\n'),
    questions: [
      { question: 'B2B savdoda necha yil tajribangiz bor?', type: 'NUMBER', isRequired: true, sortOrder: 0 },
      { question: 'Haydovchilik guvohnomangiz bormi?', type: 'YES_NO', isRequired: true, sortOrder: 1 },
      { question: 'Eng katta yopgan bitimingiz haqida qisqacha yozing', type: 'TEXT', isRequired: false, sortOrder: 2 },
    ],
  },
  {
    companySlug: 'orient-bank',
    title: 'Accountant',
    locale: 'ru',
    cat: 'finance',
    skills: ['accounting', '1c', 'excel'],
    level: 'MIDDLE',
    years: 3,
    salaryMin: 7_000_000,
    salaryMax: 11_000_000,
    workMode: 'ONSITE',
    employmentType: 'FULL_TIME',
    citySlug: 'tashkent',
    description: [
      'Orient Bank Digital приглашает бухгалтера в команду финансового учёта дочерней IT-компании банка.',
      '',
      'Обязанности:',
      '- Ведение первичной документации и учёт в 1С:Бухгалтерия 8',
      '- Расчёт заработной платы, налогов и взносов по законодательству Узбекистана',
      '- Подготовка отчётности в налоговые органы и статистику через my.soliq.uz',
      '- Сверка с контрагентами, работа с банковскими выписками',
      '- Участие в закрытии месяца и подготовке управленческих отчётов',
      '',
      'Требования:',
      '- Высшее экономическое образование, опыт от 3 лет',
      '- Уверенное владение 1С 8 и Excel, знание НСБУ',
      '- Внимательность к деталям и соблюдение сроков',
      '- Русский обязателен, узбекский приветствуется',
      '',
      'Условия:',
      '- 7 000 000 - 11 000 000 сум',
      '- График 5/2, офис в Яккасарайском районе Ташкента',
      '- Официальное оформление, медицинская страховка, обучение за счёт компании',
    ].join('\n'),
    questions: [
      { question: 'Сколько лет вы работаете с 1С:Бухгалтерия?', type: 'NUMBER', isRequired: true, sortOrder: 0 },
      { question: 'Есть ли у вас опыт сдачи отчётности через my.soliq.uz?', type: 'YES_NO', isRequired: true, sortOrder: 1 },
      { question: 'С какими участками учёта вы работали?', type: 'TEXT', isRequired: false, sortOrder: 2 },
    ],
  },
  {
    companySlug: 'hadith-hotel',
    title: 'Hotel Front Office Manager',
    locale: 'uz',
    cat: 'hospitality',
    skills: ['hospitality-management', 'customer-support', 'leadership', 'english'],
    level: 'MIDDLE',
    years: 3,
    salaryMin: 6_000_000,
    salaryMax: 9_000_000,
    workMode: 'ONSITE',
    employmentType: 'FULL_TIME',
    description: [
      'Hadith Hotel qabulxona bo‘limi menejerini izlaydi: mehmonlar bilan birinchi va oxirgi uchrashuv sizning jamoangizda bo‘ladi.',
      '',
      'Vazifalar:',
      '- Qabulxona smenasi jamoasini (4-6 kishi) boshqarish va jadval tuzish',
      '- Mehmonlarni ro‘yxatga olish, check-in/check-out va bron tizimi bilan ishlash',
      '- Mehmonlar shikoyatlarini joyida hal qilish va xizmat standartlarini nazorat qilish',
      '- Housekeeping, restoran va xavfsizlik bo‘limlari bilan muvofiqlashtirish',
      '- Kunlik hisobotlar va kassani yopish',
      '',
      'Talablar:',
      '- Mehmonxona qabulxonasida 3 yildan ortiq tajriba, shundan 1 yil rahbar lavozimda',
      '- Opera, Fidelio yoki shunga o‘xshash PMS tizimlari bilan ishlash',
      '- O‘zbek, rus va ingliz tillarida erkin muloqot',
      '- Smenali ish grafigiga tayyorlik',
      '',
      'Shartlar:',
      '- 6 000 000 - 9 000 000 so‘m + xizmat haqi',
      '- Bepul ovqatlanish, forma, tibbiy sug‘urta',
      '- Xalqaro mehmonxona standartlari bo‘yicha o‘qitish',
    ].join('\n'),
    questions: [
      { question: 'Mehmonxona qabulxonasida necha yil ishlagansiz?', type: 'NUMBER', isRequired: true, sortOrder: 0 },
      { question: 'Tungi smenalarda ishlashga tayyormisiz?', type: 'YES_NO', isRequired: true, sortOrder: 1 },
      { question: 'Qaysi PMS tizimlari bilan ishlagansiz?', type: 'TEXT', isRequired: false, sortOrder: 2 },
    ],
  },
  {
    companySlug: 'edunest-uz',
    title: 'English Teacher (Corporate)',
    locale: 'en',
    cat: 'education',
    skills: ['english', 'teaching', 'communication'],
    level: 'MIDDLE',
    years: 2,
    salaryMin: 5_000_000,
    salaryMax: 9_000_000,
    workMode: 'HYBRID',
    employmentType: 'PART_TIME',
    citySlug: 'tashkent',
    description: [
      'EduNest Uzbekistan is looking for a corporate English teacher to run group and one-to-one classes for company clients in Tashkent.',
      '',
      'Responsibilities:',
      '- Teach General and Business English (A2-C1) to corporate groups on site and online',
      '- Prepare lesson plans aligned with CEFR and client goals',
      '- Run placement tests and progress assessments every 8 weeks',
      '- Report attendance and outcomes to the academic coordinator',
      '',
      'Requirements:',
      '- 2+ years of teaching adults; CELTA, TESOL or equivalent',
      '- C1+ English; Uzbek or Russian for beginner groups is a plus',
      '- Comfortable with Zoom, Google Classroom and interactive whiteboards',
      '',
      'Conditions:',
      '- 5 000 000 - 9 000 000 UZS depending on hours and certificates',
      '- Hybrid schedule: morning and evening slots, weekends free',
      '- Paid teacher training and materials',
    ].join('\n'),
    questions: [
      { question: 'How many years have you taught adults?', type: 'NUMBER', isRequired: true, sortOrder: 0 },
      { question: 'Do you hold CELTA, TESOL or an equivalent certificate?', type: 'YES_NO', isRequired: true, sortOrder: 1 },
      { question: 'Which corporate clients or industries have you taught?', type: 'TEXT', isRequired: false, sortOrder: 2 },
    ],
  },
];

export type DemoCompanyRow = { id: string; name: string; slug: string; cityId: string | null };
export type DemoCityRow = { id: string; name: string; slug: string };
export type DemoSeedContext = {
  companies: DemoCompanyRow[];
  cities: DemoCityRow[];
  catMap: Record<string, { id: string }>;
  skillMap: Record<string, { id: string; name: string }>;
  benefits: Array<{ id: string }>;
  /** Generic postings to create on top of the hero jobs. */
  jobCount?: number;
  log?: (message: string) => void;
};

export type DemoSeedResult = { jobs: JobPost[]; heroJobs: JobPost[]; skipped: number };

/**
 * Create generic and hero postings. Callers are expected to have removed the
 * previous demo postings; live duplicates are skipped by fingerprint.
 */
export async function seedDemoJobs(prisma: PrismaClient, ctx: DemoSeedContext): Promise<DemoSeedResult> {
  const log = ctx.log ?? (() => undefined);
  const jobs: JobPost[] = [];
  const heroJobs: JobPost[] = [];
  let skipped = 0;
  if (ctx.companies.length === 0 || ctx.cities.length === 0) {
    log('Demo jobs: no companies or cities available; nothing created');
    return { jobs, heroJobs, skipped };
  }

  const employmentTypes: EmploymentType[] = ['FULL_TIME', 'FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP'];
  const workModes: WorkMode[] = ['ONSITE', 'HYBRID', 'REMOTE', 'HYBRID', 'ONSITE'];
  const jobCount = ctx.jobCount ?? 96;

  for (let i = 0; i < jobCount; i++) {
    const tpl = DEMO_JOB_TEMPLATES[i % DEMO_JOB_TEMPLATES.length];
    const company = ctx.companies[i % ctx.companies.length];
    const city = ctx.cities[i % ctx.cities.length];
    const locale = DEMO_JOB_LOCALES[i % DEMO_JOB_LOCALES.length];
    const isHot = i < 6;
    const status = i % 14 === 0 ? 'DRAFT' : i % 16 === 0 ? 'CLOSED' : 'PUBLISHED';
    const workMode = workModes[i % workModes.length];
    const employmentType = employmentTypes[i % employmentTypes.length];
    const band = demoSalaryBand(tpl.cat, tpl.level);
    // Small per-posting spread so identical roles do not all show one number.
    const salaryMin = roundUzs(band.min * (1 + ((i % 3) - 1) * 0.05));
    const salaryMax = roundUzs(band.max * (1 + ((i % 4) - 1) * 0.05));

    const resolvedTitle = await resolveJobTitle(prisma, { name: tpl.title });
    const title = resolvedTitle.jobTitle.name;
    const skillNames = tpl.skills.map((slug) => ctx.skillMap[slug]?.name ?? slug);
    const description = buildDemoJobDescription({
      locale,
      companyName: company.name,
      cityName: city.name,
      title,
      cat: tpl.cat,
      skillNames,
      years: tpl.years,
      salaryMin,
      salaryMax,
      workMode,
      employmentType,
    });

    const created = await createDemoJob(prisma, {
      company,
      cityId: city.id,
      categoryId: ctx.catMap[tpl.cat]?.id,
      jobTitleId: resolvedTitle.jobTitle.id,
      title,
      description,
      locale,
      employmentType,
      workMode,
      salaryMin,
      salaryMax,
      years: tpl.years,
      level: tpl.level,
      status,
      publishedAt: status === 'PUBLISHED' ? new Date(Date.now() - (i + 1) * 86_400_000) : null,
      boost: isHot ? { weight: 1.2, days: 14 } : null,
      skills: tpl.skills,
      skillMap: ctx.skillMap,
      benefits: ctx.benefits.slice(i % 3, (i % 3) + 3 + (i % 2)),
      questions: i % 3 === 0 ? demoScreeningQuestions(locale) : [],
      log,
    });
    if (!created) {
      skipped += 1;
      continue;
    }
    jobs.push(created);
  }

  const cityBySlug = Object.fromEntries(ctx.cities.map((c) => [c.slug, c]));
  const cityById = Object.fromEntries(ctx.cities.map((c) => [c.id, c]));
  for (let h = 0; h < DEMO_HERO_JOBS.length; h++) {
    const hero = DEMO_HERO_JOBS[h];
    const company = ctx.companies.find((c) => c.slug === hero.companySlug);
    if (!company) {
      log(`Demo hero job "${hero.title}": company ${hero.companySlug} missing; skipped`);
      skipped += 1;
      continue;
    }
    const city =
      (hero.citySlug && cityBySlug[hero.citySlug]) ||
      (company.cityId && cityById[company.cityId]) ||
      cityBySlug.tashkent ||
      ctx.cities[0];
    const resolvedTitle = await resolveJobTitle(prisma, { name: hero.title });
    const created = await createDemoJob(prisma, {
      company,
      cityId: city.id,
      categoryId: ctx.catMap[hero.cat]?.id,
      jobTitleId: resolvedTitle.jobTitle.id,
      title: resolvedTitle.jobTitle.name,
      description: hero.description,
      locale: hero.locale,
      employmentType: hero.employmentType,
      workMode: hero.workMode,
      salaryMin: hero.salaryMin,
      salaryMax: hero.salaryMax,
      years: hero.years,
      level: hero.level,
      status: 'PUBLISHED',
      // Freshest postings on the board, a few hours apart.
      publishedAt: new Date(Date.now() - (h + 1) * 3 * 3_600_000),
      boost: { weight: 1.3, days: 30 },
      skills: hero.skills,
      skillMap: ctx.skillMap,
      benefits: ctx.benefits.slice(0, 4),
      questions: hero.questions,
      log,
    });
    if (!created) {
      skipped += 1;
      continue;
    }
    jobs.push(created);
    heroJobs.push(created);
  }

  return { jobs, heroJobs, skipped };
}

type CreateDemoJobInput = {
  company: DemoCompanyRow;
  cityId: string;
  categoryId?: string;
  jobTitleId: string;
  title: string;
  description: string;
  locale: DemoLocale;
  employmentType: EmploymentType;
  workMode: WorkMode;
  salaryMin: number;
  salaryMax: number;
  years: number;
  level: ExperienceLevel;
  status: 'DRAFT' | 'PUBLISHED' | 'CLOSED';
  publishedAt: Date | null;
  boost: { weight: number; days: number } | null;
  skills: string[];
  skillMap: Record<string, { id: string; name: string }>;
  benefits: Array<{ id: string }>;
  questions: DemoQuestion[];
  log: (message: string) => void;
};

async function createDemoJob(prisma: PrismaClient, input: CreateDemoJobInput): Promise<JobPost | null> {
  const fingerprint = jobFingerprint({
    title: input.title,
    workMode: input.workMode,
    cityId: input.cityId,
  });
  const clash = await prisma.jobPost.findFirst({
    where: {
      companyId: input.company.id,
      fingerprint,
      status: { in: ['DRAFT', 'PUBLISHED', 'PAUSED'] },
    },
    select: { id: true },
  });
  if (clash) {
    input.log(
      `Skip demo job "${input.title}" for ${input.company.name}: active fingerprint exists (${clash.id})`,
    );
    return null;
  }

  const job = await prisma.jobPost.create({
    data: {
      companyId: input.company.id,
      jobTitleId: input.jobTitleId,
      title: input.title,
      description: input.description,
      cityId: input.cityId,
      categoryId: input.categoryId,
      locale: input.locale,
      employmentType: input.employmentType,
      workMode: input.workMode,
      salaryMin: input.salaryMin,
      salaryMax: input.salaryMax,
      salaryPeriod: 'MONTHLY',
      currency: 'UZS',
      experienceYearsMin: input.years,
      experienceLevel: input.level,
      status: input.status,
      publishedAt: input.publishedAt,
      boostWeight: input.boost ? input.boost.weight : 0,
      boostUntil: input.boost ? new Date(Date.now() + input.boost.days * 86_400_000) : null,
      fingerprint,
      contentHash: contentHash(input.description),
    },
  });

  for (const slug of input.skills) {
    const skill = input.skillMap[slug];
    if (!skill) continue;
    await prisma.jobPostSkill.create({
      data: {
        jobPostId: job.id,
        skillId: skill.id,
        isRequired: true,
        weight: 1 + (slug === input.skills[0] ? 0.5 : 0),
      },
    });
  }

  for (const benefit of input.benefits) {
    await prisma.jobPostBenefit
      .create({ data: { jobPostId: job.id, benefitId: benefit.id } })
      .catch(() => undefined);
  }

  if (input.questions.length) {
    await prisma.jobQuestion.createMany({
      data: input.questions.map((q) => ({ jobPostId: job.id, ...q })),
    });
  }

  return job;
}

/** Roughly: half direct, a third Telegram, the rest app and shared links. */
export const DEMO_APPLICATION_SOURCES: Array<string | null> = [
  null,
  'telegram:channel',
  null,
  'telegram:bot',
  'pwa',
  null,
  'telegram:channel',
  'share:telegram',
  null,
];

export type DemoApplicationsContext = {
  /** Published postings; hero jobs first so demo recruiters see a full pipeline. */
  jobs: Array<Pick<JobPost, 'id' | 'status' | 'locale'>>;
  profiles: Array<{ id: string }>;
  count?: number;
  log?: (message: string) => void;
};

/** Applications with localized cover letters and screening answers, plus a few interviews. */
export async function seedDemoApplications(
  prisma: PrismaClient,
  ctx: DemoApplicationsContext,
): Promise<number> {
  const published = ctx.jobs.filter((j) => j.status === 'PUBLISHED');
  if (published.length === 0 || ctx.profiles.length === 0) {
    ctx.log?.('Demo applications: no published jobs or profiles; skipped');
    return 0;
  }
  const count = ctx.count ?? 140;
  let created = 0;
  for (let i = 0; i < count; i++) {
    const job = published[i % published.length];
    const profile = ctx.profiles[i % ctx.profiles.length];
    const locale = (['uz', 'ru', 'en'] as DemoLocale[]).includes(job.locale as DemoLocale)
      ? (job.locale as DemoLocale)
      : 'uz';
    try {
      const questions = await prisma.jobQuestion.findMany({ where: { jobPostId: job.id } });
      const matchScore = 40 + ((i * 7) % 55);
      const status = (['NEW', 'IN_REVIEW', 'INTERVIEW', 'OFFER', 'REJECTED', 'NEW'] as const)[i % 6];
      const app = await prisma.application.create({
        data: {
          jobPostId: job.id,
          profileId: profile.id,
          coverLetter: demoCoverLetter(locale, i),
          // Mirrors the channels the demo talks about; null is a direct site visit.
          source: DEMO_APPLICATION_SOURCES[i % DEMO_APPLICATION_SOURCES.length],
          matchScore,
          matchBreakdown: {
            skills: Math.round(matchScore * 0.45),
            experience: Math.round(matchScore * 0.2),
            location: Math.round(matchScore * 0.15),
            education: Math.round(matchScore * 0.1),
            language: Math.round(matchScore * 0.1),
            total: matchScore,
          },
          status,
          createdAt: new Date(Date.now() - (i % 20) * 6 * 3_600_000),
          events: { create: { toStatus: 'NEW', note: 'Application submitted' } },
          answers: {
            create: questions.map((q) => ({
              questionId: q.id,
              answer: demoAnswer(locale, q.type, i),
            })),
          },
        },
      });
      created += 1;
      if (status === 'INTERVIEW' || i % 10 === 0) {
        await prisma.interview.create({
          data: {
            applicationId: app.id,
            scheduledAt: new Date(Date.now() + (i + 1) * 86_400_000),
            durationMins: 60,
            meetingUrl: 'https://meet.google.com/demo-interview',
            note: locale === 'ru' ? 'Техническое собеседование' : locale === 'en' ? 'Technical interview' : 'Texnik suhbat',
            status: 'SCHEDULED',
          },
        });
      }
    } catch {
      // unique (jobPostId, profileId): the same profile already applied to this job
    }
  }
  return created;
}
