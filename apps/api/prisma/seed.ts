import { PrismaClient, PlanCode, ExperienceLevel, EmploymentType, WorkMode, DegreeLevel, SkillLevel, CompanySize } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60);
}

function avatar(n: number) {
  return `https://i.pravatar.cc/300?img=${n}`;
}

function logo(name: string, color: string) {
  return `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(name)}&backgroundColor=${color}`;
}

const CITIES = [
  { name: 'Tashkent', slug: 'tashkent', region: 'Tashkent' },
  { name: 'Samarkand', slug: 'samarkand', region: 'Samarkand' },
  { name: 'Bukhara', slug: 'bukhara', region: 'Bukhara' },
  { name: 'Andijan', slug: 'andijan', region: 'Andijan' },
  { name: 'Namangan', slug: 'namangan', region: 'Namangan' },
  { name: 'Fergana', slug: 'fergana', region: 'Fergana' },
  { name: 'Nukus', slug: 'nukus', region: 'Karakalpakstan' },
  { name: 'Urgench', slug: 'urgench', region: 'Khorezm' },
  { name: 'Navoi', slug: 'navoi', region: 'Navoi' },
  { name: 'Karshi', slug: 'karshi', region: 'Kashkadarya' },
  { name: 'Termez', slug: 'termez', region: 'Surkhandarya' },
  { name: 'Jizzakh', slug: 'jizzakh', region: 'Jizzakh' },
  { name: 'Gulistan', slug: 'gulistan', region: 'Sirdarya' },
  { name: 'Chirchiq', slug: 'chirchiq', region: 'Tashkent Region' },
  { name: 'Angren', slug: 'angren', region: 'Tashkent Region' },
];

const CATEGORIES = [
  { name: 'IT & Software', slug: 'it-software', icon: '💻' },
  { name: 'Finance & Banking', slug: 'finance', icon: '🏦' },
  { name: 'Sales & Marketing', slug: 'sales-marketing', icon: '📈' },
  { name: 'Design & Creative', slug: 'design', icon: '🎨' },
  { name: 'HR & Recruiting', slug: 'hr', icon: '👥' },
  { name: 'Education', slug: 'education', icon: '📚' },
  { name: 'Healthcare', slug: 'healthcare', icon: '🏥' },
  { name: 'Engineering', slug: 'engineering', icon: '⚙️' },
  { name: 'Customer Support', slug: 'customer-support', icon: '🎧' },
  { name: 'Logistics', slug: 'logistics', icon: '🚚' },
  { name: 'Legal', slug: 'legal', icon: '⚖️' },
  { name: 'Hospitality', slug: 'hospitality', icon: '🏨' },
];

const INDUSTRIES = [
  { name: 'Information Technology', slug: 'it' },
  { name: 'Fintech', slug: 'fintech' },
  { name: 'E-commerce', slug: 'ecommerce' },
  { name: 'Telecommunications', slug: 'telecom' },
  { name: 'Banking', slug: 'banking' },
  { name: 'Education', slug: 'education' },
  { name: 'Healthcare', slug: 'healthcare' },
  { name: 'Manufacturing', slug: 'manufacturing' },
  { name: 'Logistics', slug: 'logistics' },
  { name: 'Media', slug: 'media' },
];

const SKILLS: Array<{ name: string; category: string }> = [
  { name: 'TypeScript', category: 'Programming' },
  { name: 'JavaScript', category: 'Programming' },
  { name: 'Python', category: 'Programming' },
  { name: 'Java', category: 'Programming' },
  { name: 'Go', category: 'Programming' },
  { name: 'PHP', category: 'Programming' },
  { name: 'C#', category: 'Programming' },
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
];

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
  { name: 'Health Insurance', slug: 'health-insurance', icon: '🏥' },
  { name: 'Remote Work', slug: 'remote-work', icon: '🏠' },
  { name: 'Flexible Hours', slug: 'flexible-hours', icon: '⏰' },
  { name: 'Meal Allowance', slug: 'meal-allowance', icon: '🍱' },
  { name: 'Learning Budget', slug: 'learning-budget', icon: '📖' },
  { name: 'Gym Membership', slug: 'gym', icon: '💪' },
  { name: 'Paid Vacation', slug: 'paid-vacation', icon: '🌴' },
  { name: 'Stock Options', slug: 'stock-options', icon: '📊' },
  { name: 'Relocation Support', slug: 'relocation', icon: '✈️' },
  { name: 'Equipment Budget', slug: 'equipment', icon: '💻' },
  { name: 'Parental Leave', slug: 'parental-leave', icon: '👶' },
  { name: 'Performance Bonus', slug: 'bonus', icon: '💰' },
];

