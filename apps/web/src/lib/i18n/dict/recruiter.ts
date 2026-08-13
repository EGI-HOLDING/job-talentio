/** Recruiter dashboard: jobs, pipeline, bulk comms, analytics, billing, company. */
export const recruiter = {
  // Dashboard navigation
  'rec.tabPipeline': { uz: 'Pipeline va moslik', ru: 'Пайплайн и подбор', en: 'Pipeline & match' },
  'rec.tabBulk': { uz: 'Ommaviy xabarlar', ru: 'Массовые рассылки', en: 'Bulk comms' },
  'rec.tabAnalytics': { uz: 'Analitika', ru: 'Аналитика', en: 'Analytics' },
  'rec.tabBilling': { uz: 'Tarif va to‘lov', ru: 'Тариф и оплата', en: 'Plan & billing' },
  'rec.orOpen': { uz: 'Yoki oching:', ru: 'Или откройте', en: 'Or open' },
  'rec.loading': { uz: 'Yuklanmoqda...', ru: 'Загрузка...', en: 'Loading...' },

  // Create / edit job form
  'rec.createJob': { uz: 'Ish e’lon qilish', ru: 'Создать вакансию', en: 'Create job' },
  'rec.description': { uz: 'Tavsif', ru: 'Описание', en: 'Description' },
  'rec.jobTitlePlaceholder': {
    uz: 'Masalan: Frontend Developer',
    ru: 'Например: Frontend Developer',
    en: 'e.g. Frontend Developer',
  },
  'rec.minYears': { uz: 'Minimal tajriba (yil)', ru: 'Мин. стаж (лет)', en: 'Min years' },
  'rec.salaryMin': { uz: 'Maosh (dan)', ru: 'Зарплата от', en: 'Salary min' },
  'rec.salaryMax': { uz: 'Maosh (gacha)', ru: 'Зарплата до', en: 'Salary max' },
  'rec.salaryMinPlaceholder': {
    uz: 'Masalan: 8.000.000',
    ru: 'Например: 8.000.000',
    en: 'e.g. 8.000.000',
  },
  'rec.salaryMaxPlaceholder': {
    uz: 'Masalan: 15.000.000',
    ru: 'Например: 15.000.000',
    en: 'e.g. 15.000.000',
  },
  'rec.salaryPeriod': { uz: 'Maosh davri', ru: 'Период зарплаты', en: 'Salary period' },
  'rec.periodMonthly': { uz: 'Oylik', ru: 'Ежемесячно', en: 'Monthly' },
  'rec.periodYearly': { uz: 'Yillik', ru: 'Ежегодно', en: 'Yearly' },
  'rec.periodHourly': { uz: 'Soatlik', ru: 'Почасовая', en: 'Hourly' },
  'rec.currency': { uz: 'Valyuta', ru: 'Валюта', en: 'Currency' },
  'rec.cityRuleHint': {
    uz: 'Masofaviy: shahar ixtiyoriy (yollash hududi yoki vaqt mintaqasi). Ofisda/Gibrid: chop etishdan oldin shahar majburiy.',
    ru: 'Удалённо: город необязателен (регион найма или часовой пояс). В офисе/гибрид: город обязателен до публикации.',
    en: 'Remote: city is optional (hiring region/timezone hub). Onsite/Hybrid: city required before publish.',
  },
  'rec.addSkillToJob': {
    uz: 'Ish e’loniga ko‘nikma qo‘shish',
    ru: 'Добавить навык к вакансии',
    en: 'Add skill to job',
  },
  'rec.createDraft': { uz: 'Qoralama yaratish', ru: 'Создать черновик', en: 'Create draft' },
  'rec.saveChanges': {
    uz: 'O‘zgarishlarni saqlash',
    ru: 'Сохранить изменения',
    en: 'Save changes',
  },

  // Optional extra language versions of one posting
  'rec.langVersionsTitle': {
    uz: 'Til versiyalari',
    ru: 'Языковые версии',
    en: 'Language versions',
  },
  'rec.langVersionsHint': {
    uz: 'Ixtiyoriy. Bu e’lonni boshqa tillarda ham chop etish mumkin - nomzod o‘z tilidagi versiyani ko‘radi.',
    ru: 'Необязательно. Эту вакансию можно опубликовать и на других языках - кандидат увидит версию на своём языке.',
    en: 'Optional. Publish this posting in other languages too - candidates see the version in their own language.',
  },
  'rec.langVersionsLoadFailed': {
    uz: 'Til versiyalarini yuklab bo‘lmadi',
    ru: 'Не удалось загрузить языковые версии',
    en: 'Could not load language versions',
  },
  'rec.langVersionSource': {
    uz: 'Asl til: {lang}',
    ru: 'Язык оригинала: {lang}',
    en: 'Source language: {lang}',
  },
  'rec.langVersionSourceRef': {
    uz: 'Asl sarlavha',
    ru: 'Заголовок оригинала',
    en: 'Source title',
  },
  'rec.langVersionSourceNote': {
    uz: 'Bu tildagi sarlavha va tavsif yuqoridagi asosiy shaklda tahrirlanadi.',
    ru: 'Заголовок и описание на этом языке редактируются в основной форме выше.',
    en: 'The title and description in this language are edited in the main form above.',
  },
  'rec.langVersionMissing': { uz: 'Qo‘shilmagan', ru: 'Не добавлено', en: 'Not added' },
  'rec.langVersionHuman': {
    uz: 'Qo‘lda saqlangan',
    ru: 'Сохранено вручную',
    en: 'Saved manually',
  },
  'rec.langVersionMachine': {
    uz: 'Avtomatik tarjima',
    ru: 'Автоперевод',
    en: 'Auto-translated',
  },
  'rec.langVersionMachineNote': {
    uz: 'Mashina tarjimasi. Matnni tekshirib, saqlash bilan tasdiqlang.',
    ru: 'Машинный перевод. Проверьте текст и подтвердите сохранением.',
    en: 'Machine translation. Review the text and save it to confirm.',
  },
  'rec.langVersionSave': {
    uz: 'Bu versiyani saqlash',
    ru: 'Сохранить эту версию',
    en: 'Save this version',
  },
  'rec.langVersionDelete': {
    uz: 'Versiyani o‘chirish',
    ru: 'Удалить версию',
    en: 'Delete version',
  },
  'rec.langVersionConfirmDelete': {
    uz: '{lang} versiyasi o‘chirilsinmi?',
    ru: 'Удалить версию ({lang})?',
    en: 'Delete the {lang} version?',
  },
  'rec.langVersionSaved': {
    uz: '{lang} versiyasi saqlandi',
    ru: 'Версия ({lang}) сохранена',
    en: '{lang} version saved',
  },
  'rec.langVersionSaveFailed': {
    uz: 'Til versiyasini saqlab bo‘lmadi',
    ru: 'Не удалось сохранить языковую версию',
    en: 'Could not save the language version',
  },
  'rec.langVersionDeleted': {
    uz: '{lang} versiyasi o‘chirildi',
    ru: 'Версия ({lang}) удалена',
    en: '{lang} version removed',
  },
  'rec.langVersionDeleteFailed': {
    uz: 'Til versiyasini o‘chirib bo‘lmadi',
    ru: 'Не удалось удалить языковую версию',
    en: 'Could not delete the language version',
  },
  'rec.langVersionFillBoth': {
    uz: '{lang} versiyasi uchun sarlavha va tavsifni to‘ldiring',
    ru: 'Заполните заголовок и описание для версии ({lang})',
    en: 'Add a title and a description for the {lang} version',
  },
  'rec.langVersionQuestion': {
    uz: 'Savol: {question}',
    ru: 'Вопрос: {question}',
    en: 'Question: {question}',
  },

  // Company profile blurb in extra languages (the legal name is never translated)
  'rec.companyLangVersionsTitle': {
    uz: 'Kompaniya tavsifi tillari',
    ru: 'Языки описания компании',
    en: 'Company description languages',
  },
  'rec.companyLangVersionsHint': {
    uz: 'Ixtiyoriy. Kompaniya nomi tarjima qilinmaydi - faqat tavsif.',
    ru: 'Необязательно. Название компании не переводится - только описание.',
    en: 'Optional. The company name is never translated - only the description.',
  },
  'rec.companyLangVersionFill': {
    uz: '{lang} versiyasi uchun tavsifni to‘ldiring',
    ru: 'Заполните описание для версии ({lang})',
    en: 'Add a description for the {lang} version',
  },
  'rec.localeNameUz': { uz: 'O‘zbekcha', ru: 'Узбекский', en: 'Uzbek' },
  'rec.localeNameRu': { uz: 'Ruscha', ru: 'Русский', en: 'Russian' },
  'rec.localeNameEn': { uz: 'Inglizcha', ru: 'Английский', en: 'English' },

  // Job list
  'rec.yourJobs': { uz: 'Sizning ish e’lonlaringiz', ru: 'Ваши вакансии', en: 'Your jobs' },
  'rec.appsWord': { uz: 'ariza', ru: 'откликов', en: 'apps' },
  'rec.viewsWord': { uz: 'ko‘rish', ru: 'просмотров', en: 'views' },
  'rec.applicationsWord': { uz: 'ariza', ru: 'откликов', en: 'applications' },
  'rec.hotUntil': {
    uz: 'Dolzarb: {date} gacha',
    ru: 'Горячая до {date}',
    en: 'Hot until {date}',
  },
  'rec.publish': { uz: 'Chop etish', ru: 'Опубликовать', en: 'Publish' },
  'rec.reopen': { uz: 'Qayta ochish', ru: 'Открыть снова', en: 'Reopen' },
  'rec.resumeJob': { uz: 'Davom ettirish', ru: 'Возобновить', en: 'Resume' },
  'rec.pause': { uz: 'To‘xtatib turish', ru: 'Приостановить', en: 'Pause' },
  'rec.closeJob': { uz: 'Yopish', ru: 'Закрыть', en: 'Close' },
  'rec.edit': { uz: 'Tahrirlash', ru: 'Редактировать', en: 'Edit' },
  'rec.cancelEdit': {
    uz: 'Tahrirni bekor qilish',
    ru: 'Отменить редактирование',
    en: 'Cancel edit',
  },
  'rec.pipeline': { uz: 'Pipeline', ru: 'Пайплайн', en: 'Pipeline' },
  'rec.boostDays': { uz: '{n} kunga ko‘tarish', ru: 'Продвинуть на {n} дн', en: 'Boost {n}d' },

  // Job + billing flash messages
  'rec.jobCreatedDraft': {
    uz: 'Ish e’loni qoralama sifatida yaratildi',
    ru: 'Вакансия создана как черновик',
    en: 'Job created as DRAFT',
  },
  'rec.jobUpdated': { uz: 'Ish e’loni yangilandi', ru: 'Вакансия обновлена', en: 'Job updated' },
  'rec.jobUpdateFailed': {
    uz: 'Ish e’lonini yangilab bo‘lmadi',
    ru: 'Не удалось обновить вакансию',
    en: 'Job update failed',
  },
  'rec.jobStatusFailed': {
    uz: 'Ish e’loni holatini yangilab bo‘lmadi',
    ru: 'Не удалось изменить статус вакансии',
    en: 'Failed to update job status',
  },
  'rec.jobPublished': {
    uz: 'Ish e’loni chop etildi',
    ru: 'Вакансия опубликована',
    en: 'Job published',
  },
  'rec.jobReopened': {
    uz: 'Ish e’loni qayta ochildi',
    ru: 'Вакансия открыта снова',
    en: 'Job reopened',
  },
  'rec.jobResumed': {
    uz: 'Ish e’loni davom ettirildi',
    ru: 'Вакансия возобновлена',
    en: 'Job resumed',
  },
  'rec.jobPaused': {
    uz: 'Ish e’loni to‘xtatildi',
    ru: 'Вакансия приостановлена',
    en: 'Job paused',
  },
  'rec.jobClosed': { uz: 'Ish e’loni yopildi', ru: 'Вакансия закрыта', en: 'Job closed' },
  'rec.planUpgraded': {
    uz: '{plan} tarifiga o‘tildi',
    ru: 'Тариф изменён на {plan}',
    en: 'Upgraded to {plan}',
  },
  'rec.upgradeFailed': {
    uz: 'Tarifni oshirib bo‘lmadi',
    ru: 'Не удалось повысить тариф',
    en: 'Upgrade failed',
  },
  'rec.hotBoostActivated': {
    uz: '{n} kunlik ko‘tarish yoqildi',
    ru: 'Продвижение на {n} дн активировано',
    en: 'Hot boost {n}d activated',
  },
  'rec.hotBoostFailed': {
    uz: 'Ko‘tarishni yoqib bo‘lmadi',
    ru: 'Не удалось активировать продвижение',
    en: 'Hot boost failed',
  },
  'rec.interviewScheduled': {
    uz: 'Suhbat rejalashtirildi',
    ru: 'Собеседование назначено',
    en: 'Interview scheduled',
  },

  // Pipeline
  'rec.pipelineTitle': {
    uz: 'Pipeline va moslik',
    ru: 'Пайплайн и подбор',
    en: 'Pipeline & matching',
  },
  'rec.pipelineSubtitle': {
    uz: 'Nomzodlarni bosqichlar bo‘ylab siljiting va shu ish e’loni bo‘yicha moslik ballarini ko‘ring.',
    ru: 'Перемещайте кандидатов по этапам и смотрите баллы совпадения по этой вакансии.',
    en: 'Move applicants through stages and review match scores for this job.',
  },
  'rec.jobPost': { uz: 'Ish e’loni', ru: 'Вакансия', en: 'Job post' },
  'rec.selectJobPost': {
    uz: 'Ish e’lonini tanlang',
    ru: 'Выберите вакансию',
    en: 'Select job post',
  },
  'rec.noJobsYet': { uz: 'Hozircha ish e’lonlari yo‘q', ru: 'Вакансий пока нет', en: 'No jobs yet' },
  'rec.pipelineEmpty': {
    uz: 'Pipeline’ni ochish uchun ish e’loni yarating yoki tanlang.',
    ru: 'Создайте или выберите вакансию, чтобы открыть пайплайн.',
    en: 'Create or select a job post to open the pipeline.',
  },
  'rec.noCandidates': { uz: 'Nomzodlar yo‘q', ru: 'Нет кандидатов', en: 'No candidates' },
  'rec.candidateFallback': { uz: 'Nomzod', ru: 'Кандидат', en: 'Candidate' },
  'rec.selectCandidate': { uz: '{name}ni tanlash', ru: 'Выбрать {name}', en: 'Select {name}' },
  'rec.selectAllIn': {
    uz: '{name} bosqichidagi barchasini tanlash',
    ru: 'Выбрать всех на этапе {name}',
    en: 'Select all in {name}',
  },
  'rec.statusFor': { uz: '{name} uchun holat', ru: 'Статус для {name}', en: 'Status for {name}' },
  'rec.matchDetails': {
    uz: 'Moslik {n}% | tafsilotlar',
    ru: 'Совпадение {n}% | детали',
    en: 'Match {n}% | details',
  },
  'rec.chat': { uz: 'Chat', ru: 'Чат', en: 'Chat' },
  'rec.interviewTime': {
    uz: 'Suhbat vaqti',
    ru: 'Время собеседования',
    en: 'Interview time',
  },
  'rec.meetingUrl': { uz: 'Uchrashuv havolasi', ru: 'Ссылка на встречу', en: 'Meeting URL' },
  'rec.meetingUrlPlaceholder': { uz: 'Meet havolasi', ru: 'Ссылка Meet', en: 'Meet URL' },
  'rec.scheduleInterview': {
    uz: 'Suhbat belgilash',
    ru: 'Назначить собеседование',
    en: 'Schedule interview',
  },
  'rec.recommendedCandidates': {
    uz: 'Tavsiya etilgan nomzodlar',
    ru: 'Рекомендуемые кандидаты',
    en: 'Recommended candidates',
  },
  'rec.recommendedSubtitle': {
    uz: 'Hali ariza bermagan, lekin yaxshi mos keladigan nomzodlar.',
    ru: 'Хорошо подходящие кандидаты, которые ещё не откликнулись.',
    en: 'Strong matches who have not applied yet.',
  },
  'rec.suggestedCount': { uz: '{n} ta taklif', ru: 'Предложено: {n}', en: '{n} suggested' },
  'rec.recommendedEmpty': {
    uz: 'Hozircha tavsiyalar yo‘q. Moslikni yaxshilash uchun ish e’loniga kerakli ko‘nikmalarni qo‘shing.',
    ru: 'Пока нет рекомендаций. Добавьте требуемые навыки в вакансию, чтобы улучшить подбор.',
    en: 'No recommendations yet. Add required skills on the job post to improve matching.',
  },
  'rec.coldChatLocked': {
    uz: 'Sovuq murojaat uchun Premium kerak - Tarif va to‘lov bo‘limida oshiring',
    ru: 'Холодные сообщения доступны с Premium - повысьте тариф в разделе Тариф и оплата',
    en: 'Cold outreach requires Premium - upgrade in Plan & billing',
  },
  'rec.chatPremium': { uz: 'Chat (Premium)', ru: 'Чат (Premium)', en: 'Chat (Premium)' },

  // Bulk actions on the pipeline
  'rec.selectedCount': { uz: '{n} ta tanlandi', ru: 'Выбрано: {n}', en: '{n} selected' },
  'rec.clear': { uz: 'Tozalash', ru: 'Очистить', en: 'Clear' },
  'rec.templatesHistory': {
    uz: 'Shablonlar va tarix',
    ru: 'Шаблоны и история',
    en: 'Templates & history',
  },
  'rec.moveToStage': { uz: 'Bosqichga o‘tkazish', ru: 'Перевести на этап', en: 'Move to stage' },
  'rec.bulkTargetStage': {
    uz: 'Ommaviy amal uchun bosqich',
    ru: 'Целевой этап массового действия',
    en: 'Bulk target stage',
  },
  'rec.keepStage': { uz: '- Bosqich o‘zgarmasin -', ru: '- Оставить этап -', en: '- Keep stage -' },
  'rec.template': { uz: 'Shablon', ru: 'Шаблон', en: 'Template' },
  'rec.bulkTemplateAria': {
    uz: 'Ommaviy xabar shabloni',
    ru: 'Шаблон массового сообщения',
    en: 'Bulk message template',
  },
  'rec.customNone': { uz: '- Boshqa / yo‘q -', ru: '- Свой / нет -', en: '- Custom / none -' },
  'rec.messageOptional': {
    uz: 'Xabar (ixtiyoriy)',
    ru: 'Сообщение (необязательно)',
    en: 'Message (optional)',
  },
  'rec.bulkMessagePlaceholder': {
    uz: 'Salom {{name}}, ...',
    ru: 'Здравствуйте, {{name}}, ...',
    en: 'Hi {{name}}, ...',
  },
  'rec.running': { uz: 'Bajarilmoqda...', ru: 'Выполняется...', en: 'Running...' },
  'rec.applyToSelected': {
    uz: 'Tanlanganlarga qo‘llash',
    ru: 'Применить к выбранным',
    en: 'Apply to selected',
  },
  'rec.bulkOptOutNote': {
    uz: 'Ommaviy xabarlardan voz kechgan nomzodlarga chat yuborilmaydi (GDPR), lekin ularni bosqichlar bo‘ylab siljitish mumkin.',
    ru: 'Кандидатам, отказавшимся от массовых сообщений, чат не отправляется (GDPR), но их можно перемещать по этапам.',
    en: 'Candidates who opted out of bulk messaging are skipped for chat (GDPR) but can still be moved.',
  },
  'rec.bulkChooseTarget': {
    uz: 'Maqsadli bosqich va/yoki xabar yoki shablon tanlang',
    ru: 'Выберите целевой этап и/или сообщение либо шаблон',
    en: 'Choose a target stage and/or a message/template',
  },
  'rec.bulkDoneSent': {
    uz: 'Ommaviy amal bajarildi: {n} ta yuborildi',
    ru: 'Массовое действие выполнено: отправлено {n}',
    en: 'Bulk action done: {n} sent',
  },
  'rec.bulkDoneSkipped': {
    uz: ', {n} ta voz kechgan',
    ru: ', {n} отказались',
    en: ', {n} opted out',
  },
  'rec.bulkDoneFailed': { uz: ', {n} ta xato', ru: ', {n} с ошибкой', en: ', {n} failed' },
  'rec.bulkActionFailed': {
    uz: 'Ommaviy amal bajarilmadi',
    ru: 'Массовое действие не выполнено',
    en: 'Bulk action failed',
  },

  // Analytics
  'rec.jobAnalytics': {
    uz: 'Ish e’loni analitikasi',
    ru: 'Аналитика вакансии',
    en: 'Job analytics',
  },
  'rec.plan': { uz: 'Tarif', ru: 'Тариф', en: 'Plan' },
  'rec.currentPlan': { uz: 'Joriy tarif', ru: 'Текущий тариф', en: 'Current plan' },
  'rec.publishedJobs': {
    uz: 'Chop etilgan e’lonlar',
    ru: 'Опубликованные вакансии',
    en: 'Published jobs',
  },
  'rec.managePlanBilling': {
    uz: 'Tarif va to‘lovni boshqarish',
    ru: 'Управлять тарифом и оплатой',
    en: 'Manage plan & billing',
  },

  // Plan & billing
  'rec.renewsEnds': {
    uz: 'yangilanadi/tugaydi {date}',
    ru: 'продление/окончание {date}',
    en: 'renews/ends {date}',
  },
  'rec.demoCheckoutNote': {
    uz: 'Demo to‘lov (sinov rejimi). Haqiqiy Payme/Click keyinroq.',
    ru: 'Демо-оплата (тестовый режим). Реальные Payme/Click позже.',
    en: 'Demo checkout (mock payments). Real Payme/Click later.',
  },
  'rec.free': { uz: 'Bepul', ru: 'Бесплатно', en: 'Free' },
  'rec.perMonth': { uz: '/oyiga', ru: '/мес', en: '/mo' },
  'rec.upgradeTo': {
    uz: '{plan} tarifiga o‘tish',
    ru: 'Перейти на {plan}',
    en: 'Upgrade to {plan}',
  },
  'rec.included': { uz: 'Kiritilgan', ru: 'Включено', en: 'Included' },
  'rec.alreadyHigherPlan': {
    uz: 'Yuqoriroq tarifdasiz',
    ru: 'У вас более высокий тариф',
    en: 'Already on higher plan',
  },
  'rec.hotJobBoosts': {
    uz: 'E’lonni ko‘tarish',
    ru: 'Продвижение вакансий',
    en: 'Hot job boosts',
  },
  'rec.hotBoostHint': {
    uz: 'Chop etilgan e’lonni Ish o‘rinlari bo‘limidan ko‘taring yoki quyidan tanlang.',
    ru: 'Продвиньте опубликованную вакансию во вкладке вакансий или выберите ниже.',
    en: 'Boost a published job from the Jobs tab, or pick one below.',
  },
  'rec.noPublishedJobs': {
    uz: 'Hozircha chop etilgan e’lon yo‘q.',
    ru: 'Пока нет опубликованных вакансий.',
    en: 'No published jobs yet.',
  },
  'rec.daysShort': { uz: '{n} kun', ru: '{n} дн', en: '{n}d' },

  // Plan feature lists
  'rec.planFeature1Job': { uz: '1 ta faol e’lon', ru: '1 активная вакансия', en: '1 active job' },
  'rec.planFeature5Jobs': { uz: '5 ta faol e’lon', ru: '5 активных вакансий', en: '5 active jobs' },
  'rec.planFeature20Jobs': {
    uz: '20 ta faol e’lon',
    ru: '20 активных вакансий',
    en: '20 active jobs',
  },
  'rec.planFeature50Jobs': {
    uz: '50 ta faol e’lon',
    ru: '50 активных вакансий',
    en: '50 active jobs',
  },
  'rec.planFeatureContactsBlurred': {
    uz: 'Nomzod kontaktlari yashirilgan',
    ru: 'Контакты кандидатов скрыты',
    en: 'Blurred candidate contacts',
  },
  'rec.planFeatureContactsFull': {
    uz: 'Nomzod kontaktlari to‘liq',
    ru: 'Полные контакты кандидатов',
    en: 'Full candidate contacts',
  },
  'rec.planFeatureNoColdChat': {
    uz: 'Sovuq chat yo‘q',
    ru: 'Без холодных сообщений',
    en: 'No cold chat',
  },
  'rec.planFeatureColdChat20': {
    uz: 'Sovuq chat (kuniga 20 ta)',
    ru: 'Холодные сообщения (20 в день)',
    en: 'Cold chat (20/day)',
  },
  'rec.planFeatureColdChat50': {
    uz: 'Sovuq chat (kuniga 50 ta)',
    ru: 'Холодные сообщения (50 в день)',
    en: 'Cold chat (50/day)',
  },
  'rec.planFeatureVipBadge': {
    uz: 'VIP nishoni va Top kompaniyalar',
    ru: 'VIP-значок и Топ компании',
    en: 'VIP badge + Top Companies',
  },

  // Company tab
  'rec.members': { uz: 'A’zolar', ru: 'Участники', en: 'Members' },
  'rec.followers': { uz: 'Kuzatuvchilar', ru: 'Подписчики', en: 'Followers' },
  'rec.publicPage': { uz: 'Ommaviy sahifa', ru: 'Публичная страница', en: 'Public page' },
  'rec.companyLogo': { uz: 'Kompaniya logosi', ru: 'Логотип компании', en: 'Company logo' },
  'rec.editCompanyProfile': {
    uz: 'Kompaniya profilini tahrirlash',
    ru: 'Редактировать профиль компании',
    en: 'Edit company profile',
  },
  'rec.saveCompany': { uz: 'Kompaniyani saqlash', ru: 'Сохранить компанию', en: 'Save company' },
  'rec.companyUpdated': {
    uz: 'Kompaniya profili yangilandi',
    ru: 'Профиль компании обновлён',
    en: 'Company profile updated',
  },
  'rec.logoUpdated': { uz: 'Logo yangilandi', ru: 'Логотип обновлён', en: 'Logo updated' },
  'rec.team': { uz: 'Jamoa', ru: 'Команда', en: 'Team' },
  'rec.remove': { uz: 'Olib tashlash', ru: 'Удалить', en: 'Remove' },
  'rec.confirmRemoveMember': {
    uz: 'Bu jamoa a’zosi olib tashlansinmi?',
    ru: 'Удалить этого участника команды?',
    en: 'Remove this team member?',
  },
  'rec.memberRemoved': { uz: 'A’zo olib tashlandi', ru: 'Участник удалён', en: 'Member removed' },
  'rec.removeFailed': {
    uz: 'Olib tashlab bo‘lmadi',
    ru: 'Не удалось удалить',
    en: 'Remove failed',
  },
  'rec.inviteByEmail': {
    uz: 'Email orqali taklif qilish',
    ru: 'Пригласить по email',
    en: 'Invite by email',
  },
  'rec.inviteRole': { uz: 'Rol', ru: 'Роль', en: 'Role' },
  'rec.roleRecruiter': { uz: 'Rekruter', ru: 'Рекрутер', en: 'Recruiter' },
  'rec.roleAdmin': { uz: 'Admin', ru: 'Админ', en: 'Admin' },
  'rec.inviteEmailLanguage': {
    uz: 'Email tili',
    ru: 'Язык письма',
    en: 'Email language',
  },
  'rec.inviteMember': { uz: 'A’zo taklif qilish', ru: 'Пригласить участника', en: 'Invite member' },
  'rec.inviting': { uz: 'Yuborilmoqda...', ru: 'Отправка...', en: 'Inviting...' },
  'rec.memberInvited': {
    uz: 'Taklif emaili yuborildi',
    ru: 'Письмо с приглашением отправлено',
    en: 'Invitation email sent',
  },
  'rec.memberAdded': {
    uz: 'Jamoa a’zosi qo‘shildi',
    ru: 'Участник добавлен в команду',
    en: 'Team member added',
  },
  'rec.inviteFailed': {
    uz: 'Taklifni yuborib bo‘lmadi',
    ru: 'Не удалось отправить приглашение',
    en: 'Invite failed',
  },
  'rec.pendingInvites': {
    uz: 'Kutilayotgan takliflar',
    ru: 'Ожидающие приглашения',
    en: 'Pending invitations',
  },
  'rec.resendInvite': { uz: 'Qayta yuborish', ru: 'Отправить ещё раз', en: 'Resend' },
  'rec.cancelInvite': { uz: 'Bekor qilish', ru: 'Отменить', en: 'Cancel' },
  'rec.inviteCancelled': {
    uz: 'Taklif bekor qilindi',
    ru: 'Приглашение отменено',
    en: 'Invitation cancelled',
  },
  'rec.noPendingInvites': {
    uz: 'Kutilayotgan taklif yo‘q',
    ru: 'Нет ожидающих приглашений',
    en: 'No pending invitations',
  },
} as const;
