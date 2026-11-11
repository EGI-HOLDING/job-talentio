BEGIN;
ALTER TABLE "AiScreeningSession" ADD COLUMN "taraInterview" JSONB;
ALTER TABLE "VoiceInterview" ADD COLUMN "taraInterview" JSONB;
COMMIT;
