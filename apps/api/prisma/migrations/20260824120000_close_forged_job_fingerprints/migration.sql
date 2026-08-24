-- Close active JobPost duplicates that share a canonical fingerprint (including
-- backfill-forged `hash:idSlice` values) or the same title+workMode+city.
-- Keep one winner per group: PUBLISHED, then PAUSED, then DRAFT; then most
-- applications; then newest createdAt. Restore 64-hex fingerprints afterwards.
-- Idempotent. Does not target individual job ids.

DO $$
DECLARE
  n integer;
BEGIN
  WITH ranked AS (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY
          "companyId",
          CASE
            WHEN fingerprint ~* '^[a-f0-9]{64}(:[a-z0-9]+)?$'
              THEN lower(split_part(fingerprint, ':', 1))
            ELSE fingerprint
          END
        ORDER BY
          CASE status
            WHEN 'PUBLISHED' THEN 0
            WHEN 'PAUSED' THEN 1
            WHEN 'DRAFT' THEN 2
            ELSE 3
          END,
          (SELECT COUNT(*) FROM "Application" a WHERE a."jobPostId" = "JobPost".id) DESC,
          "createdAt" DESC,
          id
      ) AS rn
    FROM "JobPost"
    WHERE status IN ('DRAFT', 'PUBLISHED', 'PAUSED')
      AND fingerprint IS NOT NULL
  ),
  upd AS (
    UPDATE "JobPost" AS j
    SET
      status = 'CLOSED',
      "closedAt" = COALESCE(j."closedAt", CURRENT_TIMESTAMP)
    FROM ranked AS r
    WHERE j.id = r.id
      AND r.rn > 1
    RETURNING j.id
  )
  SELECT COUNT(*) INTO n FROM upd;
  RAISE NOTICE 'close_forged_job_fingerprints: pass A closed % row(s)', n;
END $$;

DO $$
DECLARE
  n integer;
BEGIN
  WITH ranked AS (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY
          "companyId",
          lower(btrim(title)),
          "workMode",
          COALESCE("cityId", '')
        ORDER BY
          CASE status
            WHEN 'PUBLISHED' THEN 0
            WHEN 'PAUSED' THEN 1
            WHEN 'DRAFT' THEN 2
            ELSE 3
          END,
          (SELECT COUNT(*) FROM "Application" a WHERE a."jobPostId" = "JobPost".id) DESC,
          "createdAt" DESC,
          id
      ) AS rn
    FROM "JobPost"
    WHERE status IN ('DRAFT', 'PUBLISHED', 'PAUSED')
  ),
  upd AS (
    UPDATE "JobPost" AS j
    SET
      status = 'CLOSED',
      "closedAt" = COALESCE(j."closedAt", CURRENT_TIMESTAMP)
    FROM ranked AS r
    WHERE j.id = r.id
      AND r.rn > 1
    RETURNING j.id
  )
  SELECT COUNT(*) INTO n FROM upd;
  RAISE NOTICE 'close_forged_job_fingerprints: pass B closed % row(s)', n;
END $$;

-- Restore canonical hashes. Skip an active row when another active sibling
-- already owns the prefix (unique index JobPost_companyId_fingerprint_active_key).
UPDATE "JobPost" AS j
SET fingerprint = lower(split_part(j.fingerprint, ':', 1))
WHERE j.fingerprint ~* '^[a-f0-9]{64}:[a-z0-9]+$'
  AND NOT (
    j.status IN ('DRAFT', 'PUBLISHED', 'PAUSED')
    AND EXISTS (
      SELECT 1
      FROM "JobPost" AS o
      WHERE o.id <> j.id
        AND o."companyId" = j."companyId"
        AND o.status IN ('DRAFT', 'PUBLISHED', 'PAUSED')
        AND o.fingerprint = lower(split_part(j.fingerprint, ':', 1))
    )
  );
