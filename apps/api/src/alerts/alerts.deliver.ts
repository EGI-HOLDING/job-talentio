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

export function hasAnyAlertChannel(flags: AlertChannelFlags): boolean {
  return flags.notifyInApp || flags.notifyEmail || flags.notifyTelegram;
}

export function decideAlertChannels(
  flags: AlertChannelFlags,
  ctx: AlertChannelContext,
): AlertChannelDecisions {
  return {
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
