ALTER TABLE "Resume" ADD COLUMN "parseStartedAt" TIMESTAMP(3);
UPDATE "Resume" SET "parseStartedAt" = "updatedAt" WHERE "parseStatus" = 'PROCESSING';
