// Talentio product taxonomy, not an assertion of an official global standard.
export const INDUSTRY_TAXONOMY_VERSION = 'talentio-industry-v1';
export const SENIORITY_CATALOG_VERSION = 'talentio-seniority-v1';
const groups = [
  ['AGRICULTURE_NATURAL_RESOURCES','Agriculture & Natural Resources','Pertanian & Sumber Daya Alam','Qishloq xo‘jaligi va tabiiy resurslar','Сельское хозяйство и природные ресурсы','Growing crops, forestry, fishing and animal production.','Exclude mining and processing in factories.'],
  ['MINING_EXTRACTIVES','Mining & Extractives','Pertambangan & Ekstraksi','Konchilik va qazib olish','Горнодобывающая промышленность','Extraction of minerals, crude oil and natural gas.','Exclude refining, equipment manufacturing and energy distribution.'],
  ['ENERGY_UTILITIES','Energy & Utilities','Energi & Utilitas','Energetika va kommunal xizmatlar','Энергетика и коммунальные услуги','Generation and supply of power, gas and water.','Renewable generation belongs here; environmental consulting does not.'],
  ['MANUFACTURING','Manufacturing','Manufaktur','Ishlab chiqarish','Обрабатывающая промышленность','Physical transformation and factory production of goods.','Includes pharmaceuticals, vehicles, steel and defense/space equipment manufacturing; excludes distribution.'],
  ['CONSTRUCTION_INFRASTRUCTURE','Construction & Infrastructure','Konstruksi & Infrastruktur','Qurilish va infratuzilma','Строительство и инфраструктура','Construction of buildings, civil works and infrastructure.','Exclude property transactions, architectural consultancy and materials factories.'],
  ['PROPERTY_REAL_ESTATE','Property & Real Estate','Properti & Real Estat','Ko‘chmas mulk','Недвижимость','Development, transactions, leasing and management of property.','Exclude construction contractors and financial-only investment services.'],
  ['TRANSPORTATION_LOGISTICS','Transportation & Logistics','Transportasi & Logistik','Transport va logistika','Транспорт и логистика','Movement of people/goods, freight, storage and delivery.','Exclude vehicle production and wholesale ownership of distributed goods.'],
  ['TRADE_DISTRIBUTION','Trade & Distribution','Perdagangan & Distribusi','Savdo va distribyutsiya','Оптовая торговля и дистрибуция','Wholesale, import/export and business distribution of goods.','Pharmaceutical distribution belongs here; factories and consumer retail do not.'],
  ['RETAIL_CONSUMER','Retail & Consumer','Ritel & Konsumen','Chakana savdo','Розничная торговля','Retail sale of goods to final consumers.','Includes online retail; exclude marketplaces operating primarily as software services and wholesale.'],
  ['BANKING_FINANCIAL_SERVICES','Banking & Financial Services','Perbankan & Jasa Keuangan','Bank va moliyaviy xizmatlar','Банковские и финансовые услуги','Banking, lending, investment and financial intermediation.','Exclude insurance and providers whose primary activity is payment/fintech technology.'],
  ['FINTECH_PAYMENTS','FinTech & Payments','FinTech & Pembayaran','Fintex va to‘lovlar','Финтех и платежи','Payment processing and financial technology platforms.','A bank using software remains banking; general software vendors remain technology.'],
  ['INSURANCE','Insurance','Asuransi','Sug‘urta','Страхование','Insurance, reinsurance and dedicated insurance intermediation.','Exclude generic finance and software-only providers.'],
  ['TECHNOLOGY_DIGITAL','Technology & Digital','Teknologi & Digital','Texnologiyalar va raqamli xizmatlar','Технологии и цифровые услуги','Software, IT services, cloud and digital infrastructure services.','Using AI or SaaS alone is not a new economic activity; exclude physical factories and telecom carriers.'],
  ['TELECOMMUNICATIONS','Telecommunications','Telekomunikasi','Telekommunikatsiyalar','Телекоммуникации','Operation of telecommunications and connectivity networks.','Exclude telecom equipment manufacturing and generic IT consultancy.'],
  ['HEALTHCARE_LIFE_SCIENCES','Healthcare & Life Sciences','Kesehatan & Ilmu Hayati','Sog‘liqni saqlash va hayot fanlari','Здравоохранение и науки о жизни','Clinical care, diagnostics and dedicated life-science research.','Pharmaceutical factories are manufacturing; medicine distribution is trade.'],
  ['EDUCATION','Education','Pendidikan','Ta’lim','Образование','Teaching, training and educational institutions.','Religious schools remain education when teaching is the primary activity.'],
  ['HOSPITALITY_TOURISM','Hospitality & Tourism','Hospitalitas & Pariwisata','Mehmondo‘stlik va turizm','Гостиничный бизнес и туризм','Accommodation, food service, travel and tourism services.','Exclude packaged food factories and passenger transport operators.'],
  ['MEDIA_ENTERTAINMENT','Media & Entertainment','Media & Hiburan','Media va ko‘ngilochar xizmatlar','Медиа и развлечения','Publishing, broadcasting, film distribution and entertainment operation.','Separate commissioned creative/design services from media operation.'],
  ['PROFESSIONAL_SERVICES','Professional Services','Jasa Profesional','Professional xizmatlar','Профессиональные услуги','Legal, accounting, consulting, architecture and business support services.','Classify clients separately; a consultant is not in its client’s industry.'],
  ['GOVERNMENT_PUBLIC_SECTOR','Government & Public Sector','Pemerintahan & Sektor Publik','Davlat boshqaruvi','Государственное управление','Public administration and statutory governmental functions.','State ownership alone does not move an energy producer, bank or factory here.'],
  ['NONPROFIT_INTERNATIONAL','Non-Profit & International Organizations','Organisasi Nirlaba & Internasional','Notijorat va xalqaro tashkilotlar','Некоммерческие и международные организации','Charitable, membership and international institutional activities.','Nonprofit ownership alone does not replace a clear primary activity such as education.'],
  ['ENVIRONMENTAL_SUSTAINABILITY','Environmental & Sustainability','Lingkungan & Keberlanjutan','Atrof-muhit va barqarorlik','Экология и устойчивое развитие','Remediation, recycling services and dedicated environmental services.','Exclude renewable electricity generation and generic green marketing claims.'],
  ['CREATIVE_INDUSTRIES','Creative Industries','Industri Kreatif','Ijodiy sohalar','Креативные индустрии','Design, artistic production and commissioned creative services.','Exclude physical mass manufacturing and operation of media distribution channels.'],
  ['SPORTS_WELLNESS','Sports & Wellness','Olahraga & Kebugaran','Sport va sog‘lom turmush','Спорт и оздоровление','Sports facilities, fitness, wellness and nonclinical personal-care services.','Exclude clinical care, sporting goods factories and retail.'],
  ['RELIGIOUS_ECONOMY','Religious Economy','Ekonomi Keagamaan','Diniy iqtisodiyot','Религиозная экономика','Dedicated religious institutional services and religious compliance services.','Halal branding alone is insufficient; schools, factories and banks retain their primary activity.'],
  ['DEFENSE_INDUSTRY','Defense Industry','Industri Pertahanan','Mudofaa sohasi','Оборонная отрасль','Dedicated defense systems integration and defense-specific services.','Physical equipment production remains manufacturing; public military administration remains government.'],
  ['SPACE_ECONOMY','Space Economy','Ekonomi Antariksa','Kosmik iqtisodiyot','Космическая экономика','Launch, orbital operations and dedicated space mission services.','Equipment factories remain manufacturing; telecom carriers retain telecommunications.'],
  ['ADVANCED_TECHNOLOGY','Advanced Technology','Teknologi Lanjut','Ilg‘or texnologiyalar','Передовые технологии','Dedicated research and development of advanced enabling technologies.','Commercial software belongs to technology; factories and life-science research retain their activity.'],
  ['FUTURE_INDUSTRIES','Future Industries','Industri Masa Depan','Kelajak sohalari','Отрасли будущего','Documented emerging commercial activities outside existing group definitions.','Never assign from novelty, buzzwords or missing data; require a documented primary activity.'],
] as const;
export const INDUSTRY_GROUPS = groups.map(([code,name,nameId,nameUz,nameRu,definition,boundaries],sortOrder)=>({id:`${INDUSTRY_TAXONOMY_VERSION}:${code}`,code,version:INDUSTRY_TAXONOMY_VERSION,name,nameId,nameUz,nameRu,definition,boundaries,sortOrder}));

