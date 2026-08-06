'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

export type Locale = 'uz' | 'ru' | 'en';

const DICT: Record<string, Record<Locale, string>> = {
  jobs: { uz: 'Ish o‘rinlari', ru: 'Вакансии', en: 'Jobs' },
  dashboard: { uz: 'Kabinet', ru: 'Кабинет', en: 'Dashboard' },
  messages: { uz: 'Xabarlar', ru: 'Сообщения', en: 'Messages' },
  settings: { uz: 'Sozlamalar', ru: 'Настройки', en: 'Settings' },
  login: { uz: 'Kirish', ru: 'Войти', en: 'Login' },
  register: { uz: 'Ro‘yxatdan o‘tish', ru: 'Регистрация', en: 'Register' },
  logout: { uz: 'Chiqish', ru: 'Выйти', en: 'Logout' },
  search: { uz: 'Qidirish', ru: 'Поиск', en: 'Search' },
  searchJobs: { uz: 'Ish qidirish', ru: 'Найти вакансии', en: 'Search jobs' },
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
  hotJobs: { uz: 'Dolzarb vakansiyalar', ru: 'Горячие вакансии', en: 'Hot jobs' },
  viewAll: { uz: 'Barchasini ko‘rish', ru: 'Смотреть все', en: 'View all' },
  hiringNow: { uz: 'Hozir ishga olmoqda', ru: 'Сейчас нанимают', en: 'Hiring now' },
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
  language: { uz: 'Til', ru: 'Язык', en: 'Language' },
  save: { uz: 'Saqlash', ru: 'Сохранить', en: 'Save' },
  changePassword: { uz: 'Parolni o‘zgartirish', ru: 'Сменить пароль', en: 'Change password' },
  currentPassword: { uz: 'Joriy parol', ru: 'Текущий пароль', en: 'Current password' },
  newPassword: { uz: 'Yangi parol', ru: 'Новый пароль', en: 'New password' },
  send: { uz: 'Yuborish', ru: 'Отправить', en: 'Send' },
  writeMessage: { uz: 'Xabar yozing…', ru: 'Напишите сообщение…', en: 'Write a message…' },
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
};

type I18nCtx = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: keyof typeof DICT | string) => string;
};

const Ctx = createContext<I18nCtx>({
  locale: 'uz',
  setLocale: () => undefined,
  t: (k) => String(k),
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('uz');

  useEffect(() => {
    const stored = localStorage.getItem('jt_locale') as Locale | null;
    if (stored && ['uz', 'ru', 'en'].includes(stored)) setLocaleState(stored);
  }, []);

  function setLocale(l: Locale) {
    setLocaleState(l);
    localStorage.setItem('jt_locale', l);
  }

  function t(key: string) {
    return DICT[key]?.[locale] ?? key;
  }

  return <Ctx.Provider value={{ locale, setLocale, t }}>{children}</Ctx.Provider>;
}

export function useI18n() {
  return useContext(Ctx);
}
