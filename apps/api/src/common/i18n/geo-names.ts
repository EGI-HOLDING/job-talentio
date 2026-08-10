/** Localized display names for the Uzbekistan geo catalog, keyed by slug. */

export type LocalizedName = { uz: string; ru: string };

export const COUNTRY_NAMES: Record<string, LocalizedName> = {
  uzbekistan: { uz: 'O‘zbekiston', ru: 'Узбекистан' },
};

export const PROVINCE_NAMES: Record<string, LocalizedName> = {
  'tashkent-city': { uz: 'Toshkent shahri', ru: 'город Ташкент' },
  'tashkent-region': { uz: 'Toshkent viloyati', ru: 'Ташкентская область' },
  karakalpakstan: { uz: 'Qoraqalpog‘iston Respublikasi', ru: 'Республика Каракалпакстан' },
  andijan: { uz: 'Andijon viloyati', ru: 'Андижанская область' },
  bukhara: { uz: 'Buxoro viloyati', ru: 'Бухарская область' },
  fergana: { uz: 'Farg‘ona viloyati', ru: 'Ферганская область' },
  jizzakh: { uz: 'Jizzax viloyati', ru: 'Джизакская область' },
  kashkadarya: { uz: 'Qashqadaryo viloyati', ru: 'Кашкадарьинская область' },
  khorezm: { uz: 'Xorazm viloyati', ru: 'Хорезмская область' },
  namangan: { uz: 'Namangan viloyati', ru: 'Наманганская область' },
  navoi: { uz: 'Navoiy viloyati', ru: 'Навоийская область' },
  samarkand: { uz: 'Samarqand viloyati', ru: 'Самаркандская область' },
  sirdarya: { uz: 'Sirdaryo viloyati', ru: 'Сырдарьинская область' },
  surkhandarya: { uz: 'Surxondaryo viloyati', ru: 'Сурхандарьинская область' },
  'other-uzbekistan': { uz: 'Boshqa hududlar', ru: 'Другие регионы' },
};

