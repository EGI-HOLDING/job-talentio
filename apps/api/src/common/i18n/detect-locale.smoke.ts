import { detectLocale } from './detect-locale';

const CASES: Array<[string, ReturnType<typeof detectLocale>]> = [
  [
    'Apex Soft is hiring a Backend Developer in Tashkent.\n\nAbout the role:\nYou will help build products used by customers across Uzbekistan.\n\nRequirements:\n- Hands-on experience with Go and PostgreSQL\n- 3+ years relevant experience preferred',
    'en',
  ],
  [
    'Kompaniya Toshkent shahrida backend dasturchi qidirmoqda.\n\nTalablar:\n- Go va PostgreSQL bilan ish tajribasi kerak\n- Jamoada ishlash malakasi zarur\n- Loyihalarni rivojlantirish uchun bilim talab qilinadi',
    'uz',
  ],
  [
    'Компания ищет backend-разработчика в Ташкенте.\n\nТребования:\n- Опыт работы с Go и PostgreSQL\n- Умение работать в команде\n- Готовность развивать проекты',
    'ru',
  ],
  ['Short text', null],
  ['', null],
];

let failed = 0;
for (const [text, expected] of CASES) {
  const actual = detectLocale(text);
  if (actual !== expected) {
    console.error(`detectLocale mismatch: expected ${expected}, got ${actual}\n  ${text.slice(0, 60)}`);
    failed += 1;
  }
}

if (failed) {
  process.exit(1);
}
console.log('api: locale detection smoke ok');
