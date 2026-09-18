import { buildChannelPost, buildJobsCommandText, formatChannelSalary } from './telegram.channel';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const WEB = 'https://staging.jobtalent.io';

function channelPostIsHtmlSafeAndLocalized() {
  const post = buildChannelPost(
    {
      id: 'job1',
      title: 'Sales <Manager> & Lead',
      locale: 'uz',
      companyName: 'UzPay & Co',
      cityName: 'Toshkent',
      workMode: 'ONSITE',
      employmentType: 'FULL_TIME',
      salaryMin: 6_000_000,
      salaryMax: 15_000_000,
      currency: 'UZS',
      skills: ['Sales', 'B2B savdo', 'CRM'],
    },
    WEB,
  );
  assert(post.text.includes('<b>Sales &lt;Manager&gt; &amp; Lead</b>'), 'title must be HTML-escaped and bold');
  assert(post.text.includes('UzPay &amp; Co | Toshkent'), 'company and city line');
  assert(post.text.includes('6 000 000 - 15 000 000 UZS'), 'salary band formatted with spaces');
  assert(post.text.includes('To‘liq stavka | ofisda'), 'employment and mode in Uzbek');
  assert(post.url === `${WEB}/uz/jobs/job1?utm_source=telegram&utm_medium=channel`, `url got ${post.url}`);
  assert(post.text.includes('#Toshkent') && post.text.includes('#B2Bsavdo'), 'hashtags for city and skills');
  assert(post.button === 'Batafsil va ariza berish', 'button label in Uzbek');
}

function russianPostUsesRussianLabels() {
  const post = buildChannelPost(
    {
      id: 'job2',
      title: 'Бухгалтер',
      locale: 'ru',
      companyName: 'Orient Bank Digital',
      cityName: 'Ташкент',
      workMode: 'HYBRID',
      employmentType: 'PART_TIME',
      salaryMin: 7_000_000,
      salaryMax: null,
      currency: 'UZS',
    },
    WEB,
  );
  assert(post.text.includes('Зарплата: от 7 000 000 UZS'), `salary-from in Russian: ${post.text}`);
  assert(post.text.includes('Частичная занятость | гибрид'), 'employment and mode in Russian');
  assert(post.url.startsWith(`${WEB}/ru/jobs/job2`), 'Russian posting links to the ru page');
}

function salaryFallbacks() {
  assert(formatChannelSalary('en', null, null, 'UZS') === 'negotiable', 'no band -> negotiable');
  assert(formatChannelSalary('uz', null, 9_000_000, 'UZS') === '9 000 000 UZS gacha', 'up-to in Uzbek');
}

function jobsCommandText() {
  const personal = buildJobsCommandText({
    locale: 'uz',
    personalised: true,
    linked: true,
    webBase: WEB,
    jobs: [{ id: 'a', title: 'Frontend Developer', companyName: 'Apex Soft', cityName: 'Toshkent' }],
  });
  assert(personal.startsWith('Sizga mos so‘nggi ish o‘rinlari:'), 'personalised intro');
  assert(personal.includes(`${WEB}/uz/jobs/a?utm_source=telegram&utm_medium=bot`), 'bot deep link with utm');
  assert(!personal.includes('hisobingizni ulang'), 'linked users get no link hint');

  const anonymous = buildJobsCommandText({
    locale: 'ru',
    personalised: false,
    linked: false,
    webBase: WEB,
    jobs: [{ id: 'b', title: 'Бухгалтер', companyName: 'Orient Bank', cityName: null }],
  });
  assert(anonymous.startsWith('Свежие вакансии:'), 'latest intro when not personalised');
  assert(anonymous.includes('привяжите аккаунт'), 'unlinked users get the link hint');

  const empty = buildJobsCommandText({ locale: 'en', personalised: false, linked: false, jobs: [] });
  assert(empty.includes('Nothing to show yet'), 'empty state');
}

channelPostIsHtmlSafeAndLocalized();
russianPostUsesRussianLabels();
salaryFallbacks();
jobsCommandText();
console.log('api: telegram-channel smoke ok');
