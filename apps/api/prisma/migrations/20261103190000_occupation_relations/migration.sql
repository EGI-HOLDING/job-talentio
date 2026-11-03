CREATE TABLE "OccupationRelationRelease" (
 "id" TEXT PRIMARY KEY, "sourceVersion" TEXT NOT NULL, "algorithmVersion" TEXT NOT NULL,
 "sourceDigest" TEXT NOT NULL, "catalogRevision" TEXT NOT NULL, "report" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "OccupationRelationState" ("id" TEXT PRIMARY KEY DEFAULT 'employee', "activeReleaseId" TEXT, "pinned" BOOLEAN NOT NULL DEFAULT false, "updatedAt" TIMESTAMP(3) NOT NULL);
CREATE TABLE "OccupationProfessionProfile" (
 "releaseId" TEXT NOT NULL REFERENCES "OccupationRelationRelease"("id") ON DELETE CASCADE,
 "jobTitleId" TEXT NOT NULL, "sourceUri" TEXT, "mappingMethod" TEXT NOT NULL, "description" TEXT NOT NULL, "facts" JSONB NOT NULL,
 PRIMARY KEY ("releaseId","jobTitleId")
);
CREATE TABLE "OccupationProfessionRelation" (
 "releaseId" TEXT NOT NULL REFERENCES "OccupationRelationRelease"("id") ON DELETE CASCADE,
 "fromRoleId" TEXT NOT NULL, "toRoleId" TEXT NOT NULL, "score" DOUBLE PRECISION NOT NULL, "basis" JSONB NOT NULL,
 PRIMARY KEY ("releaseId","fromRoleId","toRoleId"), CHECK ("fromRoleId" <> "toRoleId")
);
CREATE INDEX "OccupationProfessionRelation_releaseId_fromRoleId_score_idx" ON "OccupationProfessionRelation"("releaseId","fromRoleId","score");
CREATE TABLE "OccupationRelationOverride" (
 "fromRoleId" TEXT NOT NULL, "toRoleId" TEXT NOT NULL, "enabled" BOOLEAN NOT NULL, "reason" TEXT NOT NULL, "actorId" TEXT NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL,
 PRIMARY KEY ("fromRoleId","toRoleId"), CHECK ("fromRoleId" <> "toRoleId")
);
