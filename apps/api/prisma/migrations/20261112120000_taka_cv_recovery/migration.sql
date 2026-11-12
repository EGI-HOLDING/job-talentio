ALTER TABLE "AiScreeningWork" ADD COLUMN "cvPolicy" TEXT, ADD COLUMN "cvCheckpoint" JSONB;
ALTER TABLE "AiScreeningCall" ADD COLUMN "cvTokenReservation" INTEGER, ADD COLUMN "cvCooldownUntil" TIMESTAMP(3);
ALTER TABLE "RecruitmentCandidate" ADD COLUMN "cvProgress" JSONB;
CREATE INDEX "AiScreeningCall_responseId_idx" ON "AiScreeningCall"("responseId");
CREATE INDEX "AiScreeningCall_task_createdAt_idx" ON "AiScreeningCall"("task", "createdAt");
