import { BadRequestException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

export const SELECTABLE_CITY = {
  archivedAt: null,
  kind: { in: ['CITY', 'REGENCY'] },
  province: { archivedAt: null, country: { archivedAt: null, isActive: true } },
} satisfies Prisma.CityWhereInput;

export function geoAliasKey(text: string): string {
  return text.trim().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[‘’'`ʻʼ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function countryFilter(value: string): Prisma.CountryWhereInput {
  return { OR: [{ id: value }, { iso2: value.toUpperCase() }, { slug: value.toLowerCase() }] };
}

/** Validate the complete hierarchy; never silently discard an invalid city. */
export async function resolveJobLocation(
  db: Pick<PrismaClient, 'country' | 'city'>,
  input: { countryId?: unknown; citySlug?: unknown },
  existing?: { countryId: string | null; cityId: string | null },
) {
  const citySpecified = input.citySlug !== undefined;
  const countrySpecified = input.countryId !== undefined;
  if (!citySpecified && !countrySpecified && existing) return { ...existing };
  let countryId = countrySpecified ? (input.countryId || null) as string | null : existing?.countryId ?? null;
  if (countryId && !await db.country.findFirst({ where: { id: countryId, isActive: true, archivedAt: null } })) {
    throw new BadRequestException('Country is not available');
  }
  const city = citySpecified
    ? input.citySlug ? await db.city.findFirst({ where: { slug: String(input.citySlug), ...SELECTABLE_CITY }, include: { province: true } }) : null
    : countrySpecified && countryId !== existing?.countryId ? null
    : existing?.cityId ? await db.city.findFirst({ where: { id: existing.cityId, ...SELECTABLE_CITY }, include: { province: true } }) : null;
  if (input.citySlug && !city) throw new BadRequestException('City is not available');
  if (city && countrySpecified && (!countryId || city.province.countryId !== countryId)) {
    throw new BadRequestException('City does not belong to the selected country');
  }
  if (city && !countrySpecified) countryId = city.province.countryId;
  return { cityId: city?.id ?? null, countryId: countryId ?? city?.province.countryId ?? null };
}
