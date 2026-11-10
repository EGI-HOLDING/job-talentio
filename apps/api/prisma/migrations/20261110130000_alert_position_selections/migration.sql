BEGIN;

ALTER TABLE "JobAlert"
ADD COLUMN "positionSelections" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "positionReviewRequired" BOOLEAN NOT NULL DEFAULT false,
ADD CONSTRAINT "JobAlert_positionSelections_array" CHECK (jsonb_typeof("positionSelections") = 'array');

UPDATE "JobAlert" SET "positionReviewRequired" = true WHERE btrim(COALESCE("query", '')) <> '';

COMMIT;
