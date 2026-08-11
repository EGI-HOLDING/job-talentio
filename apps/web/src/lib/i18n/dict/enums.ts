/**
 * API enum values rendered in the UI. Keys follow `enum.<group>.<VALUE>` and are
 * resolved through `useEnumLabel()` so unknown values degrade to the raw string.
 */
export const enums = {
  'enum.jobStatus.DRAFT': { uz: 'Qoralama', ru: 'Черновик', en: 'Draft' },
  'enum.jobStatus.PENDING_REVIEW': {
    uz: 'Tekshiruvda',
    ru: 'На проверке',
    en: 'Pending review',
  },
  'enum.jobStatus.PUBLISHED': { uz: 'Chop etilgan', ru: 'Опубликовано', en: 'Published' },
  'enum.jobStatus.PAUSED': { uz: 'To‘xtatilgan', ru: 'Приостановлено', en: 'Paused' },
  'enum.jobStatus.CLOSED': { uz: 'Yopilgan', ru: 'Закрыто', en: 'Closed' },
  'enum.jobStatus.ARCHIVED': { uz: 'Arxivlangan', ru: 'В архиве', en: 'Archived' },

  'enum.employmentType.FULL_TIME': {
    uz: 'To‘liq stavka',
    ru: 'Полная занятость',
    en: 'Full time',
  },
  'enum.employmentType.PART_TIME': {
    uz: 'Yarim stavka',
    ru: 'Частичная занятость',
    en: 'Part time',
  },
  'enum.employmentType.CONTRACT': { uz: 'Shartnoma', ru: 'Контракт', en: 'Contract' },
  'enum.employmentType.INTERNSHIP': { uz: 'Amaliyot', ru: 'Стажировка', en: 'Internship' },
  'enum.employmentType.TEMPORARY': { uz: 'Vaqtinchalik', ru: 'Временная', en: 'Temporary' },

  'enum.workMode.ONSITE': { uz: 'Ofisda', ru: 'В офисе', en: 'On-site' },
  'enum.workMode.REMOTE': { uz: 'Masofaviy', ru: 'Удалённо', en: 'Remote' },
  'enum.workMode.HYBRID': { uz: 'Gibrid', ru: 'Гибрид', en: 'Hybrid' },

  'enum.applicationStatus.NEW': { uz: 'Yangi', ru: 'Новый', en: 'New' },
  'enum.applicationStatus.IN_REVIEW': { uz: 'Ko‘rib chiqilmoqda', ru: 'На рассмотрении', en: 'In review' },
  'enum.applicationStatus.INTERVIEW': { uz: 'Suhbat', ru: 'Собеседование', en: 'Interview' },
  'enum.applicationStatus.OFFER': { uz: 'Taklif', ru: 'Оффер', en: 'Offer' },
  'enum.applicationStatus.HIRED': { uz: 'Ishga olingan', ru: 'Нанят', en: 'Hired' },
  'enum.applicationStatus.REJECTED': { uz: 'Rad etilgan', ru: 'Отклонён', en: 'Rejected' },
  'enum.applicationStatus.WITHDRAWN': { uz: 'Qaytarib olingan', ru: 'Отозван', en: 'Withdrawn' },

  'enum.degree.HIGH_SCHOOL': { uz: 'O‘rta maktab', ru: 'Среднее образование', en: 'High school' },
  'enum.degree.VOCATIONAL': { uz: 'Kasb-hunar', ru: 'Профессиональное', en: 'Vocational' },
  'enum.degree.BACHELOR': { uz: 'Bakalavr', ru: 'Бакалавр', en: 'Bachelor' },
  'enum.degree.MASTER': { uz: 'Magistr', ru: 'Магистр', en: 'Master' },
  'enum.degree.PHD': { uz: 'PhD', ru: 'Доктор наук', en: 'PhD' },

  'enum.skillLevel.BEGINNER': { uz: 'Boshlang‘ich', ru: 'Начальный', en: 'Beginner' },
  'enum.skillLevel.INTERMEDIATE': { uz: 'O‘rta', ru: 'Средний', en: 'Intermediate' },
  'enum.skillLevel.ADVANCED': { uz: 'Yuqori', ru: 'Продвинутый', en: 'Advanced' },
  'enum.skillLevel.EXPERT': { uz: 'Ekspert', ru: 'Эксперт', en: 'Expert' },

  'enum.experienceLevel.INTERN': { uz: 'Amaliyotchi', ru: 'Стажёр', en: 'Intern' },
  'enum.experienceLevel.JUNIOR': { uz: 'Junior', ru: 'Junior', en: 'Junior' },
  'enum.experienceLevel.MIDDLE': { uz: 'Middle', ru: 'Middle', en: 'Middle' },
  'enum.experienceLevel.SENIOR': { uz: 'Senior', ru: 'Senior', en: 'Senior' },
  'enum.experienceLevel.LEAD': { uz: 'Lead', ru: 'Lead', en: 'Lead' },
  'enum.experienceLevel.EXECUTIVE': { uz: 'Rahbar', ru: 'Руководитель', en: 'Executive' },

  'enum.plan.FREE': { uz: 'Bepul', ru: 'Бесплатный', en: 'Free' },
  'enum.plan.STANDARD': { uz: 'Standart', ru: 'Стандарт', en: 'Standard' },
  'enum.plan.PREMIUM': { uz: 'Premium', ru: 'Премиум', en: 'Premium' },
  'enum.plan.VIP': { uz: 'VIP', ru: 'VIP', en: 'VIP' },

  'enum.role.EMPLOYEE': { uz: 'Nomzod', ru: 'Соискатель', en: 'Job seeker' },
  'enum.role.RECRUITER': { uz: 'Rekruter', ru: 'Рекрутер', en: 'Recruiter' },
  'enum.role.SUPER_ADMIN': { uz: 'Administrator', ru: 'Администратор', en: 'Administrator' },
  'enum.role.OWNER': { uz: 'Egasi', ru: 'Владелец', en: 'Owner' },
  'enum.role.ADMIN': { uz: 'Administrator', ru: 'Администратор', en: 'Admin' },

  'enum.frequency.DAILY': { uz: 'Har kuni', ru: 'Ежедневно', en: 'Daily' },
  'enum.frequency.WEEKLY': { uz: 'Har hafta', ru: 'Еженедельно', en: 'Weekly' },

  'enum.paymentStatus.PENDING': { uz: 'Kutilmoqda', ru: 'В ожидании', en: 'Pending' },
  'enum.paymentStatus.PAID': { uz: 'To‘langan', ru: 'Оплачено', en: 'Paid' },
  'enum.paymentStatus.FAILED': { uz: 'Muvaffaqiyatsiz', ru: 'Ошибка', en: 'Failed' },
  'enum.paymentStatus.REFUNDED': { uz: 'Qaytarilgan', ru: 'Возвращено', en: 'Refunded' },
  'enum.paymentStatus.MOCKED': { uz: 'Sinov to‘lovi', ru: 'Тестовый платёж', en: 'Mock payment' },

  'enum.workMode.location.REMOTE': { uz: 'Masofaviy', ru: 'Удалённо', en: 'Remote' },
  'enum.workMode.location.HYBRID': { uz: 'Gibrid', ru: 'Гибрид', en: 'Hybrid' },
  'enum.workMode.location.UNKNOWN': {
    uz: 'Manzil aniqlanmagan',
    ru: 'Локация уточняется',
    en: 'Location TBD',
  },
} as const;
