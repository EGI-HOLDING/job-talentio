-- Owner close-company: keep the row for job/application history, hide from public listings.
ALTER TABLE "Company" ADD COLUMN "anonymizedAt" TIMESTAMP(3);
