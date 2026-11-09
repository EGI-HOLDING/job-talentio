-- DropIndex
DROP INDEX "AiScreeningSession_jobId_profileId_key";

-- AlterTable
ALTER TABLE "AiScreeningSession" ADD COLUMN     "legacyKey" TEXT;

-- CreateTable
CREATE TABLE "ScreeningInvitation" (
    "packageId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "createdById" TEXT,
    "claimedUserId" TEXT,
    "requestKey" TEXT NOT NULL,
    "tokenNonce" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'INVITED',
    "snapshot" JSONB NOT NULL,
    "sessionId" TEXT,
    "emailStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "emailAttemptAt" TIMESTAMP(3),
    "emailSentAt" TIMESTAMP(3),
    "messageStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "messageId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScreeningInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScreeningInvitation_tokenHash_key" ON "ScreeningInvitation"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "ScreeningInvitation_sessionId_key" ON "ScreeningInvitation"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "ScreeningInvitation_messageId_key" ON "ScreeningInvitation"("messageId");

-- CreateIndex
CREATE INDEX "ScreeningInvitation_candidateId_createdAt_idx" ON "ScreeningInvitation"("candidateId", "createdAt");

-- CreateIndex
CREATE INDEX "ScreeningInvitation_claimedUserId_status_idx" ON "ScreeningInvitation"("claimedUserId", "status");

-- CreateIndex
CREATE INDEX "ScreeningInvitation_status_expiresAt_idx" ON "ScreeningInvitation"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScreeningInvitation_candidateId_requestKey_key" ON "ScreeningInvitation"("candidateId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "AiScreeningSession_legacyKey_key" ON "AiScreeningSession"("legacyKey");

-- CreateIndex
CREATE INDEX "AiScreeningSession_jobId_profileId_idx" ON "AiScreeningSession"("jobId", "profileId");

-- AddForeignKey
ALTER TABLE "ScreeningInvitation" ADD CONSTRAINT "ScreeningInvitation_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "AiScreeningPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningInvitation" ADD CONSTRAINT "ScreeningInvitation_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "RecruitmentCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningInvitation" ADD CONSTRAINT "ScreeningInvitation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningInvitation" ADD CONSTRAINT "ScreeningInvitation_claimedUserId_fkey" FOREIGN KEY ("claimedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningInvitation" ADD CONSTRAINT "ScreeningInvitation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AiScreeningSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Preserve unique legacy draft identity; invited sessions keep independent histories.
UPDATE "AiScreeningSession" SET "legacyKey"='legacy:'||"jobId"||':'||"profileId";
