/** Job search list and job detail page. */
export const jobs = {
  'job.negotiable': { uz: 'Kelishilgan', ru: 'По договорённости', en: 'Negotiable' },

  'job.salaryMin': { uz: 'Maosh (min)', ru: 'Зарплата от', en: 'Salary min' },
  'job.salaryMax': { uz: 'Maosh (maks)', ru: 'Зарплата до', en: 'Salary max' },
  'job.salaryMinPlaceholder': {
    uz: 'masalan 5.000.000',
    ru: 'например 5.000.000',
    en: 'e.g. 5.000.000',
  },
  'job.salaryMaxPlaceholder': {
    uz: 'masalan 20.000.000',
    ru: 'например 20.000.000',
    en: 'e.g. 20.000.000',
  },

  'job.sortRelevance': { uz: 'Moslik bo‘yicha', ru: 'По релевантности', en: 'Relevance' },
  'job.sortNewest': { uz: 'Eng yangi', ru: 'Сначала новые', en: 'Newest' },
  'job.sortSalaryHigh': { uz: 'Maosh (yuqori)', ru: 'Зарплата (выше)', en: 'Salary high' },
  'job.sortSalaryLow': { uz: 'Maosh (past)', ru: 'Зарплата (ниже)', en: 'Salary low' },
  'job.sortBestMatch': { uz: 'Eng mos', ru: 'Лучшее совпадение', en: 'Best match' },
  'job.perPage': { uz: '{n} / sahifa', ru: '{n} / стр.', en: '{n} / page' },

  'job.hotEndsToday': {
    uz: 'Bugun tugaydi - shoshiling',
    ru: 'Заканчивается сегодня - откликнитесь',
    en: 'Ends today - apply soon',
  },
  'job.hotDaysLeft': {
    uz: 'Atigi {n} kun qoldi',
    ru: 'Осталось всего {n} дн.',
    en: 'Only {n} days left',
  },
  'job.hotMoreDays': {
    uz: 'Yana {n} kun dolzarb',
    ru: 'Горячая ещё {n} дн.',
    en: 'Hot for {n} more days',
  },
  'job.hotLimitedBoost': {
    uz: 'Cheklangan muddatga ko‘tarilgan',
    ru: 'Продвижение на ограниченное время',
    en: 'Limited-time boost',
  },
  'job.boostedUntil': {
    uz: '{date} gacha ko‘tarilgan - muddat cheklangan',
    ru: 'Продвигается до {date} - время ограничено',
    en: 'Boosted until {date} - limited window',
  },

  'job.noResults': {
    uz: 'Bu filtrlarga mos ish topilmadi. Ba’zilarini olib tashlab ko‘ring.',
    ru: 'По этим фильтрам вакансий нет. Попробуйте сбросить часть из них.',
    en: 'No jobs match these filters. Try clearing some.',
  },
  'job.truncatedNote': {
    uz: 'Bu saralash uchun {m} ta moslikdan eng yaxshi {n} tasi ko‘rsatilmoqda',
    ru: 'Показаны первые {n} из {m} совпадений для этой сортировки',
    en: 'Showing top {n} of {m} matches for this sort',
  },

  'job.viewsAndApplicants': {
    uz: '{n} ko‘rish | {m} nomzod',
    ru: '{n} просмотров | {m} откликов',
    en: '{n} views | {m} applicants',
  },
  'job.appliedBadge': { uz: 'Ariza berilgan', ru: 'Отклик отправлен', en: 'Applied' },
  'job.viewMyApplications': {
    uz: 'Arizalarimni ko‘rish',
    ru: 'Мои отклики',
    en: 'View my applications',
  },
  'job.aboutTheRole': { uz: 'Lavozim haqida', ru: 'О вакансии', en: 'About the role' },
  'job.yourMatch': { uz: 'Sizning mosligingiz', ru: 'Ваше совпадение', en: 'Your match' },
  'job.yourMatchHint': {
    uz: 'Profilingiz ushbu lavozimga qanchalik mos kelishi',
    ru: 'Насколько ваш профиль подходит этой вакансии',
    en: 'How your profile scores against this role',
  },
  'job.noBenefits': {
    uz: 'Imtiyozlar ko‘rsatilmagan',
    ru: 'Льготы не указаны',
    en: 'No benefits listed',
  },
  'job.yearsPreferred': {
    uz: '{n}+ yil tajriba afzal',
    ru: 'Желательно от {n} лет опыта',
    en: '{n}+ years preferred',
  },

  'job.applySuccess': {
    uz: 'Ariza yuborildi! Rekruter uchun moslik balli hisoblandi.',
    ru: 'Отклик отправлен! Балл совпадения рассчитан для рекрутера.',
    en: 'Application submitted! Match score was calculated for the recruiter.',
  },
  'job.savedToList': {
    uz: 'Ish saqlanganlar ro‘yxatiga qo‘shildi.',
    ru: 'Вакансия сохранена в вашем списке.',
    en: 'Job saved to your list.',
  },
  'job.resumeDraftCreated': {
    uz: 'Rezyume qoralamasi yaratildi. Fayl bilan ariza berish uchun builderdan PDF eksport qiling yoki PDFsiz davom eting.',
    ru: 'Черновик резюме создан. Экспортируйте PDF из конструктора, чтобы откликнуться с файлом, или продолжите без PDF.',
    en: 'Resume draft created. Export a PDF from the builder before applying with a file, or continue without a PDF.',
  },
  'job.resume': { uz: 'Rezyume', ru: 'Резюме', en: 'Resume' },
  'job.noResumesOnProfile': {
    uz: 'Profilda rezyume yo‘q',
    ru: 'В профиле нет резюме',
    en: 'No resumes on profile',
  },
  'job.resumePrimary': { uz: 'asosiy', ru: 'основное', en: 'primary' },
  'job.resumeNoPdf': { uz: 'PDF yo‘q', ru: 'без PDF', en: 'no PDF' },
  'job.resumeNoPdfWarning': {
    uz: 'Tanlangan rezyumeda hali PDF fayl yo‘q. Ariza berishdan oldin builderdan eksport qiling yoki fayl biriktiring.',
    ru: 'У выбранного резюме пока нет PDF. Экспортируйте его из конструктора или прикрепите файл перед откликом.',
    en: 'Selected resume has no PDF file yet. Export from the resume builder or attach a file before applying.',
  },
  'job.selectOption': { uz: 'Tanlang...', ru: 'Выберите...', en: 'Select...' },
  'job.yes': { uz: 'Ha', ru: 'Да', en: 'Yes' },
  'job.no': { uz: 'Yo‘q', ru: 'Нет', en: 'No' },
  'job.submitting': { uz: 'Yuborilmoqda...', ru: 'Отправка...', en: 'Submitting...' },
} as const;
