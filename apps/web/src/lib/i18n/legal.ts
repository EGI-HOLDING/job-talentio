import type { Locale } from '@/lib/locale';

export type LegalSection = { heading: string; paragraphs?: string[]; items?: string[] };
export type LegalDoc = {
  title: string;
  /** Human-readable revision date in the document's language. */
  updated: string;
  intro: string;
  sections: LegalSection[];
};

export type LegalDocKey = 'terms' | 'privacy';

const CONTACT = 'info@jobtalent.io';

const termsEn: LegalDoc = {
  title: 'Terms of Service',
  updated: '18 September 2026',
  intro:
    'Job Talentio is an online job portal for Uzbekistan operated by Job Talentio (EGI Holding), referred to below as "we". These Terms govern the use of jobtalent.io, its subdomains, the Job Talentio Telegram bot and related services (the "Service"). By creating an account or using the Service you agree to these Terms.',
  sections: [
    {
      heading: '1. Accounts and eligibility',
      paragraphs: [
        'You must be at least 16 years old, the minimum working age in the Republic of Uzbekistan. Keep one account per person, give accurate information and keep your credentials safe. You can sign in with an email address and password, a Google account or a Telegram account; you are responsible for activity under your account.',
      ],
    },
    {
      heading: '2. Job seekers',
      paragraphs: [
        'Your profile, CV and messages remain yours. You choose who can see your profile: everyone, registered recruiters only, or nobody. You grant us the right to store, display and translate that content to employers according to your visibility settings and to the employers you apply to. Do not upload personal data of other people without their permission.',
      ],
    },
    {
      heading: '3. Employers',
      items: [
        'Post only genuine vacancies of the organisation you represent and keep them current.',
        'Comply with the labour legislation of the Republic of Uzbekistan, including its non-discrimination rules: do not set requirements on gender, age, nationality, religion, marital status or other grounds unrelated to the work.',
        'Use candidate data only to fill the vacancy it was received for and never charge candidates for applying.',
        'Team members you invite act on behalf of your company; you are responsible for their use of the Service.',
      ],
    },
    {
      heading: '4. Prohibited conduct',
      paragraphs: [
        'Fraud, spam, scraping, malware, impersonation, harassment, duplicate postings and content that is illegal or misleading are not allowed. We may moderate, pause or remove content and suspend or close accounts that break these rules.',
      ],
    },
    {
      heading: '5. Plans and payments',
      paragraphs: [
        'Some employer features depend on a plan. Prices are shown in Uzbek soum in the employer account. During the pilot period paid features may run in demo mode without an actual charge. When payments are enabled, the conditions shown at checkout apply.',
      ],
    },
    {
      heading: '6. Machine translation and matching',
      paragraphs: [
        'Content may be shown in a machine-translated form and is labelled as such. Match scores and recommendations are indicative and are not a hiring decision; every decision remains with the employer and the candidate.',
      ],
    },
    {
      heading: '7. Intellectual property',
      paragraphs: [
        'The Service, its design, software and databases belong to us. Content created by users remains theirs.',
      ],
    },
    {
      heading: '8. Liability',
      paragraphs: [
        'We are an intermediary between job seekers and employers. We do not guarantee employment, hiring results or the accuracy of user content, and we are not responsible for what employers or candidates do outside the Service. The Service is provided as is to the extent permitted by law.',
      ],
    },
    {
      heading: '9. Termination',
      paragraphs: [
        'You can delete your account at any time in Settings. We may suspend or close an account that breaches these Terms.',
      ],
    },
    {
      heading: '10. Changes and governing law',
      paragraphs: [
        'We may update these Terms; material changes are announced on the Service before they take effect. These Terms are governed by the laws of the Republic of Uzbekistan. Disputes are resolved by the courts of Tashkent unless mandatory law provides otherwise.',
      ],
    },
    {
      heading: '11. Contact',
      paragraphs: [`Questions about these Terms: ${CONTACT}.`],
    },
  ],
};

