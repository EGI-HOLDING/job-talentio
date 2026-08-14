import {
  buildAlertJobsListPath,
  buildInAppJobAlert,
  buildJobAlertEmailHtml,
  decideAlertChannels,
  ensureDeliverableAlertChannels,
  hasAnyAlertChannel,
  shouldStampLastSentAt,
} from './alerts.deliver';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function emailSkippedWhenUnverified() {
  const decisions = decideAlertChannels(
    { notifyInApp: false, notifyEmail: true, notifyTelegram: false },
    {
      emailVerified: false,
      demoMailbox: false,
      telegramId: null,
      telegramConfigured: true,
    },
  );
  assert(decisions.email === 'skip', `expected email skip, got ${decisions.email}`);
  assert(decisions.inApp === 'send', 'unverified email-only alerts must still notify in-app');
}

function telegramSkippedWithoutChat() {
  const decisions = decideAlertChannels(
    { notifyInApp: true, notifyEmail: false, notifyTelegram: true },
    {
      emailVerified: true,
      demoMailbox: false,
      telegramId: null,
      telegramConfigured: true,
    },
  );
  assert(decisions.telegram === 'skip', `expected telegram skip, got ${decisions.telegram}`);
  assert(decisions.inApp === 'send', 'in-app should still send when telegram is skipped');
}

function telegramUnlinkedFallsBackToInApp() {
  const decisions = decideAlertChannels(
    { notifyInApp: false, notifyEmail: false, notifyTelegram: true },
    {
      emailVerified: true,
      demoMailbox: false,
      telegramId: null,
      telegramConfigured: true,
    },
  );
  assert(decisions.telegram === 'skip', 'unlinked telegram must skip');
  assert(decisions.inApp === 'send', 'unlinked telegram-only alerts must still notify in-app');
}

function lastSentAtNotStampedWhenAllFail() {
  const decisions = decideAlertChannels(
    { notifyInApp: true, notifyEmail: true, notifyTelegram: true },
    {
      emailVerified: true,
      demoMailbox: false,
      telegramId: '123',
      telegramConfigured: true,
    },
  );
  assert(decisions.inApp === 'send' && decisions.email === 'send' && decisions.telegram === 'send', 'all should send');
  assert(
    !shouldStampLastSentAt(decisions, { inApp: false, email: false, telegram: false }),
    'must not stamp lastSentAt when every channel fails',
  );
  assert(
    shouldStampLastSentAt(decisions, { inApp: true, email: false, telegram: false }),
    'in-app success should stamp lastSentAt',
  );
}

function digestHtmlEscapesAndLinks() {
  const html = buildJobAlertEmailHtml({
    locale: 'en',
    alertName: 'Frontend <x>',
    webBase: 'https://staging.jobtalent.io',
    jobs: [
      {
        id: 'job-1',
        title: 'Engineer <script>',
        companyName: 'Acme & Co',
        cityName: 'Tashkent',
      },
    ],
  });
  assert(html.includes('https://staging.jobtalent.io/en/jobs/job-1'), 'missing job url');
  assert(html.includes('https://staging.jobtalent.io/en/dashboard/employee?tab=alerts'), 'missing manage url');
  assert(html.includes('Engineer &lt;script&gt;'), `title was not escaped: ${html}`);
  assert(html.includes('Acme &amp; Co'), 'company was not escaped');
  assert(!html.includes('<script>'), 'raw script tag leaked into html');
  assert(!hasAnyAlertChannel({ notifyInApp: false, notifyEmail: false, notifyTelegram: false }), 'empty channels');
  const forced = ensureDeliverableAlertChannels({
    notifyInApp: false,
    notifyEmail: false,
    notifyTelegram: false,
  });
  assert(forced.notifyInApp === true, 'empty alert must keep in-app on');
}

function inAppAlertLinksFollowMatchCount() {
  const one = buildInAppJobAlert({
    alertName: 'Waiters',
    listPath: '/jobs?city=tashkent&sort=newest',
    jobs: [{ id: 'job-1', title: 'Waiter', companyName: 'Hadith', cityName: 'Tashkent' }],
  });
  assert(one.linkUrl === '/jobs/job-1', `single match should open the job, got ${one.linkUrl}`);
  assert(one.titleKey === 'notify.jobAlert.singleTitle', 'single match should use the job title key');

  const many = buildInAppJobAlert({
    alertName: 'Waiters',
    listPath: '/jobs?city=tashkent&skills=waiter&sort=newest',
    jobs: [
      { id: 'job-1', title: 'Waiter', companyName: 'Hadith', cityName: 'Tashkent' },
      { id: 'job-2', title: 'Host', companyName: 'Saji', cityName: 'Tashkent' },
    ],
  });
  assert(
    many.linkUrl === '/jobs?city=tashkent&skills=waiter&sort=newest',
    `digest should open the filtered list, got ${many.linkUrl}`,
  );
  assert(many.titleKey === 'notify.jobAlert.title', 'digest should keep the alert title');

  const listPath = buildAlertJobsListPath({
    query: 'waiter',
    frequency: 'DAILY',
    city: { slug: 'tashkent' },
    category: null,
    skills: [{ skill: { slug: 'hospitality' } }],
  });
  assert(listPath.includes('q=waiter'), `missing keyword: ${listPath}`);
  assert(listPath.includes('city=tashkent'), `missing city: ${listPath}`);
  assert(listPath.includes('skills=hospitality'), `missing skills: ${listPath}`);
  assert(listPath.includes('postedWithin=24h'), `daily digest should hint 24h: ${listPath}`);
  assert(listPath.includes('sort=newest'), `missing newest sort: ${listPath}`);
}

function main() {
  emailSkippedWhenUnverified();
  telegramSkippedWithoutChat();
  telegramUnlinkedFallsBackToInApp();
  lastSentAtNotStampedWhenAllFail();
  digestHtmlEscapesAndLinks();
  inAppAlertLinksFollowMatchCount();
  console.log('api: alerts.deliver smoke ok');
}

main();
