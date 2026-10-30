import type { LegalDoc } from './legal';

/**
 * Privacy notices for the Indonesia deployment. Keep these market-specific:
 * locale changes wording, never the jurisdiction or responsible entity.
 */
export const INDONESIA_PRIVACY_DOCS: Record<'uz' | 'ru' | 'en' | 'id', LegalDoc> = {
  id: {
    title: 'Kebijakan Privasi',
    updated: '29 Oktober 2026',
    intro:
      'Kebijakan ini berlaku untuk layanan Job Talentio di Indonesia melalui cari-kerja.co.id. PT EGI Resources (“kami”) bertindak sebagai Pengendali Data Pribadi atas pemrosesan yang dijelaskan di sini. Kebijakan ini menjelaskan data yang kami proses, tujuannya, pihak yang dapat menerimanya, masa pemrosesan, dan hak Anda berdasarkan hukum Indonesia, termasuk Undang-Undang Nomor 27 Tahun 2022 tentang Pelindungan Data Pribadi (“UU PDP”).',
    sections: [
      {
        heading: '1. Data yang kami proses',
        items: [
          'Data akun dan kontak, seperti nama, alamat email, nomor telepon, hash kata sandi, foto profil, bahasa antarmuka, serta pengenal dari Google atau Telegram jika Anda memilih metode masuk tersebut.',
          'Data profil dan karier, seperti ringkasan, pengalaman kerja, pendidikan, keahlian, bahasa, sertifikat, preferensi pekerjaan, dan pengaturan visibilitas.',
          'Data CV, termasuk berkas yang Anda unggah, teks yang diekstrak untuk mengisi profil, dan CV yang Anda buat atau kirim saat melamar. Ekstraksi teks CV berjalan pada layanan kami; berkas CV tidak dikirim ke penyedia AI untuk parsing.',
          'Data perusahaan dan rekrutmen, seperti informasi perusahaan, anggota tim, lowongan, pertanyaan penyaringan, lamaran, jawaban, jadwal wawancara, dan pesan.',
          'Data penggunaan dan teknis, seperti lowongan tersimpan, notifikasi, interaksi dengan layanan, alamat IP, informasi perangkat dan browser, serta data yang diperlukan untuk keamanan dan pemecahan masalah.',
        ],
      },
      {
        heading: '2. Tujuan dan dasar pemrosesan',
        items: [
          'Membuat dan mengelola akun, profil, pencarian lowongan, lamaran, komunikasi, dan fitur lain yang Anda minta, berdasarkan pelaksanaan perjanjian atau langkah yang Anda minta sebelum perjanjian.',
          'Menampilkan lowongan yang relevan, pencocokan berdasarkan informasi profil dan lowongan, serta notifikasi yang Anda pilih, untuk menjalankan layanan dan sesuai pengaturan atau persetujuan Anda bila diperlukan.',
          'Menjaga keamanan layanan, mencegah penipuan dan penyalahgunaan, menangani dukungan, serta menjaga keandalan sistem berdasarkan kepentingan yang sah dengan tetap mempertimbangkan hak Anda.',
          'Menggunakan integrasi opsional, seperti menghubungkan akun Telegram atau LinkedIn dan penerjemahan mesin, berdasarkan persetujuan atau tindakan pilihan Anda. Persetujuan dapat ditarik melalui pengaturan yang tersedia atau dengan menghubungi kami.',
          'Memenuhi kewajiban hukum dan menanggapi permintaan yang sah dari pihak berwenang.',
        ],
      },
      {
        heading: '3. Visibilitas dan penerima data',
        paragraphs: [
          'Anda mengatur visibilitas profil sesuai pilihan yang tersedia. Perusahaan dapat melihat profil sesuai pengaturan tersebut dan dapat melihat data yang Anda kirim saat melamar. Anggota tim yang berwenang pada perusahaan penerima dapat memproses data lamaran untuk proses rekrutmen mereka; perusahaan bertanggung jawab atas penggunaan data setelah menerimanya.',
          'Kami tidak menjual data pribadi. Data dapat diproses oleh penyedia yang membantu menjalankan layanan, seperti hosting dan penyimpanan berkas, email, pencarian, serta penyedia login atau komunikasi yang Anda pilih. Penyedia hanya menerima data yang diperlukan untuk fungsi yang digunakan.',
        ],
      },
      {
        heading: '4. Integrasi dan layanan pihak ketiga',
        paragraphs: [
          'Jika Anda memilih masuk dengan Google atau menghubungkan Telegram, layanan tersebut memproses data sesuai kebijakan privasi mereka. Jika perekrut menghubungkan profil LinkedIn pribadi dan secara khusus menyetujui pratinjau posting, data profil perekrut serta isi lowongan yang dipilih dapat dikirim ke LinkedIn untuk menerbitkan posting. Menghubungkan LinkedIn tidak menerbitkan posting tanpa persetujuan atas pratinjaunya.',
          'Jika penerjemahan mesin diaktifkan dan digunakan, teks profil atau konten lain yang diminta untuk diterjemahkan dapat dikirim ke penyedia terjemahan yang dikonfigurasi. Pemrosesan CV untuk ekstraksi teks dilakukan secara lokal di layanan kami dan tidak memakai penyedia tersebut.',
        ],
      },
      {
        heading: '5. Pemrosesan lintas negara',
        paragraphs: [
          'Sebagian penyedia layanan dapat memproses atau menyimpan data di luar Indonesia. Jika transfer lintas negara terjadi, kami menerapkan persyaratan dan perlindungan yang berlaku berdasarkan UU PDP. Lokasi pemrosesan dapat bergantung pada penyedia dan fitur yang Anda gunakan.',
        ],
      },
      {
        heading: '6. Masa pemrosesan dan penghapusan',
        paragraphs: [
          'Kami memproses data selama akun aktif atau selama diperlukan untuk tujuan layanan, keamanan, dan kewajiban hukum. Anda dapat meminta penghapusan akun melalui Pengaturan. Setelah permintaan dapat diproses, data identitas dan profil pada sistem aktif dihapus atau dianonimkan; sebagian catatan rekrutmen dapat tetap disimpan dalam bentuk yang dianonimkan untuk menjaga riwayat dan memenuhi kewajiban yang berlaku.',
          'Salinan cadangan dapat tetap ada sampai siklus rotasi cadangan yang berlaku menghapusnya. Salinan tersebut tidak digunakan sebagai sistem aktif dan aksesnya dibatasi. Data yang wajib dipertahankan berdasarkan hukum hanya disimpan selama jangka waktu yang diwajibkan.',
        ],
      },
      {
        heading: '7. Hak Anda',
        items: [
          'Meminta informasi dan akses ke data pribadi Anda, termasuk salinan dan informasi pemrosesannya.',
          'Melengkapi, memperbarui, atau memperbaiki data yang tidak akurat.',
          'Meminta penghentian pemrosesan, penghapusan, atau pemusnahan data sesuai ketentuan yang berlaku, serta membatasi atau menunda pemrosesan jika memenuhi ketentuan.',
          'Menarik persetujuan yang pernah diberikan, meminta pemindahan data Anda, dan mengajukan keberatan atas keputusan yang hanya didasarkan pada pemrosesan otomatis dan berdampak hukum atau signifikan jika berlaku.',
          'Mengajukan gugatan dan meminta ganti rugi sesuai UU PDP jika hak Anda dilanggar.',
          'Mengajukan permintaan dengan menghubungi info@cari-kerja.co.id. Kami dapat meminta informasi secukupnya untuk memverifikasi identitas dan akan menanggapi sesuai tenggat hukum.',
        ],
      },
      {
        heading: '8. Keamanan dan insiden',
        paragraphs: [
          'Kami menerapkan langkah teknis dan organisasi yang wajar untuk melindungi data, termasuk penggunaan HTTPS, hash kata sandi, pembatasan akses, dan pencatatan tindakan administratif. Jika terjadi kegagalan pelindungan data pribadi, pemberitahuan dilakukan kepada pihak yang diwajibkan sesuai ketentuan dan tenggat UU PDP.',
        ],
      },
      {
        heading: '9. Cookie dan penyimpanan lokal',
        paragraphs: [
          'Kami menggunakan cookie dan penyimpanan lokal yang diperlukan untuk sesi masuk, bahasa pilihan, keamanan, serta preferensi layanan. Kami tidak menggunakan cookie iklan pihak ketiga.',
        ],
      },
      {
        heading: '10. Perubahan dan kontak',
        paragraphs: [
          'Kami dapat memperbarui kebijakan ini. Perubahan penting akan diumumkan melalui layanan. Untuk pertanyaan atau permintaan terkait data pribadi, hubungi PT EGI Resources melalui info@cari-kerja.co.id.',
        ],
      },
    ],
  },
  en: {
    title: 'Privacy Policy',
    updated: '29 October 2026',
    intro:
      'This Policy applies to the Indonesia service operated through cari-kerja.co.id. PT EGI Resources (“we”) is the Personal Data Controller for the processing described here. It explains the data we process, why we process it, who may receive it, how long processing lasts, and your rights under Indonesian law, including Law No. 27 of 2022 on Personal Data Protection (“PDP Law”).',
    sections: [
      {
        heading: '1. Data we process',
        items: [
          'Account and contact data, such as your name, email address, phone number, password hash, profile photo, interface language, and identifiers from Google or Telegram if you choose those sign-in methods.',
          'Profile and career data, such as your summary, work history, education, skills, languages, certificates, job preferences, and visibility settings.',
          'CV data, including files you upload, text extracted to populate your profile, and CVs you create or submit with applications. CV text extraction runs on our service; CV files are not sent to an AI provider for parsing.',
          'Company and recruitment data, such as company details, team members, vacancies, screening questions, applications, answers, interview schedules, and messages.',
          'Usage and technical data, such as saved jobs, notifications, interactions with the service, IP address, device and browser information, and data needed for security and troubleshooting.',
        ],
      },
      {
        heading: '2. Purposes and legal bases',
        items: [
          'To create and manage accounts, profiles, job search, applications, communications, and other features you request, based on performing a contract or taking steps you request before entering one.',
          'To show relevant vacancies, match profile and vacancy information, and send notifications you choose, to operate the service and in accordance with your settings or consent where required.',
          'To secure the service, prevent fraud and abuse, provide support, and maintain system reliability based on legitimate interests while considering your rights.',
          'To use optional integrations, such as linking Telegram or LinkedIn and machine translation, based on your consent or chosen action. You can withdraw consent through available settings or by contacting us.',
          'To meet legal obligations and respond to lawful requests from authorities.',
        ],
      },
      {
        heading: '3. Visibility and recipients',
        paragraphs: [
          'You control profile visibility using the available settings. Employers may see your profile according to those settings and may see data you submit when applying. Authorized team members at the receiving company may process application data for their recruitment; that company is responsible for its use of data after receiving it.',
          'We do not sell personal data. Service providers may process data to help operate the service, including hosting and file storage, email, search, and sign-in or communication providers you choose. Each provider receives only the data needed for the feature used.',
        ],
      },
      {
        heading: '4. Integrations and third-party services',
        paragraphs: [
          'If you choose Google sign-in or link Telegram, those services process data under their own privacy policies. If a recruiter links a personal LinkedIn profile and explicitly approves a post preview, the recruiter’s profile data and selected job content may be sent to LinkedIn to publish the post. Linking LinkedIn does not publish anything without approval of the preview.',
          'If machine translation is enabled and used, profile text or other content you request to translate may be sent to the configured translation provider. CV text extraction takes place locally within our service and does not use that provider.',
        ],
      },
      {
        heading: '5. International processing',
        paragraphs: [
          'Some service providers may process or store data outside Indonesia. If an international transfer occurs, we apply the requirements and safeguards under the PDP Law. Processing locations may depend on the provider and the features you use.',
        ],
      },
      {
        heading: '6. Processing period and deletion',
        paragraphs: [
          'We process data while your account is active or as needed for service delivery, security, and legal obligations. You can request account deletion in Settings. Once the request can be completed, identifying and profile data in active systems is deleted or anonymized; some recruitment records may remain anonymized to preserve history and meet applicable obligations.',
          'Backup copies may remain until the applicable backup rotation removes them. They are not used as active systems and access is restricted. Data that must be retained by law is kept only for the legally required period.',
        ],
      },
      {
        heading: '7. Your rights',
        items: [
          'Request information about and access to your personal data, including a copy and details of its processing.',
          'Complete, update, or correct inaccurate data.',
          'Request that processing stop, be restricted, or be delayed, or that data be erased or destroyed, subject to applicable law.',
          'Withdraw consent, request transfer of your data, and object to decisions based solely on automated processing that have legal or significant effects, where applicable.',
          'Bring a claim and seek compensation as provided by the PDP Law if your rights are violated.',
          'Submit a request to info@cari-kerja.co.id. We may ask for information reasonably needed to verify your identity and will respond within applicable legal deadlines.',
        ],
      },
      {
        heading: '8. Security and incidents',
        paragraphs: [
          'We use reasonable technical and organizational measures to protect data, including HTTPS, password hashing, access restrictions, and administrative audit logs. If a personal data protection failure occurs, we notify the parties required by law within the deadlines set by the PDP Law.',
        ],
      },
      {
        heading: '9. Cookies and local storage',
        paragraphs: [
          'We use cookies and local storage needed for sign-in sessions, language choice, security, and service preferences. We do not use third-party advertising cookies.',
        ],
      },
      {
        heading: '10. Changes and contact',
        paragraphs: [
          'We may update this Policy. Material changes will be announced through the service. For questions or requests about personal data, contact PT EGI Resources at info@cari-kerja.co.id.',
        ],
      },
    ],
  },
  ru: {
    title: 'Политика конфиденциальности',
    updated: '29 октября 2026 г.',
    intro:
      'Эта Политика применяется к сервису в Индонезии на сайте cari-kerja.co.id. PT EGI Resources («мы») является Контролёром персональных данных в отношении описанной здесь обработки. В Политике указаны обрабатываемые данные, цели и сроки обработки, получатели данных и ваши права по законодательству Индонезии, включая Закон № 27 от 2022 года о защите персональных данных («Закон PDP»).',
    sections: [
      {
        heading: '1. Обрабатываемые данные',
        items: [
          'Данные аккаунта и контакты: имя, адрес электронной почты, номер телефона, хеш пароля, фото профиля, язык интерфейса и идентификаторы Google или Telegram, если вы выбрали эти способы входа.',
          'Данные профиля и карьеры: описание, опыт работы, образование, навыки, языки, сертификаты, предпочтения по работе и настройки видимости.',
          'Данные резюме: загруженные файлы, извлечённый для заполнения профиля текст и резюме, созданные или отправленные с откликом. Извлечение текста выполняется внутри нашего сервиса; файлы резюме не отправляются поставщику ИИ для распознавания.',
          'Данные компании и найма: сведения о компании, участники команды, вакансии, вопросы отбора, отклики, ответы, расписание собеседований и сообщения.',
          'Данные об использовании и технические данные: сохранённые вакансии, уведомления, действия в сервисе, IP-адрес, сведения об устройстве и браузере, а также данные для безопасности и устранения неполадок.',
        ],
      },
      {
        heading: '2. Цели и правовые основания',
        items: [
          'Создание и обслуживание аккаунтов, профилей, поиска вакансий, откликов, общения и других запрошенных функций на основании исполнения договора или действий по вашей просьбе до его заключения.',
          'Показ подходящих вакансий, сопоставление данных профиля и вакансии и отправка выбранных вами уведомлений для работы сервиса и в соответствии с настройками или согласием, когда оно требуется.',
          'Защита сервиса, предотвращение мошенничества и злоупотреблений, поддержка пользователей и надёжность системы на основании законных интересов с учётом ваших прав.',
          'Использование необязательных интеграций, например подключения Telegram или LinkedIn и машинного перевода, на основании вашего согласия или выбранного вами действия. Согласие можно отозвать в настройках или, связавшись с нами.',
          'Исполнение требований закона и ответы на законные запросы органов власти.',
        ],
      },
      {
        heading: '3. Видимость и получатели',
        paragraphs: [
          'Вы управляете видимостью профиля с помощью доступных настроек. Работодатели могут видеть профиль согласно этим настройкам и данные, отправленные вами при отклике. Уполномоченные участники команды получившей компании могут обрабатывать данные отклика для найма; после получения данных компания отвечает за их дальнейшее использование.',
          'Мы не продаём персональные данные. Поставщики услуг могут обрабатывать данные для работы сервиса, включая хостинг и хранение файлов, электронную почту, поиск, а также выбранные вами сервисы входа или связи. Каждый поставщик получает только данные, необходимые для используемой функции.',
        ],
      },
      {
        heading: '4. Интеграции и сторонние сервисы',
        paragraphs: [
          'Если вы входите через Google или подключаете Telegram, эти сервисы обрабатывают данные в соответствии со своими политиками конфиденциальности. Если рекрутер подключает личный профиль LinkedIn и явно одобряет предварительный просмотр публикации, данные профиля рекрутера и выбранное содержание вакансии могут быть переданы LinkedIn для публикации. Само подключение LinkedIn не публикует запись без одобрения предварительного просмотра.',
          'Если машинный перевод включён и используется, текст профиля или другой материал, который вы попросили перевести, может быть отправлен настроенному поставщику перевода. Извлечение текста из резюме выполняется локально в нашем сервисе и не использует этого поставщика.',
        ],
      },
      {
        heading: '5. Международная обработка',
        paragraphs: [
          'Некоторые поставщики услуг могут обрабатывать или хранить данные за пределами Индонезии. При международной передаче мы применяем требования и меры защиты, предусмотренные Законом PDP. Место обработки может зависеть от поставщика и используемых функций.',
        ],
      },
      {
        heading: '6. Срок обработки и удаление',
        paragraphs: [
          'Мы обрабатываем данные, пока аккаунт активен, либо пока это необходимо для работы сервиса, безопасности и исполнения требований закона. Удалить аккаунт можно в настройках. После выполнения запроса идентифицирующие данные и данные профиля удаляются или обезличиваются в активных системах; часть обезличенных записей о найме может сохраняться для истории и выполнения применимых обязанностей.',
          'Резервные копии могут сохраняться до их удаления в рамках действующего цикла ротации. Они не используются как активные системы, а доступ к ним ограничен. Данные, которые требуется хранить по закону, сохраняются только в течение установленного срока.',
        ],
      },
      {
        heading: '7. Ваши права',
        items: [
          'Запрашивать информацию и доступ к своим персональным данным, включая копию и сведения об их обработке.',
          'Дополнять, обновлять или исправлять неточные данные.',
          'Просить прекратить, ограничить или отложить обработку, а также удалить или уничтожить данные с учётом применимого законодательства.',
          'Отозвать согласие, запросить перенос данных и возразить против решений, основанных исключительно на автоматизированной обработке и имеющих правовые или существенные последствия, если это применимо.',
          'Обратиться в суд и потребовать возмещения ущерба в случаях и порядке, предусмотренных Законом PDP.',
          'Направить запрос на info@cari-kerja.co.id. Для проверки личности мы можем запросить разумно необходимую информацию и ответим в установленные законом сроки.',
        ],
      },
      {
        heading: '8. Безопасность и инциденты',
        paragraphs: [
          'Мы применяем разумные технические и организационные меры защиты, включая HTTPS, хеширование паролей, ограничение доступа и журналы административных действий. При нарушении защиты персональных данных мы уведомляем предусмотренных законом лиц в сроки, установленные Законом PDP.',
        ],
      },
      {
        heading: '9. Cookies и локальное хранилище',
        paragraphs: [
          'Мы используем cookies и локальное хранилище, необходимые для сеанса входа, выбранного языка, безопасности и настроек сервиса. Сторонние рекламные cookies не используются.',
        ],
      },
      {
        heading: '10. Изменения и контакты',
        paragraphs: [
          'Мы можем обновлять эту Политику. О существенных изменениях сообщается в сервисе. По вопросам или запросам о персональных данных обращайтесь в PT EGI Resources: info@cari-kerja.co.id.',
        ],
      },
    ],
  },
  uz: {
    title: 'Maxfiylik siyosati',
    updated: '2026-yil 29-oktabr',
    intro:
      'Ushbu Siyosat cari-kerja.co.id saytidagi Indoneziya xizmatiga tegishli. PT EGI Resources (“biz”) bu yerda bayon qilingan shaxsga doir ma’lumotlarni qayta ishlash uchun Ma’lumotlar operatori hisoblanadi. Siyosatda qayta ishlanadigan ma’lumotlar, maqsadlar, oluvchilar, qayta ishlash muddati va Indoneziya qonunchiligi, jumladan 2022-yildagi 27-sonli Shaxsga doir ma’lumotlarni himoya qilish to‘g‘risidagi Qonun (“PDP qonuni”) bo‘yicha huquqlaringiz tushuntiriladi.',
    sections: [
      {
        heading: '1. Qayta ishlanadigan ma’lumotlar',
        items: [
          'Hisob va aloqa ma’lumotlari: ism, elektron pochta, telefon raqami, parol xeshi, profil rasmi, interfeys tili hamda tanlangan kirish usuliga qarab Google yoki Telegram identifikatorlari.',
          'Profil va kasbiy ma’lumotlar: qisqacha ma’lumot, ish tajribasi, ta’lim, ko‘nikmalar, tillar, sertifikatlar, ish afzalliklari va ko‘rinish sozlamalari.',
          'Rezyume ma’lumotlari: yuklangan fayllar, profilni to‘ldirish uchun ajratilgan matn hamda yaratilgan yoki arizaga qo‘shib yuborilgan rezyumelar. Rezyumeni matnga aylantirish xizmatimiz ichida bajariladi; CV fayllari tahlil uchun AI provayderiga yuborilmaydi.',
          'Kompaniya va yollash ma’lumotlari: kompaniya tafsilotlari, jamoa a’zolari, vakansiyalar, saralash savollari, arizalar, javoblar, suhbat jadvali va xabarlar.',
          'Foydalanish va texnik ma’lumotlar: saqlangan vakansiyalar, bildirishnomalar, xizmatdagi harakatlar, IP-manzil, qurilma va brauzer ma’lumotlari, xavfsizlik va nosozliklarni tuzatish uchun zarur ma’lumotlar.',
        ],
      },
      {
        heading: '2. Maqsadlar va huquqiy asoslar',
        items: [
          'Hisob, profil, vakansiya qidiruvi, arizalar, muloqot va siz so‘ragan boshqa funksiyalarni taqdim etish uchun: shartnomani bajarish yoki shartnomadan oldingi so‘rovingizni bajarish asosida.',
          'Mos vakansiyalarni ko‘rsatish, profil va vakansiya ma’lumotlarini solishtirish hamda siz tanlagan bildirishnomalarni yuborish uchun: xizmatni ishlatish va zarur joylarda sozlamalaringiz yoki roziligingiz asosida.',
          'Xizmatni himoyalash, firibgarlik va suiiste’molning oldini olish, yordam ko‘rsatish va tizim ishonchliligini ta’minlash uchun: huquqlaringizni hisobga olgan holda qonuniy manfaatlarimiz asosida.',
          'Telegram yoki LinkedIn ulash va mashina tarjimasi kabi ixtiyoriy integratsiyalardan foydalanish uchun: roziligingiz yoki o‘zingiz tanlagan harakat asosida. Rozilikni mavjud sozlamalarda yoki bizga murojaat qilib qaytarib olishingiz mumkin.',
          'Qonuniy majburiyatlarni bajarish va davlat organlarining qonuniy so‘rovlariga javob berish uchun.',
        ],
      },
      {
        heading: '3. Ko‘rinish va ma’lumot oluvchilar',
        paragraphs: [
          'Profil ko‘rinishini mavjud sozlamalar orqali o‘zingiz boshqarasiz. Ish beruvchilar profilni shu sozlamalarga muvofiq va vakansiyaga ariza yuborganingizda taqdim etgan ma’lumotlaringizni ko‘rishi mumkin. Arizani olgan kompaniyaning vakolatli jamoa a’zolari ma’lumotlardan yollash jarayonida foydalanishi mumkin; qabul qilinganidan keyingi foydalanish uchun kompaniyaning o‘zi javob beradi.',
          'Biz shaxsiy ma’lumotlarni sotmaymiz. Xizmatni yuritishda yordam beradigan provayderlar, jumladan hosting va fayl saqlash, elektron pochta, qidiruv, siz tanlagan kirish yoki aloqa xizmatlari ma’lumotlarni qayta ishlashi mumkin. Har bir provayderga faqat ishlatilayotgan funksiya uchun kerakli ma’lumot beriladi.',
        ],
      },
      {
        heading: '4. Integratsiyalar va uchinchi tomon xizmatlari',
        paragraphs: [
          'Google orqali kirsangiz yoki Telegramni ulasangiz, bu xizmatlar ma’lumotlarni o‘z maxfiylik siyosatlariga muvofiq qayta ishlaydi. Rekruter shaxsiy LinkedIn profilini ulab, posting oldindan ko‘rinishini alohida tasdiqlasa, rekruter profili va tanlangan vakansiya mazmuni postni chiqarish uchun LinkedIn’ga yuborilishi mumkin. LinkedIn’ni ulashning o‘zi postni e’lon qilmaydi.',
          'Mashina tarjimasi yoqilgan va ishlatilgan bo‘lsa, tarjima so‘ralgan profil matni yoki boshqa kontent sozlangan tarjima provayderiga yuborilishi mumkin. Rezyumedan matn ajratish xizmatimiz ichida bajariladi va bu provayderdan foydalanmaydi.',
        ],
      },
      {
        heading: '5. Xalqaro qayta ishlash',
        paragraphs: [
          'Ayrim xizmat provayderlari ma’lumotlarni Indoneziyadan tashqarida qayta ishlashi yoki saqlashi mumkin. Xalqaro uzatish yuz bersa, PDP qonunidagi talablar va himoya choralarini qo‘llaymiz. Qayta ishlash joyi provayder va siz foydalanadigan funksiyalarga bog‘liq bo‘lishi mumkin.',
        ],
      },
      {
        heading: '6. Qayta ishlash muddati va o‘chirish',
        paragraphs: [
          'Hisob faol bo‘lganida yoki xizmat, xavfsizlik va qonuniy majburiyatlar uchun zarur bo‘lgan muddatda ma’lumotlarni qayta ishlaymiz. Hisobni Sozlamalar orqali o‘chirishni so‘rashingiz mumkin. So‘rov bajarilgach, faol tizimlardagi shaxsni aniqlovchi va profil ma’lumotlari o‘chiriladi yoki anonimlashtiriladi; yollash tarixini saqlash va amaldagi majburiyatlarni bajarish uchun ayrim yozuvlar anonim shaklda qolishi mumkin.',
          'Zaxira nusxalar amaldagi aylantirish jadvali bo‘yicha o‘chirilguniga qadar saqlanishi mumkin. Ular faol tizim sifatida ishlatilmaydi va ularga kirish cheklangan. Qonun bo‘yicha saqlanishi shart bo‘lgan ma’lumotlar faqat talab qilingan muddatda saqlanadi.',
        ],
      },
      {
        heading: '7. Sizning huquqlaringiz',
        items: [
          'Shaxsiy ma’lumotlaringiz va ularni qayta ishlash haqida axborot hamda ma’lumotlar nusxasini so‘rash.',
          'Noto‘g‘ri ma’lumotlarni to‘ldirish, yangilash yoki tuzatish.',
          'Amaldagi qonun doirasida qayta ishlashni to‘xtatish, cheklash yoki kechiktirishni, ma’lumotlarni o‘chirish yoki yo‘q qilishni so‘rash.',
          'Rozilikni qaytarib olish, ma’lumotlarni ko‘chirishni so‘rash va faqat avtomatlashtirilgan qayta ishlashga asoslangan, huquqiy yoki jiddiy ta’sir ko‘rsatadigan qarorlarga e’tiroz bildirish.',
          'PDP qonuniga muvofiq sudga murojaat qilish va zarar qoplanishini talab qilish.',
          'So‘rovni info@cari-kerja.co.id manziliga yuboring. Shaxsingizni tasdiqlash uchun zarur ma’lumotni so‘rashimiz mumkin; qonunda belgilangan muddatlarda javob beramiz.',
        ],
      },
      {
        heading: '8. Xavfsizlik va hodisalar',
        paragraphs: [
          'Ma’lumotlarni himoya qilish uchun HTTPS, parol xeshlari, kirish cheklovlari va ma’muriy harakatlar jurnali kabi oqilona texnik va tashkiliy choralarni qo‘llaymiz. Shaxsga doir ma’lumotlar himoyasi buzilsa, qonun talab qilgan tomonlarga PDP qonunida belgilangan muddatlarda xabar beramiz.',
        ],
      },
      {
        heading: '9. Cookie va lokal saqlash',
        paragraphs: [
          'Kirish seansi, tanlangan til, xavfsizlik va xizmat sozlamalari uchun zarur cookie hamda lokal saqlashdan foydalanamiz. Uchinchi tomon reklama cookie-fayllaridan foydalanmaymiz.',
        ],
      },
      {
        heading: '10. O‘zgarishlar va aloqa',
        paragraphs: [
          'Ushbu Siyosatni yangilashimiz mumkin. Muhim o‘zgarishlar xizmat orqali e’lon qilinadi. Shaxsiy ma’lumotlar bo‘yicha savol yoki so‘rovlar uchun PT EGI Resources bilan info@cari-kerja.co.id orqali bog‘laning.',
        ],
      },
    ],
  },
};