const termsRu: LegalDoc = {
  title: 'Условия использования',
  updated: '18 сентября 2026 г.',
  intro:
    'Job Talentio - онлайн-портал вакансий для Узбекистана, которым управляет Job Talentio (EGI Holding), далее "мы". Настоящие Условия регулируют использование сайта jobtalent.io, его поддоменов, Telegram-бота Job Talentio и связанных сервисов ("Сервис"). Создавая аккаунт или используя Сервис, вы принимаете эти Условия.',
  sections: [
    {
      heading: '1. Аккаунты и требования',
      paragraphs: [
        'Вам должно быть не менее 16 лет - минимального возраста трудоустройства в Республике Узбекистан. Один человек - один аккаунт; указывайте достоверные данные и храните доступ в тайне. Войти можно по электронной почте и паролю, через аккаунт Google или Telegram; вы отвечаете за действия под своим аккаунтом.',
      ],
    },
    {
      heading: '2. Соискатели',
      paragraphs: [
        'Ваш профиль, резюме и сообщения принадлежат вам. Вы выбираете, кто видит профиль: все, только зарегистрированные рекрутеры или никто. Вы разрешаете нам хранить, показывать и переводить этот контент работодателям согласно настройкам видимости и тем работодателям, к которым вы откликаетесь. Не загружайте персональные данные других людей без их разрешения.',
      ],
    },
    {
      heading: '3. Работодатели',
      items: [
        'Публикуйте только реальные вакансии организации, которую представляете, и поддерживайте их в актуальном состоянии.',
        'Соблюдайте трудовое законодательство Республики Узбекистан, включая запрет дискриминации: не указывайте требования по полу, возрасту, национальности, религии, семейному положению и иным признакам, не связанным с работой.',
        'Используйте данные кандидатов только для закрытия той вакансии, по которой они получены, и никогда не взимайте с кандидатов плату за отклик.',
        'Приглашённые участники команды действуют от имени вашей компании; вы отвечаете за их использование Сервиса.',
      ],
    },
    {
      heading: '4. Запрещённые действия',
      paragraphs: [
        'Мошенничество, спам, автоматический сбор данных, вредоносный код, выдача себя за других, травля, дублирующие публикации, а также незаконный или вводящий в заблуждение контент запрещены. Мы можем модерировать, приостанавливать или удалять контент, а также блокировать аккаунты, нарушающие эти правила.',
      ],
    },
    {
      heading: '5. Тарифы и оплата',
      paragraphs: [
        'Часть функций для работодателей зависит от тарифа. Цены указаны в узбекских сумах в кабинете работодателя. В пилотный период платные функции могут работать в демо-режиме без фактического списания. После включения оплаты действуют условия, показанные при оформлении.',
      ],
    },
    {
      heading: '6. Машинный перевод и подбор',
      paragraphs: [
        'Контент может показываться в машинном переводе и помечается соответствующим образом. Оценки соответствия и рекомендации носят справочный характер и не являются решением о найме; решение остаётся за работодателем и кандидатом.',
      ],
    },
    {
      heading: '7. Интеллектуальная собственность',
      paragraphs: [
        'Сервис, его дизайн, программное обеспечение и базы данных принадлежат нам. Контент, созданный пользователями, остаётся их собственностью.',
      ],
    },
    {
      heading: '8. Ответственность',
      paragraphs: [
        'Мы - посредник между соискателями и работодателями. Мы не гарантируем трудоустройство, результат найма или точность пользовательского контента и не отвечаем за действия работодателей и кандидатов вне Сервиса. Сервис предоставляется "как есть" в пределах, допускаемых законом.',
      ],
    },
    {
      heading: '9. Прекращение использования',
      paragraphs: [
        'Вы можете удалить аккаунт в любой момент в настройках. Мы можем приостановить или закрыть аккаунт, нарушающий эти Условия.',
      ],
    },
    {
      heading: '10. Изменения и применимое право',
      paragraphs: [
        'Мы можем обновлять эти Условия; о существенных изменениях сообщается в Сервисе до их вступления в силу. Условия регулируются законодательством Республики Узбекистан. Споры рассматриваются судами города Ташкента, если иное не установлено императивными нормами закона.',
      ],
    },
    {
      heading: '11. Контакты',
      paragraphs: [`Вопросы по Условиям: ${CONTACT}.`],
    },
  ],
};

