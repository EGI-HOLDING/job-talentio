-- Canonical job titles (lookup) + aliases; JobPost.jobTitleId

CREATE TABLE "JobTitle" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "normalizedKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobTitle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JobTitle_slug_key" ON "JobTitle"("slug");
CREATE UNIQUE INDEX "JobTitle_normalizedKey_key" ON "JobTitle"("normalizedKey");

CREATE TABLE "JobTitleAlias" (
    "id" TEXT NOT NULL,
    "jobTitleId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "aliasKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobTitleAlias_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JobTitleAlias_aliasKey_key" ON "JobTitleAlias"("aliasKey");
CREATE INDEX "JobTitleAlias_jobTitleId_idx" ON "JobTitleAlias"("jobTitleId");

ALTER TABLE "JobTitleAlias" ADD CONSTRAINT "JobTitleAlias_jobTitleId_fkey" FOREIGN KEY ("jobTitleId") REFERENCES "JobTitle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JobPost" ADD COLUMN "jobTitleId" TEXT;

CREATE INDEX "JobPost_jobTitleId_idx" ON "JobPost"("jobTitleId");

ALTER TABLE "JobPost" ADD CONSTRAINT "JobPost_jobTitleId_fkey" FOREIGN KEY ("jobTitleId") REFERENCES "JobTitle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
