import type { EmployeePracticalFit } from '@job-talentio/shared';
import type { IntentPreferences, IntentJob } from './employee-intent';

export const EMPLOYEE_PRACTICAL_POLICY_VERSION = 'employee-practical-v1';
export const employeePracticalEnabled = () => true;
export type PracticalJob = Pick<IntentJob, 'countryId'|'city'|'salaryMin'|'salaryMax'|'currency'|'salaryPeriod'>;

// Decimal amounts are compared as integer hundredths; no exchange rate or working-hour assumption.
function cents(value: unknown): bigint | null {
  const text = String(value ?? '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}
export function practicalFit(preferences: IntentPreferences, job: PracticalJob, enabled = true): EmployeePracticalFit {
  const countries = [...new Set(preferences.preferredCountries.map(c => c.id))];
  if (!countries.length && preferences.residenceCountryId) countries.push(preferences.residenceCountryId);
  const desired = cents(preferences.desiredSalaryMin);
  const countryActive = enabled && countries.length > 0;
  const salaryActive = enabled && desired !== null && desired > 0n;
  const explicit = job.countryId, inferred = job.city?.province.countryId;
  const conflictingCountry = !!(explicit && inferred && explicit !== inferred);
  const country = !countryActive ? 'NOT_REQUESTED' : conflictingCountry || !explicit && !inferred
    ? 'UNKNOWN' : countries.includes(explicit || inferred!) ? 'MET' : 'UNMET';
  let salary: EmployeePracticalFit['salary'] = salaryActive ? 'UNKNOWN' : 'NOT_REQUESTED';
  let salaryReason: EmployeePracticalFit['salaryReason'] = salaryActive ? 'NOT_DISCLOSED' : 'NOT_REQUESTED';
  if (salaryActive) {
    const min = job.salaryMin == null ? null : cents(job.salaryMin), max = job.salaryMax == null ? null : cents(job.salaryMax);
    const currency = (s: string) => s.trim().toUpperCase();
    const period = (s: string) => s === 'YEARLY' ? 12n : s === 'MONTHLY' ? 1n : s === 'HOURLY' ? 1n : null;
    const a = period(preferences.desiredSalaryPeriod), b = period(job.salaryPeriod);
    if (job.salaryMin != null && min === null || job.salaryMax != null && max === null || min !== null && max !== null && min > max) salaryReason = 'INVALID_RANGE';
    else if (currency(job.currency) !== currency(preferences.desiredSalaryCurrency) || !/^[A-Z]{3}$/.test(currency(job.currency))) salaryReason = 'CURRENCY_MISMATCH';
    else if (!a || !b || (preferences.desiredSalaryPeriod === 'HOURLY') !== (job.salaryPeriod === 'HOURLY')) salaryReason = 'PERIOD_MISMATCH';
    else if (max !== null) {
      salary = max * a >= desired! * b ? 'MET' : 'UNMET';
      salaryReason = salary === 'UNMET' ? 'BELOW_TARGET' : min !== null && min * a >= desired! * b ? 'ENTIRE_RANGE_MEETS' : 'UPPER_BOUND_MEETS';
    } else if (min !== null && min * a >= desired! * b) { salary = 'MET'; salaryReason = 'LOWER_BOUND_MEETS'; }
    else if (min !== null) salaryReason = 'UPPER_BOUND_MISSING';
  }
  const countryEligible = country === 'MET' || country === 'NOT_REQUESTED';
  return { version: EMPLOYEE_PRACTICAL_POLICY_VERSION, active: enabled, country, salary, salaryReason,
    group: !countryEligible || salary === 'UNMET' ? 'EXCLUDED' : salary === 'UNKNOWN' ? 'SALARY_UNVERIFIED' : 'MAIN' };
}
