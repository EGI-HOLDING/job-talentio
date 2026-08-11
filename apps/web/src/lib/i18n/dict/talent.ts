/** Find Talent search panel and candidate profile. */
export const talent = {
  'talent.sortRelevance': {
    uz: 'Saralash: moslik',
    ru: 'Сортировка: релевантность',
    en: 'Sort: Relevance',
  },
  'talent.sortNewest': {
    uz: 'Saralash: yangilari',
    ru: 'Сортировка: новые',
    en: 'Sort: Newest',
  },
  'talent.sortMatch': {
    uz: 'Saralash: vakansiyaga moslik',
    ru: 'Сортировка: совпадение с вакансией',
    en: 'Sort: Match to job',
  },
  'talent.perPage': { uz: '{n} / sahifa', ru: '{n} / стр.', en: '{n} / page' },
  'talent.matchToJob': {
    uz: 'Vakansiyaga moslik',
    ru: 'Совпадение с вакансией',
    en: 'Match to job',
  },
  'talent.matchToJobAny': {
    uz: 'Har qanday (moslik bo‘yicha saralanmaydi)',
    ru: 'Любая (без ранжирования)',
    en: 'Any (no match ranking)',
  },
  'talent.minYears': { uz: 'Min. yil', ru: 'Мин. лет', en: 'Min years' },
  'talent.maxYears': { uz: 'Maks. yil', ru: 'Макс. лет', en: 'Max years' },
  'talent.min': { uz: 'Min', ru: 'Мин', en: 'Min' },
  'talent.max': { uz: 'Maks', ru: 'Макс', en: 'Max' },
  'talent.degree': { uz: 'Ta’lim darajasi', ru: 'Образование', en: 'Degree' },
  'talent.hasCertification': {
    uz: 'Sertifikati bor',
    ru: 'Есть сертификат',
    en: 'Has certification',
  },
  'talent.noMatches': {
    uz: 'Bu filtrlarga mos talent topilmadi.',
    ru: 'По этим фильтрам таланты не найдены.',
    en: 'No talent matches these filters.',
  },
  'talent.noMatchesForTitles': {
    uz: '{titles} bo‘yicha bu filtrlarga mos talent topilmadi.',
    ru: 'По этим фильтрам нет талантов для: {titles}.',
    en: 'No talent matches these filters for {titles}.',
  },
  'talent.noMatchesHint': {
    uz: 'Filtrlarni tozalang yoki ko‘nikma, shahar yoki lavozimni kengaytiring.',
    ru: 'Сбросьте фильтры или расширьте навыки, город либо должность.',
    en: 'Try clearing filters or broadening skills, city, or title.',
  },
  'talent.expYears': { uz: '{n} yil tajriba', ru: '{n} лет опыта', en: '{n}y exp' },
  'talent.contactsLimited': {
    uz: 'Kontaktlar cheklangan',
    ru: 'Контакты ограничены',
    en: 'Contacts limited',
  },
  'talent.chat': { uz: 'Chat', ru: 'Чат', en: 'Chat' },
  'talent.chatPremium': { uz: 'Chat (Premium)', ru: 'Чат (Premium)', en: 'Chat (Premium)' },
  'talent.coldChatRequiresPremium': {
    uz: 'Sovuq murojaat uchun Premium kerak',
    ru: 'Холодные сообщения доступны с Premium',
    en: 'Cold outreach requires Premium',
  },
  'talent.truncatedNote': {
    uz: 'Bu saralash bo‘yicha {m} tadan eng yaxshi {n} tasi ko‘rsatilmoqda',
    ru: 'Показаны первые {n} из {m} совпадений для этой сортировки',
    en: 'Showing top {n} of {m} matches for this sort',
  },
  'talent.loadFailed': { uz: 'Yuklab bo‘lmadi', ru: 'Не удалось загрузить', en: 'Failed to load' },
  'talent.loadTalentFailed': {
    uz: 'Talentlarni yuklab bo‘lmadi',
    ru: 'Не удалось загрузить таланты',
    en: 'Failed to load talent',
  },

  'talent.profileOpenError': {
    uz: 'Bu profilni ochib bo‘lmadi',
    ru: 'Не удалось открыть профиль',
    en: 'Could not open this profile',
  },
  'talent.backToFindTalent': {
    uz: 'Talent qidiruviga qaytish',
    ru: 'Назад к поиску талантов',
    en: 'Back to Find talent',
  },
  'talent.desiredSalary': {
    uz: 'Kutilayotgan maosh',
    ru: 'Желаемая зарплата',
    en: 'Desired salary',
  },
  'talent.contactsHiddenPrefix': {
    uz: 'Kontaktlar yashirin -',
    ru: 'Контакты скрыты -',
    en: 'Contacts hidden -',
  },
  'talent.contactsHiddenUpgrade': {
    uz: 'Standard/Premium ga o‘ting',
    ru: 'перейдите на Standard/Premium',
    en: 'upgrade to Standard/Premium',
  },
  'talent.contactsHiddenSuffix': {
    uz: ', yoki nomzod ariza topshirgach ochiladi.',
    ru: ', либо они откроются после отклика кандидата.',
    en: ', or unlock after the candidate applies.',
  },
  'talent.revealContactsFailed': {
    uz: 'Kontaktlarni ko‘rsatib bo‘lmadi',
    ru: 'Не удалось показать контакты',
    en: 'Failed to reveal contacts',
  },
  'talent.upgradeForChat': {
    uz: 'Chat uchun tarifni oshiring',
    ru: 'Улучшите тариф для чата',
    en: 'Upgrade for Chat',
  },
  'talent.cvAfterApply': {
    uz: 'Ariza topshirgach ochiladi',
    ru: 'Доступно после отклика',
    en: 'Available after they apply',
  },
  'talent.matchBreakdown': {
    uz: 'Moslik tafsiloti',
    ru: 'Детали совпадения',
    en: 'Match breakdown',
  },
  'talent.about': { uz: 'Haqida', ru: 'О себе', en: 'About' },
  'talent.now': { uz: 'hozir', ru: 'сейчас', en: 'now' },
} as const;