const COMPANIES = [
  { name: 'Demo Tech Tashkent', slug: 'demo-tech-tashkent', industry: 'it', plan: 'STANDARD' as PlanCode, city: 'tashkent', color: '4f46e5', size: 'SIZE_51_200' as CompanySize },
  { name: 'UzPay Fintech', slug: 'uzpay-fintech', industry: 'fintech', plan: 'PREMIUM' as PlanCode, city: 'tashkent', color: '059669', size: 'SIZE_51_200' as CompanySize },
  { name: 'Silk Road Commerce', slug: 'silk-road-commerce', industry: 'ecommerce', plan: 'STANDARD' as PlanCode, city: 'tashkent', color: 'd97706', size: 'SIZE_201_1000' as CompanySize },
  { name: 'Tashkent Soft Labs', slug: 'tashkent-soft-labs', industry: 'it', plan: 'PREMIUM' as PlanCode, city: 'tashkent', color: '2563eb', size: 'SIZE_11_50' as CompanySize },
  { name: 'Samarkand Digital', slug: 'samarkand-digital', industry: 'media', plan: 'FREE' as PlanCode, city: 'samarkand', color: 'db2777', size: 'SIZE_11_50' as CompanySize },
  { name: 'Orient Bank Digital', slug: 'orient-bank', industry: 'banking', plan: 'PREMIUM' as PlanCode, city: 'tashkent', color: '0f766e', size: 'SIZE_1000_PLUS' as CompanySize },
  { name: 'Fergana Logistics', slug: 'fergana-logistics', industry: 'logistics', plan: 'STANDARD' as PlanCode, city: 'fergana', color: '7c3aed', size: 'SIZE_51_200' as CompanySize },
  { name: 'EduNest Uzbekistan', slug: 'edunest-uz', industry: 'education', plan: 'FREE' as PlanCode, city: 'tashkent', color: 'ea580c', size: 'SIZE_11_50' as CompanySize },
  { name: 'MediCare IT', slug: 'medicare-it', industry: 'healthcare', plan: 'STANDARD' as PlanCode, city: 'tashkent', color: '0891b2', size: 'SIZE_51_200' as CompanySize },
  { name: 'Navoi Engineering', slug: 'navoi-engineering', industry: 'manufacturing', plan: 'FREE' as PlanCode, city: 'navoi', color: '64748b', size: 'SIZE_201_1000' as CompanySize },
];

const FIRST_NAMES = ['Madina', 'Dilshod', 'Aziza', 'Jasur', 'Nilufar', 'Bobur', 'Sevara', 'Timur', 'Malika', 'Sardor', 'Kamola', 'Rustam', 'Zarina', 'Alisher', 'Dilnoza', 'Farrukh', 'Gulnora', 'Islom', 'Lola', 'Muzaffar', 'Nargiza', 'Oybek', 'Parvina', 'Quvonch', 'Rayhon', 'Shohruh', 'Umida', 'Valijon', 'Yulduz', 'Zafar'];
const LAST_NAMES = ['Karimova', 'Rahimov', 'Tursunov', 'Usmarova', 'Saidov', 'Yusupova', 'Ergashev', 'Abdullayeva', 'Nazarov', 'Ismoilova'];

