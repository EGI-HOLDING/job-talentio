-- CreateEnum
CREATE TYPE "JobPackageCode" AS ENUM ('FREE', 'STANDARD', 'PREMIUM');

-- CreateEnum
CREATE TYPE "JobEventKind" AS ENUM ('IMPRESSION', 'DETAIL_VIEW', 'APPLY_CLICK', 'APPLY_START', 'APPLICATION_SUBMITTED');

-- CreateEnum
CREATE TYPE "SupportTicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_HR', 'RESOLVED');

-- AlterTable
ALTER TABLE "EmployeeProfile" ADD COLUMN     "databaseCvEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "databaseResumeId" TEXT;

-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "funnelSessionId" TEXT;

-- AlterTable
ALTER TABLE "JobQuestion" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "ApplicationAnswer" ADD COLUMN     "questionRevision" INTEGER,
ADD COLUMN     "questionSnapshot" JSONB;

-- CreateTable
CREATE TABLE "JobQuestionVersion" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobQuestionVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackagePolicy" (
    "id" TEXT NOT NULL,
    "code" "JobPackageCode" NOT NULL,
    "version" INTEGER NOT NULL,
    "settings" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackagePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobBenefit" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" "JobPackageCode" NOT NULL DEFAULT 'FREE',
    "highestCode" "JobPackageCode" NOT NULL DEFAULT 'FREE',
    "policyVersion" INTEGER NOT NULL DEFAULT 1,
    "policySnapshot" JSONB NOT NULL,
    "startsAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "candidateGranted" INTEGER NOT NULL DEFAULT 0,
    "boostGrantedSeconds" INTEGER NOT NULL DEFAULT 0,
    "featuredGrantedSeconds" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobBenefit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobPackageGrant" (
    "id" TEXT NOT NULL,
    "benefitId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "code" "JobPackageCode" NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "candidateDelta" INTEGER NOT NULL DEFAULT 0,
    "boostDeltaSeconds" INTEGER NOT NULL DEFAULT 0,
    "featuredDeltaSeconds" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobPackageGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateCredit" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "jobId" TEXT,
    "capacity" INTEGER NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateCredit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateAccess" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "creditId" TEXT NOT NULL,
    "openedById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoostEpisode" (
    "id" TEXT NOT NULL,
    "benefitId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "BoostEpisode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyPromotion" (
    "companyId" TEXT NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "grantedSeconds" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyPromotion_pkey" PRIMARY KEY ("companyId")
);

-- CreateTable
CREATE TABLE "OperationKey" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'RUNNING',
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactRevealCounter" (
    "actorId" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ContactRevealCounter_pkey" PRIMARY KEY ("actorId","windowStart")
);

