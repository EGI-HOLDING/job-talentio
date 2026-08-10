/** Localized display names for roles and skills, keyed by slug. */
export type LocalizedName = { uz: string; ru: string };

/**
 * Keys are `JobTitle.slug` as produced by `jobTitleSlugify` (title-resolve.ts),
 * which folds `C++` to `cplusplus` and `Full-stack` to `fullstack` before
 * slugifying. Seniority is never part of the localized name - it lives on
 * `experienceLevel`.
 */
export const JOB_TITLE_NAMES: Record<string, LocalizedName> = {
  // IT & Software
  'frontend-developer': { uz: 'Frontend dasturchi', ru: 'Frontend-разработчик' },
  'backend-developer': { uz: 'Backend dasturchi', ru: 'Backend-разработчик' },
  'fullstack-developer': { uz: 'Full-stack dasturchi', ru: 'Full-stack-разработчик' },
  'cplusplus-developer': { uz: 'C++ dasturchi', ru: 'Разработчик C++' },
  'react-developer': { uz: 'React dasturchi', ru: 'React-разработчик' },
  'java-developer': { uz: 'Java dasturchi', ru: 'Java-разработчик' },
  'devops-engineer': { uz: 'DevOps muhandisi', ru: 'DevOps-инженер' },
  'cplusplus-systems-engineer': { uz: 'C++ tizim muhandisi', ru: 'Системный инженер C++' },

  // Finance & Banking
  'financial-analyst': { uz: 'Moliyaviy tahlilchi', ru: 'Финансовый аналитик' },
  accountant: { uz: 'Buxgalter', ru: 'Бухгалтер' },
  'credit-risk-analyst': { uz: 'Kredit risklari tahlilchisi', ru: 'Аналитик кредитных рисков' },
  'banking-associate': { uz: 'Bank mutaxassisi', ru: 'Банковский специалист' },

  // Sales & Marketing
  'digital-marketing-specialist': {
    uz: 'Raqamli marketing mutaxassisi',
    ru: 'Специалист по digital-маркетингу',
  },
  'sales-manager': { uz: 'Savdo menejeri', ru: 'Менеджер по продажам' },
  'seo-specialist': { uz: 'SEO mutaxassisi', ru: 'SEO-специалист' },
  'smm-manager': { uz: 'SMM menejeri', ru: 'SMM-менеджер' },

  // Design & Creative
  'ui-ux-designer': { uz: 'UI/UX dizayner', ru: 'UI/UX-дизайнер' },
  'graphic-designer': { uz: 'Grafik dizayner', ru: 'Графический дизайнер' },
  'product-designer': { uz: 'Mahsulot dizayneri', ru: 'Продуктовый дизайнер' },
  'motion-designer': { uz: 'Motion dizayner', ru: 'Motion-дизайнер' },

  // HR & Recruiting
  'hr-recruiter': { uz: 'HR rekruter', ru: 'HR-рекрутер' },
  'talent-acquisition-partner': {
    uz: 'Xodimlarni tanlash bo‘yicha menejer',
    ru: 'Менеджер по подбору персонала',
  },
  'hr-business-partner': { uz: 'HR biznes-hamkor', ru: 'HR бизнес-партнёр' },
  'people-operations-specialist': {
    uz: 'Xodimlar bo‘yicha mutaxassis',
    ru: 'Специалист по персоналу',
  },

  // Education
  'english-teacher-corporate': {
    uz: 'Ingliz tili o‘qituvchisi (korporativ)',
    ru: 'Преподаватель английского языка (корпоративный)',
  },
  'curriculum-designer': {
    uz: 'O‘quv dasturlari metodisti',
    ru: 'Методист образовательных программ',
  },
  'online-course-instructor': {
    uz: 'Onlayn kurs o‘qituvchisi',
    ru: 'Преподаватель онлайн-курсов',
  },
  'teaching-assistant': { uz: 'O‘qituvchi yordamchisi', ru: 'Ассистент преподавателя' },

  // Healthcare
  'registered-nurse': { uz: 'Hamshira', ru: 'Медицинская сестра' },
  'clinical-research-associate': {
    uz: 'Klinik tadqiqotlar mutaxassisi',
    ru: 'Специалист по клиническим исследованиям',
  },
  'pharmacy-specialist': { uz: 'Farmatsevt', ru: 'Фармацевт' },
  'patient-care-coordinator': {
    uz: 'Bemorlar bilan ishlash koordinatori',
    ru: 'Координатор по работе с пациентами',
  },

  // Engineering
  'engineering-project-lead': {
    uz: 'Muhandislik loyihasi rahbari',
    ru: 'Руководитель инженерных проектов',
  },
  'mechanical-design-engineer': {
    uz: 'Muhandis-konstruktor (mexanika)',
    ru: 'Инженер-конструктор (механика)',
  },
  'electrical-engineer': { uz: 'Elektr muhandisi', ru: 'Инженер-электрик' },
  'site-engineer': { uz: 'Obyekt muhandisi', ru: 'Инженер участка' },

  // Customer Support
  'customer-support-lead': {
    uz: 'Mijozlarni qo‘llab-quvvatlash guruhi rahbari',
    ru: 'Руководитель службы поддержки',
  },
  'support-specialist': { uz: 'Qo‘llab-quvvatlash mutaxassisi', ru: 'Специалист поддержки' },
  'technical-support-engineer': {
    uz: 'Texnik qo‘llab-quvvatlash muhandisi',
    ru: 'Инженер технической поддержки',
  },
  'call-center-supervisor': { uz: 'Call-markaz supervayzeri', ru: 'Супервайзер call-центра' },

  // Logistics
  'logistics-coordinator': { uz: 'Logistika koordinatori', ru: 'Координатор по логистике' },
  'warehouse-supervisor': { uz: 'Ombor boshlig‘i', ru: 'Заведующий складом' },
  'supply-chain-analyst': { uz: 'Ta’minot zanjiri tahlilchisi', ru: 'Аналитик цепочки поставок' },
  'fleet-operations-manager': { uz: 'Avtopark boshlig‘i', ru: 'Начальник автопарка' },

  // Legal
  'legal-counsel': { uz: 'Yuriskonsult', ru: 'Юрисконсульт' },
  'compliance-officer': { uz: 'Komplayens bo‘yicha mutaxassis', ru: 'Комплаенс-офицер' },
  'contract-specialist': { uz: 'Shartnomalar bo‘yicha mutaxassis', ru: 'Специалист по договорам' },
  'paralegal-assistant': { uz: 'Yurist yordamchisi', ru: 'Помощник юриста' },

  // Hospitality
  'hotel-front-office-manager': {
    uz: 'Mehmonxona qabul bo‘limi menejeri',
    ru: 'Менеджер службы приёма и размещения',
  },
  'restaurant-supervisor': { uz: 'Restoran administratori', ru: 'Администратор ресторана' },
  'guest-relations-officer': {
    uz: 'Mehmonlar bilan ishlash bo‘yicha mutaxassis',
    ru: 'Специалист по работе с гостями',
  },
  'f-b-operations-lead': { uz: 'F&B bo‘limi rahbari', ru: 'Руководитель службы F&B' },

  // Same roles under the plain `slugify` spelling, for callers that slugify a
  // display name themselves instead of reading `JobTitle.slug`.
  'full-stack-developer': { uz: 'Full-stack dasturchi', ru: 'Full-stack-разработчик' },
  'c-developer': { uz: 'C++ dasturchi', ru: 'Разработчик C++' },
  'c-systems-engineer': { uz: 'C++ tizim muhandisi', ru: 'Системный инженер C++' },
};