const termsUz: LegalDoc = {
  title: 'Foydalanish shartlari',
  updated: '2026-yil 18-sentabr',
  intro:
    'Job Talentio - O‘zbekiston uchun onlayn ish portali bo‘lib, uni Job Talentio (EGI Holding), keyingi o‘rinlarda "biz", boshqaradi. Ushbu Shartlar jobtalent.io sayti, uning subdomenlari, Job Talentio Telegram-boti va ular bilan bog‘liq xizmatlardan ("Xizmat") foydalanishni tartibga soladi. Hisob yaratish yoki Xizmatdan foydalanish orqali siz ushbu Shartlarga rozilik bildirasiz.',
  sections: [
    {
      heading: '1. Hisoblar va talablar',
      paragraphs: [
        'Siz kamida 16 yoshda bo‘lishingiz kerak - bu O‘zbekiston Respublikasida ishga qabul qilishning eng kam yoshi. Bir odam - bir hisob; to‘g‘ri ma’lumot kiriting va kirish ma’lumotlaringizni sir saqlang. Elektron pochta va parol, Google hisobi yoki Telegram hisobi orqali kirish mumkin; hisobingiz ostidagi harakatlar uchun siz javobgarsiz.',
      ],
    },
    {
      heading: '2. Ish izlovchilar',
      paragraphs: [
        'Profilingiz, rezyumeingiz va xabarlaringiz sizga tegishli. Profilni kim ko‘rishini siz tanlaysiz: hamma, faqat ro‘yxatdan o‘tgan rekruterlar yoki hech kim. Siz bizga ushbu kontentni ko‘rinish sozlamalaringizga muvofiq va ariza yuborgan ish beruvchilarga saqlash, ko‘rsatish va tarjima qilish huquqini berasiz. Boshqa odamlarning shaxsiy ma’lumotlarini ularning ruxsatisiz yuklamang.',
      ],
    },
    {
      heading: '3. Ish beruvchilar',
      items: [
        'Faqat o‘zingiz vakillik qilayotgan tashkilotning haqiqiy bo‘sh ish o‘rinlarini e’lon qiling va ularni dolzarb holda saqlang.',
        'O‘zbekiston Respublikasi mehnat qonunchiligiga, shu jumladan kamsitishni taqiqlash qoidalariga rioya qiling: jins, yosh, millat, din, oilaviy holat va ish bilan bog‘liq bo‘lmagan boshqa belgilar bo‘yicha talab qo‘ymang.',
        'Nomzodlar ma’lumotlarini faqat ular olingan bo‘sh ish o‘rnini to‘ldirish uchun ishlating va ariza berish uchun nomzodlardan hech qachon to‘lov olmang.',
        'Siz taklif qilgan jamoa a’zolari kompaniyangiz nomidan harakat qiladi; ularning Xizmatdan foydalanishi uchun siz javobgarsiz.',
      ],
    },
    {
      heading: '4. Taqiqlangan harakatlar',
      paragraphs: [
        'Firibgarlik, spam, ma’lumotlarni avtomatik yig‘ish, zararli kod, o‘zini boshqa shaxs sifatida ko‘rsatish, ta’qib, takroriy e’lonlar, shuningdek noqonuniy yoki chalg‘ituvchi kontent taqiqlanadi. Biz kontentni moderatsiya qilishimiz, to‘xtatib qo‘yishimiz yoki o‘chirishimiz, qoidalarni buzgan hisoblarni bloklashimiz mumkin.',
      ],
    },
    {
      heading: '5. Tariflar va to‘lov',
      paragraphs: [
        'Ish beruvchilar uchun ayrim funksiyalar tarifga bog‘liq. Narxlar ish beruvchi kabinetida o‘zbek so‘mida ko‘rsatiladi. Sinov davrida pullik funksiyalar haqiqiy to‘lovsiz demo rejimida ishlashi mumkin. To‘lov yoqilgandan so‘ng rasmiylashtirish paytida ko‘rsatilgan shartlar amal qiladi.',
      ],
    },
    {
      heading: '6. Mashina tarjimasi va moslik',
      paragraphs: [
        'Kontent mashina tarjimasida ko‘rsatilishi va shunday belgilanishi mumkin. Moslik ballari va tavsiyalar ma’lumot uchun bo‘lib, ishga qabul qilish qarori hisoblanmaydi; qaror ish beruvchi va nomzodga tegishli.',
      ],
    },
    {
      heading: '7. Intellektual mulk',
      paragraphs: [
        'Xizmat, uning dizayni, dasturiy ta’minoti va ma’lumotlar bazalari bizga tegishli. Foydalanuvchilar yaratgan kontent ularning o‘zlariga tegishli bo‘lib qoladi.',
      ],
    },
    {
      heading: '8. Javobgarlik',
      paragraphs: [
        'Biz ish izlovchilar va ish beruvchilar o‘rtasidagi vositachimiz. Biz ishga joylashishni, ishga qabul natijasini yoki foydalanuvchi kontentining to‘g‘riligini kafolatlamaymiz va ish beruvchilar yoki nomzodlarning Xizmatdan tashqaridagi harakatlari uchun javob bermaymiz. Xizmat qonun yo‘l qo‘ygan doirada "boricha" taqdim etiladi.',
      ],
    },
    {
      heading: '9. Foydalanishni to‘xtatish',
      paragraphs: [
        'Hisobingizni istalgan vaqtda sozlamalarda o‘chirishingiz mumkin. Biz ushbu Shartlarni buzgan hisobni to‘xtatib qo‘yishimiz yoki yopishimiz mumkin.',
      ],
    },
    {
      heading: '10. O‘zgarishlar va amaldagi qonun',
      paragraphs: [
        'Biz ushbu Shartlarni yangilashimiz mumkin; muhim o‘zgarishlar kuchga kirishidan oldin Xizmatda e’lon qilinadi. Shartlar O‘zbekiston Respublikasi qonunchiligi bilan tartibga solinadi. Nizolar, qonunning imperativ normalarida boshqacha belgilanmagan bo‘lsa, Toshkent shahri sudlarida ko‘riladi.',
      ],
    },
    {
      heading: '11. Aloqa',
      paragraphs: [`Shartlar bo‘yicha savollar: ${CONTACT}.`],
    },
  ],
};

