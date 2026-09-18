import { translateMessage, type MessageLocale } from '@job-talentio/shared';
import { escapeHtml } from '../common/utils';
import { jobPublicUrl } from '../alerts/alerts.deliver';

export type ChannelJobInput = {
  id: string;
  title: string;
  locale: string | null;
  companyName: string;
  cityName?: string | null;
  workMode: string;
  employmentType: string;
  salaryMin?: number | null;
  salaryMax?: number | null;
  currency?: string | null;
  skills?: string[];
};

const LOCALES: MessageLocale[] = ['uz', 'ru', 'en'];

export function channelLocale(raw: string | null | undefined): MessageLocale {
  return LOCALES.includes(raw as MessageLocale) ? (raw as MessageLocale) : 'uz';
}

function spaced(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export function formatChannelSalary(
  locale: MessageLocale,
  min?: number | null,
  max?: number | null,
  currency?: string | null,
): string {
  const cur = currency || 'UZS';
  if (min && max) return `${spaced(min)} - ${spaced(max)} ${cur}`;
  if (min) return translateMessage('telegram.channel.salaryFrom', locale, { amount: `${spaced(min)} ${cur}` });
  if (max) return translateMessage('telegram.channel.salaryUpTo', locale, { amount: `${spaced(max)} ${cur}` });
  return translateMessage('telegram.channel.salaryNegotiable', locale);
}

/** Hashtag-safe token: letters and digits only, Latin/Cyrillic kept. */
function hashtag(value: string | null | undefined): string | null {
  if (!value) return null;
  const token = value.replace(/[^\p{L}\p{N}]+/gu, '');
  return token ? `#${token}` : null;
}

export function channelJobUrl(jobId: string, locale: MessageLocale, webBase?: string): string {
  return `${jobPublicUrl(jobId, locale, webBase)}?utm_source=telegram&utm_medium=channel`;
}

/** HTML-formatted channel card for a newly published posting, in the posting's language. */
export function buildChannelPost(job: ChannelJobInput, webBase?: string): { text: string; url: string; button: string } {
  const locale = channelLocale(job.locale);
  const t = (key: string, params?: Record<string, string | number>) => translateMessage(key, locale, params);
  const url = channelJobUrl(job.id, locale, webBase);
  const mode = t(`telegram.channel.workMode.${job.workMode}`);
  const employment = t(`telegram.channel.employment.${job.employmentType}`);
  const salary = formatChannelSalary(locale, job.salaryMin, job.salaryMax, job.currency);
  const tags = [hashtag(job.cityName), ...(job.skills || []).slice(0, 3).map((s) => hashtag(s))]
    .filter((x): x is string => Boolean(x))
    .join(' ');

  const lines = [
    `<b>${escapeHtml(job.title)}</b>`,
    `${escapeHtml(job.companyName)}${job.cityName ? ` | ${escapeHtml(job.cityName)}` : ''}`,
    `${t('telegram.channel.salaryLabel')}: ${escapeHtml(salary)}`,
    `${escapeHtml(employment)} | ${escapeHtml(mode)}`,
    '',
    `<a href="${escapeHtml(url)}">${escapeHtml(t('telegram.channel.open'))}</a>`,
  ];
  if (tags) lines.push('', tags);
  return { text: lines.join('\n'), url, button: t('telegram.channel.open') };
}

export type BotJobLine = {
  id: string;
  title: string;
  companyName: string;
  cityName?: string | null;
};

/** `/jobs` reply: personalised when matches exist, latest postings otherwise. */
export function buildJobsCommandText(opts: {
  locale: MessageLocale;
  jobs: BotJobLine[];
  personalised: boolean;
  linked: boolean;
  webBase?: string;
}): string {
  const t = (key: string, params?: Record<string, string | number>) => translateMessage(key, opts.locale, params);
  if (opts.jobs.length === 0) {
    return [t('telegram.jobs.none'), opts.linked ? '' : t('telegram.jobs.linkHint')].filter(Boolean).join('\n\n');
  }
  const lines = opts.jobs.map((job) =>
    t('telegram.jobAlert.jobLine', {
      title: job.title,
      company: job.companyName,
      city: job.cityName || '-',
      url: `${jobPublicUrl(job.id, opts.locale, opts.webBase)}?utm_source=telegram&utm_medium=bot`,
    }),
  );
  const intro = opts.personalised ? t('telegram.jobs.intro') : t('telegram.jobs.introLatest');
  const footer = opts.linked ? '' : t('telegram.jobs.linkHint');
  return [intro, '', ...lines, footer ? '' : null, footer || null].filter((x) => x !== null).join('\n');
}
