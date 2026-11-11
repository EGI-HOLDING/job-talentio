BEGIN;

ALTER TABLE "JobPost"
  ADD COLUMN "positionGroupId" TEXT REFERENCES "PositionGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD COLUMN "positionGroupReleaseId" TEXT REFERENCES "PositionGroupRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD COLUMN "positionGroupScopeRevision" TEXT,
  ADD COLUMN "positionGroupApprovedAt" TIMESTAMP(3),
  ADD CONSTRAINT "JobPost_group_position_identity" CHECK (
    ("positionEntryMode" = 'GROUP' AND "positionGroupId" IS NOT NULL AND "jobTitleId" IS NULL)
    OR ("positionEntryMode" <> 'GROUP' AND "positionGroupId" IS NULL)
  );

CREATE INDEX "JobPost_positionGroupId_status_idx" ON "JobPost"("positionGroupId", "status");

CREATE TABLE "JobPositionGroupMember" (
  "jobId" TEXT NOT NULL REFERENCES "JobPost"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "jobTitleId" TEXT NOT NULL REFERENCES "JobTitle"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  PRIMARY KEY ("jobId", "jobTitleId")
);
CREATE INDEX "JobPositionGroupMember_jobTitleId_jobId_idx" ON "JobPositionGroupMember"("jobTitleId", "jobId");

COMMIT;
