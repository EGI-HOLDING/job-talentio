CREATE TABLE "JobOccupationTaskEvidence" (
    "jobId" TEXT NOT NULL REFERENCES "JobPost"("id") ON DELETE CASCADE,
    "version" TEXT NOT NULL,
    "jobUpdatedAt" TIMESTAMP(3) NOT NULL,
    "coreKeys" TEXT[] NOT NULL,
    "evidence" JSONB NOT NULL,
    PRIMARY KEY ("jobId", "version")
);
CREATE INDEX "JobOccupationTaskEvidence_coreKeys_idx" ON "JobOccupationTaskEvidence" USING GIN ("coreKeys");
