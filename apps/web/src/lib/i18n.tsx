'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from 'react';

export type Locale = 'uz' | 'ru' | 'en';

const DICT = {
  jobs: { uz: 'Ish o‘rinlari', ru: 'Вакансии', en: 'Jobs' },
  dashboard: { uz: 'Kabinet', ru: 'Кабинет', en: 'Dashboard' },
  messages: { uz: 'Xabarlar', ru: 'Сообщения', en: 'Messages' },
  settings: { uz: 'Sozlamalar', ru: 'Настройки', en: 'Settings' },
  login: { uz: 'Kirish', ru: 'Войти', en: 'Login' },
  register: { uz: 'Ro‘yxatdan o‘tish', ru: 'Регистрация', en: 'Register' },
  logout: { uz: 'Chiqish', ru: 'Выйти', en: 'Logout' },
  search: { uz: 'Qidirish', ru: 'Поиск', en: 'Search' },
  searchJobs: { uz: 'Ish qidirish', ru: 'Найти вакансии', en: 'Search jobs' },
  searchPlaceholder: {
    uz: 'Lavozim, ko‘nikma yoki kompaniya…',
    ru: 'Должность, навык или компания…',
    en: 'Job title, skill, or company…',
  },
  heroTitle: {
    uz: 'O‘zingizga mos ish toping. Ishga yaroqli kadr yollang.',
    ru: 'Найдите подходящую работу. Наймите нужных людей.',
    en: 'Find work that fits. Hire talent that delivers.',
  },
  heroSubtitle: {
    uz: 'Job Talentio O‘zbekiston bo‘ylab nomzodlar va kompaniyalarni aqlli moslashtirish bilan bog‘laydi.',
    ru: 'Job Talentio соединяет кандидатов и компании по всему Узбекистану с умным подбором.',
    en: 'Job Talentio connects candidates and companies across Uzbekistan with smart matching, advanced search, and a lightweight ATS.',
  },
  heroBadge: {
    uz: 'O‘zbekiston · uz / ru / en',
    ru: 'Узбекистан · uz / ru / en',
    en: 'Uzbekistan · uz / ru / en',
  },
  openRoles: { uz: 'Ochiq ish o‘rinlari', ru: 'Открытые вакансии', en: 'Open roles' },
  companiesStat: { uz: 'Kompaniyalar', ru: 'Компании', en: 'Companies' },
  talentProfiles: { uz: 'Nomzodlar', ru: 'Профили талантов', en: 'Talent profiles' },
  citiesCovered: { uz: 'Shaharlar', ru: 'Городов', en: 'Cities covered' },
  hotJobs: { uz: 'Dolzarb vakansiyalar', ru: 'Горячие вакансии', en: 'Hot jobs' },
  hot: { uz: 'Dolzarb', ru: 'Горячее', en: 'Hot' },
  hotJobsEmpty: {
    uz: 'Dolzarb vakansiyalar seed’dan keyin paydo bo‘ladi.',
    ru: 'Горячие вакансии появятся после загрузки сидов.',
    en: 'Hot jobs will appear after seed data loads.',
  },
  viewAll: { uz: 'Barchasini ko‘rish', ru: 'Смотреть все', en: 'View all' },
  hiringNow: { uz: 'Hozir ishga olmoqda', ru: 'Сейчас нанимают', en: 'Hiring now' },
  hiringNowSubtitle: {
    uz: 'Kompaniyalar ochiq vakansiyalar bilan',
    ru: 'Компании с открытыми вакансиями',
    en: 'Companies with open roles right now',
  },
  openRolesCount: {
    uz: '{n} ochiq ish',
    ru: '{n} вакансий',
    en: '{n} open roles',
  },
  browseByCompany: {
    uz: 'Kompaniya bo‘yicha qidirish',
    ru: 'Поиск по компаниям',
    en: 'Browse jobs by company',
  },
  browseByCompanyHint: {
    uz: 'Kompaniyani tanlang — uning barcha ochiq ishlari chiqadi.',
    ru: 'Выберите компанию, чтобы увидеть все её открытые вакансии.',
    en: 'Pick a company to see all of its open roles.',
  },
  jobsAtCompany: {
    uz: 'Ishlar: {name}',
    ru: 'Вакансии: {name}',
    en: 'Jobs at {name}',
  },
  clearCompanyFilter: {
    uz: 'Kompaniya filtrini tozalash',
    ru: 'Сбросить фильтр компании',
    en: 'Clear company filter',
  },
  viewCompanyProfile: {
    uz: 'Kompaniya profili',
    ru: 'Профиль компании',
    en: 'Company profile',
  },
  companiesHiring: {
    uz: 'Ishga olayotgan kompaniyalar',
    ru: 'Компании, которые нанимают',
    en: 'Companies hiring',
  },
  forCandidates: { uz: 'Nomzodlar uchun', ru: 'Для кандидатов', en: 'For candidates' },
  forCandidatesDesc: {
    uz: 'Profil, ko‘nikmalar, CV yuklash, moslik ballari, ogohlantirishlar va chat.',
    ru: 'Профиль, навыки, загрузка CV, баллы совпадения, оповещения и чат.',
    en: 'Profile, skills, CV upload, match scores, alerts, and chat.',
  },
  forCompanies: { uz: 'Kompaniyalar uchun', ru: 'Для компаний', en: 'For companies' },
  forCompaniesDesc: {
    uz: 'Pipeline, nomzod tanlash, Hot Jobs, screening savollari.',
    ru: 'Воронка, подбор кандидатов, Hot Jobs, скрининг-вопросы.',
    en: 'Pipeline, candidate matching, Hot Jobs, screening questions.',
  },
  enterpriseReady: { uz: 'Korxona darajasi', ru: 'Для бизнеса', en: 'Enterprise-ready' },
  enterpriseReadyDesc: {
    uz: 'Normallashtirilgan ma’lumotlar, analitika, bildirishnomalar, moderatsiya.',
    ru: 'Нормализованные данные, аналитика, уведомления, модерация.',
    en: 'Normalized data, analytics, notifications, moderation tools.',
  },
  filters: { uz: 'Filtrlar', ru: 'Фильтры', en: 'Filters' },
  city: { uz: 'Shahar', ru: 'Город', en: 'City' },
  category: { uz: 'Kategoriya', ru: 'Категория', en: 'Category' },
  skills: { uz: 'Ko‘nikmalar', ru: 'Навыки', en: 'Skills' },
  benefits: { uz: 'Imtiyozlar', ru: 'Льготы', en: 'Benefits' },
  salary: { uz: 'Maosh', ru: 'Зарплата', en: 'Salary' },
  applyNow: { uz: 'Ariza topshirish', ru: 'Откликнуться', en: 'Apply now' },
  saveJob: { uz: 'Saqlash', ru: 'Сохранить', en: 'Save job' },
  followCompany: { uz: 'Kompaniyani kuzatish', ru: 'Подписаться', en: 'Follow company' },
  following: { uz: 'Kuzatilmoqda', ru: 'Вы подписаны', en: 'Following' },
  jobsFound: { uz: 'ta ish topildi', ru: 'вакансий найдено', en: 'jobs found' },
  clearFilters: { uz: 'Filtrlarni tozalash', ru: 'Сбросить фильтры', en: 'Clear filters' },
  overview: { uz: 'Umumiy', ru: 'Обзор', en: 'Overview' },
  recommended: { uz: 'Tavsiya etilgan', ru: 'Рекомендации', en: 'Recommended' },
  applications: { uz: 'Arizalar', ru: 'Отклики', en: 'Applications' },
  savedJobs: { uz: 'Saqlangan ishlar', ru: 'Сохранённые', en: 'Saved jobs' },
  alerts: { uz: 'Ish ogohlantirishlari', ru: 'Оповещения', en: 'Job alerts' },
  profile: { uz: 'Profil', ru: 'Профиль', en: 'Profile' },
  account: { uz: 'Hisob', ru: 'Аккаунт', en: 'Account' },
  fullName: { uz: 'To‘liq ism', ru: 'Полное имя', en: 'Full name' },
  email: { uz: 'Email', ru: 'Email', en: 'Email' },
  password: { uz: 'Parol', ru: 'Пароль', en: 'Password' },
  language: { uz: 'Til', ru: 'Язык', en: 'Language' },
  save: { uz: 'Saqlash', ru: 'Сохранить', en: 'Save' },
  saving: { uz: 'Saqlanmoqda…', ru: 'Сохранение…', en: 'Saving…' },
  changePassword: { uz: 'Parolni o‘zgartirish', ru: 'Сменить пароль', en: 'Change password' },
  currentPassword: { uz: 'Joriy parol', ru: 'Текущий пароль', en: 'Current password' },
  newPassword: { uz: 'Yangi parol', ru: 'Новый пароль', en: 'New password' },
  send: { uz: 'Yuborish', ru: 'Отправить', en: 'Send' },
  writeMessage: { uz: 'Xabar yozing…', ru: 'Напишите сообщение…', en: 'Write a message…' },
  sent: { uz: 'Yuborildi', ru: 'Отправлено', en: 'Sent' },
  delivered: { uz: 'Yetkazildi', ru: 'Доставлено', en: 'Delivered' },
  read: { uz: 'O‘qildi', ru: 'Прочитано', en: 'Read' },
  noConversations: {
    uz: 'Suhbatlar hali yo‘q',
    ru: 'Диалогов пока нет',
    en: 'No conversations yet',
  },
  chatWithCandidate: { uz: 'Nomzod bilan chat', ru: 'Чат с кандидатом', en: 'Chat with candidate' },
  chatWithRecruiter: { uz: 'Rekruter bilan chat', ru: 'Чат с рекрутером', en: 'Chat with recruiter' },
  match: { uz: 'Moslik', ru: 'Совпадение', en: 'Match' },
  experience: { uz: 'Tajriba', ru: 'Опыт', en: 'Experience' },
  education: { uz: 'Ta’lim', ru: 'Образование', en: 'Education' },
  certifications: { uz: 'Sertifikatlar', ru: 'Сертификаты', en: 'Certifications' },
  languages: { uz: 'Tillar', ru: 'Языки', en: 'Languages' },
  resumes: { uz: 'Rezyumelar', ru: 'Резюме', en: 'Resumes' },
  years: { uz: 'yil', ru: 'лет', en: 'years' },
  company: { uz: 'Kompaniya', ru: 'Компания', en: 'Company' },
  editCompany: { uz: 'Kompaniyani tahrirlash', ru: 'Редактировать компанию', en: 'Edit company' },
  viewProfile: { uz: 'Profilni ko‘rish', ru: 'Смотреть профиль', en: 'View profile' },
  required: { uz: 'majburiy', ru: 'обязательно', en: 'required' },
  optional: { uz: 'ixtiyoriy', ru: 'необязательно', en: 'optional' },
  requiredFieldsNote: {
    uz: 'Maydonlar * bilan belgilanadi majburiy.',
    ru: 'Поля, отмеченные *, обязательны.',
    en: 'Fields marked with * are required.',
  },
  closeDialog: { uz: 'Yopish', ru: 'Закрыть', en: 'Close' },
  messageInput: { uz: 'Xabar matni', ru: 'Текст сообщения', en: 'Message text' },
  uploadCv: { uz: 'CV yuklash', ru: 'Загрузить CV', en: 'Upload CV' },
  sortBy: { uz: 'Saralash', ru: 'Сортировка', en: 'Sort by' },
  resultsPerPage: { uz: 'Sahifadagi natijalar', ru: 'На странице', en: 'Results per page' },
  jumpToPage: { uz: 'Sahifaga o‘tish', ru: 'Перейти к странице', en: 'Jump to page' },
  welcomeBack: { uz: 'Xush kelibsiz', ru: 'С возвращением', en: 'Welcome back' },
  signInTo: {
    uz: 'Job Talentio hisobingizga kiring',
    ru: 'Войдите в Job Talentio',
    en: 'Sign in to Job Talentio',
  },
  signIn: { uz: 'Kirish', ru: 'Войти', en: 'Sign in' },
  signingIn: { uz: 'Kirilmoqda…', ru: 'Вход…', en: 'Signing in…' },
  noAccount: { uz: 'Hisobingiz yo‘qmi?', ru: 'Нет аккаунта?', en: 'No account?' },
  createAccount: { uz: 'Hisob yaratish', ru: 'Создать аккаунт', en: 'Create account' },
  joinTalentio: {
    uz: 'Job Talentio’ga qo‘shiling',
    ru: 'Присоединяйтесь к Job Talentio',
    en: 'Join Job Talentio',
  },
  imCandidate: { uz: 'Men nomzodman', ru: 'Я кандидат', en: "I'm a candidate" },
  imHiring: { uz: 'Men yollayman', ru: 'Я нанимаю', en: "I'm hiring" },
  companyName: { uz: 'Kompaniya nomi', ru: 'Название компании', en: 'Company name' },
  alreadyRegistered: {
    uz: 'Allaqachon ro‘yxatdan o‘tganmisiz?',
    ru: 'Уже зарегистрированы?',
    en: 'Already registered?',
  },
  passwordHint: {
    uz: 'Kamida 8 ta belgi',
    ru: 'Не менее 8 символов',
    en: 'At least 8 characters',
  },
  notifications: { uz: 'Bildirishnomalar', ru: 'Уведомления', en: 'Notifications' },
  markAllRead: { uz: 'Hammasi o‘qildi', ru: 'Прочитать все', en: 'Mark all read' },
  noNotifications: {
    uz: 'Bildirishnomalar yo‘q',
    ru: 'Уведомлений пока нет',
    en: 'No notifications yet',
  },
  languagePreference: {
    uz: 'Interfeys va ogohlantirishlar tili',
    ru: 'Язык интерфейса и оповещений',
    en: 'Preferred language for the interface and alerts.',
  },
  languageApplied: {
    uz: 'Til darhol qo‘llanadi. Saqlash hisobingizga yozadi.',
    ru: 'Язык применяется сразу. Сохранение запишет его в аккаунт.',
    en: 'Language applies immediately. Save writes it to your account.',
  },
  footer: {
    uz: 'Job Talentio — O‘zbekiston bo‘ylab ish o‘rinlari',
    ru: 'Job Talentio — вакансии по всему Узбекистану',
    en: 'Job Talentio — jobs across Uzbekistan',
  },
  experienceLevel: { uz: 'Tajriba darajasi', ru: 'Уровень опыта', en: 'Experience level' },
  workMode: { uz: 'Ish tartibi', ru: 'Формат работы', en: 'Work mode' },
  employmentType: { uz: 'Bandlik turi', ru: 'Тип занятости', en: 'Employment type' },
  postedWithin: { uz: 'Joylangan muddat', ru: 'Опубликовано за', en: 'Posted within' },
  hotOnly: { uz: 'Faqat dolzarb', ru: 'Только горячие', en: 'Hot only' },
  keyword: { uz: 'Kalit so‘z', ru: 'Ключевое слово', en: 'Keyword' },
  page: { uz: 'Sahifa', ru: 'Страница', en: 'Page' },
  of: { uz: '/', ru: 'из', en: 'of' },
  coverLetter: { uz: 'Motivatsion xat', ru: 'Сопроводительное письмо', en: 'Cover letter' },
  submitApplication: {
    uz: 'Arizani yuborish',
    ru: 'Отправить отклик',
    en: 'Submit application',
  },
  cancel: { uz: 'Bekor qilish', ru: 'Отмена', en: 'Cancel' },
  applyFor: { uz: 'Ariza', ru: 'Отклик', en: 'Apply' },
  employee: { uz: 'Xodim', ru: 'Сотрудник', en: 'Employee' },
  recruiter: { uz: 'Rekruter', ru: 'Рекрутер', en: 'Recruiter' },
  accountType: { uz: 'Hisob turi', ru: 'Тип аккаунта', en: 'Account type' },
  showPassword: { uz: 'Parolni ko‘rsatish', ru: 'Показать пароль', en: 'Show password' },
  hidePassword: { uz: 'Parolni yashirish', ru: 'Скрыть пароль', en: 'Hide password' },
  confirmPassword: {
    uz: 'Parolni tasdiqlang',
    ru: 'Подтвердите пароль',
    en: 'Confirm password',
  },
  passwordsDoNotMatch: {
    uz: 'Parollar mos kelmaydi',
    ru: 'Пароли не совпадают',
    en: 'Passwords do not match',
  },
  mustAcceptTerms: {
    uz: 'Hisob yaratish uchun shartlarga rozilik bering',
    ru: 'Чтобы создать аккаунт, примите условия',
    en: 'Please accept the terms to create an account',
  },
  acceptTermsLabel: {
    uz: 'Men Foydalanish shartlari va Maxfiylik siyosatiga roziman',
    ru: 'Я принимаю Условия использования и Политику конфиденциальности',
    en: 'I agree to the Terms of Service and Privacy Policy',
  },
  creatingAccount: {
    uz: 'Hisob yaratilmoqda…',
    ru: 'Создание аккаунта…',
    en: 'Creating account…',
  },
  companyNameRequired: {
    uz: 'Rekruter uchun kompaniya nomi majburiy',
    ru: 'Название компании обязательно для рекрутера',
    en: 'Company name is required for recruiter accounts',
  },
  authFillRequired: {
    uz: 'Barcha majburiy maydonlarni to‘ldiring',
    ru: 'Заполните все обязательные поля',
    en: 'Please fill in all required fields',
  },
  authLoginFailed: {
    uz: 'Kirish amalga oshmadi. Email yoki parolni tekshiring.',
    ru: 'Не удалось войти. Проверьте email или пароль.',
    en: 'Sign-in failed. Check your email or password.',
  },
  authRegisterFailed: {
    uz: 'Ro‘yxatdan o‘tish amalga oshmadi. Qayta urinib ko‘ring.',
    ru: 'Не удалось зарегистрироваться. Попробуйте ещё раз.',
    en: 'Registration failed. Please try again.',
  },
  avatarUrl: { uz: 'Avatar URL', ru: 'URL аватара', en: 'Avatar URL' },
  updateProfileHint: {
    uz: 'Job Talentio’da qanday ko‘rinishingizni yangilang.',
    ru: 'Обновите, как вы выглядите в Job Talentio.',
    en: 'Update how you appear across Job Talentio.',
  },
  matchMode: { uz: 'Moslik rejimi', ru: 'Режим совпадения', en: 'Match mode' },
  filterSkills: { uz: 'Ko‘nikmalarni filtrlash', ru: 'Фильтр навыков', en: 'Filter skills' },
  any: { uz: 'Har qanday', ru: 'Любой', en: 'Any' },
  anyTime: { uz: 'Har qanday vaqt', ru: 'За всё время', en: 'Any time' },
  last24h: { uz: 'Oxirgi 24 soat', ru: 'За 24 часа', en: 'Last 24 hours' },
  last7d: { uz: 'Oxirgi 7 kun', ru: 'За 7 дней', en: 'Last 7 days' },
  last30d: { uz: 'Oxirgi 30 kun', ru: 'За 30 дней', en: 'Last 30 days' },
  onsite: { uz: 'Ofisda', ru: 'В офисе', en: 'On-site' },
  hybrid: { uz: 'Gibrid', ru: 'Гибрид', en: 'Hybrid' },
  remote: { uz: 'Masofaviy', ru: 'Удалённо', en: 'Remote' },
  hotJobsOnly: { uz: 'Faqat dolzarb ishlar', ru: 'Только горячие вакансии', en: 'Hot jobs only' },
  matchAny: { uz: 'Kamida bittasi (OR)', ru: 'Любой навык (OR)', en: 'Match any (OR)' },
  matchAll: { uz: 'Barchasi (AND)', ru: 'Все навыки (AND)', en: 'Match all (AND)' },
  viewMore: { uz: 'Yana ko‘rish', ru: 'Показать ещё', en: 'View more' },
  showLess: { uz: 'Kamroq', ru: 'Свернуть', en: 'Show less' },
  showingNofM: {
    uz: '{n} / {m} ko‘rsatilmoqda',
    ru: 'Показано {n} из {m}',
    en: 'Showing {n} of {m}',
  },
  showAdvancedFilters: {
    uz: 'Kengaytirilgan filtrlar',
    ru: 'Расширенные фильтры',
    en: 'Advanced filters',
  },
  hideAdvancedFilters: {
    uz: 'Kengaytirilgan filtrlarni yashirish',
    ru: 'Скрыть расширенные фильтры',
    en: 'Hide advanced filters',
  },
  activeFiltersCount: {
    uz: '{n} ta faol filtr',
    ru: 'Активных фильтров: {n}',
    en: '{n} active filters',
  },
  skillSearchPlaceholder: {
    uz: 'Ko‘nikma qidiring…',
    ru: 'Поиск навыка…',
    en: 'Search skills…',
  },
  skillNoMatchAdd: {
    uz: 'Topilmadi. “{name}” ni yangi ko‘nikma sifatida qo‘shish mumkin.',
    ru: 'Нет совпадений. Можно добавить «{name}» как новый навык.',
    en: 'No match. You can add “{name}” as a new skill.',
  },
  confirmAddSkill: {
    uz: '“{name}” katalogda yo‘q. Yangi ko‘nikma sifatida qo‘shilsinmi?',
    ru: '«{name}» нет в каталоге. Добавить как новый навык?',
    en: '“{name}” is not in the catalog. Add it as a new skill?',
  },
  skillMatched: {
    uz: 'Tanlandi: {name}',
    ru: 'Выбрано: {name}',
    en: 'Selected: {name}',
  },
  skillCreating: {
    uz: 'Qo‘shilmoqda: {name}',
    ru: 'Добавление: {name}',
    en: 'Adding: {name}',
  },
  skillPickOrType: {
    uz: 'Ro‘yxatdan tanlang yoki yangi nom yozing',
    ru: 'Выберите из списка или введите новое имя',
    en: 'Pick a suggestion or type a new skill name',
  },
  addSkill: { uz: 'Ko‘nikma qo‘shish', ru: 'Добавить навык', en: 'Add skill' },
  addBenefit: { uz: 'Imtiyoz qo‘shish', ru: 'Добавить льготу', en: 'Add benefit' },
  addLanguage: { uz: 'Til qo‘shish', ru: 'Добавить язык', en: 'Add language' },
  confirmAddLookup: {
    uz: '“{name}” katalogda yo‘q ({kind}). Yangi yozuv sifatida qo‘shilsinmi?',
    ru: '«{name}» нет в каталоге ({kind}). Добавить как новую запись?',
    en: '“{name}” is not in the catalog ({kind}). Add it as a new entry?',
  },
  benefitSearchPlaceholder: {
    uz: 'Imtiyoz qidiring…',
    ru: 'Поиск льготы…',
    en: 'Search benefits…',
  },
  languageSearchPlaceholder: {
    uz: 'Til qidiring…',
    ru: 'Поиск языка…',
    en: 'Search languages…',
  },
} as const;

export type DictKey = keyof typeof DICT;

type I18nCtx = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: DictKey | string) => string;
};

const Ctx = createContext<I18nCtx | null>(null);

function readStoredLocale(): Locale {
  if (typeof window === 'undefined') return 'uz';
  const stored = localStorage.getItem('jt_locale');
  if (stored === 'uz' || stored === 'ru' || stored === 'en') return stored;
  return 'uz';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('uz');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const initial = readStoredLocale();
    setLocaleState(initial);
    document.documentElement.lang = initial;
    setReady(true);
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    localStorage.setItem('jt_locale', l);
    document.documentElement.lang = l;
  }, []);

  const t = useCallback(
    (key: string) => {
      const entry = DICT[key as DictKey];
      if (!entry) return key;
      return entry[locale] ?? entry.en ?? key;
    },
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  // Avoid flashing wrong language before localStorage hydrate
  if (!ready) {
    return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return ctx;
}