-- CreateTable
CREATE TABLE "JobFunnelSession" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "sessionKey" TEXT NOT NULL,
    "visitorHash" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'direct',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobFunnelSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobEvent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "kind" "JobEventKind" NOT NULL,
    "applicationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobId" TEXT,
    "createdById" TEXT NOT NULL,
    "assignedToId" TEXT,
    "title" TEXT NOT NULL,
    "priority" BOOLEAN NOT NULL DEFAULT false,
    "status" "SupportTicketStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportReply" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorRole" "UserRole" NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportReply_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JobQuestionVersion_questionId_revision_key" ON "JobQuestionVersion"("questionId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "PackagePolicy_code_version_key" ON "PackagePolicy"("code", "version");

-- CreateIndex
CREATE UNIQUE INDEX "JobBenefit_jobId_key" ON "JobBenefit"("jobId");

-- CreateIndex
CREATE INDEX "JobBenefit_expiresAt_idx" ON "JobBenefit"("expiresAt");

-- CreateIndex
CREATE INDEX "JobBenefit_companyId_code_expiresAt_idx" ON "JobBenefit"("companyId", "code", "expiresAt");

-- CreateIndex
CREATE INDEX "JobPackageGrant_benefitId_createdAt_idx" ON "JobPackageGrant"("benefitId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateCredit_sourceKey_key" ON "CandidateCredit"("sourceKey");

-- CreateIndex
CREATE INDEX "CandidateCredit_companyId_expiresAt_idx" ON "CandidateCredit"("companyId", "expiresAt");

-- CreateIndex
CREATE INDEX "CandidateAccess_companyId_profileId_expiresAt_idx" ON "CandidateAccess"("companyId", "profileId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateAccess_companyId_profileId_creditId_key" ON "CandidateAccess"("companyId", "profileId", "creditId");

-- CreateIndex
CREATE INDEX "BoostEpisode_benefitId_endsAt_idx" ON "BoostEpisode"("benefitId", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "OperationKey_scope_key_key" ON "OperationKey"("scope", "key");

-- CreateIndex
CREATE UNIQUE INDEX "JobFunnelSession_sessionKey_key" ON "JobFunnelSession"("sessionKey");

-- CreateIndex
CREATE INDEX "JobFunnelSession_jobId_startedAt_idx" ON "JobFunnelSession"("jobId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobEvent_applicationId_key" ON "JobEvent"("applicationId");

-- CreateIndex
CREATE INDEX "JobEvent_createdAt_idx" ON "JobEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobEvent_sessionId_kind_key" ON "JobEvent"("sessionId", "kind");

-- CreateIndex
CREATE INDEX "SupportTicket_companyId_createdAt_idx" ON "SupportTicket"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportTicket_status_priority_createdAt_idx" ON "SupportTicket"("status", "priority", "createdAt");

-- CreateIndex
CREATE INDEX "SupportReply_ticketId_createdAt_idx" ON "SupportReply"("ticketId", "createdAt");

-- AddForeignKey
ALTER TABLE "EmployeeProfile" ADD CONSTRAINT "EmployeeProfile_databaseResumeId_fkey" FOREIGN KEY ("databaseResumeId") REFERENCES "Resume"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobQuestionVersion" ADD CONSTRAINT "JobQuestionVersion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "JobQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobBenefit" ADD CONSTRAINT "JobBenefit_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "JobPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobBenefit" ADD CONSTRAINT "JobBenefit_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobPackageGrant" ADD CONSTRAINT "JobPackageGrant_benefitId_fkey" FOREIGN KEY ("benefitId") REFERENCES "JobBenefit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateCredit" ADD CONSTRAINT "CandidateCredit_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateAccess" ADD CONSTRAINT "CandidateAccess_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateAccess" ADD CONSTRAINT "CandidateAccess_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateAccess" ADD CONSTRAINT "CandidateAccess_creditId_fkey" FOREIGN KEY ("creditId") REFERENCES "CandidateCredit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoostEpisode" ADD CONSTRAINT "BoostEpisode_benefitId_fkey" FOREIGN KEY ("benefitId") REFERENCES "JobBenefit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyPromotion" ADD CONSTRAINT "CompanyPromotion_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobFunnelSession" ADD CONSTRAINT "JobFunnelSession_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "JobPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobEvent" ADD CONSTRAINT "JobEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "JobFunnelSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportReply" ADD CONSTRAINT "SupportReply_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Versioned initial policies; legacy subscriptions intentionally remain untouched.
INSERT INTO "PackagePolicy" (id,code,version,settings,"createdAt") VALUES ('policy:FREE:1','FREE',1,'{"durationDays":30,"candidateCredits":0,"boostDays":0,"featuredDays":0,"visibility":1,"conversions":false,"reports":false,"prioritySupport":false}'::jsonb,CURRENT_TIMESTAMP);
INSERT INTO "PackagePolicy" (id,code,version,settings,"createdAt") VALUES ('policy:STANDARD:1','STANDARD',1,'{"durationDays":30,"candidateCredits":50,"boostDays":3,"featuredDays":7,"visibility":1.15,"conversions":true,"reports":false,"prioritySupport":false}'::jsonb,CURRENT_TIMESTAMP);
INSERT INTO "PackagePolicy" (id,code,version,settings,"createdAt") VALUES ('policy:PREMIUM:1','PREMIUM',1,'{"durationDays":30,"candidateCredits":150,"boostDays":7,"featuredDays":30,"visibility":1.3,"conversions":true,"reports":true,"prioritySupport":true}'::jsonb,CURRENT_TIMESTAMP);
INSERT INTO "FeatureFlag" (id,key,enabled,"updatedAt") VALUES ('flag:hr_packages','hr_packages',false,CURRENT_TIMESTAMP) ON CONFLICT (key) DO NOTHING;
INSERT INTO "FeatureFlag" (id,key,enabled,"updatedAt") VALUES ('flag:hr_promotions','hr_promotions',false,CURRENT_TIMESTAMP) ON CONFLICT (key) DO NOTHING;
INSERT INTO "FeatureFlag" (id,key,enabled,"updatedAt") VALUES ('flag:hr_analytics','hr_analytics',false,CURRENT_TIMESTAMP) ON CONFLICT (key) DO NOTHING;
INSERT INTO "FeatureFlag" (id,key,enabled,"updatedAt") VALUES ('flag:hr_support','hr_support',false,CURRENT_TIMESTAMP) ON CONFLICT (key) DO NOTHING;
INSERT INTO "JobQuestionVersion" (id,"questionId",revision,snapshot,"createdAt") SELECT 'initial:'||id,id,revision,to_jsonb(q),CURRENT_TIMESTAMP FROM "JobQuestion" q;
UPDATE "ApplicationAnswer" a SET "questionRevision"=q.revision,"questionSnapshot"=to_jsonb(q)||'{"historicalSource":"migration_current_question"}'::jsonb FROM "JobQuestion" q WHERE q.id=a."questionId";

ALTER TABLE "CandidateCredit" ADD CONSTRAINT "CandidateCredit_balance_valid" CHECK (capacity>=0 AND used>=0 AND used<=capacity);
ALTER TABLE "BoostEpisode" ADD CONSTRAINT "BoostEpisode_interval_valid" CHECK ("endsAt">"startsAt");
INSERT INTO "FeatureFlag" (id,key,enabled,payload,"updatedAt") VALUES ('flag:hr_exposure_policy','hr_exposure_policy',false,'{"version":1,"halfLifeDays":7,"cap":1.8,"boostAmplitude":0.4}'::jsonb,CURRENT_TIMESTAMP) ON CONFLICT(key) DO NOTHING;
