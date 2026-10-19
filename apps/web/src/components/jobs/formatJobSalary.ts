type Salary = { salaryMin?: number | null; salaryMax?: number | null; currency?: string | null; salaryPeriod?: string | null };

export function formatJobSalary(job: Salary, locale: string, t: (key: string) => string) {
  const min = job.salaryMin, max = job.salaryMax;
  if (min == null && max == null) return t('job.negotiable');
  const fmt = new Intl.NumberFormat(locale === 'ru' ? 'ru-RU' : locale === 'uz' ? 'uz-UZ' : 'en-US', { maximumFractionDigits: 1 });
  // Compact millions without hiding the actual currency or pay period.
  const unit = (min ?? max ?? 0) >= 1_000_000 ? 1_000_000 : 1;
  const number = (value: number) => fmt.format(value / unit);
  const modifier = t(min != null ? 'landing.from' : 'landing.upTo');
  let amount = min != null && max != null ? `${number(min)} - ${number(max)}`
    : locale === 'uz' ? `${number((min ?? max)!)} ${modifier}` : `${modifier} ${number((min ?? max)!)}`;
  if (unit !== 1) amount += ` ${t('workspace.million')}`;
  const period: Record<string, string> = { MONTHLY: 'landing.month', YEARLY: 'landing.year', HOURLY: 'landing.hour' };
  return `${job.currency || ''} ${amount}${period[job.salaryPeriod || ''] ? ` / ${t(period[job.salaryPeriod!])}` : ''}`.trim();
}
