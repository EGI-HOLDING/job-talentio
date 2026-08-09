-- Intentionally a no-op.
-- Earlier revision used convert_from(decode(...)) emoji bytes; Railway Postgres
-- rejected those 4-byte sequences (SQLSTATE 22021), leaving migrate in P3009.
-- Category/benefit icons are resolved in app code via @job-talentio/shared icon maps.
SELECT 1;
