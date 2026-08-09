-- CreateTable
CREATE TABLE "IndustryGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "IndustryGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IndustryGroup_slug_key" ON "IndustryGroup"("slug");

-- Placeholder group so existing Industry rows can gain a NOT NULL groupId
INSERT INTO "IndustryGroup" ("id", "name", "slug", "sortOrder")
VALUES ('mig_industry_other', 'Other', 'other', 3);

-- AlterTable
ALTER TABLE "Industry" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Industry" ADD COLUMN "groupId" TEXT;

UPDATE "Industry" SET "groupId" = 'mig_industry_other' WHERE "groupId" IS NULL;

ALTER TABLE "Industry" ALTER COLUMN "groupId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "Industry" ADD CONSTRAINT "Industry_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "IndustryGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "Industry_groupId_idx" ON "Industry"("groupId");
