/** Localized display names for taxonomy lookups, keyed by slug (languages by code). */
export type LocalizedName = { uz: string; ru: string };

/** JobCategory.slug -> label. Keys mirror `CATEGORIES` in prisma/seed.ts. */
export const CATEGORY_NAMES: Record<string, LocalizedName> = {
  'it-software': { uz: 'IT va dasturiy ta’minot', ru: 'IT и разработка ПО' },
  finance: { uz: 'Moliya va banklar', ru: 'Финансы и банки' },
  'sales-marketing': { uz: 'Savdo va marketing', ru: 'Продажи и маркетинг' },
  design: { uz: 'Dizayn va kreativ', ru: 'Дизайн и креатив' },
  hr: { uz: 'HR va rekruting', ru: 'HR и рекрутинг' },
  education: { uz: 'Ta’lim', ru: 'Образование' },
  healthcare: { uz: 'Sog‘liqni saqlash', ru: 'Здравоохранение' },
  engineering: { uz: 'Muhandislik', ru: 'Инженерия' },
  'customer-support': { uz: 'Mijozlarni qo‘llab-quvvatlash', ru: 'Поддержка клиентов' },
  logistics: { uz: 'Logistika', ru: 'Логистика' },
  legal: { uz: 'Yurisprudensiya', ru: 'Юриспруденция' },
  hospitality: { uz: 'Mehmonxona va restoran', ru: 'Гостиницы и рестораны' },
};

/** IndustryGroup.slug -> label. Keys mirror `INDUSTRY_GROUPS` in common/industry-catalog.ts. */
export const INDUSTRY_GROUP_NAMES: Record<string, LocalizedName> = {
  'services-non-manufacturing': { uz: 'Xizmat ko‘rsatish sohasi', ru: 'Сфера услуг' },
  'sales-trade': { uz: 'Savdo va sotuv', ru: 'Продажи и торговля' },
  'manufacturing-industry': {
    uz: 'Ishlab chiqarish va sanoat',
    ru: 'Производство и промышленность',
  },
  other: { uz: 'Boshqa', ru: 'Другое' },
};

/** Industry.slug -> label. Keys mirror the `industries` arrays in common/industry-catalog.ts. */
export const INDUSTRY_NAMES: Record<string, LocalizedName> = {
  // services-non-manufacturing
  'auto-business': { uz: 'Avtobiznes va avtoservis', ru: 'Автобизнес и автосервис' },
  'beauty-fitness-sports': { uz: 'Go‘zallik, fitnes, sport', ru: 'Красота, фитнес, спорт' },
  'construction-architecture-design': {
    uz: 'Qurilish, arxitektura, interyer',
    ru: 'Строительство, архитектура, интерьер',
  },
  'consulting-accounting-audit': {
    uz: 'Konsalting, buxgalteriya, audit',
    ru: 'Консалтинг, бухгалтерия, аудит',
  },
  design: { uz: 'Dizayn', ru: 'Дизайн' },
  'education-science': { uz: 'Ta’lim va fan', ru: 'Образование и наука' },
  'finance-banking-insurance': { uz: 'Moliya, bank, sug‘urta', ru: 'Финансы, банки, страхование' },
  'hospitality-restaurants': {
    uz: 'Mehmonxona va restoran biznesi',
    ru: 'Гостинично-ресторанный бизнес',
  },
  it: { uz: 'IT', ru: 'IT' },
  legal: { uz: 'Yuridik xizmatlar', ru: 'Юридические услуги' },
  'marketing-advertising-pr': { uz: 'Marketing, reklama, PR', ru: 'Маркетинг, реклама, PR' },
  media: { uz: 'Media', ru: 'Медиа' },
  'medicine-pharmacy': { uz: 'Tibbiyot va farmatsevtika', ru: 'Медицина и фармацевтика' },
  'public-business-services': {
    uz: 'Aholi va biznesga xizmat ko‘rsatish',
    ru: 'Услуги для населения и бизнеса',
  },
  'publishing-printing': { uz: 'Nashriyot va poligrafiya', ru: 'Издательство, полиграфия' },
  'recruiting-hr': { uz: 'Rekruting va HR', ru: 'Рекрутинг и HR' },
  security: { uz: 'Xavfsizlik va qo‘riqlash', ru: 'Безопасность и охрана' },
  'arts-entertainment': { uz: 'San’at va ko‘ngilocharlik', ru: 'Искусство и развлечения' },
  'telecom-networking': { uz: 'Telekommunikatsiya va aloqa', ru: 'Телекоммуникации и связь' },
  tourism: { uz: 'Turizm', ru: 'Туризм' },
  'transportation-logistics': { uz: 'Transport va logistika', ru: 'Транспорт и логистика' },

  // sales-trade
  'real-estate': { uz: 'Ko‘chmas mulk', ru: 'Недвижимость' },
  retail: { uz: 'Chakana savdo', ru: 'Розничная торговля' },
  'wholesale-distribution': {
    uz: 'Ulgurji savdo va distribyutsiya',
    ru: 'Оптовая торговля и дистрибуция',
  },

  // manufacturing-industry
  'agriculture-agribusiness': {
    uz: 'Qishloq xo‘jaligi va agrobiznes',
    ru: 'Сельское хозяйство и агробизнес',
  },
  'chemicals-pharma-manufacturing': {
    uz: 'Kimyo sanoati va farmatsevtika',
    ru: 'Химическая промышленность, фармацевтика',
  },
  'construction-materials-woodworking': {
    uz: 'Qurilish materiallari va yog‘ochsozlik',
    ru: 'Стройматериалы и деревообработка',
  },
  'food-industry': { uz: 'Oziq-ovqat sanoati', ru: 'Пищевая промышленность' },
  'light-industry': { uz: 'Yengil sanoat', ru: 'Лёгкая промышленность' },
  'mechanical-engineering': { uz: 'Mashinasozlik', ru: 'Машиностроение' },
  'metals-metalworking': {
    uz: 'Metallurgiya va metall ishlash',
    ru: 'Металлургия и металлообработка',
  },
  mining: { uz: 'Konchilik sanoati', ru: 'Горнодобывающая промышленность' },
  'power-energy': { uz: 'Energetika', ru: 'Энергетика' },
  'manufacturing-general': { uz: 'Ishlab chiqarish (umumiy)', ru: 'Производство (общее)' },

  // other
  'government-public-sector': { uz: 'Davlat tashkilotlari', ru: 'Государственные организации' },
  'non-profit': { uz: 'Notijorat tashkilotlar', ru: 'Некоммерческие организации' },
  other: { uz: 'Boshqa', ru: 'Другое' },
};

