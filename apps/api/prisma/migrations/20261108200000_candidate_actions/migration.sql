-- CreateTable
CREATE TABLE "CandidateMessageBatch" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdById" TEXT,
    "requestKey" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyTemplate" TEXT NOT NULL,
    "email" BOOLEAN NOT NULL DEFAULT true,
    "talentio" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateMessageBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateMessage" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "interviewId" TEXT,
    "interviewRevision" INTEGER,
    "recipientEmail" TEXT NOT NULL,
    "recipientUserId" TEXT,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'MESSAGE',
    "emailStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "emailAttemptAt" TIMESTAMP(3),
    "emailSentAt" TIMESTAMP(3),
    "messageStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "messageId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateInterview" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "nativeInterviewId" TEXT,
    "requestKey" TEXT NOT NULL,
    "createdById" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "durationMins" INTEGER NOT NULL DEFAULT 30,
    "location" TEXT,
    "meetingUrl" TEXT,
    "note" TEXT,
    "status" "InterviewStatus" NOT NULL DEFAULT 'SCHEDULED',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateInterview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CandidateMessageBatch_companyId_createdAt_idx" ON "CandidateMessageBatch"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateMessageBatch_companyId_requestKey_key" ON "CandidateMessageBatch"("companyId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateMessage_messageId_key" ON "CandidateMessage"("messageId");

-- CreateIndex
CREATE INDEX "CandidateMessage_candidateId_createdAt_idx" ON "CandidateMessage"("candidateId", "createdAt");

-- CreateIndex
CREATE INDEX "CandidateMessage_messageStatus_createdAt_idx" ON "CandidateMessage"("messageStatus", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateMessage_batchId_candidateId_key" ON "CandidateMessage"("batchId", "candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateInterview_nativeInterviewId_key" ON "CandidateInterview"("nativeInterviewId");

-- CreateIndex
CREATE INDEX "CandidateInterview_candidateId_status_scheduledAt_idx" ON "CandidateInterview"("candidateId", "status", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateInterview_candidateId_requestKey_key" ON "CandidateInterview"("candidateId", "requestKey");

-- AddForeignKey
ALTER TABLE "CandidateMessageBatch" ADD CONSTRAINT "CandidateMessageBatch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateMessageBatch" ADD CONSTRAINT "CandidateMessageBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateMessage" ADD CONSTRAINT "CandidateMessage_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "CandidateMessageBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateMessage" ADD CONSTRAINT "CandidateMessage_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "RecruitmentCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateMessage" ADD CONSTRAINT "CandidateMessage_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "CandidateInterview"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateInterview" ADD CONSTRAINT "CandidateInterview_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "RecruitmentCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateInterview" ADD CONSTRAINT "CandidateInterview_nativeInterviewId_fkey" FOREIGN KEY ("nativeInterviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

