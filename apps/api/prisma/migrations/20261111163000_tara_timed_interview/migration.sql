ALTER TABLE "AiScreeningSession" ADD COLUMN "taraDeadlineAt" TIMESTAMP(3),
    ADD COLUMN "taraAdvanceAt" TIMESTAMP(3);
CREATE INDEX "AiScreeningSession_taraDeadlineAt_status_idx" ON "AiScreeningSession"("taraDeadlineAt", "status");
CREATE INDEX "AiScreeningSession_taraAdvanceAt_status_idx" ON "AiScreeningSession"("taraAdvanceAt", "status");
