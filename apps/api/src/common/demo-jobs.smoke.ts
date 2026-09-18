import {
  DEMO_HERO_JOBS,
  DEMO_JOB_LOCALES,
  DEMO_JOB_TEMPLATES,
  buildDemoJobDescription,
  demoAnswer,
  demoCoverLetter,
  demoSalaryBand,
  demoScreeningQuestions,
  type DemoLocale,
} from './demo-jobs';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const RISKY_PUNCTUATION = /[\u2013\u2014\u2026]/;
const HEADING: Record<DemoLocale, string> = {
  uz: 'Vazifalar:',
  ru: 'Обязанности:',
  en: 'Responsibilities:',
};

function descriptionsReadInEveryLanguage() {
  for (const locale of ['uz', 'ru', 'en'] as DemoLocale[]) {
    const text = buildDemoJobDescription({
      locale,
      companyName: 'Apex Soft Tashkent',
      cityName: 'Tashkent',
      title: 'Accountant',
      cat: 'finance',
      skillNames: ['Accounting', '1C', 'Excel'],
      years: 3,
      salaryMin: 7_000_000,
      salaryMax: 11_000_000,
      workMode: 'ONSITE',
      employmentType: 'FULL_TIME',
    });
    assert(text.includes(HEADING[locale]), `${locale}: duties heading missing`);
    assert(text.includes('7 000 000 - 11 000 000'), `${locale}: salary not formatted`);
    assert(text.split('\n- ').length >= 8, `${locale}: expected bullet list, got\n${text}`);
    assert(!RISKY_PUNCTUATION.test(text), `${locale}: risky punctuation in description`);
  }
  const noExperience = buildDemoJobDescription({
    locale: 'uz',
    companyName: 'EduNest',
    cityName: 'Samarqand',
    title: 'Teaching Assistant',
    cat: 'education',
    skillNames: ['Teaching'],
    years: 0,
    salaryMin: 3_000_000,
    salaryMax: 4_500_000,
    workMode: 'HYBRID',
    employmentType: 'PART_TIME',
  });
  assert(/Tajribasiz/.test(noExperience), 'uz: zero years should invite juniors');
}

function salaryBandsAreSane() {
  for (const tpl of DEMO_JOB_TEMPLATES) {
    const band = demoSalaryBand(tpl.cat, tpl.level);
    assert(band.min < band.max, `${tpl.title}: min >= max`);
    assert(band.min % 100_000 === 0 && band.max % 100_000 === 0, `${tpl.title}: not rounded`);
    assert(band.min >= 2_000_000, `${tpl.title}: below market floor (${band.min})`);
    assert(band.max <= 45_000_000, `${tpl.title}: above market ceiling (${band.max})`);
  }
  const senior = demoSalaryBand('it-software', 'SENIOR');
  const junior = demoSalaryBand('it-software', 'JUNIOR');
  assert(senior.min > junior.max, 'senior IT band should sit above junior band');
}

function heroJobsAreComplete() {
  const seen = new Set<string>();
  for (const hero of DEMO_HERO_JOBS) {
    const key = `${hero.companySlug}:${hero.title}:${hero.workMode}`;
    assert(!seen.has(key), `duplicate hero ${key}`);
    seen.add(key);
    assert(hero.description.length > 400, `${hero.title}: description too short`);
    assert(hero.description.includes(HEADING[hero.locale]), `${hero.title}: heading not in ${hero.locale}`);
    assert(!RISKY_PUNCTUATION.test(hero.description), `${hero.title}: risky punctuation`);
    assert(hero.salaryMin < hero.salaryMax, `${hero.title}: salary band inverted`);
    assert(hero.questions.length === 3, `${hero.title}: expected 3 screening questions`);
    assert(
      hero.questions.some((q) => q.type === 'YES_NO') && hero.questions.some((q) => q.type === 'NUMBER'),
      `${hero.title}: questions should mix yes/no and number`,
    );
    assert(hero.skills.length >= 3, `${hero.title}: needs skills for matching`);
  }
  assert(DEMO_HERO_JOBS[0].title.includes('IT Infrastructure'), 'first hero should mirror the CV demo');
}

function localizedScreeningAndAnswers() {
  for (const locale of ['uz', 'ru', 'en'] as DemoLocale[]) {
    const questions = demoScreeningQuestions(locale);
    assert(questions.map((q) => q.type).join(',') === 'NUMBER,YES_NO,TEXT', `${locale}: question types`);
    assert(questions[2].isRequired === false, `${locale}: motivation question should be optional`);
    assert(demoCoverLetter(locale, 0).length > 40, `${locale}: cover letter too short`);
    assert(['Yes', 'No'].includes(demoAnswer(locale, 'YES_NO', 3)), `${locale}: yes/no answer literal`);
    assert(/^\d+$/.test(demoAnswer(locale, 'NUMBER', 2)), `${locale}: number answer`);
  }
  assert(demoScreeningQuestions('uz')[0].question !== demoScreeningQuestions('ru')[0].question, 'questions must differ per locale');
}

function localeMixFavoursUzbek() {
  const uz = DEMO_JOB_LOCALES.filter((l) => l === 'uz').length;
  assert(uz / DEMO_JOB_LOCALES.length >= 0.5, 'at least half of demo postings should be Uzbek');
  assert(DEMO_JOB_LOCALES.includes('ru') && DEMO_JOB_LOCALES.includes('en'), 'mix should include ru and en');
}

descriptionsReadInEveryLanguage();
salaryBandsAreSane();
heroJobsAreComplete();
localizedScreeningAndAnswers();
localeMixFavoursUzbek();
console.log('api: demo-jobs smoke ok');
