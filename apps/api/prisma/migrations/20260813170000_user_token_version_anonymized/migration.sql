-- Access JWTs carry `tv`; bumping tokenVersion signs everyone out.
-- anonymizedAt marks GDPR erasure without deleting the user row.
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "anonymizedAt" TIMESTAMP(3);
