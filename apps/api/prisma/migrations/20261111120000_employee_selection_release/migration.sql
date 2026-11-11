ALTER TABLE "JobOccupationTaskEvidence"
  ADD COLUMN "state" TEXT NOT NULL DEFAULT 'UNRECOGNIZED',
  ADD COLUMN "recognizedClauses" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "unrecognizedClauses" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "sourceDigest" TEXT,
  ADD COLUMN "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "EmployeeSelectionRelease" (
  "id" TEXT PRIMARY KEY,
  "graphReleaseId" TEXT NOT NULL UNIQUE REFERENCES "OccupationRelationRelease"("id") ON DELETE CASCADE,
  "dictionaryVersion" TEXT NOT NULL,
  "taskEvidenceVersion" TEXT NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "sourceDigest" TEXT NOT NULL,
  "validation" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
