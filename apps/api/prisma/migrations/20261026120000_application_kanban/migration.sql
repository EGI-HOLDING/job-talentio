ALTER TABLE "Application" ADD COLUMN "kanbanEnteredAt" TIMESTAMP(3);

-- Preserve processing already performed by HR, without enrolling untouched
-- new applications or applications only withdrawn by their employee.
UPDATE "Application" a SET "kanbanEnteredAt" = COALESCE(
  (SELECT MIN(e."createdAt") FROM "PipelineEvent" e
   JOIN "User" u ON u.id = e."actorUserId"
   WHERE e."applicationId" = a.id AND e."fromStatus" IS NOT NULL
     AND u.role IN ('RECRUITER', 'SUPER_ADMIN')),
  a."updatedAt"
)
WHERE a.status IN ('IN_REVIEW', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED')
   OR EXISTS (SELECT 1 FROM "PipelineEvent" e JOIN "User" u ON u.id = e."actorUserId"
      WHERE e."applicationId" = a.id AND e."fromStatus" IS NOT NULL
        AND u.role IN ('RECRUITER', 'SUPER_ADMIN'));

CREATE INDEX "Application_jobPostId_kanbanEnteredAt_status_idx"
ON "Application"("jobPostId", "kanbanEnteredAt", "status");
