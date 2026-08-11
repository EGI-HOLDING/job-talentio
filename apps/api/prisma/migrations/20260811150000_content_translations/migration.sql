-- Per-language versions of author-written content. The original language stays
-- on the parent row (JobPost.locale / NewsArticle.locale); rows here are extra
-- versions, written by a human or produced by machine translation.
CREATE TABLE "JobPostTranslation" (
    "id" TEXT NOT NULL,
    "jobPostId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "isMachine" BOOLEAN NOT NULL DEFAULT false,
    "sourceHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobPostTranslation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JobPostTranslation_jobPostId_locale_key" ON "JobPostTranslation"("jobPostId", "locale");
CREATE INDEX "JobPostTranslation_jobPostId_idx" ON "JobPostTranslation"("jobPostId");

ALTER TABLE "JobPostTranslation" ADD CONSTRAINT "JobPostTranslation_jobPostId_fkey"
    FOREIGN KEY ("jobPostId") REFERENCES "JobPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "NewsArticleTranslation" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isMachine" BOOLEAN NOT NULL DEFAULT false,
    "sourceHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsArticleTranslation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NewsArticleTranslation_articleId_locale_key" ON "NewsArticleTranslation"("articleId", "locale");
CREATE INDEX "NewsArticleTranslation_articleId_idx" ON "NewsArticleTranslation"("articleId");

ALTER TABLE "NewsArticleTranslation" ADD CONSTRAINT "NewsArticleTranslation_articleId_fkey"
    FOREIGN KEY ("articleId") REFERENCES "NewsArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CompanyTranslation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "isMachine" BOOLEAN NOT NULL DEFAULT false,
    "sourceHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyTranslation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanyTranslation_companyId_locale_key" ON "CompanyTranslation"("companyId", "locale");
CREATE INDEX "CompanyTranslation_companyId_idx" ON "CompanyTranslation"("companyId");

ALTER TABLE "CompanyTranslation" ADD CONSTRAINT "CompanyTranslation_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