const JOB_TITLES = [
  { title: 'Senior Full-stack Developer', skills: ['typescript', 'react', 'nestjs', 'postgresql'], cat: 'it-software', level: 'SENIOR' as ExperienceLevel, years: 5 },
  { title: 'Frontend React Engineer', skills: ['react', 'typescript', 'next-js', 'figma'], cat: 'it-software', level: 'MIDDLE' as ExperienceLevel, years: 3 },
  { title: 'Backend NestJS Developer', skills: ['nestjs', 'nodejs', 'postgresql', 'redis'], cat: 'it-software', level: 'MIDDLE' as ExperienceLevel, years: 2 },
  { title: 'Python Data Analyst', skills: ['python', 'sql', 'data-analysis', 'tableau'], cat: 'it-software', level: 'JUNIOR' as ExperienceLevel, years: 1 },
  { title: 'DevOps Engineer', skills: ['docker', 'kubernetes', 'aws', 'ci-cd'], cat: 'it-software', level: 'SENIOR' as ExperienceLevel, years: 4 },
  { title: 'Mobile Flutter Developer', skills: ['flutter', 'mobile-development', 'react-native'], cat: 'it-software', level: 'MIDDLE' as ExperienceLevel, years: 2 },
  { title: 'QA Automation Engineer', skills: ['qa-testing', 'cypress', 'selenium'], cat: 'it-software', level: 'MIDDLE' as ExperienceLevel, years: 2 },
  { title: 'Product Manager', skills: ['product-management', 'agile', 'scrum'], cat: 'it-software', level: 'SENIOR' as ExperienceLevel, years: 4 },
  { title: 'UI/UX Designer', skills: ['figma', 'ui-ux', 'adobe-photoshop'], cat: 'design', level: 'MIDDLE' as ExperienceLevel, years: 2 },
  { title: 'Digital Marketing Specialist', skills: ['digital-marketing', 'seo', 'smm'], cat: 'sales-marketing', level: 'JUNIOR' as ExperienceLevel, years: 1 },
  { title: 'Sales Manager', skills: ['sales', 'communication', 'excel'], cat: 'sales-marketing', level: 'MIDDLE' as ExperienceLevel, years: 3 },
  { title: 'Financial Analyst', skills: ['financial-analysis', 'excel', 'accounting'], cat: 'finance', level: 'MIDDLE' as ExperienceLevel, years: 2 },
  { title: 'HR Recruiter', skills: ['recruiting', 'hr-management', 'communication'], cat: 'hr', level: 'JUNIOR' as ExperienceLevel, years: 1 },
  { title: 'Customer Support Lead', skills: ['customer-support', 'communication', 'leadership'], cat: 'customer-support', level: 'MIDDLE' as ExperienceLevel, years: 3 },
  { title: 'Legal Counsel', skills: ['legal-research', 'contract-law'], cat: 'legal', level: 'SENIOR' as ExperienceLevel, years: 5 },
  { title: 'Logistics Coordinator', skills: ['supply-chain', 'excel', 'communication'], cat: 'logistics', level: 'JUNIOR' as ExperienceLevel, years: 1 },
  { title: 'Machine Learning Engineer', skills: ['machine-learning', 'python', 'sql'], cat: 'it-software', level: 'SENIOR' as ExperienceLevel, years: 4 },
  { title: 'Junior Java Developer', skills: ['java', 'spring-boot', 'sql'], cat: 'it-software', level: 'JUNIOR' as ExperienceLevel, years: 0 },
  { title: 'Content Writer', skills: ['content-writing', 'english', 'seo'], cat: 'sales-marketing', level: 'JUNIOR' as ExperienceLevel, years: 1 },
  { title: 'Engineering Project Lead', skills: ['project-management', 'leadership', 'excel'], cat: 'engineering', level: 'LEAD' as ExperienceLevel, years: 8 },
];

const SCHOOLS = ['TUIT', 'NUUz', 'Westminster International University in Tashkent', 'INHA University in Tashkent', 'Amity University Tashkent', 'Turin Polytechnic University in Tashkent'];
const LEVELS: SkillLevel[] = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'];

