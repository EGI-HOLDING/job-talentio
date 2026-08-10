/** Uzbek and Russian versions of the curated news articles, keyed by slug. */
export type NewsTranslation = {
  title: string;
  excerpt: string;
  /** Same paragraph structure as the source: blocks separated by a blank line. */
  body: string;
};

/**
 * Keys mirror `NEWS_ARTICLES` in common/news-catalog.ts, which stays the source
 * of truth for slugs, covers, sources and publication dates. Only the editorial
 * text lives here.
 */
export const NEWS_TRANSLATIONS: Record<string, { uz: NewsTranslation; ru: NewsTranslation }> = {
  // ---------------------------------------------------------------- CAREER
  'it-park-residents-tech-hiring-tashkent': {
    uz: {
      title: 'IT Park rezidentlari ko‘paygani sari IT kadrlarga talab ortmoqda',
      excerpt:
        'IT Park Uzbekistan rezidentlari dasturchilar, QA muhandislari va mahsulot bo‘yicha mutaxassislarni yollashda davom etmoqda — tajribali nomzodlar uchun raqobat esa Toshkentda ham, viloyatlarda ham kuchayib bormoqda.',
      body: [
        'IT Park Uzbekistan ish boshlagan paytdagi bir necha rezidentdan Toshkent va viloyat markazlarini qamrab olgan umummilliy tarmoqqa aylandi. Rezidentlar dasturiy ta’minot eksportida sezilarli soliq imtiyozlariga ega — bu ekotizimga ham mahalliy startaplarni, ham xorijiy servis kompaniyalarini tortishda davom etmoqda. Har bir yangi rezident esa yangi ish beruvchi degani.',
        'Ish izlayotganlar uchun buning amaliy natijasi oddiy: backend va frontend dasturchilar, QA muhandislari, DevOps mutaxassislari va product managerlarga talab taklifdan ustun bo‘lib qolmoqda. Eng qattiq raqobat ikki-to‘rt yillik tajribaga ega o‘rta darajali muhandislar uchun ketadi, ingliz tili esa maoshga eng ko‘p ta’sir qiluvchi omil bo‘lib qolmoqda — rezidentlarning ko‘pchiligi xorijiy mijozlar bilan ishlaydi.',
        'Karyerasining boshida turganlar uchun eng oqilona yo‘l — ichki akademiyasi yoki amaliyotdan so‘ng ishga olish yo‘nalishi bor rezidentlarni tanlash. Bunday dasturlar aynan tajribali mutaxassislar tanqisligi tufayli paydo bo‘lgan va ular o‘quv kurslaridan real ishlab chiqarish kodiga o‘tishning eng tez, halol yo‘li.',
        'Rekruterlar esa natija ko‘rsatgan har bir nomzod uchun qarshi taklif odatiy holga aylanganini hisobga olishi kerak. Aniq o‘sish yo‘li va masofadan ishlash imkoniyati bugun asosiy maosh raqami bilan bir xil darajada muhim.',
      ].join('\n\n'),
    },
    ru: {
      title: 'Резидентов IT Park всё больше — и спрос на IT-кадры растёт',
      excerpt:
        'Компании-резиденты IT Park Uzbekistan продолжают набирать разработчиков, QA-инженеров и продуктовых специалистов, а конкуренция за опытных кандидатов растёт и в Ташкенте, и в регионах.',
      body: [
        'IT Park Uzbekistan вырос из нескольких резидентов на старте в национальную сеть, которая охватывает Ташкент и региональные центры. Резиденты получают существенные налоговые льготы на экспорт программного обеспечения, и это продолжает притягивать в экосистему как местные стартапы, так и зарубежные сервисные компании. А каждый новый резидент — это новый работодатель.',
        'Для соискателей практический вывод простой: спрос на backend- и frontend-разработчиков, QA-инженеров, DevOps-специалистов и продакт-менеджеров по-прежнему превышает предложение. Самый острый дефицит — инженеры среднего уровня с двумя-четырьмя годами опыта, а знание английского остаётся главным множителем зарплаты, потому что многие резиденты работают на зарубежных клиентов.',
        'Тем, кто только начинает карьеру, стоит присматриваться к резидентам с внутренними академиями и программами «стажировка — трудоустройство». Они появились именно из-за дефицита сильных специалистов и остаются самым быстрым честным путём от учебных задач к коду в продакшене.',
        'Рекрутерам же стоит исходить из того, что контрофферы для кандидатов с подтверждённым результатом стали нормой. Понятная траектория роста и возможность работать удалённо сегодня весят не меньше, чем цифра оклада.',
      ].join('\n\n'),
    },
  },
  'remote-work-uzbek-developers-global-companies': {
    uz: {
      title: 'Remote-first: o‘zbek dasturchilari xalqaro mijozni qanday topadi',
      excerpt:
        'Eksportga qaratilgan imtiyozlar, internet sifatining yaxshilanishi va yetilib borayotgan frilans madaniyati xorijiy kompaniyalarda masofadan ishlashni odatiy karyera yo‘liga aylantirmoqda.',
      body: [
        'O‘zbekistonlik dasturchilarning tobora ko‘proq qismi uyidan chiqmasdan chet elda joylashgan kompaniyalarda ishlaydi. IT Park rezidentligi bilan bog‘liq eksportga qulay tartib mahalliy kompaniyalarga xorijiy mijozlar bilan hisob-kitob qilishni osonlashtiradi, alohida mutaxassislar esa servis kompaniyalari orqali yoki to‘g‘ridan-to‘g‘ri shartnoma asosida xalqaro jamoalarga qo‘shilmoqda.',
        'Ishlaydigan formula shunday: ochiq portfolio (GitHub va bir-ikki ishga tushirilgan loyiha), ingliz tilidagi aniq maqsadli rezyume va xorijiy ish beruvchilar haqiqatan qidiradigan platformalarda doimiy faollik. Yevropa bilan vaqt mintaqasi mos kelishi — yetarlicha qadrlanmagan ustunlik: Toshkentdagi ertalabki soatlar Yevropa jamoalarining standaplariga bemalol to‘g‘ri keladi.',
        'Masofaviy ish o‘rinlarida maosh odatda xorijiy valyutada belgilanadi — shu sababli remote formatda ishlay oladigan muhandislar mahalliy maosh tadqiqotlarining yuqori qismini egallaydi. Buning evaziga mustaqil muloqotga talab ham yuqori: yozma ingliz tili, asinxron hisobotlar va muddatni halol baholash algoritmlar bilan bir qatorda tekshiriladi.',
        'Kerak bo‘lsa, kichikroq qadamdan boshlang: open-source loyihalarga hissa qo‘shish va pullik sinov loyihalari uzoq muddatli shartnomaga sovuq murojaatlardan ancha ko‘p aylanadi.',
      ].join('\n\n'),
    },
    ru: {
      title: 'Remote-first: как узбекские разработчики выходят на зарубежных клиентов',
      excerpt:
        'Экспортные льготы, растущее качество связи и зрелая фриланс-культура превращают удалённую работу на зарубежные компании в обычный карьерный путь.',
      body: [
        'Всё больше узбекских разработчиков работают на компании с головными офисами за рубежом, не покидая страну. Экспортно ориентированный режим для резидентов IT Park позволяет местным компаниям без сложностей выставлять счета зарубежным клиентам, а отдельные специалисты всё чаще попадают в глобальные команды через сервисные компании или напрямую по контракту.',
        'Работающая схема выглядит так: открытое портфолио (GitHub плюс один-два задеплоенных проекта), сфокусированное резюме на английском и постоянное присутствие на площадках, где зарубежные работодатели действительно ищут людей. Совпадение часовых поясов с Европой — недооценённое преимущество: утро в Ташкенте хорошо накладывается на стендапы европейских команд.',
        'Вознаграждение по удалённым позициям обычно указывают в валюте — поэтому инженеры, готовые к remote-формату, держатся в верхней части местных зарплатных обзоров. Плата за это — более высокие требования к самостоятельной коммуникации: письменный английский, асинхронные апдейты и честная оценка сроков проверяются не менее строго, чем алгоритмы.',
        'Если нужно, начните с малого: вклад в open-source и небольшие оплачиваемые пилотные проекты превращаются в долгосрочные контракты гораздо чаще, чем отклики «в холодную».',
      ].join('\n\n'),
    },
  },
  'banking-digitalization-fintech-careers': {
    uz: {
      title: 'Fintech eng yaxshi to‘lanadigan karyera yo‘nalishiga aylanmoqda',
      excerpt:
        'Banklarning raqamlashuvi va mobil to‘lovlar bumi nafaqat dasturchilarga, balki mahsulot, xavfsizlik va QA mutaxassislariga ham barqaror talab yaratdi.',
      body: [
        'O‘zbekiston banklari chakana xizmatlarni raqamlashtirish bo‘yicha ochiq poygada, mahalliy to‘lov ilovalari esa naqd pulsiz to‘lovni millionlab odam uchun kundalik odatga aylantirdi. Hamyondagi har bir funksiya ortida ishga olish yo‘nalishi turadi: mobil dasturchilar, product managerlar, firibgarlikka qarshi kurash va axborot xavfsizligi analitiklari, QA avtomatlashtirish muhandislari hamda compliance mutaxassislari.',
        'Fintech kompaniyalari bozor o‘rtachasidan yuqori to‘laydi, chunki xatoning narxi qimmat va regulyator talablari real. Ular lavozimni ham tezroq oshiradi: to‘lov oqimini boshidan oxirigacha tushunadigan QA muhandisi klassik autsorsingga qaraganda ancha tez lead darajasiga chiqadi.',
        'Sohaga kirish bo‘yicha maslahat unchalik jozibali emas, lekin ishlaydi. Karta protsessingi, P2P o‘tkazmalar va KYC qanday ishlashini o‘rganing; mahalliy to‘lov tizimlarining ochiq hujjatlarini o‘qing; suhbatda tranzaksiyaning hayotiy siklini tushuntirishni mashq qiling. Aynan soha bilimi sizni ajratib turadi, chunki toza kod yozish mahoratini topish to‘lovlarni tushunadigan odamni topishdan osonroq.',
        'Vakansiyalarda ISO 8583, anti-fraud yoki mobil SDK tilga olingan o‘rinlarni kuzatib boring — bunday jamoalar odatda odamlarga uzoq muddatga sarmoya kiritadi.',
      ].join('\n\n'),
    },
    ru: {
      title: 'Финтех — одно из самых высокооплачиваемых направлений',
      excerpt:
        'Цифровизация банков и бум мобильных платежей создали устойчивый спрос не только на разработчиков, но и на продуктовых специалистов, безопасников и QA.',
      body: [
        'Банки Узбекистана наперегонки цифровизируют розничные сервисы, а местные платёжные приложения сделали безналичную оплату ежедневной привычкой для миллионов. За каждой функцией кошелька стоит своя воронка найма: мобильные разработчики, продакт-менеджеры, аналитики по фроду и информационной безопасности, QA-автоматизаторы и специалисты по комплаенсу.',
        'Финтех-компании обычно платят выше медианы по рынку: цена ошибки высока, а требования регулятора вполне реальны. Растут в них тоже быстрее: QA-инженер, который понимает платёжный поток от начала до конца, доходит до уровня лида заметно быстрее, чем в классическом аутсорсинге.',
        'Совет по входу в отрасль звучит скучно, но работает. Разберитесь, как на самом деле устроены карточный процессинг, P2P-переводы и KYC; прочитайте открытую документацию местных платёжных систем; потренируйтесь объяснять жизненный цикл транзакции на интервью. Отличает кандидата именно знание домена — чистый навык программирования найти проще, чем понимание платежей.',
        'Следите за вакансиями, где упоминаются ISO 8583, антифрод или мобильные SDK: такие команды обычно вкладываются в людей на долгую перспективу.',
      ].join('\n\n'),
    },
  },
  'salary-negotiation-uzbekistan-guide': {
    uz: {
      title: 'Ish suhbatida maosh haqida qanday gaplashish kerak',
      excerpt:
        'Maosh haqidagi suhbatlar ochiqroq bo‘lib bormoqda, lekin ular hamon mahalliy qoidalarga bo‘ysunadi. Raqamni belgilash, diapazon va qarshi taklif haqida qisqa amaliy qo‘llanma.',
      body: [
        'O‘zbekistonning xususiy sektorida maosh shaffofligi yaxshilandi: vakansiyalarda diapazon ko‘rsatilishi ko‘paydi, nomzodlar esa umumiy kompensatsiya haqida uyalmasdan so‘ray boshladi. Shunga qaramay, muzokaraning o‘zi bilib qo‘yishga arziydigan qoidalar bo‘yicha kechadi.',
        'Birinchi qoida: bozorni suhbatdan keyin emas, oldin bilib oling. Ochiq maosh tadqiqotlari, kasbiy chatlar va vakansiyalarda ko‘rsatilgan diapazonlar sizning darajangiz va stekingiz uchun asoslangan koridor beradi. Himoya qila oladigan raqamni aytish (“Toshkentda ishlab chiqarishda Go tajribasi bor o‘rta darajali backend dasturchi”) ochko‘zlik emas, professionallik sifatida qabul qilinadi.',
        'Ikkinchi qoida: imkoni bo‘lsa, diapazonni ish beruvchi aytsin, muzokarani esa butun paket bo‘yicha olib boring — sinov muddati shartlari, maoshni ko‘rib chiqish vaqti, masofadan ishlash kunlari, o‘qish uchun budjet va bonuslar ko‘pincha asosiy maoshdan osonroq o‘zgaradi. Kelishilgan mezonlar bilan uch oydan keyin kafolatlangan qayta ko‘rib chiqish bugungi kichik qo‘shimchadan ko‘ra qimmatliroq bo‘lib chiqadi.',
        'Va oxirgisi: qarshi taklifga ehtiyotkorlik bilan yondashing. Hozirgi ish beruvchining taklifini qabul qilish pul masalasini yechadi, lekin siz boshqa joyda suhbatga borgan sabablarni kamdan-kam hal qiladi. Qanday qaror qilsangiz ham, ishtirok etgan barcha kompaniyalar bilan muloqotni xushmuomalalik bilan yakunlang — bozor kichik, rekruterlar esa eslab qoladi.',
      ].join('\n\n'),
    },
    ru: {
      title: 'Как говорить о зарплате на собеседовании в Узбекистане',
      excerpt:
        'Разговоры о зарплате становятся прозрачнее, но всё ещё живут по местным правилам. Короткий практический гид: якорь, диапазоны и контроффер.',
      body: [
        'Прозрачность зарплат в частном секторе Узбекистана выросла: всё больше вакансий указывают диапазон, а кандидаты без стеснения спрашивают о полном пакете. И всё же сами переговоры идут по правилам, которые стоит знать.',
        'Во-первых, изучите рынок до интервью, а не после. Открытые зарплатные обзоры, профессиональные чаты и указанные в вакансиях диапазоны дают вам обоснованный коридор для вашего грейда и стека. Названная цифра, которую вы можете объяснить («backend среднего уровня с продакшен-опытом на Go в Ташкенте»), читается как профессионализм, а не как жадность.',
        'Во-вторых, по возможности пусть диапазон назовёт работодатель, а торгуйтесь за весь пакет: условия испытательного срока, срок пересмотра зарплаты, удалённые дни, бюджет на обучение и бонусы часто двигаются легче, чем оклад. Гарантированный пересмотр через три месяца с согласованными критериями нередко стоит больше, чем небольшая надбавка сегодня.',
        'И последнее: с контрофферами будьте аккуратны. Согласие на предложение текущего работодателя закрывает вопрос денег, но редко закрывает причины, по которым вы вообще пошли на собеседования. Что бы вы ни решили, вежливо доведите диалог до конца со всеми компаниями — рынок небольшой, и рекрутеры всё помнят.',
      ].join('\n\n'),
    },
  },

  // --------------------------------------------------------------- INSIGHT
  'labor-market-youth-skills-gap': {
    uz: {
      title: 'Yiliga yuz minglab yangi ishchi kuchi: yoshlar to‘lqini ichida',
      excerpt:
        'O‘zbekiston aholisi mintaqadagi eng yosh aholidan biri. Bu ulkan imkoniyat — va bir vaqtning o‘zida ish beruvchilar ham, ta’lim tizimi ham hal qilishi kerak bo‘lgan ko‘nikmalar muvofiqligi masalasi.',
      body: [
        'Har yili bir necha yuz ming o‘zbekistonlik yosh mehnat bozoriga kirib keladi — bu Markaziy Osiyodagi eng yuqori ko‘rsatkichlardan biri. Xalqaro taraqqiyot institutlari doimo bir xil paradoksni qayd etadi: ish beruvchilar bo‘sh o‘rinlarni to‘ldira olmayotganini aytadi, yosh bitiruvchilar esa birinchi ishni topish qiyinligidan gapiradi.',
        'Muammo kamdan-kam holda diplomda. U amaliy ko‘nikmalarda to‘planadi: amaliy IT, texnik ingliz tili, zamonaviy savdo va jamoada ishlash bilan yozma muloqot kabi soft skill’lar. Ish joyida tizimli o‘qitish yo‘lga qo‘yilgan sohalar (IT xizmatlar, zamonaviy chakana savdo, logistika) yosh kadrlarni tayyor mutaxassis kutadigan sohalarga qaraganda ancha tez o‘zlashtiradi.',
        'Ish izlayotganlar uchun xulosa: birinchi ishga shogirdlik davri sifatida qarang — lavozim nomi emas, o‘rganish zichligini tanlang. Ish beruvchilar uchun esa bitiruvchilar dasturi va pullik amaliyot endi chiroyli brending emas: raqobatchilardan oldin junior oqimini ta’minlashning yagona ishonchli yo‘li.',
        'Ko‘nikmalarni ko‘rinadigan qiladigan platformalar — portfolio, tasdiqlangan sertifikatlar, tizimli baholash — har yili ko‘proq ahamiyat kasb etadi, chunki nomzodlar soni qo‘lda saralashni imkonsiz qilib qo‘ydi.',
      ].join('\n\n'),
    },
    ru: {
      title: 'Сотни тысяч новых работников в год: внутри молодёжной волны',
      excerpt:
        'У Узбекистана одно из самых молодых населений в регионе. Это огромная возможность — и одновременно вызов для работодателей и системы образования: навыки не совпадают со спросом.',
      body: [
        'Каждый год на рынок труда выходят несколько сотен тысяч молодых узбекистанцев — один из самых высоких показателей в Центральной Азии. Международные институты развития стабильно фиксируют один и тот же парадокс: работодатели не могут закрыть вакансии, а молодые выпускники не могут найти первую работу.',
        'Разрыв почти никогда не в дипломах. Он концентрируется в прикладных навыках: практическое IT, технический английский, современные продажи, а также умение работать в команде и понятно писать. Отрасли с выстроенным обучением на рабочем месте (IT-услуги, современный ритейл, логистика) впитывают молодых людей гораздо быстрее, чем те, где ждут готового специалиста.',
        'Для соискателей вывод такой: относитесь к первой работе как к ученичеству — выбирайте плотность обучения, а не название должности. Для работодателей программы для выпускников и оплачиваемые стажировки перестали быть красивым брендингом: это единственный надёжный способ обеспечить поток джунов раньше конкурентов.',
        'Платформы, которые делают навыки видимыми — портфолио, подтверждённые сертификаты, структурированная оценка, — будут значить всё больше: при таком объёме кандидатов отбор вручную попросту невозможен.',
      ].join('\n\n'),
    },
  },
  'digital-uzbekistan-2030-jobs': {
    uz: {
      title: '“Digital Uzbekistan 2030” keyingi ishingizga qanday ta’sir qiladi',
      excerpt:
        'Milliy raqamlashtirish strategiyasi faqat elektron hukumat portallari haqida emas. U butun iqtisodiyot bo‘ylab qaysi ko‘nikmalar moliyalanishini, o‘qitilishini va ishga olinishini o‘zgartiradi.',
      body: [
        '“Digital Uzbekistan 2030” strategiyasi shijoatli yo‘nalish belgilab berdi: davlat xizmatlarini raqamlashtirish, IT sohasining iqtisodiyotdagi ulushini oshirish va aloqa infratuzilmasini har bir viloyatga yetkazish. Bu miqyosdagi strategiyalar mehnat bozorini haqiqatan qo‘zg‘atadi, chunki ular ortidan budjetlar keladi.',
        'Ishga olishdagi uchta ta’sir allaqachon ko‘rinib turadi. Davlat idoralari va davlat ulushi bor korxonalarga eski jarayonlarni zamonaviylashtira oladigan product ownerlar, analitiklar va integratsiya muhandislari kerak. Telekom va infratuzilma kompaniyalari qamrov kengaygani sari tarmoq va cloud mutaxassislarini yollashda davom etmoqda. An’anaviy sohalarning har birida — bank, logistika, chakana savdo, qishloq xo‘jaligi — sohani yaxshi biladigan tajribali kadrlar bilan yosh texnologlarni birlashtirgan raqamli transformatsiya jamoalari paydo bo‘ldi.',
        'Toshkentdan tashqarida yashaydigan nomzodlar uchun bu eng muhim tendensiya: viloyat IT markazlari, raqamli savodxonlik dasturlari va masofadan ishlashga moslashgan davlat loyihalari imkoniyatni ataylab poytaxtdan tashqariga chiqarmoqda.',
        'Strategik ko‘nikmalar bo‘yicha tanlov o‘zgarmayapti: ma’lumotlar tahlili, kiberxavfsizlik, cloud infratuzilmasini boshqarish va biznes tili bilan texnik ijro o‘rtasida ko‘prik bo‘lish qobiliyati. Bu to‘rttasi strategiya tegadigan har qanday sohada asqotadi.',
      ].join('\n\n'),
    },
    ru: {
      title: 'Что «Цифровой Узбекистан — 2030» значит для вашей карьеры',
      excerpt:
        'Национальная стратегия цифровизации — это не только порталы электронного правительства. Она меняет, какие навыки финансируют, чему учат и кого нанимают во всей экономике.',
      body: [
        'Стратегия «Цифровой Узбекистан — 2030» задала амбициозное направление: цифровизировать государственные услуги, увеличить долю IT в экономике и довести связь до каждого региона. Стратегии такого масштаба реально двигают рынок труда, потому что за ними идут бюджеты.',
        'Три эффекта для найма видны уже сейчас. Госорганам и компаниям с государственным участием нужны product owner’ы, аналитики и интеграционные инженеры, способные перестроить устаревшие процессы. Телеком и инфраструктурные игроки продолжают набирать сетевых и cloud-специалистов по мере расширения покрытия. А в каждой традиционной отрасли — банки, логистика, ритейл, сельское хозяйство — появились команды цифровой трансформации, где ветераны отрасли работают вместе с молодыми технологами.',
        'Для кандидатов за пределами Ташкента это самый важный тренд: региональные IT-центры, программы цифровой грамотности и государственные проекты с удалённым форматом целенаправленно выводят возможности за пределы столицы.',
        'Ставки на навыки остаются стабильными: анализ данных, кибербезопасность, эксплуатация облаков и умение переводить с языка бизнеса на язык технической реализации. Эти четыре навыка работают в любой отрасли, до которой доходит стратегия.',
      ].join('\n\n'),
    },
  },
  'women-in-tech-uzbekistan': {
    uz: {
      title: 'Ayollar O‘zbekiston IT sohasida tobora katta ulushni egallamoqda',
      excerpt:
        'Stipendiyalar, jamoat dasturlari va ko‘zga ko‘rinadigan namunali mutaxassislar IT sohasida ayollar ulushini barqaror oshirmoqda — ish beruvchilar esa bu oqim uchun raqobat qilmoqda.',
      body: [
        'O‘zbekiston IT sohasida ayollar ulushi barqaror o‘sib bormoqda: bunga maxsus stipendiyalar, qizlar uchun dasturlash bootcamplari va xalqaro tashkilotlar ko‘magidagi jamoat tashabbuslari yordam beryapti. O‘zgarish ishga olish tadbirlarida ko‘rinadi: besh yil oldin butunlay erkaklardan iborat bo‘lgan jamoalar bugun aralash nomzodlar ro‘yxatini suhbatga chaqirishni odatiy hol deb biladi.',
        'Dasturlar muhim, lekin iqtisodiy mantiq ham shunchalik muhim. IT moslashuvchan formatlarni taklif qiladi — masofadan ishlash, to‘liq bo‘lmagan ish kuni, loyiha asosidagi hamkorlik — va bu ko‘p an’anaviy kasblarga qaraganda turli hayotiy sharoitlarga to‘g‘ri keladi. QA, biznes-tahlil, dizayn va ma’lumotlar bilan ishlash odatiy kirish nuqtalariga aylandi, ishonch va jamoa ko‘magi ortgani sari muhandislik yo‘nalishlari ham ergashadi.',
        'Bu kadrlarni qo‘lga kirita oladigan ish beruvchilar uch ishni izchil bajaradi: maosh diapazonini oshkor qiladi (bu ayollarning murojaatlari sonini o‘lchanadigan darajada oshiradi), stress-suhbat o‘rniga tizimli intervyu o‘tkazadi va stok rasmlar emas, yuqori texnik lavozimlardagi haqiqiy ayollarni ko‘rsatadi.',
        'Yo‘nalish aniq: bugun inklyuziv kadr oqimini qurayotgan kompaniyalar kutib turganlarga qaraganda shunchaki ko‘proq nomzod orasidan tanlaydi.',
      ].join('\n\n'),
    },
    ru: {
      title: 'Женщины занимают всё большую долю в IT Узбекистана',
      excerpt:
        'Стипендии, общественные программы и заметные ролевые модели устойчиво повышают долю женщин в IT — и работодатели уже конкурируют за этот поток.',
      body: [
        'Доля женщин в IT-секторе Узбекистана устойчиво растёт: этому помогают адресные стипендии, курсы программирования для девушек и общественные инициативы при поддержке международных организаций. Перемены видны на карьерных мероприятиях: команды, которые пять лет назад были полностью мужскими, сегодня как норму собеседуют смешанные шортлисты.',
        'Программы важны, но не менее важна экономика. IT предлагает гибкие форматы — удалённая работа, частичная занятость, проектное сотрудничество, — которые подходят более широкому кругу жизненных обстоятельств, чем многие традиционные профессии. QA, бизнес-анализ, дизайн и работа с данными стали типичными точками входа, а инженерные треки подтягиваются по мере роста уверенности и поддержки сообщества.',
        'Работодатели, которые выигрывают борьбу за эти кадры, делают три вещи последовательно: публикуют зарплатные диапазоны (это измеримо повышает долю женских откликов), проводят структурированные интервью вместо стресс-тестов и показывают реальных женщин на senior-позициях, а не стоковые фотографии.',
        'Направление очевидно: компании, которые строят инклюзивные каналы найма сейчас, просто будут выбирать из большего числа кандидатов, чем те, кто ждёт.',
      ].join('\n\n'),
    },
  },
  'tashkent-regional-bpo-hub': {
    uz: {
      title: 'Toshkent Markaziy Osiyoning autsorsing markaziga aylanmoqchi',
      excerpt:
        'Raqobatbardosh xarajatlar, bir necha tilni biladigan bitiruvchilar va maqsadli imtiyozlar BPO va IT-xizmat shartnomalarini O‘zbekistonga olib kelmoqda. Bu ish o‘rinlari uchun nimani anglatadi?',
      body: [
        'Biznes-jarayonlarni autsorsing qilish (BPO) — O‘zbekistonda eng kam gapiriladigan, ammo eng barqaror ish o‘rni yaratuvchi sohalardan biri. Toshkent va viloyat shaharlaridagi servis markazlari Yevropa, Fors ko‘rfazi davlatlari va MDH mijozlari uchun dasturiy ta’minot ishlab chiqish, qo‘llab-quvvatlash, ma’lumotlar bilan ishlash va back-office vazifalarini bajaradi.',
        'Xorijiy mijozlarga taklif oddiy: raqobatbardosh xarajatlar, bir necha tilni biladigan katta bitiruvchilar bazasi (o‘zbek, rus, ingliz, tobora ko‘proq nemis va koreys tillari) va IT-xizmat eksportiga qaratilgan davlat imtiyozlari — shu qatorda xorijiy mutaxassislar va rezidentlar uchun soddalashtirilgan tartiblar.',
        'Nomzodlar uchun BPO — yetarlicha qadrlanmagan boshlang‘ich maydon. Qo‘llab-quvvatlash va operatsion lavozimlar keyinchalik mahsulot kompaniyalari pul to‘laydigan jarayon intizomini aynan shu yerda o‘rgatadi, support’dan QA’ga, so‘ng muhandislikka o‘tish esa allaqachon oyoq bosilgan yo‘l. Til bilimi bu sohada boshqa deyarli har qanday sohaga qaraganda to‘g‘ridan-to‘g‘ri maoshga aylanadi.',
        'Ochig‘ini aytish kerak: BPO’da boshlang‘ich maosh kamtarona, xalqaro mijozlar bilan ishlaganda esa smenali grafik odatiy hol. Birinchi yilni pullik o‘qish deb qabul qiling, ikkinchisini esa ongli ravishda rejalashtiring.',
      ].join('\n\n'),
    },
    ru: {
      title: 'Ташкент претендует на роль аутсорсинг-столицы Центральной Азии',
      excerpt:
        'Конкурентные издержки, многоязычные выпускники и адресные льготы притягивают BPO- и IT-сервисные контракты в Узбекистан. Что это значит для рабочих мест?',
      body: [
        'Аутсорсинг бизнес-процессов — один из самых незаметных, но самых стабильных создателей рабочих мест в Узбекистане. Сервисные центры в Ташкенте и региональных городах занимаются разработкой ПО, поддержкой, работой с данными и бэк-офисом для клиентов из Европы, Персидского залива и СНГ.',
        'Аргументы для зарубежных клиентов простые: конкурентные издержки, большой пул многоязычных выпускников (узбекский, русский, английский, всё чаще немецкий и корейский) и государственные льготы для экспорта IT-услуг, включая упрощённые режимы для иностранных специалистов и резидентов.',
        'Для кандидатов BPO — недооценённая стартовая площадка. Роли в поддержке и операциях учат именно той процессной дисциплине, за которую позже платят продуктовые компании, а путь «поддержка — QA — разработка» внутри компании хорошо протоптан. Знание языков здесь конвертируется в зарплату напрямую, как почти ни в одной другой отрасли.',
        'Честная оговорка: стартовые зарплаты в BPO скромные, а на глобальных аккаунтах часто бывает сменный график. Первый год стоит воспринимать как оплачиваемое обучение, а второй — планировать осознанно.',
      ].join('\n\n'),
    },
  },

  // ----------------------------------------------------------------- EVENT
  'ict-week-uzbekistan-tashkent': {
    uz: {
      title: 'ICT Week Toshkentga qaytadi: ish izlovchi u yerda nima qilishi kerak',
      excerpt:
        'O‘zbekistonning eng yirik texnologiya haftaligi startaplar, yirik kompaniyalar va davlat idoralarini bir joyga to‘playdi. Unga ishga olish tadbiri sifatida qarash kerak — ish beruvchilar aynan shunday qaraydi.',
      body: [
        'Har kuzda ICT Week Toshkentni mintaqaning texnologiya uchrashuv nuqtasiga aylantiradi: rezident kompaniyalarning ko‘rgazma zallari, startap tanlovlari, davlat raqamlashtirish loyihalarining namoyishi va sohadagi har bir yirik ish beruvchining yon tadbirlari.',
        'Ish izlovchilar bu imkoniyatdan doim to‘liq foydalanmaydi. Stendlarda faqat marketologlar emas, kadr izlab kelgan team lead va CTO’lar ham turadi — real loyiha haqidagi o‘n daqiqalik suhbat ellikta onlayn murojaatdan foydali. O‘zingiz bilan qisqa rezyume, telefonda ochiladigan portfolio havolasi va kompaniyaning haqiqiy texnologiya steki haqida ikki-uch aniq savol olib boring.',
        'Startap tanlovlariga alohida e’tibor bering. Sarmoya olgan yoki g‘olib bo‘lgan jamoalar bir necha hafta ichida odam yollay boshlaydi va ular sovrin e’lon qilinishidan oldin o‘zlariga yaqinlashgan odamlarni eslab qoladi.',
        'Shaxsan borish imkoni bo‘lmasa, dasturni onlayn kuzatib boring: ma’ruzalar yozib olinadi, g‘oliblar ro‘yxati e’lon qilinadi, muayyan ma’ruzaga havola qilgan o‘z vaqtidagi xat esa sovuq murojaatdan sezilarli darajada yaxshi ishlaydi.',
      ].join('\n\n'),
    },
    ru: {
      title: 'ICT Week снова в Ташкенте: что там делать соискателю',
      excerpt:
        'Главная технологическая неделя Узбекистана собирает стартапы, корпорации и государство в одном месте. Относитесь к ней как к карьерному событию — работодатели именно так и делают.',
      body: [
        'Каждую осень ICT Week превращает Ташкент в технологическую точку сбора региона: выставочные залы компаний-резидентов, стартап-конкурсы, витрина государственных цифровых проектов и сайд-ивенты от каждого крупного работодателя отрасли.',
        'Соискатели почти всегда используют её не до конца. На стендах стоят не только маркетологи, но и тимлиды с CTO, которые пришли присматривать людей: десятиминутный разговор о реальном проекте полезнее пятидесяти онлайн-откликов. Возьмите с собой короткое резюме, ссылку на портфолио, которая открывается с телефона, и два-три точных вопроса о реальном стеке компании.',
        'Отдельного внимания заслуживают стартап-конкурсы. Команды, которые только что подняли раунд или победили, начинают наём в течение нескольких недель — и хорошо помнят тех, кто подошёл к ним ещё до объявления приза.',
        'Если приехать лично не получается, следите за программой онлайн: доклады записывают, список победителей публикуют, а вовремя отправленное письмо со ссылкой на конкретное выступление работает заметно лучше, чем обращение «в холодную».',
      ].join('\n\n'),
    },
  },
  'regional-job-fairs-employment-ministry': {
    uz: {
      title: 'Viloyat ish yarmarkalari minglab vakansiyani oflaynga olib chiqadi',
      excerpt:
        'Davlat tashkil etadigan bandlik yarmarkalari O‘zbekistonning barcha viloyatlarida o‘tkaziladi va mahalliy ish beruvchilar bilan nomzodlarni bir kunda uchrashtiradi. Natijani tayyorgarlik belgilaydi.',
      body: [
        'Mahalliy hokimiyat bilan birga o‘tkaziladigan bandlik yarmarkalari O‘zbekiston viloyatlarida odatiy hodisaga aylangan: yuzlab ish beruvchi, minglab vakansiya va nomzod bilan ishga oluvchi menejer o‘rtasida shu kunning o‘zidagi tanishuv. Bu ayniqsa Toshkentdan tashqarida qadrli, chunki u yerda onlayn e’lonlar kamroq.',
        'Bu format tayyorgarlikni qadrlaydi. Vakansiyalar ro‘yxati odatda oldindan e’lon qilinadi: o‘nta ish beruvchini tanlab oling, ularning maosh diapazonini o‘rganing va rezyumening bir necha nusxasini chiqarib oling (yarmarkalarda qog‘oz hali ham ishlaydi). Kiyimni birinchi suhbatga borgandek tanlang, chunki joyning o‘zida intervyu o‘tkazish odatiy hol.',
        'Bunday yarmarkalar amaliy xizmatlarni ham bir joyga to‘playdi: karyera bo‘yicha maslahat nuqtalari, kasbiy qayta tayyorlash vaucherlari haqida ma’lumot, yosh mutaxassislar va ishga qaytayotgan ayollar uchun qo‘llab-quvvatlash dasturlari.',
        'Realistik strategiya — yarmarkaga birinchi aloqa vositasi sifatida qarash. Ism va telefon raqamlarini yozib oling, ertasi kuni ertalab qisqa xat yuboring va aynan qanday suhbat bo‘lganini eslatib o‘ting: kelganlarning ko‘pchiligi hech qachon qayta bog‘lanmaydi, shuning uchun bog‘langan bir nechtasi darhol ajralib turadi.',
      ].join('\n\n'),
    },
    ru: {
      title: 'Региональные ярмарки выводят тысячи вакансий в офлайн',
      excerpt:
        'Ярмарки вакансий, которые организует государство, проходят во всех регионах Узбекистана и знакомят местных работодателей с кандидатами за один день. Результат определяет подготовка.',
      body: [
        'Ярмарки занятости, которые проводят вместе с местными властями, стали привычным явлением в регионах Узбекистана: сотни работодателей, тысячи вакансий и знакомство кандидата с нанимающим менеджером в тот же день. Особенно это ценно за пределами Ташкента, где онлайн-объявлений заметно меньше.',
        'Этот формат вознаграждает подготовку. Списки вакансий обычно публикуют заранее: отберите десять работодателей, изучите их зарплатные диапазоны и распечатайте несколько копий резюме (на ярмарках бумага всё ещё работает). Одевайтесь как на первое интервью — собеседования на месте здесь обычное дело.',
        'Такие ярмарки собирают в одном месте и практические сервисы: пункты карьерных консультаций, информацию о ваучерах на профессиональную переподготовку и программы поддержки для молодых специалистов и женщин, возвращающихся к работе.',
        'Реалистичная стратегия — использовать ярмарку как инструмент первого контакта. Записывайте имена и телефоны, на следующее утро отправляйте короткое сообщение и напоминайте, о чём именно вы говорили: большинство участников так и не возвращаются с фоллоуапом, поэтому те несколько, кто это делает, сразу заметны.',
      ].join('\n\n'),
    },
  },
  'startup-demo-days-it-park': {
    uz: {
      title: 'Demo day’lar — ilk xodimlarni topishning yangi maydoni',
      excerpt:
        'IT Park va universitet inkubatorlaridagi akselerator demo day’lari — sarmoya olgan startaplar o‘zining ilk o‘n xodimi bilan uchrashadigan joy. Ulardan qanday foydalanish kerak?',
      body: [
        'Akselerator to‘plamlari, universitet inkubatorlari va korporativ innovatsiya dasturlari bir xil yakunlanadi: jamoalar investorlar va hamkorlar oldida pitch qiladigan demo day bilan. Dasturda yozilmagan narsa esa shu — demo day bir vaqtning o‘zida ishga olish tadbiri: sarmoya olgan har bir jamoa shu oyning o‘zida odam izlay boshlaydi.',
        'Bu bosqichda startapga qo‘shilish aniq bir kelishuv: boshlang‘ich maosh pastroq, tartibsizlik ko‘proq — buning evaziga zich o‘qish, real mas’uliyat va ishlar yurishsa ulush yoki ilk xodim sifatidagi imtiyoz. Bu bir yilda uch yillik tajriba olishni istaganlarga to‘g‘ri keladi.',
        'Amaliy yondashuv: pitchlarni tinglang, qaysi jamoada daromad yoki imzolangan pilot bor (faqat prototip emas) — belgilab oling va rasmiy qismdan keyin asoschilar bilan gaplashing. Demoda ko‘rgan aniq bo‘shliqqa aniq ko‘nikmani taklif qiling: asoschilar aniqlikni eslab qoladi.',
        'IT Park va yetakchi universitetlarning tadbirlar taqvimini kuzatib boring: demo day’larning ko‘pchiligi ochiq va bepul, biroq aynan eng ko‘p naf ko‘radigan nomzodlar ularga kam boradi.',
      ].join('\n\n'),
    },
    ru: {
      title: 'Демо-дни — новая площадка для найма первых сотрудников',
      excerpt:
        'Демо-дни акселераторов в IT Park и университетских инкубаторах — это место, где стартапы с деньгами находят первых десять сотрудников. Как этим пользоваться?',
      body: [
        'Наборы акселераторов, университетские инкубаторы и корпоративные программы инноваций заканчиваются одинаково: демо-днём, где команды питчат инвесторам и партнёрам. В программе никогда не пишут другого: демо-день — это ещё и мероприятие по найму, ведь каждая команда, поднявшая деньги, начинает искать людей в том же месяце.',
        'Прийти в стартап на этой стадии — вполне конкретная сделка: ниже начальная зарплата и больше хаоса в обмен на плотное обучение, реальную зону ответственности и долю или бонус раннего сотрудника, если всё получится. Это подходит тем, кто хочет получить три года опыта за один.',
        'Практический подход: послушайте питчи, отметьте, у каких команд есть выручка или подписанный пилот (а не только прототип), и поговорите с основателями после официальной части. Предложите конкретный навык под конкретный пробел, который заметили в демо: основатели запоминают конкретику.',
        'Следите за календарями мероприятий IT Park и крупных университетов: большинство демо-дней открытые и бесплатные, но именно те кандидаты, которым они дали бы больше всего, приходят на них редко.',
      ].join('\n\n'),
    },
  },

  // ------------------------------------------------------------- EDUCATION
  'it-education-expansion-tuit-schools': {
    uz: {
      title: 'TUIT’dan ixtisoslashgan maktablarga: IT ta’limi kengaymoqda',
      excerpt:
        'Universitet kvotalari ortmoqda, ixtisoslashgan IT maktablari ko‘paymoqda, xususiy akademiyalar esa amaliy bo‘shliqni to‘ldirmoqda. IT sohasiga olib boradigan yo‘llar xaritasi.',
      body: [
        'O‘zbekistonda rasmiy IT ta’limining o‘zagi hamon Toshkent axborot texnologiyalari universiteti (TUIT) va uning viloyat filiallari bo‘lib qolmoqda; ularga iqtidorli o‘quvchilar uchun tez ko‘payib borayotgan ixtisoslashgan maktablar va umumiy universitetlarning kengayib borayotgan IT fakultetlari qo‘shildi.',
        'Universitetdan pastdagi qatlamda xususiy bozor yetildi: dasturlash akademiyalari ishga yo‘naltirilgan yo‘nalishlarni — veb-dasturlash, mobil ilovalar, ma’lumotlar tahlili, dizayn — yillar emas, oylar ichida o‘rgatadi va odatda kechki hamda dam olish kunlari formatida ishlaydi, ya’ni o‘qish yoki birinchi ish bilan birga olib borish mumkin.',
        'Amalda ish beruvchilar barcha yo‘llardan kadr oladi. TUIT diplomi fundamental bilimdan darak beradi; akademiya sertifikati va ishga tushirilgan loyiha esa tayyorlikdan. Eng kuchli juniorlarda odatda ikkovi ham bor. Hech bir yo‘l o‘rnini bosa olmaydigan narsa — portfolio: o‘qiladigan kod bilan yozilgan uchta tugallangan loyiha har qanday yakka diplomdan ustun.',
        'Oldindan reja tuzayotgan ota-onalar va maktab o‘quvchilariga: kelajakda qanday mutaxassislik tanlanishidan qat’i nazar, matematika va ingliz tili karyeraga eng katta ta’sir ko‘rsatadigan ikki fan bo‘lib qolmoqda.',
      ].join('\n\n'),
    },
    ru: {
      title: 'От TUIT до специализированных школ: IT-образование расширяется',
      excerpt:
        'Квоты в вузах растут, специализированных IT-школ становится больше, а частные академии закрывают практический пробел. Карта путей в технологии.',
      body: [
        'Ядром формального IT-образования в Узбекистане остаётся Ташкентский университет информационных технологий (TUIT) с региональными филиалами; к нему добавился быстро растущий слой специализированных школ для одарённых учеников и расширяющиеся IT-факультеты в обычных вузах.',
        'Ниже университетского уровня созрел частный рынок: академии программирования учат прикладным трекам — веб-разработка, мобильные приложения, анализ данных, дизайн — за месяцы, а не за годы, обычно в вечернем формате и по выходным, так что их можно совмещать с учёбой или первой работой.',
        'На практике работодатели берут людей со всех этих маршрутов. Диплом TUIT говорит о фундаменте, сертификат академии плюс задеплоенный проект — о готовности, а самые сильные джуны обычно совмещают и то, и другое. Чего не заменит ни один маршрут, так это портфолио: три завершённых проекта с читаемым кодом сильнее любого отдельного документа.',
        'Родителям и школьникам, которые планируют заранее: какой бы ни оказалась итоговая специализация, математика и английский остаются двумя предметами с наибольшим карьерным эффектом.',
      ].join('\n\n'),
    },
  },
  'one-million-coders-free-courses': {
    uz: {
      title: 'Bepul milliy dasturlash kurslari hamon IT’ga ochiq eshik',
      excerpt:
        'One Million Uzbek Coders ruhidagi keng ko‘lamli tashabbuslar hamon bepul, o‘z tezligida o‘tiladigan yo‘nalishlarni taklif qiladi. Ish beruvchilarni esa siz ular yordamida nima qurganingiz qiziqtiradi.',
      body: [
        'O‘zbekistonning ommaviy raqamli ko‘nikmalar yo‘lidagi harakati — One Million Uzbek Coders tashabbusi bilan mashhur bo‘lgan va IT Park ta’lim dasturlari hamda viloyatlardagi raqamli savodxonlik loyihalarida davom etayotgan harakat — bitta va’dani tirik saqlab kelmoqda: intilishi bor odam IT’ni o‘rganishni bepul boshlashi mumkin.',
        'Yo‘nalishlar odatda veb-dasturlash, ma’lumotlar tahlili va mobil ilovalar asoslarini qamrab oladi; format onlayn va o‘z tezligida, yakunda sertifikat beriladi. Sifat yo‘nalishga qarab farq qiladi, ammo narx boshlashni keyinga surish uchun hech qanday bahona qoldirmaydi.',
        'Ish beruvchining halol nuqtai nazari: sertifikatning o‘zi kamdan-kam suhbatga olib boradi. Sertifikat va kurs davomida qurilgan ishlaydigan loyiha esa olib boradi. Har bir modulga portfolio uchun material sifatida qarang: mashqlarni ishga tushiring, ingliz tilida README yozing va hammasini ochiq repozitoriyga joylang.',
        'Kursdan keyin jamoaviy o‘quv guruhlariga qo‘shilgan yoki mentor topgan bitiruvchilar sezilarli darajada ko‘proq ishga joylashadi. Bepul ta’lim eshikni ochadi, ostonadan esa muntazam mashq o‘tadi.',
      ].join('\n\n'),
    },
    ru: {
      title: 'Бесплатные курсы программирования — всё ещё открытая дверь в IT',
      excerpt:
        'Масштабные инициативы в духе One Million Uzbek Coders по-прежнему дают бесплатные треки в своём темпе. Работодателей же интересует, что вы на них построили.',
      body: [
        'Курс Узбекистана на массовые цифровые навыки — прославленный инициативой One Million Uzbek Coders и продолженный образовательными программами IT Park и региональными проектами цифровой грамотности — сохраняет одно обещание: мотивированный человек может начать учиться IT бесплатно.',
        'Треки обычно охватывают веб-разработку, анализ данных и основы мобильной разработки в онлайн-формате в своём темпе, с сертификатом по завершении. Качество разное, но цена не оставляет ни одного оправдания, чтобы отложить старт.',
        'Честный взгляд работодателя: один сертификат редко приводит на интервью. Сертификат плюс работающий проект, собранный во время курса, — приводит. Относитесь к каждому модулю как к материалу для портфолио: разворачивайте задания, пишите README на английском и выкладывайте всё в публичный репозиторий.',
        'Те, кто после курса присоединяется к учебным группам сообщества или находит ментора, трудоустраиваются заметно чаще. Бесплатное образование открывает дверь — а входит в неё регулярная практика.',
      ].join('\n\n'),
    },
  },
  'international-university-branches-tashkent': {
    uz: {
      title: 'Xalqaro universitet filiallari o‘qish imkoniyatlarini kengaytirmoqda',
      excerpt:
        'Toshkentda xorijiy universitetlarning filiallari ochilishda davom etmoqda: ular O‘zbekistonni tark etmasdan texnologiya va biznes yo‘nalishlarida xalqaro darajada tan olinadigan diplom beradi.',
      body: [
        'So‘nggi o‘n yilda Toshkent Markaziy Osiyoda xorijiy universitet filiallarining eng zich klasterlaridan biriga aylandi: Buyuk Britaniya, AQSh, Osiyo va mintaqa oliygohlarining kampuslari xalqaro o‘quv dasturlari asosida kompyuter fanlari, biznes va muhandislik yo‘nalishlarida diplom beradi.',
        'Talabalar uchun hisob-kitob amaliy: kontrakt to‘lovi chet elda o‘qishdan arzon, muhit ingliz tilida, diplom esa mahalliy ish beruvchilar tomonidan ham, xalqaro ish beruvchilar tomonidan ham tan olinadi. Ko‘p dasturlar kechki yoki gibrid formatda o‘tadi — shu sababli talabalarning tobora ko‘proq qismi ikkinchi kursdan boshlab IT sohasida yarim kunlik ishlaydi.',
        'Ish beruvchilar bir xil manzarani qayd etadi: filial bitiruvchilari ingliz tili va o‘z fikrini taqdim etish ko‘nikmasi bilan ajralib turadi, chuqur texnik bilim esa hamon oliygoh nomiga emas, shaxsiy loyihalarga bog‘liq. Ideal rezyume ikkala signalni birlashtiradi.',
        'O‘qishga kirishdan oldin uch narsani tekshiring: aynan shu dasturning akkreditatsiyasi, o‘tgan yil bitiruvchilari amalda qayerda ishlayotgani va kampusda ish beruvchilar bilan hamkorlik qiladigan faol karyera markazi bor-yo‘qligi. Javoblar bukletlarda ko‘rsatilganidan ko‘ra ancha ko‘proq farq qiladi.',
      ].join('\n\n'),
    },
    ru: {
      title: 'Филиалы зарубежных вузов расширяют выбор учёбы дома',
      excerpt:
        'В Ташкенте продолжают открываться филиалы зарубежных университетов: они дают признанные за рубежом дипломы в технологиях и бизнесе без выезда из Узбекистана.',
      body: [
        'За последнее десятилетие Ташкент собрал один из самых плотных кластеров филиалов зарубежных вузов в Центральной Азии: кампусы из Великобритании, США, Азии и региона выдают дипломы по компьютерным наукам, бизнесу и инженерии по международным программам.',
        'Для студентов расчёт практический: обучение дешевле, чем за границей, среда англоязычная, а диплом признают и местные, и зарубежные работодатели. Многие программы идут в вечернем или гибридном формате — поэтому всё больше студентов со второго курса подрабатывают в IT.',
        'Работодатели отмечают устойчивую закономерность: выпускники филиалов выделяются английским и умением себя презентовать, а глубина технических знаний по-прежнему связана с личными проектами, а не с названием вуза. Идеальное резюме соединяет оба сигнала.',
        'Перед поступлением проверьте три вещи: аккредитацию конкретной программы, где на самом деле работают выпускники прошлого года и есть ли на кампусе действующий карьерный центр с партнёрствами среди работодателей. Ответы различаются сильнее, чем можно подумать по буклетам.',
      ].join('\n\n'),
    },
  },
};