/**
 * Only skills whose name is a real word rather than a product or technology
 * name. Technologies (TypeScript, React, Docker) are identical in all three
 * locales and are intentionally left out so they fall back to `name`.
 */
export const SKILL_NAMES: Record<string, LocalizedName> = {
  // Business
  'product-management': { uz: 'Mahsulot boshqaruvi', ru: 'Управление продуктом' },
  'project-management': { uz: 'Loyiha boshqaruvi', ru: 'Управление проектами' },
  sales: { uz: 'Savdo', ru: 'Продажи' },

  // Marketing
  'digital-marketing': { uz: 'Raqamli marketing', ru: 'Digital-маркетинг' },
  'content-writing': { uz: 'Kontent yaratish', ru: 'Создание контента' },

  // Finance
  accounting: { uz: 'Buxgalteriya hisobi', ru: 'Бухгалтерский учёт' },
  'financial-analysis': { uz: 'Moliyaviy tahlil', ru: 'Финансовый анализ' },

  // Support
  'customer-support': { uz: 'Mijozlarni qo‘llab-quvvatlash', ru: 'Поддержка клиентов' },

  // Languages
  english: { uz: 'Ingliz tili', ru: 'Английский язык' },
  russian: { uz: 'Rus tili', ru: 'Русский язык' },
  uzbek: { uz: 'O‘zbek tili', ru: 'Узбекский язык' },

  // Soft skills
  communication: { uz: 'Muloqot', ru: 'Коммуникация' },
  leadership: { uz: 'Liderlik', ru: 'Лидерство' },
  'problem-solving': { uz: 'Muammolarni hal qilish', ru: 'Решение проблем' },
  teamwork: { uz: 'Jamoada ishlash', ru: 'Работа в команде' },

  // Data
  'machine-learning': { uz: 'Mashinali o‘qitish', ru: 'Машинное обучение' },
  'data-analysis': { uz: 'Ma’lumotlar tahlili', ru: 'Анализ данных' },

  // QA & Mobile
  'qa-testing': { uz: 'QA testlash', ru: 'QA-тестирование' },
  'mobile-development': { uz: 'Mobil dasturlash', ru: 'Мобильная разработка' },

  // HR
  'hr-management': { uz: 'HR boshqaruvi', ru: 'Управление персоналом' },
  recruiting: { uz: 'Xodimlarni tanlash', ru: 'Подбор персонала' },

  // Legal
  'legal-research': { uz: 'Huquqiy tahlil', ru: 'Правовой анализ' },
  'contract-law': { uz: 'Shartnoma huquqi', ru: 'Договорное право' },

  // Logistics
  'supply-chain': { uz: 'Ta’minot zanjiri', ru: 'Цепочка поставок' },

  // Healthcare
  nursing: { uz: 'Hamshiralik ishi', ru: 'Сестринское дело' },
  'patient-care': { uz: 'Bemorlarga g‘amxo‘rlik', ru: 'Уход за пациентами' },
  'clinical-research': { uz: 'Klinik tadqiqotlar', ru: 'Клинические исследования' },
  pharmacy: { uz: 'Farmatsevtika', ru: 'Фармацевтика' },

  // Education
  teaching: { uz: 'O‘qitish', ru: 'Преподавание' },
  'curriculum-design': {
    uz: 'O‘quv dasturini ishlab chiqish',
    ru: 'Разработка учебных программ',
  },

  // Hospitality
  'hospitality-management': { uz: 'Mehmonxona boshqaruvi', ru: 'Гостиничный менеджмент' },
  'food-safety': { uz: 'Oziq-ovqat xavfsizligi', ru: 'Пищевая безопасность' },

  // Engineering
  'mechanical-design': { uz: 'Mexanik loyihalash', ru: 'Механическое проектирование' },
  'electrical-engineering': { uz: 'Elektrotexnika', ru: 'Электротехника' },
};