/** Benefit.slug -> label. Keys mirror `BENEFITS` in prisma/seed.ts. */
export const BENEFIT_NAMES: Record<string, LocalizedName> = {
  'health-insurance': { uz: 'Tibbiy sug‘urta', ru: 'Медицинская страховка' },
  'remote-work': { uz: 'Masofaviy ish', ru: 'Удалённая работа' },
  'flexible-hours': { uz: 'Moslashuvchan ish vaqti', ru: 'Гибкий график' },
  'meal-allowance': { uz: 'Ovqatlanish uchun to‘lov', ru: 'Оплата питания' },
  'learning-budget': { uz: 'Ta’lim uchun byudjet', ru: 'Бюджет на обучение' },
  gym: { uz: 'Sport zali obunasi', ru: 'Абонемент в спортзал' },
  'paid-vacation': { uz: 'Haq to‘lanadigan ta’til', ru: 'Оплачиваемый отпуск' },
  'stock-options': { uz: 'Aksiya opsionlari', ru: 'Опционы на акции' },
  relocation: { uz: 'Ko‘chib o‘tishga yordam', ru: 'Помощь с релокацией' },
  equipment: { uz: 'Texnika uchun byudjet', ru: 'Бюджет на технику' },
  'parental-leave': { uz: 'Ota-onalik ta’tili', ru: 'Отпуск по уходу за ребёнком' },
  bonus: { uz: 'Natijaga ko‘ra bonus', ru: 'Бонус за результат' },
};

/** Language.code (ISO 639-1) -> label. Keys mirror `LANGUAGES` in prisma/seed.ts. */
export const LANGUAGE_NAMES: Record<string, LocalizedName> = {
  uz: { uz: 'O‘zbek tili', ru: 'Узбекский' },
  ru: { uz: 'Rus tili', ru: 'Русский' },
  en: { uz: 'Ingliz tili', ru: 'Английский' },
  kk: { uz: 'Qozoq tili', ru: 'Казахский' },
  tr: { uz: 'Turk tili', ru: 'Турецкий' },
  de: { uz: 'Nemis tili', ru: 'Немецкий' },
  fr: { uz: 'Fransuz tili', ru: 'Французский' },
  ko: { uz: 'Koreys tili', ru: 'Корейский' },
  zh: { uz: 'Xitoy tili', ru: 'Китайский' },
  ar: { uz: 'Arab tili', ru: 'Арабский' },
};
