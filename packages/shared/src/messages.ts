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
