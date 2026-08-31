import { parseCvText } from './cv-parser';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const skills = [
  { name: 'React', slug: 'react' },
  { name: 'Node.js', slug: 'nodejs' },
  { name: 'TypeScript', slug: 'typescript' },
];

const ruCv = `
Иван Иванов
Разработчик
email@example.com
О себе:
Опытный backend разработчик с фокусом на Node.js и PostgreSQL для продуктов в Узбекистане.
Опыт работы
Frontend Developer в UzPay
январь 2020 — настоящее время
Образование
Ташкентский университет информационных технологий
бакалавр
2016 2020
Языки
Русский — родной
English — B2
Skills: React, TypeScript
`;

const uzCv = `
Ali Valiyev
Dasturchi
ali@example.com
Men haqimda:
Backend dasturchi Node.js va PostgreSQL bilan ishlayman professional jamoada Toshkentda.
Ish tajribasi
Backend Developer at ClickPay
2021 - hozir
Ta'lim
Toshkent universiteti
bakalavr
2017 2021
Tillar
O'zbek — ona tili
English — B1
Skills: Node.js, React
`;

const enCv = `
Jane Doe
Senior Frontend Developer
jane@example.com
+998901234567
Summary:
Experienced frontend engineer building React and TypeScript products for Central Asia markets.
Experience
Frontend Developer at Demo Tech
January 2019 - Present
Education
National University
Bachelor 2015 2019
Languages
English — native
Russian — B2
Skills: React, TypeScript, Node.js
`;

const ru = parseCvText(ruCv, skills);
assert(ru.experiences.length >= 1, 'RU: expected experience');
assert(ru.experiences[0].isCurrent === true, 'RU: experience should be current');
assert(ru.experiences[0].startDate === '2020-01-01', `RU: startDate got ${ru.experiences[0].startDate}`);
assert(/uzpay/i.test(ru.experiences[0].companyName), `RU: company got ${ru.experiences[0].companyName}`);
assert(ru.educations.some((e) => e.degree === 'BACHELOR'), 'RU: expected bachelor education');
assert(
  ru.educations.some((e) => /университет/i.test(e.school)),
  'RU: expected university school',
);
const ruLang = ru.languages.find((l) => l.code === 'ru');
assert(ruLang?.level === 'NATIVE', `RU: russian level got ${ruLang?.level}`);
assert(ru.skillNames.includes('React'), 'RU: expected React skill');

const uz = parseCvText(uzCv, skills);
assert(uz.experiences.length >= 1, 'UZ: expected experience');
assert(uz.experiences[0].isCurrent === true, 'UZ: experience should be current');
assert(uz.experiences[0].startDate === '2021-01-01', `UZ: startDate got ${uz.experiences[0].startDate}`);
assert(uz.educations.some((e) => e.degree === 'BACHELOR'), 'UZ: expected bachelor');
const uzLang = uz.languages.find((l) => l.code === 'uz');
assert(uzLang?.level === 'NATIVE', `UZ: uzbek level got ${uzLang?.level}`);
assert(uz.skillNames.includes('Node.js'), 'UZ: expected Node.js skill');

const en = parseCvText(enCv, skills);
assert(en.email === 'jane@example.com', 'EN: email');
assert(en.experiences.length >= 1 && en.experiences[0].isCurrent, 'EN: current experience');
assert(en.skillNames.includes('React') && en.skillNames.includes('TypeScript'), 'EN: skills');
const enLang = en.languages.find((l) => l.code === 'en');
assert(enLang?.level === 'NATIVE', `EN: english level got ${enLang?.level}`);

const wrappedCv = `
Jane Doe
IT Specialist
jane@example.com
Experience
IT Infrastructure & Support Specialist
Acme
Jan 2023 – Dec 2024
• Manage and maintain IT infrastructure supporting 150+ users
• Configure and troubleshoot managed switches LAN connectivity.
• Provide Level 1 and Level 2 support for Windows workstations, printers, POS devices, IP phones, and operational
systems.
IT Support Engineer
Jan 2022 – Present
Education
National University
Bachelor 2015 2019
`;

const wrapped = parseCvText(wrappedCv, skills);
assert(wrapped.experiences.length >= 2, `WRAP: expected 2 roles, got ${wrapped.experiences.length}`);
const first = wrapped.experiences[0];
assert(first.description, 'WRAP: first role description missing');
assert(/operational systems/i.test(first.description), `WRAP: wrap not joined: ${first.description}`);
assert(/Level 1 and Level 2/i.test(first.description), `WRAP: Level 1/2 dropped: ${first.description}`);
assert(
  !/IT Support Engineer/i.test(first.description),
  `WRAP: next title leaked into description: ${first.description}`,
);
const second = wrapped.experiences[1];
assert(/IT Support Engineer/i.test(second.title), `WRAP: second title got ${second.title}`);

console.log('api: cv-parser RU/UZ/EN smoke ok');
