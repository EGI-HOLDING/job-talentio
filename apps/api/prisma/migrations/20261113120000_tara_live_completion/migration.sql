ALTER TABLE "AiScreeningSession"
    ADD COLUMN "voiceCompletion" JSONB,
    ADD COLUMN "voiceDeadlineAt" TIMESTAMP(3);

CREATE INDEX "AiScreeningSession_status_voiceDeadlineAt_idx"
    ON "AiScreeningSession"("status", "voiceDeadlineAt");

ALTER TABLE "VoiceInterview" ADD COLUMN "resumedForId" TEXT;
CREATE UNIQUE INDEX "VoiceInterview_resumedForId_key" ON "VoiceInterview"("resumedForId");
ALTER TABLE "VoiceInterview" ADD CONSTRAINT "VoiceInterview_resumedForId_fkey"
    FOREIGN KEY ("resumedForId") REFERENCES "AiScreeningSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "VoiceInterview" ADD CONSTRAINT "VoiceInterview_single_session_link"
    CHECK ("sessionId" IS NULL OR "resumedForId" IS NULL);
