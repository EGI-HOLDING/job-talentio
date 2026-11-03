ALTER TABLE "Application" ADD COLUMN "hrSubmissionSnapshot" JSONB;
CREATE TABLE "ResumeRecruiterEvidence" (
  "id" TEXT NOT NULL, "versionId" TEXT NOT NULL, "parserVersion" TEXT NOT NULL,
  "catalogRevision" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING',
  "generation" INTEGER NOT NULL DEFAULT 0, "revision" INTEGER NOT NULL DEFAULT 0,
  "facts" JSONB, "checksum" TEXT, "error" TEXT, "startedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ResumeRecruiterEvidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ResumeRecruiterEvidence_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ResumeVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ResumeRecruiterEvidence_versionId_parserVersion_catalogRevision_key" ON "ResumeRecruiterEvidence"("versionId", "parserVersion", "catalogRevision");
CREATE INDEX "ResumeRecruiterEvidence_status_updatedAt_idx" ON "ResumeRecruiterEvidence"("status", "updatedAt");
CREATE TABLE "ApplicationRecruiterEvaluation" (
  "id" TEXT NOT NULL, "applicationId" TEXT NOT NULL, "inputHash" TEXT NOT NULL,
  "rankingVersion" TEXT NOT NULL, "result" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApplicationRecruiterEvaluation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ApplicationRecruiterEvaluation_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ApplicationRecruiterEvaluation_applicationId_inputHash_key" ON "ApplicationRecruiterEvaluation"("applicationId", "inputHash");

CREATE FUNCTION hr_submission_snapshot_immutable() RETURNS TRIGGER AS $$
BEGIN
  IF OLD."hrSubmissionSnapshot" IS NOT NULL AND NEW."hrSubmissionSnapshot" IS DISTINCT FROM OLD."hrSubmissionSnapshot"
     AND NOT (NEW."hrSubmissionSnapshot" IS NULL AND COALESCE(NEW."resumeSnapshot"->>'anonymized','false') = 'true') THEN
    RAISE EXCEPTION 'Submitted HR evidence snapshot is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER hr_submission_snapshot_immutable BEFORE UPDATE OF "hrSubmissionSnapshot" ON "Application"
FOR EACH ROW EXECUTE FUNCTION hr_submission_snapshot_immutable();