const privacyEn: LegalDoc = {
  title: 'Privacy Policy',
  updated: '18 September 2026',
  intro:
    'This Policy explains what personal data Job Talentio (EGI Holding), the data controller ("we"), collects when you use jobtalent.io, its subdomains and the Job Talentio Telegram bot, why we process it and what rights you have. We process personal data in accordance with the Law of the Republic of Uzbekistan "On Personal Data".',
  sections: [
    {
      heading: '1. Data we collect',
      items: [
        'Account data: name, email address, phone number, password hash, Google or Telegram identifiers, profile photo, interface language.',
        'Profile and CV data: headline, summary, work experience, education, skills, languages, certificates, uploaded CV files and the text extracted from them, resume PDFs you generate.',
        'Employer data: company details, logo, team members, job postings, screening questions and message templates.',
        'Usage data: applications, answers, messages, saved jobs, alerts, notifications, page views, IP address, device and browser information, and cookies needed for sign-in and language.',
      ],
    },
    {
      heading: '2. Why we process it',
      items: [
        'To provide the Service you asked for: accounts, profiles, postings, applications, chat and notifications.',
        'To match candidates and vacancies, send job alerts and recommendations.',
        'To keep the Service safe: moderation, abuse prevention, duplicate detection, audit logs.',
        'To meet legal obligations and respond to lawful requests.',
        'With your consent, for optional channels such as Telegram messages and email alerts; you can withdraw consent at any time in Settings.',
      ],
    },
    {
      heading: '3. Who can see your data',
      paragraphs: [
        'Employers see your profile according to your visibility setting and always when you apply to their vacancy; their invited team members see the same. We rely on service providers that act on our instructions: cloud hosting and file storage, email delivery, Telegram (if you link it), Google sign-in (if you use it), search infrastructure, and AI providers that structure the text of your CV or translate postings and profiles. Only the text needed for the task is sent to AI providers and it is not used to train their models. We do not sell personal data.',
      ],
    },
    {
      heading: '4. Storage and transfers',
      paragraphs: [
        'Data is stored on the infrastructure of our hosting providers, which may be located outside Uzbekistan. Where the law requires, personal data of citizens of Uzbekistan is processed in line with the localization and cross-border transfer rules of the Law "On Personal Data".',
      ],
    },
    {
      heading: '5. Retention',
      paragraphs: [
        'We keep your data while your account is active. When you delete your account in Settings, personal data is deleted or anonymized within 30 days, except records we must keep by law. Backups are rotated on a regular schedule.',
      ],
    },
    {
      heading: '6. Your rights',
      items: [
        'Access, correct or delete your data in your profile and Settings.',
        'Restrict who sees your profile with the visibility setting.',
        'Unlink Google or Telegram and turn notification channels off.',
        'Export your CV as a PDF from the resume builder.',
        `Contact us at ${CONTACT} for any request, or lodge a complaint with the authorized body for personal data protection.`,
      ],
    },
    {
      heading: '7. Cookies',
      paragraphs: [
        'We use only essential cookies and local storage: sign-in session, chosen language and dashboard preferences. We do not use third-party advertising cookies.',
      ],
    },
    {
      heading: '8. Security',
      paragraphs: [
        'Data is encrypted in transit, passwords are stored as hashes, access is limited to staff who need it, and administrative actions are logged.',
      ],
    },
    {
      heading: '9. Children',
      paragraphs: ['The Service is not intended for people under 16.'],
    },
    {
      heading: '10. Changes and contact',
      paragraphs: [
        `We may update this Policy; material changes are announced on the Service. Questions about personal data: ${CONTACT}.`,
      ],
    },
  ],
};

