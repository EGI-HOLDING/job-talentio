-- Rows already admitted to the old NEW Kanban lane are now part of review.
-- Untouched applications stay NEW and outside the Kanban board.
WITH moved AS (
  UPDATE "Application"
  SET "status" = 'IN_REVIEW', "updatedAt" = CURRENT_TIMESTAMP
  WHERE "status" = 'NEW' AND "kanbanEnteredAt" IS NOT NULL
  RETURNING "id", "kanbanEnteredAt"
)
INSERT INTO "PipelineEvent" (
  "id", "applicationId", "fromStatus", "toStatus", "note", "actorUserId", "createdAt"
)
SELECT
  'kanban-admission-review-' || moved."id",
  moved."id",
  'NEW',
  'IN_REVIEW',
  'Legacy Kanban entry normalized to In Review',
  NULL,
  moved."kanbanEnteredAt"
FROM moved;