async function main() {
  console.log('Seeding Job Talentio...');
  const passwordHash = await bcrypt.hash('Password123!', 10);

  // Lookups
  const cities = await Promise.all(
    CITIES.map((c) =>
      prisma.city.upsert({
        where: { slug: c.slug },
        update: c,
        create: c,
      }),
    ),
  );
  const cityMap = Object.fromEntries(cities.map((c) => [c.slug, c]));

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

  const industries = await Promise.all(
    INDUSTRIES.map((i) =>
      prisma.industry.upsert({
        where: { slug: i.slug },
        update: i,
        create: i,
      }),
    ),
  );
  const indMap = Object.fromEntries(industries.map((i) => [i.slug, i]));

  const skills = await Promise.all(
    SKILLS.map((s) => {
      const slug = slugify(s.name);
      return prisma.skill.upsert({
        where: { slug },
        update: { name: s.name, category: s.category },
        create: { name: s.name, slug, category: s.category },
      });
    }),
  );
  const skillMap = Object.fromEntries(skills.map((s) => [s.slug, s]));

  const languages = await Promise.all(
    LANGUAGES.map((l) =>
      prisma.language.upsert({
        where: { code: l.code },
        update: { name: l.name },
        create: l,
      }),
    ),
  );
  const langMap = Object.fromEntries(languages.map((l) => [l.code, l]));

  const benefits = await Promise.all(
    BENEFITS.map((b) =>
      prisma.benefit.upsert({
        where: { slug: b.slug },
        update: b,
        create: b,
      }),
    ),
  );

  // Admin
  const adminEmail = (process.env.SUPERADMIN_EMAIL ?? 'admin@jobtalentio.local').toLowerCase();
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: { role: 'SUPER_ADMIN', passwordHash: await bcrypt.hash(process.env.SUPERADMIN_PASSWORD ?? 'Admin123!', 10) },
    create: {
      email: adminEmail,
      passwordHash: await bcrypt.hash(process.env.SUPERADMIN_PASSWORD ?? 'Admin123!', 10),
      fullName: 'Super Admin',
      role: 'SUPER_ADMIN',
      emailVerified: true,
      avatarUrl: avatar(1),
    },
  });

  // Companies + recruiters
  const companyRecords = [];
  for (let i = 0; i < COMPANIES.length; i++) {
    const c = COMPANIES[i];
    const email = i === 0 ? 'recruiter@demo.uz' : `recruiter${i + 1}@demo.uz`;
    const recruiter = await prisma.user.upsert({
      where: { email },
      update: {
        fullName: `${FIRST_NAMES[i]} ${LAST_NAMES[i % LAST_NAMES.length]}`,
        avatarUrl: avatar(10 + i),
        role: 'RECRUITER',
        passwordHash,
      },
      create: {
        email,
        passwordHash,
        fullName: `${FIRST_NAMES[i]} ${LAST_NAMES[i % LAST_NAMES.length]}`,
        role: 'RECRUITER',
        locale: 'uz',
        emailVerified: true,
        avatarUrl: avatar(10 + i),
      },
    });

    // Extra recruiter for some companies
    let extra = null;
    if (i < 2) {
      extra = await prisma.user.upsert({
        where: { email: `hr${i + 1}@demo.uz` },
        update: { passwordHash, role: 'RECRUITER' },
        create: {
          email: `hr${i + 1}@demo.uz`,
          passwordHash,
          fullName: `${FIRST_NAMES[20 + i]} HR`,
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
        website: `https://${c.slug}.uz`,
        cityId: cityMap[c.city].id,
        industryId: indMap[c.industry].id,
        size: c.size,
        logoUrl: logo(c.name, c.color),
        isVerified: c.plan !== 'FREE',
      },
      create: {
        name: c.name,
        slug: c.slug,
        description: `${c.name} is a leading ${c.industry} company in Uzbekistan, building modern products for the Central Asian market.`,
        website: `https://${c.slug}.uz`,
        cityId: cityMap[c.city].id,
        industryId: indMap[c.industry].id,
        size: c.size,
        logoUrl: logo(c.name, c.color),
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
          amountUzs: c.plan === 'PREMIUM' ? 2_500_000 : 990_000,
          status: 'MOCKED',
          provider: 'mock',
        },
      });
    }

    companyRecords.push(company);
  }

  // Employees
  const employeeProfiles = [];
  for (let i = 0; i < 30; i++) {
    const email = i === 0 ? 'employee@demo.uz' : `employee${i + 1}@demo.uz`;
    const city = cities[i % cities.length];
    const skillPick = skills.slice(i % 10, (i % 10) + 5 + (i % 4));
    const user = await prisma.user.upsert({
      where: { email },
      update: {
        passwordHash,
        fullName: `${FIRST_NAMES[i]} ${LAST_NAMES[i % LAST_NAMES.length]}`,
        avatarUrl: avatar(30 + (i % 40)),
        role: 'EMPLOYEE',
      },
      create: {
        email,
        passwordHash,
        fullName: `${FIRST_NAMES[i]} ${LAST_NAMES[i % LAST_NAMES.length]}`,
        role: 'EMPLOYEE',
        locale: i % 3 === 0 ? 'ru' : 'uz',
        emailVerified: true,
        avatarUrl: avatar(30 + (i % 40)),
      },
    });

    const headline = JOB_TITLES[i % JOB_TITLES.length].title.replace('Senior ', '').replace('Junior ', '');
    let profile = await prisma.employeeProfile.findUnique({ where: { userId: user.id } });
    if (!profile) {
      profile = await prisma.employeeProfile.create({
        data: {
          userId: user.id,
          headline,
          summary: `Experienced professional based in ${city.name}. Passionate about building products and growing career in Uzbekistan tech ecosystem.`,
          cityId: city.id,
          phone: `+99890${String(1000000 + i).slice(0, 7)}`,
          desiredPosition: headline,
          desiredSalaryMin: 8_000_000 + i * 500_000,
          visibility: 'TO_REGISTERED_RECRUITERS',
        },
      });
    } else {
      profile = await prisma.employeeProfile.update({
        where: { id: profile.id },
        data: {
          headline,
          summary: `Experienced professional based in ${city.name}. Passionate about building products and growing career in Uzbekistan tech ecosystem.`,
          cityId: city.id,
          desiredPosition: headline,
          desiredSalaryMin: 8_000_000 + i * 500_000,
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
        description: 'Delivered features, collaborated with cross-functional teams.',
        cityId: city.id,
        startDate: new Date(2021 - (i % 4), i % 12, 1),
        isCurrent: true,
      },
    });
    if (i % 2 === 0) {
      await prisma.workExperience.create({
        data: {
          profileId: profile.id,
          companyName: 'Startup Hub Tashkent',
          title: 'Junior Specialist',
          cityId: cityMap.tashkent.id,
          startDate: new Date(2018, 0, 1),
          endDate: new Date(2020, 11, 1),
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
        field: 'Computer Science',
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

  // Jobs
  const jobRecords = [];
  for (let i = 0; i < 40; i++) {
    const tpl = JOB_TITLES[i % JOB_TITLES.length];
    const company = companyRecords[i % companyRecords.length];
    const city = cities[i % cities.length];
    const isHot = i < 6;
    const status = i % 15 === 0 ? 'DRAFT' : i % 17 === 0 ? 'CLOSED' : 'PUBLISHED';
    const employmentTypes: EmploymentType[] = ['FULL_TIME', 'FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP'];
    const workModes: WorkMode[] = ['ONSITE', 'HYBRID', 'REMOTE', 'HYBRID', 'ONSITE'];

    const job = await prisma.jobPost.create({
      data: {
        companyId: company.id,
        title: tpl.title,
        description: `We are looking for a ${tpl.title} to join ${company.name}.\n\nResponsibilities:\n- Deliver high-quality work\n- Collaborate with product and design\n- Mentor teammates\n\nRequirements:\n- Strong skills in ${tpl.skills.join(', ')}\n- ${tpl.years}+ years experience preferred\n- Good communication in Uzbek/Russian/English\n\nJoin one of Uzbekistan's growing tech teams!`,
        cityId: city.id,
        categoryId: catMap[tpl.cat].id,
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

  // Applications + matching-ish scores
  const publishedJobs = jobRecords.filter((j) => j.status === 'PUBLISHED');
  let appCount = 0;
  for (let i = 0; i < 60; i++) {
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
  for (let i = 0; i < 15; i++) {
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

  for (let i = 0; i < 10; i++) {
    const user = await prisma.user.findUnique({
      where: { email: i === 0 ? 'employee@demo.uz' : `employee${i + 1}@demo.uz` },
    });
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

  for (let i = 0; i < 20; i++) {
    const user = await prisma.user.findUnique({
      where: { email: i === 0 ? 'employee@demo.uz' : `employee${(i % 30) + 1}@demo.uz` },
    });
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
  for (let i = 0; i < 200; i++) {
    await prisma.jobView.create({
      data: {
        jobPostId: publishedJobs[i % publishedJobs.length].id,
        viewerId: null,
        createdAt: new Date(Date.now() - i * 3_600_000),
      },
    });
  }

  // Notifications for demo employee & recruiter
  const emp = await prisma.user.findUnique({ where: { email: 'employee@demo.uz' } });
  const rec = await prisma.user.findUnique({ where: { email: 'recruiter@demo.uz' } });
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
  - ${companyRecords.length} companies, 30 employees, ${jobRecords.length} jobs
  - ~${appCount} applications
  Demo: admin@jobtalentio.local / recruiter@demo.uz / employee@demo.uz (Password123! for demo users)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
