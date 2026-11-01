-- AlterTable
ALTER TABLE "Resume" ADD COLUMN     "currentVersionId" TEXT;

-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "resumeVersionId" TEXT;

-- CreateTable
CREATE TABLE "ResumeVersion" (
    "id" TEXT NOT NULL,
    "resumeId" TEXT,
    "fileKey" TEXT NOT NULL,
    "checksum" TEXT,
    "parseStatus" "ResumeParseStatus" NOT NULL DEFAULT 'NONE',
    "parseGeneration" INTEGER NOT NULL DEFAULT 0,
    "parseStartedAt" TIMESTAMP(3),
    "parseError" TEXT,
    "parsedAt" TIMESTAMP(3),
    "parserVersion" TEXT NOT NULL DEFAULT 'cv-evidence-v1',
    "parsedData" JSONB,
    "matchingData" JSONB,
    "skillIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "roleKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "degreeLevels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "searchText" TEXT NOT NULL DEFAULT '',
    "experienceYears" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResumeVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResumeVersion_skillIds_idx" ON "ResumeVersion" USING GIN ("skillIds");

-- CreateIndex
CREATE INDEX "ResumeVersion_roleKeys_idx" ON "ResumeVersion" USING GIN ("roleKeys");

-- CreateIndex
CREATE INDEX "ResumeVersion_degreeLevels_idx" ON "ResumeVersion" USING GIN ("degreeLevels");

-- CreateIndex
CREATE INDEX "ResumeVersion_parseStatus_idx" ON "ResumeVersion"("parseStatus");

-- CreateIndex
CREATE UNIQUE INDEX "ResumeVersion_resumeId_fileKey_key" ON "ResumeVersion"("resumeId", "fileKey");

-- CreateIndex
CREATE UNIQUE INDEX "Resume_currentVersionId_key" ON "Resume"("currentVersionId");

-- CreateIndex
CREATE INDEX "Application_resumeVersionId_idx" ON "Application"("resumeVersionId");

-- AddForeignKey
ALTER TABLE "Resume" ADD CONSTRAINT "Resume_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "ResumeVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResumeVersion" ADD CONSTRAINT "ResumeVersion_resumeId_fkey" FOREIGN KEY ("resumeId") REFERENCES "Resume"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_resumeVersionId_fkey" FOREIGN KEY ("resumeVersionId") REFERENCES "ResumeVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Register file identities without trusting old profile-derived facts. The local
-- recovery worker extracts these files in bounded batches after deployment.
INSERT INTO "ResumeVersion" (id,"resumeId","fileKey","parseStatus","parseGeneration","updatedAt")
SELECT 'cvv_' || md5(id || ':' || "fileKey"),id,"fileKey",'PENDING',"parseGeneration",CURRENT_TIMESTAMP
FROM "Resume" WHERE "fileKey" IS NOT NULL
ON CONFLICT ("resumeId","fileKey") DO NOTHING;

UPDATE "Resume" r SET "currentVersionId"=v.id
FROM "ResumeVersion" v WHERE v."resumeId"=r.id AND v."fileKey"=r."fileKey";

INSERT INTO "ResumeVersion" (id,"resumeId","fileKey","parseStatus","updatedAt")
SELECT DISTINCT ON (a."resumeId",a."resumeSnapshot" #>> '{resume,fileKey}')
  'cvv_' || md5(COALESCE(a."resumeId",'orphan') || ':' || (a."resumeSnapshot" #>> '{resume,fileKey}')),
  a."resumeId",a."resumeSnapshot" #>> '{resume,fileKey}','PENDING',CURRENT_TIMESTAMP
FROM "Application" a
WHERE NULLIF(a."resumeSnapshot" #>> '{resume,fileKey}','') IS NOT NULL
ON CONFLICT DO NOTHING;

UPDATE "Application" a SET "resumeVersionId"=v.id
FROM "ResumeVersion" v
WHERE v."fileKey"=a."resumeSnapshot" #>> '{resume,fileKey}'
AND (v."resumeId"=a."resumeId" OR (a."resumeId" IS NULL AND v.id='cvv_' || md5('orphan' || ':' || (a."resumeSnapshot" #>> '{resume,fileKey}'))));
