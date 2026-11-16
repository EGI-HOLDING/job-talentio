import { Prisma } from '@prisma/client';

export function activeCompanyFeatures(now: Date, companyId?: string) {
  const company = companyId ? Prisma.sql`AND b."companyId" = ${companyId}` : Prisma.empty;
  return Prisma.sql`
    SELECT b."companyId", b.code, p."featuredEndsAt" AS "endsAt"
    FROM "JobPublicationPeriod" p
    JOIN "JobBenefit" b ON b."jobId" = p."jobId" AND b."publicationCycle" = p.cycle
    JOIN "JobPost" j ON j.id = b."jobId"
    WHERE p."featuredStartsAt" <= ${now} AND p."featuredEndsAt" > ${now}
      AND b."startsAt" <= ${now} AND b."expiresAt" > ${now}
      AND j.status = 'PUBLISHED' AND NOT j."isAnonymous" ${company}
    UNION ALL
    SELECT b."companyId", b.code, LEAST(cp."endsAt", b."expiresAt") AS "endsAt"
    FROM "CompanyPromotion" cp
    JOIN "JobBenefit" b ON b."companyId" = cp."companyId"
    JOIN "JobPost" j ON j.id = b."jobId"
    WHERE cp."endsAt" > ${now} AND b."startsAt" <= ${now} AND b."expiresAt" > ${now}
      AND b.code IN ('STANDARD', 'PREMIUM')
      AND b."policySnapshot"->>'featuredByPeriod' IS DISTINCT FROM 'true'
      AND j.status = 'PUBLISHED' AND NOT j."isAnonymous" ${company}
  `;
}
