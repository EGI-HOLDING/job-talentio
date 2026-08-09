/**
 * Seed / dummy account mailbox domains — never send real outbound email
 * (keeps Resend quota for real users).
 */
export const DEMO_MAILBOX_DOMAINS = [
  // Dummy job seekers
  'jobtalent.io',
  // Seed super admin
  'jobtalentio.uz',
  // Dummy recruiter company domains (see prisma/seed.ts COMPANIES.mailDomain)
  'apexsoft.uz',
  'uzpay.uz',
  'silkroad.uz',
  'softlabs.uz',
  'samdigital.uz',
  'orientbank.uz',
  'ferganalogistics.uz',
  'edunest.uz',
  'medicare-it.uz',
  'navoieng.uz',
  'agrotech.uz',
  'bukhotels.uz',
  'clickpay.uz',
  'namtextile.uz',
  'uztelecom.uz',
  'khorezmgreen.uz',
  'tlpartners.uz',
  'caravan.uz',
  'nukussmart.uz',
  'chirchiqpharma.uz',
] as const;

const DEMO_DOMAIN_SET = new Set(
  DEMO_MAILBOX_DOMAINS.map((d) => d.toLowerCase()),
);

/** True when `to` is a seeded/dummy mailbox that must not receive platform email. */
export function isDemoMailbox(to: string): boolean {
  const email = to.trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at < 0) return false;
  const domain = email.slice(at + 1);
  return DEMO_DOMAIN_SET.has(domain);
}