const levels = [
 ['L0','Management Trainee / Graduate Program','Program Management Trainee / Lulusan','Bitiruvchilar dasturi','Программа для выпускников',0,1],
 ['L1','Junior Staff / Associate','Staf Junior / Associate','Kichik mutaxassis','Младший специалист',0,2],
 ['L2','Staff / Officer','Staf / Officer','Mutaxassis','Специалист',2,5],
 ['L3','Senior Staff / Senior Officer','Staf Senior / Senior Officer','Katta mutaxassis','Старший специалист',4,7],
 ['L4','Supervisor','Supervisor','Nazoratchi','Супервайзер',5,8],
 ['L5','Assistant Manager','Asisten Manajer','Menejer yordamchisi','Помощник менеджера',7,10],
 ['L6','Manager','Manajer','Menejer','Менеджер',10,15],
 ['L7','Senior Manager','Manajer Senior','Katta menejer','Старший менеджер',12,18],
 ['L8','General Manager','Manajer Umum','Bosh menejer','Генеральный менеджер',15,20],
 ['L9','Director','Direktur','Direktor','Директор',15,25],
 ['L10','Vice President','Vice President','Vitse-prezident','Вице-президент',18,30],
 ['L11','Senior Vice President','Senior Vice President','Katta vitse-prezident','Старший вице-президент',20,30],
 ['L12','Chief Officer (C-Level)','Chief Officer (C-Level)','Oliy rahbar (C-Level)','Руководитель C-Level',20,null],
 ['L13','President Director / CEO','Direktur Utama / CEO','Bosh direktor / CEO','Генеральный директор / CEO',20,null],
] as const;
export const SENIORITY_LEVELS = levels.map(([code,name,nameId,nameUz,nameRu,yearsMin,yearsMax],sortOrder)=>({code,version:SENIORITY_CATALOG_VERSION,name,nameId,nameUz,nameRu,yearsMin,yearsMax,sortOrder}));

