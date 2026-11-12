-- Separate creation sessions can publish openings with the same fingerprint.
DROP INDEX IF EXISTS "JobPost_companyId_fingerprint_active_key";
