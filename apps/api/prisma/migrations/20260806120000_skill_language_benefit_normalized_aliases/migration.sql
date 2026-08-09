-- AlterTable
ALTER TABLE "Benefit" ADD COLUMN "normalizedKey" TEXT;

-- AlterTable
ALTER TABLE "Language" ADD COLUMN "normalizedKey" TEXT;

-- AlterTable
ALTER TABLE "Skill" ADD COLUMN "normalizedKey" TEXT;

-- CreateTable
CREATE TABLE "SkillAlias" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "aliasKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkillAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LanguageAlias" (
    "id" TEXT NOT NULL,
    "languageId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "aliasKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LanguageAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenefitAlias" (
    "id" TEXT NOT NULL,
    "benefitId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "aliasKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BenefitAlias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SkillAlias_aliasKey_key" ON "SkillAlias"("aliasKey");

-- CreateIndex
CREATE INDEX "SkillAlias_skillId_idx" ON "SkillAlias"("skillId");

-- CreateIndex
CREATE UNIQUE INDEX "LanguageAlias_aliasKey_key" ON "LanguageAlias"("aliasKey");

-- CreateIndex
CREATE INDEX "LanguageAlias_languageId_idx" ON "LanguageAlias"("languageId");

-- CreateIndex
CREATE UNIQUE INDEX "BenefitAlias_aliasKey_key" ON "BenefitAlias"("aliasKey");

-- CreateIndex
CREATE INDEX "BenefitAlias_benefitId_idx" ON "BenefitAlias"("benefitId");

-- CreateIndex
CREATE UNIQUE INDEX "Benefit_normalizedKey_key" ON "Benefit"("normalizedKey");

-- CreateIndex
CREATE UNIQUE INDEX "Language_normalizedKey_key" ON "Language"("normalizedKey");

-- CreateIndex
CREATE UNIQUE INDEX "Skill_normalizedKey_key" ON "Skill"("normalizedKey");

-- AddForeignKey
ALTER TABLE "SkillAlias" ADD CONSTRAINT "SkillAlias_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LanguageAlias" ADD CONSTRAINT "LanguageAlias_languageId_fkey" FOREIGN KEY ("languageId") REFERENCES "Language"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenefitAlias" ADD CONSTRAINT "BenefitAlias_benefitId_fkey" FOREIGN KEY ("benefitId") REFERENCES "Benefit"("id") ON DELETE CASCADE ON UPDATE CASCADE;