const privacyRu: LegalDoc = {
  title: 'Политика конфиденциальности',
  updated: '18 сентября 2026 г.',
  intro:
    'Эта Политика объясняет, какие персональные данные собирает Job Talentio (EGI Holding), оператор данных ("мы"), при использовании jobtalent.io, его поддоменов и Telegram-бота Job Talentio, зачем мы их обрабатываем и какие у вас есть права. Мы обрабатываем персональные данные в соответствии с Законом Республики Узбекистан "О персональных данных".',
  sections: [
    {
      heading: '1. Какие данные мы собираем',
      items: [
        'Данные аккаунта: имя, адрес электронной почты, номер телефона, хеш пароля, идентификаторы Google или Telegram, фото профиля, язык интерфейса.',
        'Данные профиля и резюме: заголовок, описание, опыт работы, образование, навыки, языки, сертификаты, загруженные файлы резюме и извлечённый из них текст, созданные вами PDF-резюме.',
        'Данные работодателя: сведения о компании, логотип, участники команды, вакансии, вопросы для отбора и шаблоны сообщений.',
        'Данные об использовании: отклики, ответы, сообщения, сохранённые вакансии, подписки, уведомления, просмотры страниц, IP-адрес, сведения об устройстве и браузере, а также cookies, нужные для входа и языка.',
      ],
    },
    {
      heading: '2. Зачем мы их обрабатываем',
      items: [
        'Чтобы предоставлять запрошенный Сервис: аккаунты, профили, вакансии, отклики, чат и уведомления.',
        'Чтобы подбирать кандидатов и вакансии, отправлять подписки на вакансии и рекомендации.',
        'Чтобы поддерживать безопасность: модерация, предотвращение злоупотреблений, поиск дубликатов, журналы действий.',
        'Чтобы выполнять требования закона и отвечать на законные запросы.',
        'С вашего согласия - для необязательных каналов, таких как сообщения в Telegram и рассылки по электронной почте; согласие можно отозвать в настройках в любой момент.',
      ],
    },
    {
      heading: '3. Кто видит ваши данные',
      paragraphs: [
        'Работодатели видят профиль согласно вашей настройке видимости и всегда - когда вы откликаетесь на их вакансию; то же видят приглашённые ими участники команды. Мы используем поставщиков услуг, действующих по нашим инструкциям: облачный хостинг и хранение файлов, доставку электронной почты, Telegram (если вы его привязали), вход через Google (если вы им пользуетесь), поисковую инфраструктуру и провайдеров ИИ, которые структурируют текст резюме или переводят вакансии и профили. Провайдерам ИИ передаётся только текст, необходимый для задачи, и он не используется для обучения их моделей. Мы не продаём персональные данные.',
      ],
    },
    {
      heading: '4. Хранение и передача',
      paragraphs: [
        'Данные хранятся в инфраструктуре наших хостинг-провайдеров, которая может находиться за пределами Узбекистана. Там, где этого требует закон, персональные данные граждан Узбекистана обрабатываются с учётом правил локализации и трансграничной передачи Закона "О персональных данных".',
      ],
    },
    {
      heading: '5. Сроки хранения',
      paragraphs: [
        'Мы храним данные, пока аккаунт активен. После удаления аккаунта в настройках персональные данные удаляются или обезличиваются в течение 30 дней, кроме записей, которые мы обязаны хранить по закону. Резервные копии обновляются по регулярному графику.',
      ],
    },
    {
      heading: '6. Ваши права',
      items: [
        'Получать, исправлять и удалять данные в профиле и настройках.',
        'Ограничивать видимость профиля соответствующей настройкой.',
        'Отвязывать Google или Telegram и отключать каналы уведомлений.',
        'Экспортировать резюме в PDF из конструктора резюме.',
        `Обращаться к нам по адресу ${CONTACT} с любым запросом или подавать жалобу в уполномоченный орган по защите персональных данных.`,
      ],
    },
    {
      heading: '7. Cookies',
      paragraphs: [
        'Мы используем только необходимые cookies и локальное хранилище: сессию входа, выбранный язык и настройки кабинета. Сторонние рекламные cookies не используются.',
      ],
    },
    {
      heading: '8. Безопасность',
      paragraphs: [
        'Данные шифруются при передаче, пароли хранятся в виде хешей, доступ ограничен сотрудниками, которым он необходим, административные действия журналируются.',
      ],
    },
    {
      heading: '9. Дети',
      paragraphs: ['Сервис не предназначен для лиц младше 16 лет.'],
    },
    {
      heading: '10. Изменения и контакты',
      paragraphs: [
        `Мы можем обновлять эту Политику; о существенных изменениях сообщается в Сервисе. Вопросы о персональных данных: ${CONTACT}.`,
      ],
    },
  ],
};

