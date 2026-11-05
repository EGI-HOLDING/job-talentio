CREATE TABLE "AiScreeningEvaluationRevision" (
  "id" TEXT NOT NULL,
  "evaluationId" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL,
  "promptVersion" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiScreeningEvaluationRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AiScreeningEvaluationRevision_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "AiScreeningEvaluation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AiScreeningEvaluationRevision_evaluationId_inputHash_key" ON "AiScreeningEvaluationRevision"("evaluationId", "inputHash");
