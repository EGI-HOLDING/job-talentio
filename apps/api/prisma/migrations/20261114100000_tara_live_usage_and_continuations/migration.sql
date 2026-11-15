ALTER TABLE "VoiceInterview"
    ADD COLUMN "connectionNumber" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "attemptKey" TEXT,
    ADD COLUMN "reservedVoiceMs" INTEGER,
    ADD COLUMN "billedVoiceMs" INTEGER,
    ADD COLUMN "observedVoiceMs" INTEGER;

UPDATE "VoiceInterview" SET "connectionNumber" = 2 WHERE "resumedForId" IS NOT NULL;

CREATE UNIQUE INDEX "VoiceInterview_resumedForId_connectionNumber_key"
    ON "VoiceInterview"("resumedForId", "connectionNumber");
DROP INDEX "VoiceInterview_resumedForId_key";
