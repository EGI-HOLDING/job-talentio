import {
  getCountries,
  getCountryCallingCode,
  isSupportedCountry,
  parseDigits,
  parsePhoneNumberFromString,
  validatePhoneNumberLength,
  type CountryCode,
} from 'libphonenumber-js/max';

export type PhoneDraft = {
  country: string;
  nationalNumber: string;
};

export type PhoneErrorCode =
  | 'PHONE_REQUIRED'
  | 'PHONE_INVALID'
  | 'PHONE_COUNTRY_CODE_REPEATED'
  | 'PHONE_COUNTRY_CODE_MISMATCH'
  | 'PHONE_NATIONAL_PREFIX';

export type PhoneDraftValidation =
  | { ok: true; phone: string }
  | { ok: false; error: PhoneErrorCode };

export type PhoneCountryOption = {
  country: CountryCode;
  dialCode: string;
  name: string;
};

export function phoneCountryOptions(locale: string): PhoneCountryOption[] {
  const names = new Intl.DisplayNames([locale], { type: 'region' });
  return getCountries()
    .map((country) => ({
      country,
      dialCode: `+${getCountryCallingCode(country)}`,
      name: names.of(country) || country,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));
}

export function defaultPhoneCountry(
  country?: string | null,
  marketDefault?: string | null,
): CountryCode {
  if (country && isSupportedCountry(country)) return country;
  if (marketDefault && isSupportedCountry(marketDefault)) return marketDefault;
  return 'US';
}

function isOnlyPhoneFormatting(value: string): boolean {
  return /^[\p{N}\s().-]+$/u.test(value);
}

export function validatePhoneDraft(value: PhoneDraft): PhoneDraftValidation {
  const country = value.country;
  if (!isSupportedCountry(country)) return { ok: false, error: 'PHONE_INVALID' };

  const raw = value.nationalNumber.trim();
  if (!raw) return { ok: false, error: 'PHONE_REQUIRED' };

  const callingCode = getCountryCallingCode(country as CountryCode);
  const digits = parseDigits(raw);
  if (!digits) return { ok: false, error: 'PHONE_REQUIRED' };

  if (raw.startsWith('+')) {
    const suppliedCode = parseDigits(raw);
    return {
      ok: false,
      error: suppliedCode.startsWith(callingCode)
        ? 'PHONE_COUNTRY_CODE_REPEATED'
        : 'PHONE_COUNTRY_CODE_MISMATCH',
    };
  }
  if (!isOnlyPhoneFormatting(raw)) return { ok: false, error: 'PHONE_INVALID' };

  const candidate = `+${callingCode}${digits}`;
  // Some metadata treats a common national trunk prefix as a valid leading
  // digit in E.164. Detect an exact local-to-international normalization first
  // (for example Indonesia 0812… -> +62812…), while preserving significant
  // zeroes such as Italian numbers beginning with 0.
  if (digits.startsWith('0') && digits.length > 1) {
    const nationalInterpretation = parsePhoneNumberFromString(digits, country as CountryCode);
    const withoutTrunkPrefix = parsePhoneNumberFromString(
      `+${callingCode}${digits.slice(1)}`,
    );
    if (
      nationalInterpretation?.isValid() &&
      withoutTrunkPrefix?.isValid() &&
      nationalInterpretation.number === withoutTrunkPrefix.number
    ) {
      return { ok: false, error: 'PHONE_NATIONAL_PREFIX' };
    }
  }
  const parsed = parsePhoneNumberFromString(candidate);
  if (parsed?.isValid()) {
    const possibleCountries = parsed.getPossibleCountries();
    if (
      (parsed.country && parsed.country !== country) ||
      (!parsed.country && possibleCountries.length && !possibleCountries.includes(country as CountryCode))
    ) {
      return { ok: false, error: 'PHONE_INVALID' };
    }
    return { ok: true, phone: parsed.number };
  }

  // Catch a pasted country code only when removing it produces a valid number.
  // This avoids rejecting legitimate national numbers that happen to start with
  // the same digit as a shared calling code.
  if (digits.startsWith(callingCode) && digits.length > callingCode.length) {
    const withoutRepeatedCode = parsePhoneNumberFromString(
      `+${callingCode}${digits.slice(callingCode.length)}`,
    );
    if (withoutRepeatedCode?.isValid()) {
      return { ok: false, error: 'PHONE_COUNTRY_CODE_REPEATED' };
    }
  }

  const length = validatePhoneNumberLength(candidate);
  if (length === 'TOO_SHORT' || length === 'TOO_LONG') {
    return { ok: false, error: 'PHONE_INVALID' };
  }
  return { ok: false, error: 'PHONE_INVALID' };
}

/** Strict API/storage guard: accepts only a valid canonical E.164 number. */
export function normalizeE164Phone(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw || !/^\+[1-9]\d{7,14}$/.test(raw)) return null;
  const parsed = parsePhoneNumberFromString(raw);
  return parsed?.isValid() && parsed.number === raw ? parsed.number : null;
}

export function phoneDraftFromE164(
  value: string | null | undefined,
  fallbackCountry?: string | null,
  marketDefault?: string | null,
): PhoneDraft {
  const fallback = defaultPhoneCountry(fallbackCountry, marketDefault);
  const parsed = value ? parsePhoneNumberFromString(value) : undefined;
  if (!parsed) return { country: fallback, nationalNumber: '' };

  const possible = parsed.getPossibleCountries();
  const country =
    parsed.country ||
    (fallbackCountry && possible.includes(fallbackCountry as CountryCode)
      ? (fallbackCountry as CountryCode)
      : undefined) ||
    (possible.length ? possible[0] : fallback);
  return { country, nationalNumber: parsed.nationalNumber };
}
