CREATE TYPE "LinkedInConnectionStatus" AS ENUM ('CONNECTED','EXPIRED','REVOKED','DISCONNECTED');
CREATE TYPE "LinkedInPostStatus" AS ENUM ('PENDING','RENDERING','UPLOADING','PUBLISHING','PUBLISHED','FAILED','UNKNOWN','CANCELLED');

CREATE TABLE "LinkedInConnection" (
  "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL,
  "subject" TEXT, "authorUrn" TEXT, "displayName" TEXT, "avatarUrl" TEXT,
  "grantedScopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "tokenCiphertext" TEXT, "tokenKeyVersion" TEXT, "tokenExpiresAt" TIMESTAMP(3),
  "status" "LinkedInConnectionStatus" NOT NULL DEFAULT 'DISCONNECTED',
  "autoShareEnabled" BOOLEAN NOT NULL DEFAULT false, "generation" INTEGER NOT NULL DEFAULT 0,
  "leaseOwner" TEXT, "leaseUntil" TIMESTAMP(3), "connectedAt" TIMESTAMP(3), "disconnectedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LinkedInConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LinkedInConnection_userId_key" ON "LinkedInConnection"("userId");

CREATE TABLE "LinkedInOAuthState" (
  "stateHash" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "cookieHash" TEXT NOT NULL,
  "sessionVersion" INTEGER NOT NULL, "returnTo" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL, "consumedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LinkedInOAuthState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "LinkedInOAuthState_userId_createdAt_idx" ON "LinkedInOAuthState"("userId","createdAt");
CREATE INDEX "LinkedInOAuthState_expiresAt_idx" ON "LinkedInOAuthState"("expiresAt");

CREATE TABLE "LinkedInPreview" (
  "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "companyId" TEXT NOT NULL, "jobId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL, "connectionGeneration" INTEGER NOT NULL, "locale" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL, "content" JSONB NOT NULL, "caption" TEXT NOT NULL, "jobUrl" TEXT NOT NULL,
  "posterKey" TEXT NOT NULL, "posterSha256" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LinkedInPreview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LinkedInPreview_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LinkedInPreview_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "JobPost"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LinkedInPreview_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "LinkedInConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "LinkedInPreview_userId_jobId_idx" ON "LinkedInPreview"("userId","jobId");
CREATE INDEX "LinkedInPreview_expiresAt_idx" ON "LinkedInPreview"("expiresAt");

CREATE TABLE "LinkedInSocialPost" (
  "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "companyId" TEXT NOT NULL, "jobId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL, "connectionGeneration" INTEGER NOT NULL, "publicationRevision" INTEGER NOT NULL DEFAULT 1,
  "previewId" TEXT, "authorUrnSnapshot" TEXT NOT NULL, "content" JSONB NOT NULL, "captionSnapshot" TEXT NOT NULL,
  "jobUrlSnapshot" TEXT NOT NULL, "posterKey" TEXT NOT NULL, "posterSha256" TEXT NOT NULL, "imageUrn" TEXT, "providerPostUrn" TEXT,
  "status" "LinkedInPostStatus" NOT NULL DEFAULT 'PENDING', "attempts" INTEGER NOT NULL DEFAULT 0,
  "attemptId" TEXT, "leaseUntil" TIMESTAMP(3), "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "retrySafe" BOOLEAN NOT NULL DEFAULT true, "errorCode" TEXT, "errorSummary" TEXT,
  "publishedAt" TIMESTAMP(3), "reconciledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LinkedInSocialPost_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LinkedInSocialPost_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LinkedInSocialPost_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "JobPost"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LinkedInSocialPost_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "LinkedInConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LinkedInSocialPost_previewId_fkey" FOREIGN KEY ("previewId") REFERENCES "LinkedInPreview"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LinkedInSocialPost_jobId_userId_publicationRevision_key" ON "LinkedInSocialPost"("jobId","userId","publicationRevision");
CREATE INDEX "LinkedInSocialPost_userId_companyId_createdAt_idx" ON "LinkedInSocialPost"("userId","companyId","createdAt");
CREATE INDEX "LinkedInSocialPost_status_nextAttemptAt_idx" ON "LinkedInSocialPost"("status","nextAttemptAt");
CREATE INDEX "LinkedInSocialPost_status_leaseUntil_idx" ON "LinkedInSocialPost"("status","leaseUntil");

CREATE TABLE "LinkedInOutbox" (
  "id" TEXT NOT NULL PRIMARY KEY, "socialPostId" TEXT NOT NULL, "nextDispatchAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3), "attempts" INTEGER NOT NULL DEFAULT 0, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LinkedInOutbox_socialPostId_fkey" FOREIGN KEY ("socialPostId") REFERENCES "LinkedInSocialPost"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LinkedInOutbox_socialPostId_key" ON "LinkedInOutbox"("socialPostId");
CREATE INDEX "LinkedInOutbox_processedAt_nextDispatchAt_idx" ON "LinkedInOutbox"("processedAt","nextDispatchAt");
