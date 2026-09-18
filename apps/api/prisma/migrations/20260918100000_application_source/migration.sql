-- Where the candidate came from (utm_source[:utm_medium] such as telegram:channel, pwa, share:telegram).
-- Null means a direct visit to the site.
ALTER TABLE "Application" ADD COLUMN "source" VARCHAR(40);
CREATE INDEX "Application_jobPostId_source_idx" ON "Application"("jobPostId", "source");
