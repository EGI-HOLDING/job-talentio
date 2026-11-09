-- CreateTable
CREATE TABLE "CandidateImport" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobId" TEXT,
    "requestKey" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecruitmentCandidate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobId" TEXT,
    "applicationId" TEXT,
    "importId" TEXT,
    "importFileId" TEXT,
    "dedupeKey" TEXT,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadKey" TEXT,
    "fileKey" TEXT,
    "checksum" TEXT,
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "headline" TEXT NOT NULL DEFAULT '',
    "stage" "ApplicationStatus" NOT NULL DEFAULT 'NEW',
    "enteredProcessAt" TIMESTAMP(3),
    "assignedToId" TEXT,
    "scoreStatus" TEXT NOT NULL DEFAULT 'UPLOADING',
    "cvScore" DOUBLE PRECISION,
    "cvResult" JSONB,
    "jobSnapshot" JSONB,
    "scoringVersion" TEXT,
    "error" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecruitmentCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateActivity" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "kind" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CandidateImport_companyId_createdAt_idx" ON "CandidateImport"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateImport_companyId_requestKey_key" ON "CandidateImport"("companyId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "RecruitmentCandidate_applicationId_key" ON "RecruitmentCandidate"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "RecruitmentCandidate_dedupeKey_key" ON "RecruitmentCandidate"("dedupeKey");

-- CreateIndex
CREATE INDEX "RecruitmentCandidate_companyId_jobId_stage_idx" ON "RecruitmentCandidate"("companyId", "jobId", "stage");

-- CreateIndex
CREATE INDEX "RecruitmentCandidate_companyId_scoreStatus_createdAt_idx" ON "RecruitmentCandidate"("companyId", "scoreStatus", "createdAt");

-- CreateIndex
CREATE INDEX "RecruitmentCandidate_jobId_cvScore_createdAt_idx" ON "RecruitmentCandidate"("jobId", "cvScore", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RecruitmentCandidate_importId_importFileId_key" ON "RecruitmentCandidate"("importId", "importFileId");

-- CreateIndex
CREATE INDEX "CandidateActivity_candidateId_createdAt_idx" ON "CandidateActivity"("candidateId", "createdAt");

-- AddForeignKey
ALTER TABLE "CandidateImport" ADD CONSTRAINT "CandidateImport_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateImport" ADD CONSTRAINT "CandidateImport_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "JobPost"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruitmentCandidate" ADD CONSTRAINT "RecruitmentCandidate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruitmentCandidate" ADD CONSTRAINT "RecruitmentCandidate_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "JobPost"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruitmentCandidate" ADD CONSTRAINT "RecruitmentCandidate_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruitmentCandidate" ADD CONSTRAINT "RecruitmentCandidate_importId_fkey" FOREIGN KEY ("importId") REFERENCES "CandidateImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruitmentCandidate" ADD CONSTRAINT "RecruitmentCandidate_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateActivity" ADD CONSTRAINT "CandidateActivity_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "RecruitmentCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

