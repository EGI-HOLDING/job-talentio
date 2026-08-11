-- CreateEnum
CREATE TYPE "NewsCategory" AS ENUM ('CAREER', 'INSIGHT', 'EVENT', 'EDUCATION');

-- CreateTable
CREATE TABLE "NewsArticle" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "category" "NewsCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "coverUrl" TEXT,
    "coverCredit" TEXT,
    "sourceName" TEXT,
    "sourceUrl" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsArticle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NewsArticle_slug_key" ON "NewsArticle"("slug");
CREATE INDEX "NewsArticle_isPublished_publishedAt_idx" ON "NewsArticle"("isPublished", "publishedAt");
CREATE INDEX "NewsArticle_category_publishedAt_idx" ON "NewsArticle"("category", "publishedAt");
