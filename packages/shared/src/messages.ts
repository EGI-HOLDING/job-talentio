/**
 * Messages the server sends to people: notifications and transactional email.
 * They live in shared so the API can render them in the recipient's language
 * and the web app can reuse the same wording.
 *
 * Notifications are stored as a key plus params, so an existing notification
 * follows the reader when they switch language instead of being frozen in
 * whatever language it was created in.
 */
export type MessageLocale = 'uz' | 'ru' | 'en';

type MessageEntry = Record<MessageLocale, string>;

export const MESSAGES = {
  // ------------------------------------------------------------ notifications
  'notify.newApplicant.title': {
    uz: '{job} uchun yangi nomzod',
    ru: 'Новый отклик на «{job}»',
    en: 'New applicant for {job}',
  },
  'notify.newApplicant.body': {
    uz: '{name} ariza yubordi (moslik {match}%)',
    ru: '{name} откликнулся (совпадение {match}%)',
    en: '{name} applied (match {match}%)',
  },
  'notify.applicationStatus.title': {
    uz: 'Ariza yangilandi: {job}',
    ru: 'Обновление отклика: {job}',
    en: 'Application update: {job}',
  },
  'notify.applicationStatus.body': {
    uz: 'Holat endi: {status}',
    ru: 'Текущий статус: {status}',
    en: 'Status is now {status}',
  },
  'notify.applicationStatus.bodyWithNote': {
    uz: 'Holat endi: {status}. Izoh: {note}',
    ru: 'Текущий статус: {status}. Комментарий: {note}',
    en: 'Status is now {status}. Note: {note}',
  },
  'notify.chatMessage.title': {
    uz: 'Yangi xabar: {name}',
    ru: 'Новое сообщение: {name}',
    en: 'New message from {name}',
  },
  'notify.chatMessage.body': {
    uz: 'Suhbatni ochib o‘qing',
    ru: 'Откройте переписку, чтобы прочитать',
    en: 'Open the conversation to read it',
  },
  'notify.interviewScheduled.title': {
    uz: 'Suhbat belgilandi: {job}',
    ru: 'Назначено собеседование: {job}',
    en: 'Interview scheduled: {job}',
  },
  'notify.interviewScheduled.body': {
    uz: 'Sana: {date}',
    ru: 'Дата: {date}',
    en: 'On {date}',
  },
  'notify.newJobAtCompany.title': {
    uz: '{company} kompaniyasida yangi ish o‘rni',
    ru: 'Новая вакансия в {company}',
    en: 'New job at {company}',
  },
  'notify.verification.approved.title': {
    uz: 'Kompaniya tasdiqlandi',
    ru: 'Компания подтверждена',
    en: 'Company verified',
  },
  'notify.verification.approved.body': {
    uz: '{company} endi tasdiqlangan ish beruvchi belgisiga ega.',
    ru: 'У {company} теперь есть значок подтверждённого работодателя.',
    en: '{company} now carries the verified employer badge.',
  },
  'notify.verification.rejected.title': {
    uz: 'Tasdiqlash so‘rovi rad etildi',
    ru: 'Запрос на подтверждение отклонён',
    en: 'Verification request declined',
  },
  'notify.verification.rejected.body': {
    uz: '{company}: {note}',
    ru: '{company}: {note}',
    en: '{company}: {note}',
  },
  'notify.verification.rejected.bodyNoNote': {
    uz: '{company}: hujjatlarni tekshirib, so‘rovni qayta yuboring.',
    ru: '{company}: проверьте документы и отправьте запрос снова.',
    en: '{company}: check the documents and submit the request again.',
  },
  'notify.jobAlert.title': {
    uz: 'Ish xabarnomasi: {alert}',
    ru: 'Подписка на вакансии: {alert}',
    en: 'Job alert: {alert}',
  },
  'notify.jobAlert.body': {
    uz: '{count} ta yangi mos ish o‘rni',
    ru: 'Новых подходящих вакансий: {count}',
    en: '{count} new matching job(s)',
  },
  'notify.jobAlert.singleTitle': {
    uz: '{title}',
    ru: '{title}',
    en: '{title}',
  },
  'notify.jobAlert.singleBody': {
    uz: '{company} | {alert}',
    ru: '{company} | {alert}',
    en: '{company} | {alert}',
  },
  'notify.jobAlert.singleBodyCity': {
    uz: '{company} | {city} | {alert}',
    ru: '{company} | {city} | {alert}',
    en: '{company} | {city} | {alert}',
  },

  // Pipeline stage names, resolved inside notification params so a stored
  // notification never shows a raw enum like IN_REVIEW.
  'status.NEW': { uz: 'Yangi', ru: 'Новый', en: 'New' },
  'status.IN_REVIEW': { uz: 'Ko‘rib chiqilmoqda', ru: 'На рассмотрении', en: 'In review' },
  'status.INTERVIEW': { uz: 'Suhbat', ru: 'Собеседование', en: 'Interview' },
  'status.OFFER': { uz: 'Taklif', ru: 'Оффер', en: 'Offer' },
  'status.HIRED': { uz: 'Ishga olingan', ru: 'Нанят', en: 'Hired' },
  'status.REJECTED': { uz: 'Rad etilgan', ru: 'Отклонён', en: 'Rejected' },
  'status.WITHDRAWN': { uz: 'Qaytarib olingan', ru: 'Отозван', en: 'Withdrawn' },

  // -------------------------------------------------------------------- email
  'email.greeting': { uz: 'Salom, {name}!', ru: 'Здравствуйте, {name}!', en: 'Hello {name},' },
  'email.greetingShort': { uz: 'Salom!', ru: 'Здравствуйте!', en: 'Hello,' },
  'email.footer': {
    uz: 'Job Talentio - siz bu xatni elektron pochtangiz tasdiqlangani uchun oldingiz.',
    ru: 'Job Talentio - вы получили это письмо, потому что ваш адрес подтверждён.',
    en: 'Job Talentio - you received this because your email is verified.',
  },
  'email.linkFallback': {
    uz: 'Yoki quyidagi havolani oching: {link}',
    ru: 'Или откройте ссылку: {link}',
    en: 'Or open this link: {link}',
  },
  'email.expires24h': {
    uz: 'Havola 24 soatdan keyin eskiradi.',
    ru: 'Ссылка действительна 24 часа.',
    en: 'This link expires in 24 hours.',
  },
  'email.expires7d': {
    uz: 'Havola 7 kundan keyin eskiradi.',
    ru: 'Ссылка действительна 7 дней.',
    en: 'This link expires in 7 days.',
  },

  'email.invite.subject': {
    uz: '{company} sizni Job Talentio jamoasiga taklif qildi',
    ru: '{company} приглашает вас в команду Job Talentio',
    en: '{company} invited you to join their Job Talentio team',
  },
  'email.invite.intro': {
    uz: '{company} kompaniyasi sizni yollash jamoasiga qo‘shilishga taklif qiladi. Hisob ochish uchun havolani oching (parol yoki Google).',
    ru: '{company} приглашает вас в команду найма. Откройте ссылку, чтобы создать аккаунт (пароль или Google).',
    en: '{company} invited you to their hiring team. Open the link to create an account with a password or Google.',
  },
  'email.invite.cta': {
    uz: 'Taklifni qabul qilish',
    ru: 'Принять приглашение',
    en: 'Accept invitation',
  },
  'email.invite.ignore': {
    uz: 'Agar bu taklifni kutmagan bo‘lsangiz, xatni e’tiborsiz qoldiring.',
    ru: 'Если вы не ждали это приглашение, просто проигнорируйте письмо.',
    en: 'If you were not expecting this invitation, you can ignore this email.',
  },

  'email.inviteAdded.subject': {
    uz: 'Siz {company} jamoasiga qo‘shildingiz',
    ru: 'Вас добавили в команду {company}',
    en: 'You were added to the {company} team',
  },
  'email.inviteAdded.intro': {
    uz: '{company} kompaniyasi sizni yollash jamoasiga qo‘shdi. Kirish uchun havolani oching.',
    ru: '{company} добавила вас в команду найма. Откройте ссылку, чтобы войти.',
    en: '{company} added you to their hiring team. Open the link to sign in.',
  },
  'email.inviteAdded.cta': {
    uz: 'Kirish',
    ru: 'Войти',
    en: 'Sign in',
  },

  'email.welcome.subject': {
    uz: 'Job Talentio ga xush kelibsiz',
    ru: 'Добро пожаловать в Job Talentio',
    en: 'Welcome to Job Talentio',
  },
  'email.welcome.body': {
    uz: 'Job Talentio hisobingiz tayyor.',
    ru: 'Ваш аккаунт в Job Talentio готов.',
    en: 'Your Job Talentio account is ready.',
  },

  'email.verify.subject': {
    uz: 'Elektron pochtangizni tasdiqlang - Job Talentio',
    ru: 'Подтвердите почту - Job Talentio',
    en: 'Verify your email - Job Talentio',
  },
  'email.verify.intro': {
    uz: 'Job Talentio da ushbu pochta manzilini tasdiqlang:',
    ru: 'Подтвердите этот адрес на Job Talentio:',
    en: 'Confirm this email address on Job Talentio:',
  },
  'email.verify.cta': {
    uz: 'Pochtani tasdiqlash',
    ru: 'Подтвердить почту',
    en: 'Verify my email',
  },
  'email.verify.ignore': {
    uz: 'Agar bu so‘rovni siz yubormagan bo‘lsangiz, xatni e’tiborsiz qoldiring.',
    ru: 'Если вы не запрашивали это, просто проигнорируйте письмо.',
    en: "If you didn't request this, you can ignore this email.",
  },

  'email.resetPassword.subject': {
    uz: 'Parolni tiklash - Job Talentio',
    ru: 'Сброс пароля - Job Talentio',
    en: 'Reset your password - Job Talentio',
  },
  'email.resetPassword.intro': {
    uz: 'Job Talentio parolingizni tiklang:',
    ru: 'Сбросьте пароль в Job Talentio:',
    en: 'Reset your Job Talentio password:',
  },
  'email.resetPassword.cta': {
    uz: 'Yangi parol tanlash',
    ru: 'Выбрать новый пароль',
    en: 'Choose a new password',
  },
  'email.resetPassword.ignore': {
    uz: 'Agar tiklashni so‘ramagan bo‘lsangiz, xatni e’tiborsiz qoldiring.',
    ru: 'Если вы не запрашивали сброс, проигнорируйте письмо.',
    en: 'If you did not request a reset, ignore this email.',
  },

  'email.changeEmail.subject': {
    uz: 'Yangi pochtani tasdiqlang - Job Talentio',
    ru: 'Подтвердите новую почту - Job Talentio',
    en: 'Confirm your new email - Job Talentio',
  },
  'email.changeEmail.intro': {
    uz: 'Ushbu manzilni Job Talentio uchun yangi kirish pochtangiz sifatida tasdiqlang:',
    ru: 'Подтвердите этот адрес как новый логин в Job Talentio:',
    en: 'Confirm this address as your new Job Talentio login email:',
  },
  'email.changeEmail.cta': {
    uz: 'Pochta almashinuvini tasdiqlash',
    ru: 'Подтвердить смену почты',
    en: 'Confirm email change',
  },

  'email.jobAlert.subject': {
    uz: 'Job Talentio xabarnomasi: {alert}',
    ru: 'Job Talentio: подборка «{alert}»',
    en: 'Job Talentio alert: {alert}',
  },
  'email.jobAlert.intro': {
    uz: '<strong>{alert}</strong> so‘roviga mos yangi ish o‘rinlari:',
    ru: 'Новые вакансии по запросу <strong>{alert}</strong>:',
    en: 'New jobs matching <strong>{alert}</strong>:',
  },
  'email.jobAlert.jobLine': {
    uz: '{title} - {company} ({city})',
    ru: '{title} - {company} ({city})',
    en: '{title} - {company} ({city})',
  },
  'email.jobAlert.manage': {
    uz: 'Ogohlantirishlarni boshqarish',
    ru: 'Управлять оповещениями',
    en: 'Manage alerts',
  },

  'telegram.jobAlert.intro': {
    uz: '{alert}: {count} ta yangi mos ish',
    ru: '{alert}: новых вакансий - {count}',
    en: '{alert}: {count} new matching job(s)',
  },
  'telegram.jobAlert.jobLine': {
    uz: '{title} - {company} ({city})\n{url}',
    ru: '{title} - {company} ({city})\n{url}',
    en: '{title} - {company} ({city})\n{url}',
  },
  'telegram.channel.salaryLabel': { uz: 'Maosh', ru: 'Зарплата', en: 'Salary' },
  'telegram.channel.salaryFrom': { uz: '{amount} dan', ru: 'от {amount}', en: 'from {amount}' },
  'telegram.channel.salaryUpTo': { uz: '{amount} gacha', ru: 'до {amount}', en: 'up to {amount}' },
  'telegram.channel.salaryNegotiable': {
    uz: 'kelishiladi',
    ru: 'по договорённости',
    en: 'negotiable',
  },
  'telegram.channel.open': {
    uz: 'Batafsil va ariza berish',
    ru: 'Подробнее и откликнуться',
    en: 'View and apply',
  },
  'telegram.channel.workMode.ONSITE': { uz: 'ofisda', ru: 'офис', en: 'on-site' },
  'telegram.channel.workMode.HYBRID': { uz: 'gibrid', ru: 'гибрид', en: 'hybrid' },
  'telegram.channel.workMode.REMOTE': { uz: 'masofaviy', ru: 'удалённо', en: 'remote' },
  'telegram.channel.employment.FULL_TIME': {
    uz: 'To‘liq stavka',
    ru: 'Полная занятость',
    en: 'Full-time',
  },
  'telegram.channel.employment.PART_TIME': {
    uz: 'Qisman bandlik',
    ru: 'Частичная занятость',
    en: 'Part-time',
  },
  'telegram.channel.employment.CONTRACT': { uz: 'Shartnoma', ru: 'Договор', en: 'Contract' },
  'telegram.channel.employment.INTERNSHIP': { uz: 'Amaliyot', ru: 'Стажировка', en: 'Internship' },
  'telegram.channel.employment.TEMPORARY': { uz: 'Vaqtinchalik', ru: 'Временная', en: 'Temporary' },
  'telegram.jobs.intro': {
    uz: 'Sizga mos so‘nggi ish o‘rinlari:',
    ru: 'Свежие вакансии для вас:',
    en: 'Latest jobs for you:',
  },
  'telegram.jobs.introLatest': {
    uz: 'So‘nggi ish o‘rinlari:',
    ru: 'Свежие вакансии:',
    en: 'Latest jobs:',
  },
  'telegram.jobs.none': {
    uz: 'Hozircha ko‘rsatadigan ish o‘rni yo‘q. Keyinroq /jobs deb yozing.',
    ru: 'Пока нечего показать. Напишите /jobs позже.',
    en: 'Nothing to show yet. Try /jobs again later.',
  },
  'telegram.jobs.linkHint': {
    uz: 'Shaxsiy tanlov uchun Job Talentio hisobingizni ulang: sozlamalar, Xavfsizlik bo‘limi.',
    ru: 'Чтобы получать персональную подборку, привяжите аккаунт Job Talentio: настройки, раздел Безопасность.',
    en: 'Link your Job Talentio account (Settings, Security) to get a personalised list.',
  },
  'telegram.phone.askContact': {
    uz: 'Job Talentio ga telefon raqam bilan kirish uchun pastdagi tugmani bosib raqamingizni ulashing. Telegram raqamni tasdiqlaydi, SMS kerak emas.',
    ru: 'Чтобы войти в Job Talentio по номеру телефона, нажмите кнопку ниже и поделитесь номером. Telegram подтверждает номер, SMS не нужен.',
    en: 'To sign in to Job Talentio with your phone number, tap the button below and share your number. Telegram confirms it; no SMS needed.',
  },
  'telegram.phone.shareButton': {
    uz: 'Telefon raqamimni ulashish',
    ru: 'Поделиться номером телефона',
    en: 'Share my phone number',
  },
  'telegram.phone.notOwn': {
    uz: 'Iltimos, boshqa kontakt emas, o‘zingizning raqamingizni ulashing.',
    ru: 'Пожалуйста, поделитесь своим номером, а не чужим контактом.',
    en: 'Please share your own number, not another contact.',
  },
  'telegram.phone.loggedIn': {
    uz: 'Raqam {phone} tasdiqlandi. Brauzerga qayting: siz allaqachon kirdingiz.',
    ru: 'Номер {phone} подтверждён. Вернитесь в браузер: вход выполнен.',
    en: 'Number {phone} confirmed. Go back to the browser: you are signed in.',
  },
  'telegram.phone.created': {
    uz: 'Raqam {phone} bilan yangi Job Talentio hisobi yaratildi. Brauzerga qayting va profilingizni to‘ldiring.',
    ru: 'Создан новый аккаунт Job Talentio с номером {phone}. Вернитесь в браузер и заполните профиль.',
    en: 'A new Job Talentio account was created for {phone}. Go back to the browser and complete your profile.',
  },
  'telegram.phone.saved': {
    uz: 'Raqam {phone} hisobingizga qo‘shildi. Endi shu raqam bilan kirishingiz mumkin.',
    ru: 'Номер {phone} добавлен к вашему аккаунту. Теперь можно входить по нему.',
    en: 'Number {phone} was added to your account. You can sign in with it from now on.',
  },
  'telegram.phone.taken': {
    uz: 'Bu raqam boshqa Job Talentio hisobiga bog‘langan. Avval o‘sha hisobga kiring yoki qo‘llab-quvvatlashga yozing.',
    ru: 'Этот номер привязан к другому аккаунту Job Talentio. Войдите в тот аккаунт или напишите в поддержку.',
    en: 'This number belongs to another Job Talentio account. Sign in to that account or contact support.',
  },
  'telegram.phone.expired': {
    uz: 'Kirish havolasi eskirgan. Saytda "Telefon raqam bilan kirish" tugmasini qayta bosing.',
    ru: 'Ссылка для входа устарела. Нажмите "Войти по номеру телефона" на сайте ещё раз.',
    en: 'The sign-in link expired. Press "Sign in with phone number" on the site again.',
  },
  'telegram.phone.invalid': {
    uz: 'Raqamni o‘qib bo‘lmadi. Iltimos, qayta urinib ko‘ring.',
    ru: 'Не удалось прочитать номер. Попробуйте ещё раз.',
    en: 'The number could not be read. Please try again.',
  },
  'telegram.link.ok': {
    uz: 'Telegram hisobingiz Job Talentio bilan ulandi. Ogohlantirishlarni kabinetda yoqing. /stop yozsangiz kirish ham uziladi.',
    ru: 'Telegram привязан к Job Talentio. Включите оповещения в кабинете. /stop также отключает вход.',
    en: 'Telegram is linked to Job Talentio. Enable Telegram on a job alert in your dashboard. /stop also turns off Telegram sign-in.',
  },
  'telegram.link.already': {
    uz: 'Bu Telegram allaqachon Job Talentio bilan ulangan. Ogohlantirishlarni kabinetda yoqing. /stop yozsangiz uziladi.',
    ru: 'Этот Telegram уже привязан к Job Talentio. Включите оповещения в кабинете. /stop отключает связь.',
    en: 'This Telegram is already connected to Job Talentio. Enable Telegram on a job alert in your dashboard. Send /stop to unlink.',
  },
  'telegram.link.taken': {
    uz: 'Bu Telegram boshqa Job Talentio hisobiga ulangan. Avval o‘sha hisobdan uzing yoki boshqa Telegramdan kiring.',
    ru: 'Этот Telegram уже привязан к другому аккаунту Job Talentio. Сначала отвяжите его там или войдите с другого Telegram.',
    en: 'This Telegram is already used by another Job Talentio account. Unlink it there first, or connect a different Telegram.',
  },
  'telegram.link.expired': {
    uz: 'Bu havola eskirgan. Job Talentio sozlamalarida, Xavfsizlik bo‘limida qayta ulaning.',
    ru: 'Ссылка устарела. Подключите Telegram снова в настройках, раздел Безопасность.',
    en: 'This link expired. Connect Telegram again in Settings, Security.',
  },
  'telegram.link.help': {
    uz: 'Job Talentio ogohlantirishlari. Avval sozlamalarda, Xavfsizlik bo‘limida Telegramni ulang, keyin shu yerda Start ni bosing.',
    ru: 'Оповещения Job Talentio. Сначала подключите Telegram в настройках, раздел Безопасность, затем нажмите Start здесь.',
    en: 'Job Talentio alerts. Connect Telegram in Settings, Security, then press Start here so we can message you.',
  },
  'telegram.link.stopped': {
    uz: 'Telegram uzildi. Telegram orqali kirish ham o‘chdi. Qayta ulash: sozlamalar, Xavfsizlik.',
    ru: 'Telegram отключён. Вход через Telegram тоже выключен. Подключить снова: настройки, Безопасность.',
    en: 'Telegram unlinked. Telegram sign-in is off too. Connect again in Settings, Security.',
  },
  'telegram.chat.body': {
    uz: '{sender} Job Talentio orqali yozdi:\n\n{message}\n\nJavob: {url}',
    ru: '{sender} написал в Job Talentio:\n\n{message}\n\nОтветить: {url}',
    en: '{sender} sent you a Job Talentio message:\n\n{message}\n\nReply: {url}',
  },
  'telegram.chat.helpNoThread': {
    uz: 'Hali ochiq suhbat yo‘q. Avval Job Talentio xabarlar sahifasidan yozing, keyin shu yerda javob berishingiz mumkin.',
    ru: 'Пока нет переписки. Сначала напишите в сообщениях Job Talentio, потом можно отвечать здесь.',
    en: 'There is no open conversation yet. Message them in Job Talentio first, then you can reply here.',
  },

  'email.applicationStatus.subject': {
    uz: 'Ariza yangilandi - {job}',
    ru: 'Обновление отклика - {job}',
    en: 'Application update - {job}',
  },
  'email.applicationStatus.position': {
    uz: 'Lavozim: <strong>{job}</strong>',
    ru: 'Позиция: <strong>{job}</strong>',
    en: 'Position: <strong>{job}</strong>',
  },
  'email.applicationStatus.note': {
    uz: 'Rekruter izohi: {note}',
    ru: 'Комментарий рекрутера: {note}',
    en: 'Note from recruiter: {note}',
  },
  'email.applicationStatus.cta': {
    uz: 'Kabinetni ochish',
    ru: 'Открыть кабинет',
    en: 'Open your dashboard',
  },
  'email.applicationStatus.generic': {
    uz: 'Arizangiz holati endi: {status}.',
    ru: 'Статус вашего отклика: {status}.',
    en: 'Your application status is now {status}.',
  },
  'email.applicationStatus.IN_REVIEW': {
    uz: 'Arizangiz ko‘rib chiqilmoqda.',
    ru: 'Ваш отклик сейчас на рассмотрении.',
    en: 'Your application is being reviewed.',
  },
  'email.applicationStatus.INTERVIEW': {
    uz: 'Sizni suhbatga taklif qilishmoqda.',
    ru: 'Вас приглашают на собеседование.',
    en: 'You have been invited to an interview.',
  },
  'email.applicationStatus.OFFER': {
    uz: 'Sizga ish taklifi yuborildi.',
    ru: 'Вам направлено предложение о работе.',
    en: 'You have received a job offer.',
  },
  'email.applicationStatus.HIRED': {
    uz: 'Tabriklaymiz, siz ishga qabul qilindingiz.',
    ru: 'Поздравляем, вас приняли на работу.',
    en: 'Congratulations, you have been hired.',
  },
  'email.applicationStatus.REJECTED': {
    uz: 'Afsuski, bu safar tanlov boshqa nomzodga nasib etdi.',
    ru: 'К сожалению, в этот раз выбрали другого кандидата.',
    en: 'Unfortunately the team moved forward with another candidate.',
  },
  'email.chatMessage.subject': {
    uz: '{name} sizga Job Talentio orqali yozdi',
    ru: '{name} написал вам в Job Talentio',
    en: '{name} sent you a message on Job Talentio',
  },
  'email.chatMessage.cta': {
    uz: 'Suhbatni ochish',
    ru: 'Открыть переписку',
    en: 'Open conversation',
  },
} as const satisfies Record<string, MessageEntry>;

export type MessageKey = keyof typeof MESSAGES;

/** Renders a message in `locale`, substituting `{placeholders}` from `params`. */
export function translateMessage(
  key: string,
  locale: MessageLocale = 'uz',
  params?: Record<string, string | number | null | undefined>,
): string {
  const entry = MESSAGES[key as MessageKey] as MessageEntry | undefined;
  if (!entry) return key;

  const template = entry[locale] ?? entry.en ?? key;
  if (!params) return template;

  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined || value === null ? match : String(value);
  });
}

export function isMessageKey(value: unknown): value is MessageKey {
  return typeof value === 'string' && value in MESSAGES;
}