// Null means deliberately unresolved: a composite label is not enough evidence.
export const LEGACY_INDUSTRY_MAPPING:Record<string,string|null> = {
 'auto-business':null,'beauty-fitness-sports':'SPORTS_WELLNESS','construction-architecture-design':null,
 'consulting-accounting-audit':'PROFESSIONAL_SERVICES','design':'CREATIVE_INDUSTRIES','education-science':null,
 'finance-banking-insurance':null,'hospitality-restaurants':'HOSPITALITY_TOURISM','it':'TECHNOLOGY_DIGITAL',
 'legal':'PROFESSIONAL_SERVICES','marketing-advertising-pr':'PROFESSIONAL_SERVICES','media':'MEDIA_ENTERTAINMENT',
 'medicine-pharmacy':null,'public-business-services':null,'publishing-printing':null,'recruiting-hr':'PROFESSIONAL_SERVICES',
 'security':null,'arts-entertainment':null,'telecom-networking':'TELECOMMUNICATIONS','tourism':'HOSPITALITY_TOURISM',
 'transportation-logistics':'TRANSPORTATION_LOGISTICS','real-estate':'PROPERTY_REAL_ESTATE','retail':'RETAIL_CONSUMER',
 'wholesale-distribution':'TRADE_DISTRIBUTION','agriculture-agribusiness':'AGRICULTURE_NATURAL_RESOURCES',
 'chemicals-pharma-manufacturing':'MANUFACTURING','construction-materials-woodworking':'MANUFACTURING',
 'food-industry':'MANUFACTURING','light-industry':'MANUFACTURING','mechanical-engineering':'MANUFACTURING',
 'metals-metalworking':'MANUFACTURING','mining':'MINING_EXTRACTIVES','power-energy':'ENERGY_UTILITIES',
 'manufacturing-general':'MANUFACTURING','government-public-sector':'GOVERNMENT_PUBLIC_SECTOR','non-profit':'NONPROFIT_INTERNATIONAL','other':null,
};

export function legacyIndustryGroupCode(slug:string):string|null {
  return Object.hasOwn(LEGACY_INDUSTRY_MAPPING,slug)?LEGACY_INDUSTRY_MAPPING[slug]:null;
}