export const CITY_NAMES: Record<string, LocalizedName> = {
  // Tashkent City — the city itself plus its districts
  tashkent: { uz: 'Toshkent', ru: 'Ташкент' },
  bektemir: { uz: 'Bektemir', ru: 'Бектемир' },
  yashnobod: { uz: 'Yashnobod', ru: 'Яшнабад' },
  sergeli: { uz: 'Sergeli', ru: 'Сергели' },
  uchtepa: { uz: 'Uchtepa', ru: 'Учтепа' },
  chilanzar: { uz: 'Chilonzor', ru: 'Чиланзар' },
  yunusabad: { uz: 'Yunusobod', ru: 'Юнусабад' },
  'mirzo-ulugbek': { uz: 'Mirzo Ulug‘bek', ru: 'Мирзо-Улугбек' },
  shaykhontohur: { uz: 'Shayxontohur', ru: 'Шайхантахур' },
  olmazor: { uz: 'Olmazor', ru: 'Алмазар' },
  yakkasaray: { uz: 'Yakkasaroy', ru: 'Яккасарай' },
  mirobod: { uz: 'Mirobod', ru: 'Мирабад' },

  // Tashkent Region
  nurafshon: { uz: 'Nurafshon', ru: 'Нурафшон' },
  chirchiq: { uz: 'Chirchiq', ru: 'Чирчик' },
  angren: { uz: 'Angren', ru: 'Ангрен' },
  almalyk: { uz: 'Olmaliq', ru: 'Алмалык' },
  bekabad: { uz: 'Bekobod', ru: 'Бекабад' },
  yangiyul: { uz: 'Yangiyo‘l', ru: 'Янгиюль' },
  gazalkent: { uz: 'G‘azalkent', ru: 'Газалкент' },
  keles: { uz: 'Keles', ru: 'Келес' },
  parkent: { uz: 'Parkent', ru: 'Паркент' },
  pskent: { uz: 'Piskent', ru: 'Пскент' },
  chinaz: { uz: 'Chinoz', ru: 'Чиназ' },
  ohangaron: { uz: 'Ohangaron', ru: 'Ахангаран' },
  zangiota: { uz: 'Zangiota', ru: 'Зангиата' },
  toytepa: { uz: 'To‘ytepa', ru: 'Тойтепа' },

  // Republic of Karakalpakstan
  nukus: { uz: 'Nukus', ru: 'Нукус' },
  kungrad: { uz: 'Qo‘ng‘irot', ru: 'Кунград' },
  chimbay: { uz: 'Chimboy', ru: 'Чимбай' },
  beruniy: { uz: 'Beruniy', ru: 'Беруни' },
  takhiatash: { uz: 'Taxiatosh', ru: 'Тахиаташ' },
  muynak: { uz: 'Mo‘ynoq', ru: 'Муйнак' },
  khujayli: { uz: 'Xo‘jayli', ru: 'Ходжейли' },
  turtkul: { uz: 'To‘rtko‘l', ru: 'Турткуль' },
  mangit: { uz: 'Mang‘it', ru: 'Мангит' },
  kegeyli: { uz: 'Kegeyli', ru: 'Кегейли' },

  // Andijan Region
  andijan: { uz: 'Andijon', ru: 'Андижан' },
  asaka: { uz: 'Asaka', ru: 'Асака' },
  khanabad: { uz: 'Xonobod', ru: 'Ханабад' },
  shahrikhan: { uz: 'Shahrixon', ru: 'Шахрихан' },
  'karasu-andijan': { uz: 'Qorasuv', ru: 'Карасу' },
  poytug: { uz: 'Poytug‘', ru: 'Пайтуг' },
  pakhtaabad: { uz: 'Paxtaobod', ru: 'Пахтаабад' },
  marhamat: { uz: 'Marhamat', ru: 'Мархамат' },
  baliqchi: { uz: 'Baliqchi', ru: 'Балыкчи' },
  jalakuduk: { uz: 'Jalaquduq', ru: 'Джалакудук' },

  // Bukhara Region
  bukhara: { uz: 'Buxoro', ru: 'Бухара' },
  kagan: { uz: 'Kogon', ru: 'Каган' },
  gijduvan: { uz: 'G‘ijduvon', ru: 'Гиждуван' },
  romitan: { uz: 'Romitan', ru: 'Ромитан' },
  vabkent: { uz: 'Vobkent', ru: 'Вабкент' },
  shofirkon: { uz: 'Shofirkon', ru: 'Шафиркан' },
  peshku: { uz: 'Peshku', ru: 'Пешку' },
  jondor: { uz: 'Jondor', ru: 'Жондор' },
  karaulbazar: { uz: 'Qorovulbozor', ru: 'Караулбазар' },
  alat: { uz: 'Olot', ru: 'Алат' },

  // Fergana Region
  fergana: { uz: 'Farg‘ona', ru: 'Фергана' },
  margilan: { uz: 'Marg‘ilon', ru: 'Маргилан' },
  kokand: { uz: 'Qo‘qon', ru: 'Коканд' },
  quvasoy: { uz: 'Quvasoy', ru: 'Кувасай' },
  rishton: { uz: 'Rishton', ru: 'Риштан' },
  oltiariq: { uz: 'Oltiariq', ru: 'Алтыарык' },
  toshloq: { uz: 'Toshloq', ru: 'Ташлак' },
  yaypan: { uz: 'Yaypan', ru: 'Яйпан' },
  beshariq: { uz: 'Beshariq', ru: 'Бешарык' },
  dangara: { uz: 'Dang‘ara', ru: 'Дангара' },
  uchkoprik: { uz: 'Uchko‘prik', ru: 'Учкуприк' },

  // Jizzakh Region
  jizzakh: { uz: 'Jizzax', ru: 'Джизак' },
  gallaorol: { uz: 'G‘allaorol', ru: 'Галляарал' },
  dustlik: { uz: 'Do‘stlik', ru: 'Дустлик' },
  zarbdor: { uz: 'Zarbdor', ru: 'Зарбдар' },
  forish: { uz: 'Forish', ru: 'Фариш' },
  pakhtakor: { uz: 'Paxtakor', ru: 'Пахтакор' },
  zafarobod: { uz: 'Zafarobod', ru: 'Зафарабад' },
  yangjobod: { uz: 'Yangiobod', ru: 'Янгиабад' }, // unverified — source slug/name looks like a typo of Yangiobod (Jizzakh)

  // Kashkadarya Region
  karshi: { uz: 'Qarshi', ru: 'Карши' },
  shahrisabz: { uz: 'Shahrisabz', ru: 'Шахрисабз' },
  kitab: { uz: 'Kitob', ru: 'Китаб' },
  yakkabog: { uz: 'Yakkabog‘', ru: 'Яккабаг' },
  kamashi: { uz: 'Qamashi', ru: 'Камаши' },
  kasbi: { uz: 'Kasbi', ru: 'Касби' },
  muborak: { uz: 'Muborak', ru: 'Мубарек' },
  nishon: { uz: 'Nishon', ru: 'Нишан' },
  guzar: { uz: 'G‘uzor', ru: 'Гузар' },
  dehkanabad: { uz: 'Dehqonobod', ru: 'Дехканабад' },
  chirakchi: { uz: 'Chiroqchi', ru: 'Чиракчи' },

  // Khorezm Region
  urgench: { uz: 'Urganch', ru: 'Ургенч' },
  khiva: { uz: 'Xiva', ru: 'Хива' },
  pitnak: { uz: 'Pitnak', ru: 'Питнак' },
  gurlan: { uz: 'Gurlan', ru: 'Гурлен' },
  shovot: { uz: 'Shovot', ru: 'Шават' },
  yangiarik: { uz: 'Yangiariq', ru: 'Янгиарык' },
  bagat: { uz: 'Bog‘ot', ru: 'Багат' },
  hazorasp: { uz: 'Hazorasp', ru: 'Хазарасп' },
  koshkopir: { uz: 'Qo‘shko‘pir', ru: 'Кошкупыр' },

  // Namangan Region
  namangan: { uz: 'Namangan', ru: 'Наманган' },
  chust: { uz: 'Chust', ru: 'Чуст' },
  pop: { uz: 'Pop', ru: 'Пап' },
  uychi: { uz: 'Uychi', ru: 'Уйчи' },
  kasansay: { uz: 'Kosonsoy', ru: 'Касансай' },
  turakurgan: { uz: 'To‘raqo‘rg‘on', ru: 'Туракурган' },
  chortoq: { uz: 'Chortoq', ru: 'Чартак' },
  mingbulak: { uz: 'Mingbuloq', ru: 'Мингбулак' },
  yangikurgan: { uz: 'Yangiqo‘rg‘on', ru: 'Янгикурган' },
  uchkurgan: { uz: 'Uchqo‘rg‘on', ru: 'Учкурган' },

  // Navoi Region
  navoi: { uz: 'Navoiy', ru: 'Навои' },
  zarafshan: { uz: 'Zarafshon', ru: 'Зарафшан' },
  uchkuduk: { uz: 'Uchquduq', ru: 'Учкудук' },
  kyzyltepa: { uz: 'Qiziltepa', ru: 'Кызылтепа' },
  karmana: { uz: 'Karmana', ru: 'Кармана' },
  nurata: { uz: 'Nurota', ru: 'Нурата' },
  tomdi: { uz: 'Tomdi', ru: 'Тамды' },
  konimex: { uz: 'Konimex', ru: 'Канимех' },

  // Samarkand Region
  samarkand: { uz: 'Samarqand', ru: 'Самарканд' },
  kattakurgan: { uz: 'Kattaqo‘rg‘on', ru: 'Каттакурган' },
  urgut: { uz: 'Urgut', ru: 'Ургут' },
  juma: { uz: 'Juma', ru: 'Джума' },
  aktash: { uz: 'Oqtosh', ru: 'Акташ' },
  bulungur: { uz: 'Bulung‘ur', ru: 'Булунгур' },
  ishtikhan: { uz: 'Ishtixon', ru: 'Иштыхан' },
  nurobod: { uz: 'Nurobod', ru: 'Нурабад' },
  pastdargom: { uz: 'Pastdarg‘om', ru: 'Пастдаргом' },
  payarik: { uz: 'Payariq', ru: 'Пайарык' },
  taylak: { uz: 'Toyloq', ru: 'Тайлак' },

  // Sirdarya Region
  gulistan: { uz: 'Guliston', ru: 'Гулистан' },
  yangiyer: { uz: 'Yangiyer', ru: 'Янгиер' },
  shirin: { uz: 'Shirin', ru: 'Ширин' },
  baht: { uz: 'Baxt', ru: 'Бахт' },
  sardoba: { uz: 'Sardoba', ru: 'Сардоба' },
  boyovut: { uz: 'Boyovut', ru: 'Баяут' },
  khavast: { uz: 'Xovos', ru: 'Хаваст' },
  mirzaabad: { uz: 'Mirzaobod', ru: 'Мирзаабад' },

  // Surkhandarya Region
  termez: { uz: 'Termiz', ru: 'Термез' },
  denov: { uz: 'Denov', ru: 'Денау' },
  shargun: { uz: 'Sharg‘un', ru: 'Шаргунь' },
  boysun: { uz: 'Boysun', ru: 'Байсун' },
  jarqorgon: { uz: 'Jarqo‘rg‘on', ru: 'Джаркурган' },
  kumkurgan: { uz: 'Qumqo‘rg‘on', ru: 'Кумкурган' },
  sariosiyo: { uz: 'Sariosiyo', ru: 'Сариасия' },
  uzun: { uz: 'Uzun', ru: 'Узун' },
  muzrabot: { uz: 'Muzrabot', ru: 'Музрабад' },
  sherobod: { uz: 'Sherobod', ru: 'Шерабад' },
};
