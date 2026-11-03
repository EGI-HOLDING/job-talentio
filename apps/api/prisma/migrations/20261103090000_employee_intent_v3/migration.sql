-- AlterTable
ALTER TABLE "Skill" ADD COLUMN     "matchingKind" TEXT NOT NULL DEFAULT 'UNREVIEWED';

-- AlterTable
ALTER TABLE "JobTitle" ADD COLUMN     "canonicalRoleId" TEXT,
ADD COLUMN     "familyId" TEXT,
ADD COLUMN     "matchingApproved" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "JobTitleAlias" ADD COLUMN     "matchingApproved" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "EmployeeProfile" ADD COLUMN     "matchingPreferencesReviewed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "preferredWorkModes" "WorkMode"[] DEFAULT ARRAY[]::"WorkMode"[];

-- CreateTable
CREATE TABLE "JobFamily" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameId" TEXT,
    "nameUz" TEXT,
    "nameRu" TEXT,
    "source" TEXT NOT NULL,
    "sourceVersion" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "JobFamily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeDesiredRole" (
    "profileId" TEXT NOT NULL,
    "jobTitleId" TEXT NOT NULL,

    CONSTRAINT "EmployeeDesiredRole_pkey" PRIMARY KEY ("profileId","jobTitleId")
);

-- CreateTable
CREATE TABLE "ResumeEmployeeEvidence" (
    "versionId" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "generation" INTEGER NOT NULL,
    "facts" JSONB,
    "overrides" JSONB,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResumeEmployeeEvidence_pkey" PRIMARY KEY ("versionId")
);

-- CreateIndex
CREATE UNIQUE INDEX "JobFamily_code_key" ON "JobFamily"("code");

-- CreateIndex
CREATE INDEX "EmployeeDesiredRole_jobTitleId_idx" ON "EmployeeDesiredRole"("jobTitleId");

-- CreateIndex
CREATE INDEX "ResumeEmployeeEvidence_status_updatedAt_idx" ON "ResumeEmployeeEvidence"("status", "updatedAt");

-- AddForeignKey
ALTER TABLE "JobTitle" ADD CONSTRAINT "JobTitle_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "JobFamily"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobTitle" ADD CONSTRAINT "JobTitle_canonicalRoleId_fkey" FOREIGN KEY ("canonicalRoleId") REFERENCES "JobTitle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDesiredRole" ADD CONSTRAINT "EmployeeDesiredRole_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDesiredRole" ADD CONSTRAINT "EmployeeDesiredRole_jobTitleId_fkey" FOREIGN KEY ("jobTitleId") REFERENCES "JobTitle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResumeEmployeeEvidence" ADD CONSTRAINT "ResumeEmployeeEvidence_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ResumeVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Label edits invalidate matching approval even through older catalog writers.
CREATE INDEX "JobTitle_familyId_matchingApproved_idx" ON "JobTitle"("familyId", "matchingApproved");
CREATE INDEX "JobTitle_canonicalRoleId_idx" ON "JobTitle"("canonicalRoleId");
CREATE FUNCTION employee_intent_invalidate_role_labels() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.name, NEW."nameId", NEW."nameUz", NEW."nameRu") IS DISTINCT FROM ROW(OLD.name, OLD."nameId", OLD."nameUz", OLD."nameRu") THEN
  NEW."matchingApproved" := false;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER employee_intent_role_label_review BEFORE UPDATE OF name,"nameId","nameUz","nameRu" ON "JobTitle" FOR EACH ROW EXECUTE FUNCTION employee_intent_invalidate_role_labels();
CREATE FUNCTION employee_intent_invalidate_alias_labels() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.alias, NEW."aliasKey") IS DISTINCT FROM ROW(OLD.alias, OLD."aliasKey") THEN
  NEW."matchingApproved" := false;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER employee_intent_alias_label_review BEFORE UPDATE OF alias,"aliasKey" ON "JobTitleAlias" FOR EACH ROW EXECUTE FUNCTION employee_intent_invalidate_alias_labels();
