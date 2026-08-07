-- Chat receipts: peer delivery timestamp (readAt already exists)
ALTER TABLE "ChatMessage" ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP(3);

-- Close older active duplicates that share companyId + fingerprint (keep newest)
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "companyId", fingerprint
      ORDER BY "createdAt" DESC
    ) AS rn
  FROM "JobPost"
  WHERE status IN ('DRAFT', 'PUBLISHED', 'PAUSED')
    AND fingerprint IS NOT NULL
)
UPDATE "JobPost" AS j
SET
  status = 'CLOSED',
  "closedAt" = COALESCE(j."closedAt", CURRENT_TIMESTAMP)
FROM ranked AS r
WHERE j.id = r.id
  AND r.rn > 1;

-- Also close active dupes that share identical contentHash within a company
WITH ranked_content AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "companyId", "contentHash"
      ORDER BY "createdAt" DESC
    ) AS rn
  FROM "JobPost"
  WHERE status IN ('DRAFT', 'PUBLISHED', 'PAUSED')
    AND "contentHash" IS NOT NULL
)
UPDATE "JobPost" AS j
SET
  status = 'CLOSED',
  "closedAt" = COALESCE(j."closedAt", CURRENT_TIMESTAMP)
FROM ranked_content AS r
WHERE j.id = r.id
  AND r.rn > 1;

-- One active opening per company fingerprint (CLOSED/EXPIRED may reuse the same fingerprint)
CREATE UNIQUE INDEX IF NOT EXISTS "JobPost_companyId_fingerprint_active_key"
ON "JobPost" ("companyId", fingerprint)
WHERE status IN ('DRAFT', 'PUBLISHED', 'PAUSED')
  AND fingerprint IS NOT NULL;
