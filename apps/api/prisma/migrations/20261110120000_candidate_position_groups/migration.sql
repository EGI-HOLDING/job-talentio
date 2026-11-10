-- AlterTable
ALTER TABLE "EmployeeProfile" ADD COLUMN     "preferencesRevision" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PositionGroup" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "definition" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "source" JSONB NOT NULL,
    "sourceRoleId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PositionGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PositionGroupRelease" (
    "id" TEXT NOT NULL,
    "catalogRevision" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "algorithmVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'STAGED',
    "report" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PositionGroupRelease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PositionGroupMembership" (
    "releaseId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "jobTitleId" TEXT NOT NULL,
    "basis" JSONB NOT NULL,

    CONSTRAINT "PositionGroupMembership_pkey" PRIMARY KEY ("releaseId","groupId","jobTitleId")
);

-- CreateTable
CREATE TABLE "PositionGroupRoleLabel" (
    "releaseId" TEXT NOT NULL,
    "jobTitleId" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "source" JSONB NOT NULL,

    CONSTRAINT "PositionGroupRoleLabel_pkey" PRIMARY KEY ("releaseId","jobTitleId")
);

-- CreateTable
CREATE TABLE "PositionGroupState" (
    "id" TEXT NOT NULL,
    "activeReleaseId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PositionGroupState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PositionGroupCorrection" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "jobTitleId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "reason" TEXT NOT NULL,
    "source" JSONB NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PositionGroupCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeDesiredGroup" (
    "profileId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,

    CONSTRAINT "EmployeeDesiredGroup_pkey" PRIMARY KEY ("profileId","groupId")
);

-- CreateIndex
CREATE UNIQUE INDEX "PositionGroup_code_key" ON "PositionGroup"("code");

-- CreateIndex
CREATE INDEX "PositionGroupMembership_releaseId_jobTitleId_idx" ON "PositionGroupMembership"("releaseId", "jobTitleId");

-- CreateIndex
CREATE INDEX "PositionGroupCorrection_groupId_jobTitleId_createdAt_idx" ON "PositionGroupCorrection"("groupId", "jobTitleId", "createdAt");

-- CreateIndex
CREATE INDEX "EmployeeDesiredGroup_groupId_idx" ON "EmployeeDesiredGroup"("groupId");

-- AddForeignKey
ALTER TABLE "PositionGroup" ADD CONSTRAINT "PositionGroup_sourceRoleId_fkey" FOREIGN KEY ("sourceRoleId") REFERENCES "JobTitle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionGroupMembership" ADD CONSTRAINT "PositionGroupMembership_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "PositionGroupRelease"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionGroupMembership" ADD CONSTRAINT "PositionGroupMembership_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "PositionGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionGroupMembership" ADD CONSTRAINT "PositionGroupMembership_jobTitleId_fkey" FOREIGN KEY ("jobTitleId") REFERENCES "JobTitle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionGroupRoleLabel" ADD CONSTRAINT "PositionGroupRoleLabel_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "PositionGroupRelease"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionGroupRoleLabel" ADD CONSTRAINT "PositionGroupRoleLabel_jobTitleId_fkey" FOREIGN KEY ("jobTitleId") REFERENCES "JobTitle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionGroupState" ADD CONSTRAINT "PositionGroupState_activeReleaseId_fkey" FOREIGN KEY ("activeReleaseId") REFERENCES "PositionGroupRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDesiredGroup" ADD CONSTRAINT "EmployeeDesiredGroup_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDesiredGroup" ADD CONSTRAINT "EmployeeDesiredGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "PositionGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