const privacyUz: LegalDoc = {
  title: 'Maxfiylik siyosati',
  updated: '2026-yil 18-sentabr',
  intro:
    'Ushbu Siyosat ma’lumotlar operatori bo‘lgan Job Talentio (EGI Holding) ("biz") jobtalent.io, uning subdomenlari va Job Talentio Telegram-botidan foydalanganingizda qanday shaxsiy ma’lumotlarni to‘plashini, ularni nima uchun qayta ishlashini va sizning huquqlaringizni tushuntiradi. Shaxsiy ma’lumotlar O‘zbekiston Respublikasining "Shaxsga doir ma’lumotlar to‘g‘risida"gi Qonuniga muvofiq qayta ishlanadi.',
  sections: [
    {
      heading: '1. Qanday ma’lumotlarni to‘playmiz',
      items: [
        'Hisob ma’lumotlari: ism, elektron pochta manzili, telefon raqami, parol xeshi, Google yoki Telegram identifikatorlari, profil rasmi, interfeys tili.',
        'Profil va rezyume ma’lumotlari: sarlavha, qisqacha ma’lumot, ish tajribasi, ta’lim, ko‘nikmalar, tillar, sertifikatlar, yuklangan rezyume fayllari va ulardan ajratib olingan matn, siz yaratgan PDF-rezyumelar.',
        'Ish beruvchi ma’lumotlari: kompaniya haqida ma’lumot, logotip, jamoa a’zolari, bo‘sh ish o‘rinlari, saralash savollari va xabar shablonlari.',
        'Foydalanish ma’lumotlari: arizalar, javoblar, xabarlar, saqlangan ish o‘rinlari, obunalar, bildirishnomalar, sahifa ko‘rishlari, IP-manzil, qurilma va brauzer haqida ma’lumot, kirish va til uchun zarur cookie-fayllar.',
      ],
    },
    {
      heading: '2. Nima uchun qayta ishlaymiz',
      items: [
        'So‘ralgan Xizmatni taqdim etish uchun: hisoblar, profillar, e’lonlar, arizalar, chat va bildirishnomalar.',
        'Nomzodlar va bo‘sh ish o‘rinlarini moslashtirish, ish obunalari va tavsiyalarni yuborish uchun.',
        'Xizmat xavfsizligini ta’minlash uchun: moderatsiya, suiiste’molning oldini olish, takrorlarni aniqlash, harakatlar jurnali.',
        'Qonun talablarini bajarish va qonuniy so‘rovlarga javob berish uchun.',
        'Sizning roziligingiz bilan - Telegram xabarlari va elektron pochta obunalari kabi ixtiyoriy kanallar uchun; rozilikni istalgan vaqtda sozlamalarda qaytarib olish mumkin.',
      ],
    },
    {
      heading: '3. Ma’lumotlaringizni kim ko‘radi',
      paragraphs: [
        'Ish beruvchilar profilingizni ko‘rinish sozlamangizga muvofiq va ularning bo‘sh ish o‘rniga ariza berganingizda doimo ko‘radi; ular taklif qilgan jamoa a’zolari ham xuddi shuni ko‘radi. Biz ko‘rsatmalarimiz bo‘yicha ishlaydigan xizmat ko‘rsatuvchilardan foydalanamiz: bulutli xosting va fayllarni saqlash, elektron pochta yetkazish, Telegram (agar bog‘lagan bo‘lsangiz), Google orqali kirish (agar foydalansangiz), qidiruv infratuzilmasi va rezyume matnini tuzilmaga soluvchi yoki e’lon va profillarni tarjima qiluvchi sun’iy intellekt provayderlari. Sun’iy intellekt provayderlariga faqat vazifa uchun zarur matn yuboriladi va u ularning modellarini o‘rgatish uchun ishlatilmaydi. Biz shaxsiy ma’lumotlarni sotmaymiz.',
      ],
    },
    {
      heading: '4. Saqlash va uzatish',
      paragraphs: [
        'Ma’lumotlar xosting provayderlarimiz infratuzilmasida saqlanadi va u O‘zbekistondan tashqarida joylashgan bo‘lishi mumkin. Qonun talab qilgan hollarda O‘zbekiston fuqarolarining shaxsiy ma’lumotlari "Shaxsga doir ma’lumotlar to‘g‘risida"gi Qonunning lokalizatsiya va transchegaraviy uzatish qoidalariga muvofiq qayta ishlanadi.',
      ],
    },
    {
      heading: '5. Saqlash muddati',
      paragraphs: [
        'Hisobingiz faol bo‘lgan davrda ma’lumotlaringizni saqlaymiz. Hisobni sozlamalarda o‘chirganingizdan so‘ng shaxsiy ma’lumotlar 30 kun ichida o‘chiriladi yoki anonimlashtiriladi, qonun bo‘yicha saqlashimiz shart bo‘lgan yozuvlar bundan mustasno. Zaxira nusxalar muntazam jadval bo‘yicha yangilanadi.',
      ],
    },
    {
      heading: '6. Sizning huquqlaringiz',
      items: [
        'Profil va sozlamalarda ma’lumotlaringizni ko‘rish, to‘g‘rilash va o‘chirish.',
        'Ko‘rinish sozlamasi orqali profilni kim ko‘rishini cheklash.',
        'Google yoki Telegramni uzish va bildirishnoma kanallarini o‘chirish.',
        'Rezyume konstruktoridan rezyumeni PDF ko‘rinishida yuklab olish.',
        `Har qanday so‘rov bilan ${CONTACT} manziliga murojaat qilish yoki shaxsiy ma’lumotlarni himoya qilish bo‘yicha vakolatli organga shikoyat qilish.`,
      ],
    },
    {
      heading: '7. Cookie-fayllar',
      paragraphs: [
        'Biz faqat zarur cookie-fayllar va lokal xotiradan foydalanamiz: kirish seansi, tanlangan til va kabinet sozlamalari. Uchinchi tomon reklama cookie-fayllari ishlatilmaydi.',
      ],
    },
    {
      heading: '8. Xavfsizlik',
      paragraphs: [
        'Ma’lumotlar uzatishda shifrlanadi, parollar xesh ko‘rinishida saqlanadi, kirish faqat zarur bo‘lgan xodimlar bilan cheklanadi, ma’muriy harakatlar jurnalga yoziladi.',
      ],
    },
    {
      heading: '9. Bolalar',
      paragraphs: ['Xizmat 16 yoshga to‘lmagan shaxslar uchun mo‘ljallanmagan.'],
    },
    {
      heading: '10. O‘zgarishlar va aloqa',
      paragraphs: [
        `Biz ushbu Siyosatni yangilashimiz mumkin; muhim o‘zgarishlar Xizmatda e’lon qilinadi. Shaxsiy ma’lumotlar bo‘yicha savollar: ${CONTACT}.`,
      ],
    },
  ],
};

export const LEGAL_DOCS: Record<LegalDocKey, Record<Locale, LegalDoc>> = {
  terms: { uz: termsUz, ru: termsRu, en: termsEn },
  privacy: { uz: privacyUz, ru: privacyRu, en: privacyEn },
};

/** Label shown above the revision date, per locale. */
export const LEGAL_UPDATED_LABEL: Record<Locale, string> = {
  uz: 'Yangilangan',
  ru: 'Обновлено',
  en: 'Last updated',
};
