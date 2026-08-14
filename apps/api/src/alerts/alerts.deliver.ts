import { translateMessage, type MessageLocale } from '@job-talentio/shared';
import { escapeHtml } from '../common/utils';

export type AlertChannelFlags = {
  notifyInApp: boolean;
  notifyEmail: boolean;
  notifyTelegram: boolean;
};

export type AlertChannelContext = {
  emailVerified: boolean;
  demoMailbox: boolean;
  telegramId: string | null;
  telegramConfigured: boolean;
};

export type ChannelDecision = 'off' | 'skip' | 'send';

export type AlertChannelDecisions = {
  inApp: ChannelDecision;
  email: ChannelDecision;
  telegram: ChannelDecision;
};

export type DigestJob = {
  id: string;
  title: string;
  companyName: string;
  cityName: string | null;
};

/** First digest lookback: 24h for daily, 7d for weekly. Later runs use lastSentAt. */
export function alertMatchSince(
  alert: { frequency?: string | null; lastSentAt?: Date | null },
  now = Date.now(),
): Date {
  if (alert.lastSentAt) return alert.lastSentAt;
  const hours = alert.frequency === 'WEEKLY' ? 7 * 24 : 24;
  return new Date(now - hours * 60 * 60 * 1000);
}

export function hasAnyAlertChannel(flags: AlertChannelFlags): boolean {
  return flags.notifyInApp || flags.notifyEmail || flags.notifyTelegram;
}

/** Keep at least in-app on so an alert cannot be saved with no destination. */
export function ensureDeliverableAlertChannels(flags: AlertChannelFlags): AlertChannelFlags {
  if (hasAnyAlertChannel(flags)) return flags;
  return { ...flags, notifyInApp: true };
}

export function decideAlertChannels(
  flags: AlertChannelFlags,
  ctx: AlertChannelContext,
): AlertChannelDecisions {
  const decisions: AlertChannelDecisions = {
    inApp: flags.notifyInApp ? 'send' : 'off',
    email: !flags.notifyEmail
      ? 'off'
      : !ctx.emailVerified || ctx.demoMailbox
        ? 'skip'
        : 'send',
    telegram: !flags.notifyTelegram
      ? 'off'
      : !ctx.telegramId || !ctx.telegramConfigured
        ? 'skip'
        : 'send',
  };
  // Telegram (or email) requested but not deliverable must not drop the digest.
  if (
    decisions.inApp !== 'send' &&
    decisions.email !== 'send' &&
    decisions.telegram !== 'send' &&
    hasAnyAlertChannel(flags)
  ) {
    decisions.inApp = 'send';
  }
  return decisions;
}

export function shouldStampLastSentAt(
  decisions: AlertChannelDecisions,
  results: { inApp?: boolean; email?: boolean; telegram?: boolean },
): boolean {
  return (
    (decisions.inApp === 'send' && results.inApp === true) ||
    (decisions.email === 'send' && results.email === true) ||
    (decisions.telegram === 'send' && results.telegram === true)
  );
}

export function publicSiteUrl(locale: string, path: string, webBase?: string): string {
  const base = (webBase ?? process.env.WEB_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const loc = locale || 'uz';
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}/${loc}${p}`;
}

export function jobPublicUrl(jobId: string, locale: string, webBase?: string): string {
  return publicSiteUrl(locale, `/jobs/${jobId}`, webBase);
}

export type AlertJobsListInput = {
  query?: string | null;
  frequency?: string | null;
  city?: { slug: string } | null;
  category?: { slug: string } | null;
  skills: Array<{ skill?: { slug: string } | null }>;
};

/** Jobs browse URL that mirrors the alert filters (city, skills, keywords). */
export function buildAlertJobsListPath(alert: AlertJobsListInput): string {
  const params = new URLSearchParams();
  const q = alert.query?.trim();
  if (q) params.set('q', q);
  if (alert.city?.slug) params.set('city', alert.city.slug);
  if (alert.category?.slug) params.set('category', alert.category.slug);
  const skillSlugs = [
    ...new Set(alert.skills.map((row) => row.skill?.slug?.trim()).filter(Boolean) as string[]),
  ];
  if (skillSlugs.length) params.set('skills', skillSlugs.join(','));
  if (alert.frequency === 'WEEKLY') params.set('postedWithin', '7d');
  else params.set('postedWithin', '24h');
  params.set('sort', 'newest');
  return `/jobs?${params.toString()}`;
}

export function buildInAppJobAlert(opts: {
  alertName: string;
  jobs: DigestJob[];
  listPath: string;
}): {
  title: string;
  body: string;
  titleKey: string;
  bodyKey: string;
  params: Record<string, string | number>;
  linkUrl: string;
} {
  const job = opts.jobs[0];
  if (opts.jobs.length === 1 && job) {
    const hasCity = Boolean(job.cityName);
    return {
      title: job.title,
      body: hasCity ? `${job.companyName} | ${job.cityName}` : job.companyName,
      titleKey: 'notify.jobAlert.singleTitle',
      bodyKey: hasCity ? 'notify.jobAlert.singleBodyCity' : 'notify.jobAlert.singleBody',
      params: {
        title: job.title,
        company: job.companyName,
        city: job.cityName || '',
        alert: opts.alertName,
      },
      linkUrl: `/jobs/${job.id}`,
    };
  }
  return {
    title: `Job alert: ${opts.alertName}`,
    body: `${opts.jobs.length} new matching job(s)`,
    titleKey: 'notify.jobAlert.title',
    bodyKey: 'notify.jobAlert.body',
    params: { alert: opts.alertName, count: opts.jobs.length },
    linkUrl: opts.listPath,
  };
}

export function buildJobAlertEmailHtml(opts: {
  locale: MessageLocale;
  alertName: string;
  jobs: DigestJob[];
  webBase?: string;
}): string {
  const t = (key: string, params?: Record<string, string | number>) =>
    translateMessage(key, opts.locale, params);
  const list = opts.jobs
    .map((job) => {
      const href = escapeHtml(jobPublicUrl(job.id, opts.locale, opts.webBase));
      const title = escapeHtml(job.title);
      const company = escapeHtml(job.companyName);
      const city = escapeHtml(job.cityName || '-');
      const line = t('email.jobAlert.jobLine', { title, company, city });
      return `<li><a href="${href}">${line}</a></li>`;
    })
    .join('');
  const manageHref = escapeHtml(
    publicSiteUrl(opts.locale, '/dashboard/employee?tab=alerts', opts.webBase),
  );
  return `<p>${t('email.greetingShort')}</p><p>${t('email.jobAlert.intro', {
    alert: escapeHtml(opts.alertName),
  })}</p><ul>${list}</ul><p><a href="${manageHref}">${t(
    'email.jobAlert.manage',
  )}</a></p><p style="color:#64748b;font-size:12px">${t('email.footer')}</p>`;
}

export function buildJobAlertTelegramText(opts: {
  locale: MessageLocale;
  alertName: string;
  jobs: DigestJob[];
  webBase?: string;
}): string {
  const t = (key: string, params?: Record<string, string | number>) =>
    translateMessage(key, opts.locale, params);
  const lines = opts.jobs.map((job) =>
    t('telegram.jobAlert.jobLine', {
      title: job.title,
      company: job.companyName,
      city: job.cityName || '-',
      url: jobPublicUrl(job.id, opts.locale, opts.webBase),
    }),
  );
  return [
    t('telegram.jobAlert.intro', { alert: opts.alertName, count: opts.jobs.length }),
    '',
    ...lines,
  ].join('\n');
}
