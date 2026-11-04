-- CreateTable
CREATE TABLE "AiCompanyDocument" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "text" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiCompanyDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiScreeningPackage" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "jobSnapshot" JSONB NOT NULL,
    "companySnapshot" JSONB NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "promptSnapshot" JSONB NOT NULL,
    "payload" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiScreeningPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiScreeningSession" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "packageId" TEXT,
    "resumeId" TEXT,
    "resumeVersionId" TEXT,
    "cvSnapshot" JSONB,
    "currentPlanId" TEXT,
    "coverLetter" TEXT,
    "coverFileKey" TEXT,
    "coverFilename" TEXT,
    "coverContentType" TEXT,
    "source" TEXT,
    "funnelSession" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "applicationId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiScreeningSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiScreeningQuestion" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "criterionId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "rootQuestionId" TEXT,
    "parentQuestionId" TEXT,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "probeClosed" BOOLEAN NOT NULL DEFAULT false,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "draft" TEXT NOT NULL DEFAULT '',
    "answer" TEXT,
    "shownAt" TIMESTAMP(3),
    "deadlineAt" TIMESTAMP(3),
    "answeredAt" TIMESTAMP(3),
    "timedOut" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AiScreeningQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiCvSource" (
    "versionId" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "text" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiCvSource_pkey" PRIMARY KEY ("versionId")
);

-- CreateTable
CREATE TABLE "AiCandidatePlan" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "resumeVersionId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "promptVersion" TEXT NOT NULL,
    "payload" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiCandidatePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiScreeningEvaluation" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "inputHash" TEXT,
    "promptVersion" TEXT NOT NULL,
    "model" TEXT,
    "cvScore" DOUBLE PRECISION,
    "cvBreakdown" JSONB,
    "screeningScore" DOUBLE PRECISION,
    "finalScore" DOUBLE PRECISION,
    "result" JSONB,
    "pdfKey" TEXT,
    "pdfVersion" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiScreeningEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiScreeningWork" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "leaseOwner" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiScreeningWork_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiScreeningCall" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "workId" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "responseId" TEXT,
    "result" JSONB,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cachedTokens" INTEGER NOT NULL DEFAULT 0,
    "reasoningTokens" INTEGER NOT NULL DEFAULT 0,
    "usage" JSONB,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pricing" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiScreeningCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiCompanyDocument_companyId_createdAt_idx" ON "AiCompanyDocument"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "AiScreeningPackage_status_updatedAt_idx" ON "AiScreeningPackage"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiScreeningPackage_jobId_fingerprint_key" ON "AiScreeningPackage"("jobId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "AiScreeningPackage_jobId_version_key" ON "AiScreeningPackage"("jobId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "AiScreeningSession_currentPlanId_key" ON "AiScreeningSession"("currentPlanId");

-- CreateIndex
CREATE UNIQUE INDEX "AiScreeningSession_applicationId_key" ON "AiScreeningSession"("applicationId");

-- CreateIndex
CREATE INDEX "AiScreeningSession_status_updatedAt_idx" ON "AiScreeningSession"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiScreeningSession_jobId_profileId_key" ON "AiScreeningSession"("jobId", "profileId");

-- CreateIndex
CREATE UNIQUE INDEX "AiScreeningQuestion_sessionId_position_key" ON "AiScreeningQuestion"("sessionId", "position");

-- CreateIndex
CREATE INDEX "AiCandidatePlan_status_updatedAt_idx" ON "AiCandidatePlan"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiCandidatePlan_sessionId_fingerprint_key" ON "AiCandidatePlan"("sessionId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "AiScreeningEvaluation_sessionId_key" ON "AiScreeningEvaluation"("sessionId");

-- CreateIndex
CREATE INDEX "AiScreeningEvaluation_status_updatedAt_idx" ON "AiScreeningEvaluation"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiScreeningWork_key_key" ON "AiScreeningWork"("key");

-- CreateIndex
CREATE INDEX "AiScreeningWork_status_availableAt_idx" ON "AiScreeningWork"("status", "availableAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiScreeningCall_key_key" ON "AiScreeningCall"("key");

-- CreateIndex
CREATE INDEX "AiScreeningCall_subjectId_createdAt_idx" ON "AiScreeningCall"("subjectId", "createdAt");

-- CreateIndex
CREATE INDEX "AiScreeningCall_status_updatedAt_idx" ON "AiScreeningCall"("status", "updatedAt");

-- AddForeignKey
ALTER TABLE "AiCompanyDocument" ADD CONSTRAINT "AiCompanyDocument_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiScreeningPackage" ADD CONSTRAINT "AiScreeningPackage_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "JobPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiScreeningSession" ADD CONSTRAINT "AiScreeningSession_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "JobPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiScreeningSession" ADD CONSTRAINT "AiScreeningSession_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiScreeningSession" ADD CONSTRAINT "AiScreeningSession_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "AiScreeningPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiScreeningSession" ADD CONSTRAINT "AiScreeningSession_resumeVersionId_fkey" FOREIGN KEY ("resumeVersionId") REFERENCES "ResumeVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiScreeningSession" ADD CONSTRAINT "AiScreeningSession_currentPlanId_fkey" FOREIGN KEY ("currentPlanId") REFERENCES "AiCandidatePlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiScreeningSession" ADD CONSTRAINT "AiScreeningSession_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiScreeningQuestion" ADD CONSTRAINT "AiScreeningQuestion_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AiScreeningSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiCvSource" ADD CONSTRAINT "AiCvSource_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ResumeVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiCandidatePlan" ADD CONSTRAINT "AiCandidatePlan_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AiScreeningSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiCandidatePlan" ADD CONSTRAINT "AiCandidatePlan_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "AiScreeningPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiCandidatePlan" ADD CONSTRAINT "AiCandidatePlan_resumeVersionId_fkey" FOREIGN KEY ("resumeVersionId") REFERENCES "ResumeVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiScreeningEvaluation" ADD CONSTRAINT "AiScreeningEvaluation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AiScreeningSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
