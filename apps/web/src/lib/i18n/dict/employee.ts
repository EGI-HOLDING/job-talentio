/** Employee dashboard and resume builder. */
export const employee = {
  // Toasts and inline messages
  'emp.profileUpdated': { uz: 'Profil yangilandi', ru: 'Профиль обновлён', en: 'Profile updated' },
  'emp.skillResolvedSaved': {
    uz: '“{name}” ko‘nikmasi aniqlandi va saqlandi',
    ru: 'Навык «{name}» распознан и сохранён',
    en: 'Skill “{name}” resolved and saved',
  },
  'emp.skillAdded': {
    uz: '“{name}” ko‘nikmasi qo‘shildi',
    ru: 'Навык «{name}» добавлен',
    en: 'Skill “{name}” added',
  },
  'emp.languageResolvedSaved': {
    uz: '“{name}” tili aniqlandi va saqlandi',
    ru: 'Язык «{name}» распознан и сохранён',
    en: 'Language “{name}” resolved and saved',
  },
  'emp.languageAdded': {
    uz: '“{name}” tili qo‘shildi',
    ru: 'Язык «{name}» добавлен',
    en: 'Language “{name}” added',
  },
  'emp.cvRemoved': {
    uz: 'CV kutubxonangizdan olib tashlandi',
    ru: 'CV удалено из вашей библиотеки',
    en: 'CV removed from your library',
  },
  'emp.cvImported': {
    uz: 'Tanlangan CV ma’lumotlari profilingizga import qilindi',
    ru: 'Выбранные данные CV импортированы в профиль',
    en: 'Selected CV data imported into your profile',
  },
  'emp.deleteFailed': { uz: 'O‘chirib bo‘lmadi', ru: 'Не удалось удалить', en: 'Delete failed' },
  'emp.uploadFailed': { uz: 'Yuklab bo‘lmadi', ru: 'Не удалось загрузить', en: 'Upload failed' },
  'emp.attachFailed': {
    uz: 'Faylni biriktirib bo‘lmadi',
    ru: 'Не удалось прикрепить файл',
    en: 'Attach failed',
  },
  'emp.uploading': { uz: 'Yuklanmoqda...', ru: 'Загрузка...', en: 'Uploading...' },
  'emp.experienceAdded': { uz: 'Tajriba qo‘shildi', ru: 'Опыт добавлен', en: 'Experience added' },
  'emp.experienceUpdated': { uz: 'Tajriba yangilandi', ru: 'Опыт обновлён', en: 'Experience updated' },
  'emp.educationAdded': {
    uz: 'Ta’lim qo‘shildi',
    ru: 'Образование добавлено',
    en: 'Education added',
  },
  'emp.educationUpdated': {
    uz: 'Ta’lim yangilandi',
    ru: 'Образование обновлено',
    en: 'Education updated',
  },
  'emp.certificationAdded': {
    uz: 'Sertifikat qo‘shildi',
    ru: 'Сертификат добавлен',
    en: 'Certification added',
  },
  'emp.certificationUpdated': {
    uz: 'Sertifikat yangilandi',
    ru: 'Сертификат обновлён',
    en: 'Certification updated',
  },
  'emp.primaryResumeUpdated': {
    uz: 'Asosiy resume yangilandi',
    ru: 'Основное резюме обновлено',
    en: 'Primary resume updated',
  },

  // Overview
  'emp.profileStrength': {
    uz: 'Profil to‘liqligi',
    ru: 'Заполненность профиля',
    en: 'Profile strength',
  },
  'emp.profileStrengthHint': {
    uz: 'Bu foiz profilingiz qanchalik to‘liq ekanini ko‘rsatadi, chop etilgan ishlarga mosligini emas.',
    ru: 'Этот процент показывает заполненность профиля, а не совпадение с опубликованными вакансиями.',
    en: 'This percent is how complete your profile is, not how well you match published jobs.',
  },
  'emp.quickStats': { uz: 'Qisqacha statistika', ru: 'Краткая статистика', en: 'Quick stats' },
  'emp.statApplications': { uz: 'ta ariza', ru: 'откликов', en: 'applications' },
  'emp.statRecommendedJobs': {
    uz: 'ta tavsiya etilgan ish',
    ru: 'рекомендованных вакансий',
    en: 'recommended jobs',
  },
  'emp.statSkills': { uz: 'ta ko‘nikma', ru: 'навыков', en: 'skills' },
  'emp.upcomingInterviews': {
    uz: 'Yaqin suhbatlar',
    ru: 'Ближайшие собеседования',
    en: 'Upcoming interviews',
  },

  // Profile completeness checklist
  'emp.checkAddEmail': {
    uz: 'Email qo‘shing',
    ru: 'Добавьте email',
    en: 'Add your email',
  },
  'emp.checkVerifyEmail': {
    uz: 'Emailingizni tasdiqlang',
    ru: 'Подтвердите email',
    en: 'Verify your email',
  },
  'emp.checkAddPhoto': {
    uz: 'Profil rasmini qo‘shing',
    ru: 'Добавьте фото профиля',
    en: 'Add a profile photo',
  },
  'emp.checkAddHeadline': {
    uz: 'Sarlavha qo‘shing',
    ru: 'Добавьте заголовок',
    en: 'Add a headline',
  },
  'emp.checkSetCity': { uz: 'Shaharni tanlang', ru: 'Укажите город', en: 'Set your city' },
  'emp.checkAddSkills': {
    uz: 'Kamida 3 ta ko‘nikma qo‘shing',
    ru: 'Добавьте минимум 3 навыка',
    en: 'Add at least 3 skills',
  },
  'emp.checkAddExperience': {
    uz: 'Ish tajribasini qo‘shing',
    ru: 'Добавьте опыт работы',
    en: 'Add work experience',
  },
  'emp.checkAddEducation': {
    uz: 'Ta’limni qo‘shing',
    ru: 'Добавьте образование',
    en: 'Add education',
  },
  'emp.checkAddLanguage': { uz: 'Til qo‘shing', ru: 'Добавьте язык', en: 'Add a language' },
  'emp.checkAddResume': {
    uz: 'Resume yuklang yoki yarating',
    ru: 'Загрузите или создайте резюме',
    en: 'Upload or create a resume',
  },

  // Recommended jobs
  'emp.jobsMatchedTitle': {
    uz: 'Profilingizga mos ishlar',
    ru: 'Вакансии по вашему профилю',
    en: 'Jobs matched to your profile',
  },
  'emp.details': { uz: 'batafsil', ru: 'подробнее', en: 'details' },
  'emp.recommendedEmpty': {
    uz: 'Mos ishlarni ko‘rish uchun profilingizga ko‘nikma qo‘shing. Ko‘nikmalaringiz chop etilgan vakansiyalarga mos kelmaguncha tavsiyalar bo‘sh qoladi.',
    ru: 'Добавьте навыки в профиль, чтобы получать подходящие вакансии. Рекомендации остаются пустыми, пока ваши навыки не совпадут с опубликованными вакансиями.',
    en: 'Add skills to your profile to get job matches. Recommendations stay empty until your skills overlap with published roles.',
  },
  'emp.recommendedEmptyNoOverlap': {
    uz: 'Hozircha sarlavhangiz yoki ko‘nikmalaringizga mos ochiq ish yo‘q. Barcha e’lonlarni ko‘rish uchun',
    ru: 'Пока нет опубликованных вакансий, совпадающих с вашим заголовком или навыками. Смотреть все вакансии:',
    en: 'No published jobs overlap with your skills or headline yet. Browse all openings:',
  },

  // Applications
  'emp.myApplications': { uz: 'Mening arizalarim', ru: 'Мои отклики', en: 'My applications' },
  'emp.interview': { uz: 'Suhbat', ru: 'Собеседование', en: 'Interview' },
  'emp.withdraw': { uz: 'Qaytarib olish', ru: 'Отозвать', en: 'Withdraw' },
  'emp.withdrawConfirm': {
    uz: 'Bu ariza qaytarib olinsinmi?',
    ru: 'Отозвать этот отклик?',
    en: 'Withdraw this application?',
  },
  'emp.applicationWithdrawn': {
    uz: 'Ariza qaytarib olindi',
    ru: 'Отклик отозван',
    en: 'Application withdrawn',
  },
  'emp.withdrawFailed': {
    uz: 'Arizani qaytarib bo‘lmadi',
    ru: 'Не удалось отозвать отклик',
    en: 'Withdraw failed',
  },

  // Saved jobs
  'emp.savedEmpty': {
    uz: 'Siz hali birorta ishni saqlamagansiz.',
    ru: 'Вы ещё не сохранили ни одной вакансии.',
    en: 'You have not saved any jobs yet.',
  },
  'emp.remove': { uz: 'Olib tashlash', ru: 'Убрать', en: 'Remove' },

  // Job alerts
  'emp.createAlert': { uz: 'Ogohlantirish yaratish', ru: 'Создать оповещение', en: 'Create alert' },
  'emp.saveAlert': {
    uz: 'Ogohlantirishni saqlash',
    ru: 'Сохранить оповещение',
    en: 'Save alert',
  },
  'emp.deleteAlertConfirm': {
    uz: 'Bu ish ogohlantirishi o‘chirilsinmi?',
    ru: 'Удалить это оповещение о вакансиях?',
    en: 'Delete this job alert?',
  },
  'emp.keywords': { uz: 'Kalit so‘zlar', ru: 'Ключевые слова', en: 'Keywords' },
  'emp.addSkillToAlert': {
    uz: 'Ogohlantirishga ko‘nikma qo‘shish',
    ru: 'Добавить навык в оповещение',
    en: 'Add skill to alert',
  },
  'emp.frequency': { uz: 'Chastota', ru: 'Частота', en: 'Frequency' },
  'emp.daily': { uz: 'Har kuni', ru: 'Ежедневно', en: 'Daily' },
  'emp.weekly': { uz: 'Har hafta', ru: 'Еженедельно', en: 'Weekly' },
  'emp.anyCity': { uz: 'Istalgan shahar', ru: 'Любой город', en: 'Any city' },
  'emp.active': { uz: 'Faol', ru: 'Активно', en: 'Active' },
  'emp.paused': { uz: 'To‘xtatilgan', ru: 'Приостановлено', en: 'Paused' },
  'emp.pause': { uz: 'To‘xtatish', ru: 'Приостановить', en: 'Pause' },
  'emp.resumeAlert': { uz: 'Davom ettirish', ru: 'Возобновить', en: 'Resume' },
  'emp.delete': { uz: 'O‘chirish', ru: 'Удалить', en: 'Delete' },
  'emp.alertChannels': { uz: 'Qayerga yuborilsin', ru: 'Куда отправлять', en: 'Send to' },
  'emp.alertChannelInApp': { uz: 'Ilova', ru: 'В приложении', en: 'In-app' },
  'emp.alertChannelEmail': { uz: 'Email', ru: 'Email', en: 'Email' },
  'emp.alertChannelTelegram': { uz: 'Telegram', ru: 'Telegram', en: 'Telegram' },
  'emp.alertTelegramLinkHint': {
    uz: 'Avval Settings orqali Telegramni ulang.',
    ru: 'Сначала привяжите Telegram в настройках.',
    en: 'Link Telegram in Settings first.',
  },
  'emp.alertTelegramNotLinked': {
    uz: 'Telegram yoqilgan, lekin hisob ulanmagan.',
    ru: 'Telegram включён, но аккаунт не привязан.',
    en: 'Telegram is on, but this account is not linked yet.',
  },

  // Profile basics
  'emp.basics': { uz: 'Asosiy ma’lumotlar', ru: 'Основное', en: 'Basics' },
  'emp.basicsHint': {
    uz: 'Rekruterlar sizni birinchi qarashda shunday ko‘radi.',
    ru: 'Так вас видят рекрутеры с первого взгляда.',
    en: 'How recruiters see you at a glance.',
  },
  'emp.headline': { uz: 'Sarlavha', ru: 'Заголовок', en: 'Headline' },
  'emp.summary': { uz: 'Qisqacha ma’lumot', ru: 'О себе', en: 'Summary' },
  'emp.phone': { uz: 'Telefon', ru: 'Телефон', en: 'Phone' },
  'emp.visibility': { uz: 'Ko‘rinishi', ru: 'Видимость', en: 'Visibility' },
  'emp.visibilityPublic': { uz: 'Ochiq', ru: 'Публичный', en: 'Public' },
  'emp.visibilityRecruiters': {
    uz: 'Ro‘yxatdan o‘tgan rekruterlarga ko‘rinadi',
    ru: 'Виден зарегистрированным рекрутерам',
    en: 'Visible to registered recruiters',
  },
  'emp.visibilityPrivate': { uz: 'Yopiq', ru: 'Приватный', en: 'Private' },
  'emp.desiredPosition': {
    uz: 'Istalgan lavozim',
    ru: 'Желаемая должность',
    en: 'Desired position',
  },
  'emp.desiredSalary': {
    uz: 'Istalgan maosh (UZS)',
    ru: 'Желаемая зарплата (UZS)',
    en: 'Desired salary (UZS)',
  },
  'emp.desiredSalaryPlaceholder': {
    uz: 'masalan 12.000.000',
    ru: 'например 12.000.000',
    en: 'e.g. 12.000.000',
  },
  'emp.desiredSalaryAria': {
    uz: 'Istalgan maosh, UZS',
    ru: 'Желаемая зарплата в UZS',
    en: 'Desired salary in UZS',
  },
  'emp.saveBasics': {
    uz: 'Asosiy ma’lumotlarni saqlash',
    ru: 'Сохранить основное',
    en: 'Save basics',
  },

  // Import from CV
  'emp.importFromCv': { uz: 'CV dan import', ru: 'Импорт из CV', en: 'Import from CV' },
  'emp.importFromCvHint': {
    uz: 'Ko‘nikma, tajriba va ta’limni profilingizga o‘tkazish uchun PDF yuklang. Import qilishdan oldin tekshirib chiqing.',
    ru: 'Загрузите PDF, чтобы перенести навыки, опыт и образование в профиль. Проверьте данные перед импортом.',
    en: 'Upload a PDF to parse skills, experience, and education into your profile. Review before importing.',
  },

  // Career history
  'emp.careerHistory': { uz: 'Karyera tarixi', ru: 'Карьерная история', en: 'Career history' },
  'emp.careerHistoryHint': {
    uz: 'Tajriba, ta’lim, ko‘nikmalar va tillar - moslik va rekruterlar uchun shu yerda tahrirlang.',
    ru: 'Опыт, образование, навыки и языки - редактируйте здесь для подбора и рекрутеров.',
    en: 'Experience, education, skills, and languages - edit here for matching and recruiters.',
  },

  // Shared form actions and labels
  'emp.add': { uz: 'Qo‘shish', ru: 'Добавить', en: 'Add' },
  'emp.edit': { uz: 'Tahrirlash', ru: 'Изменить', en: 'Edit' },
  'emp.name': { uz: 'Nomi', ru: 'Название', en: 'Name' },
  'emp.description': { uz: 'Tavsif', ru: 'Описание', en: 'Description' },
  'emp.start': { uz: 'Boshlanishi', ru: 'Начало', en: 'Start' },
  'emp.end': { uz: 'Tugashi', ru: 'Окончание', en: 'End' },
  'emp.present': { uz: 'Hozirgacha', ru: 'по настоящее время', en: 'Present' },
  'emp.levelFor': { uz: '{name} uchun daraja', ru: 'Уровень для {name}', en: 'Level for {name}' },
  'emp.durationYears': { uz: '{n} yil', ru: '{n} г.', en: '{n}y' },
  'emp.durationMonths': { uz: '{n} oy', ru: '{n} мес.', en: '{n}mo' },

  // Skills
  'emp.noSkills': {
    uz: 'Hali ko‘nikma yo‘q - qo‘lda qo‘shing yoki CV dan import qiling.',
    ru: 'Навыков пока нет - добавьте вручную или импортируйте из CV.',
    en: 'No skills yet - add manually or import from CV.',
  },
  'emp.saveSkill': { uz: 'Ko‘nikmani saqlash', ru: 'Сохранить навык', en: 'Save skill' },

  // Work experience
  'emp.workExperience': { uz: 'Ish tajribasi', ru: 'Опыт работы', en: 'Work experience' },
  'emp.noExperience': { uz: 'Hali tajriba yo‘q.', ru: 'Опыта пока нет.', en: 'No experience yet.' },
  'emp.current': { uz: 'Hozirgi', ru: 'Текущее', en: 'Current' },
  'emp.positionTitle': { uz: 'Lavozim', ru: 'Должность', en: 'Title' },
  'emp.currentlyWorkHere': {
    uz: 'Hozir shu yerda ishlayman',
    ru: 'Работаю здесь сейчас',
    en: 'Currently work here',
  },
  'emp.saveExperience': { uz: 'Tajribani saqlash', ru: 'Сохранить опыт', en: 'Save experience' },
  'emp.updateExperience': { uz: 'Tajribani yangilash', ru: 'Обновить опыт', en: 'Update experience' },

  // Education
  'emp.noEducation': {
    uz: 'Hali ta’lim ma’lumotlari yo‘q.',
    ru: 'Записей об образовании пока нет.',
    en: 'No education entries yet.',
  },
  'emp.school': { uz: 'Maktab / Universitet', ru: 'Учебное заведение', en: 'School / University' },
  'emp.degree': { uz: 'Daraja', ru: 'Степень', en: 'Degree' },
  'emp.field': { uz: 'Yo‘nalish', ru: 'Направление', en: 'Field' },
  'emp.saveEducation': {
    uz: 'Ta’limni saqlash',
    ru: 'Сохранить образование',
    en: 'Save education',
  },
  'emp.updateEducation': {
    uz: 'Ta’limni yangilash',
    ru: 'Обновить образование',
    en: 'Update education',
  },

  // Languages
  'emp.noLanguages': { uz: 'Hali til qo‘shilmagan.', ru: 'Языков пока нет.', en: 'No languages yet.' },

  // Certifications
  'emp.noCertifications': {
    uz: 'Hali sertifikat yo‘q.',
    ru: 'Сертификатов пока нет.',
    en: 'No certifications yet.',
  },
  'emp.issued': { uz: 'Berilgan', ru: 'Выдан', en: 'Issued' },
  'emp.expires': { uz: 'Muddati tugaydi', ru: 'Истекает', en: 'Expires' },
  'emp.viewCredential': {
    uz: 'Sertifikatni ko‘rish',
    ru: 'Смотреть сертификат',
    en: 'View credential',
  },
  'emp.issuer': { uz: 'Bergan tashkilot', ru: 'Кем выдан', en: 'Issuer' },
  'emp.issuedAt': { uz: 'Berilgan sana', ru: 'Дата выдачи', en: 'Issued at' },
  'emp.expiresAt': { uz: 'Amal qilish muddati', ru: 'Действителен до', en: 'Expires at' },
  'emp.credentialUrl': {
    uz: 'Sertifikat havolasi',
    ru: 'Ссылка на сертификат',
    en: 'Credential URL',
  },
  'emp.saveCertification': {
    uz: 'Sertifikatni saqlash',
    ru: 'Сохранить сертификат',
    en: 'Save certification',
  },
  'emp.updateCertification': {
    uz: 'Sertifikatni yangilash',
    ru: 'Обновить сертификат',
    en: 'Update certification',
  },

  // Resumes list
  'emp.resumesHint': {
    uz: 'Arizalar uchun nomlangan CV versiyalari - yarating, eksport qiling yoki PDF biriktiring.',
    ru: 'Именованные версии CV для откликов - создайте, экспортируйте или прикрепите PDF.',
    en: 'Named CV versions for applications - build, export, or attach a PDF.',
  },
  'emp.primary': { uz: 'Asosiy', ru: 'Основное', en: 'Primary' },
  'emp.pdfAttached': { uz: 'PDF biriktirilgan', ru: 'PDF прикреплён', en: 'PDF attached' },
  'emp.setPrimary': { uz: 'Asosiy qilish', ru: 'Сделать основным', en: 'Set primary' },
  'emp.noResumesBefore': {
    uz: 'Hali resume yo‘q - yuqoridagi',
    ru: 'Резюме пока нет - нажмите',
    en: 'No resumes yet - use',
  },
  'emp.noResumesAfter': {
    uz: 'tugmasini bosing. Karyera tarixini PDF dan to‘ldirish uchun “CV dan import” bo‘limidan foydalaning.',
    ru: 'вверху. Чтобы заполнить карьерную историю из PDF, используйте раздел «Импорт из CV».',
    en: 'above. To fill career history from a PDF, use Import from CV.',
  },

  // Resume builder
  'emp.backToProfile': { uz: 'Profilga qaytish', ru: 'Назад в профиль', en: 'Back to profile' },
  'emp.saved': { uz: 'Saqlandi', ru: 'Сохранено', en: 'Saved' },
  'emp.saveFailed': { uz: 'Saqlab bo‘lmadi', ru: 'Не удалось сохранить', en: 'Save failed' },
  'emp.loadFailed': { uz: 'Yuklab bo‘lmadi', ru: 'Не удалось загрузить', en: 'Failed to load' },
  'emp.setAsPrimaryDone': {
    uz: 'Asosiy resume sifatida belgilandi',
    ru: 'Установлено как основное резюме',
    en: 'Set as primary resume',
  },
  'emp.exporting': { uz: 'Eksport qilinmoqda...', ru: 'Экспорт...', en: 'Exporting...' },
  'emp.pdfExported': { uz: 'PDF eksport qilindi', ru: 'PDF экспортирован', en: 'PDF exported' },
  'emp.exportFailed': {
    uz: 'Eksport qilib bo‘lmadi',
    ru: 'Не удалось экспортировать',
    en: 'Export failed',
  },
  'emp.template': { uz: 'Shablon', ru: 'Шаблон', en: 'Template' },
  'emp.templateClassic': { uz: 'Klassik', ru: 'Классический', en: 'Classic' },
  'emp.templateModern': { uz: 'Zamonaviy', ru: 'Современный', en: 'Modern' },
  'emp.templateCompact': { uz: 'Ixcham', ru: 'Компактный', en: 'Compact' },
  'emp.sections': { uz: 'Bo‘limlar', ru: 'Разделы', en: 'Sections' },
  'emp.experiences': { uz: 'Tajribalar', ru: 'Опыт работы', en: 'Experiences' },
  'emp.loadingPreview': {
    uz: 'Ko‘rinish yuklanmoqda...',
    ru: 'Загрузка предпросмотра...',
    en: 'Loading preview...',
  },

  // ATS checklist: keys come from scoreResumeChecklist in packages/shared
  'emp.checklist.email': { uz: 'Email kiritilgan', ru: 'Указан email', en: 'Email present' },
  'emp.checklist.email.tip': {
    uz: 'Hisob yoki profilingizga email qo‘shing',
    ru: 'Добавьте email в аккаунт или профиль',
    en: 'Add email on your account or profile',
  },
  'emp.checklist.phone': { uz: 'Telefon kiritilgan', ru: 'Указан телефон', en: 'Phone present' },
  'emp.checklist.phone.tip': {
    uz: 'Profilga telefon raqamini qo‘shing',
    ru: 'Добавьте телефон в профиль',
    en: 'Add phone in Profile',
  },
  'emp.checklist.headline': {
    uz: 'Sarlavha kiritilgan',
    ru: 'Указан заголовок',
    en: 'Headline present',
  },
  'emp.checklist.headline.tip': {
    uz: 'Kasbiy sarlavha qo‘shing',
    ru: 'Добавьте профессиональный заголовок',
    en: 'Add a professional headline',
  },
  'emp.checklist.summary': {
    uz: 'Qisqacha ma’lumot 80-600 belgi',
    ru: 'Описание 80-600 символов',
    en: 'Summary 80-600 characters',
  },
  'emp.checklist.summary.tipShort': {
    uz: 'Kasbiy tavsifni uzunroq yozing',
    ru: 'Напишите более развёрнутое описание',
    en: 'Write a longer professional summary',
  },
  'emp.checklist.summary.tipLong': {
    uz: 'Tavsifni 600 belgidan qisqartiring',
    ru: 'Сократите описание до 600 символов',
    en: 'Shorten your summary under 600 characters',
  },
  'emp.checklist.skills': {
    uz: 'Kamida 5 ta ko‘nikma',
    ru: 'Минимум 5 навыков',
    en: 'At least 5 skills',
  },
  'emp.checklist.skills.tip': {
    uz: 'Profilga yana ko‘nikma qo‘shing',
    ru: 'Добавьте больше навыков в профиль',
    en: 'Add more skills in Profile',
  },
  'emp.checklist.experience': {
    uz: 'Kamida bitta tavsifli tajriba',
    ru: 'Минимум один опыт с описанием',
    en: 'At least one experience with description',
  },
  'emp.checklist.experience.tip': {
    uz: 'Vazifalaringizni tavsiflab ish tajribasini qo‘shing',
    ru: 'Добавьте опыт работы с описанием задач',
    en: 'Add work experience with bullet details',
  },
  'emp.checklist.dates': {
    uz: 'Tajriba sanalari to‘ldirilgan',
    ru: 'Заполнены даты опыта',
    en: 'Experience dates filled',
  },
  'emp.checklist.dates.tip': {
    uz: 'Barcha tajribalar uchun boshlanish sanasini kiriting',
    ru: 'Укажите дату начала для каждого опыта',
    en: 'Fill start dates on all experiences',
  },
  'emp.checklist.education': {
    uz: 'Kamida bitta ta’lim',
    ru: 'Минимум одно образование',
    en: 'At least one education',
  },
  'emp.checklist.education.tip': {
    uz: 'Profilga ta’limni qo‘shing',
    ru: 'Добавьте образование в профиль',
    en: 'Add education in Profile',
  },
  'emp.checklist.languages': {
    uz: 'Tillar ko‘rsatilgan (bonus)',
    ru: 'Указаны языки (бонус)',
    en: 'Languages listed (bonus)',
  },
  'emp.checklist.languages.tip': {
    uz: 'Ixtiyoriy: tillarni qo‘shing',
    ru: 'Необязательно: добавьте языки',
    en: 'Optional: add languages',
  },
  'emp.checklist.certs': {
    uz: 'Sertifikatlar ko‘rsatilgan (bonus)',
    ru: 'Указаны сертификаты (бонус)',
    en: 'Certifications listed (bonus)',
  },
  'emp.checklist.certs.tip': {
    uz: 'Ixtiyoriy: sertifikatlarni qo‘shing',
    ru: 'Необязательно: добавьте сертификаты',
    en: 'Optional: add certifications',
  },
} as const;
