-- CreateEnum
CREATE TYPE "ResumeParseStatus" AS ENUM ('NONE', 'PENDING', 'PROCESSING', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "Resume" ADD COLUMN "parseStatus" "ResumeParseStatus" NOT NULL DEFAULT 'NONE';
ALTER TABLE "Resume" ADD COLUMN "parseError" TEXT;
ALTER TABLE "Resume" ADD COLUMN "parsedAt" TIMESTAMP(3);

-- Backfill: existing parsed resumes are already ready
UPDATE "Resume"
SET "parseStatus" = 'READY', "parsedAt" = "updatedAt"
WHERE "parsedData" IS NOT NULL;

-- CreateIndex
CREATE INDEX "Resume_parseStatus_idx" ON "Resume"("parseStatus");
