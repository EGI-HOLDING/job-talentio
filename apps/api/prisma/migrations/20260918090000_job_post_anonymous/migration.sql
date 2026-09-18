-- Confidential postings: the employer is hidden from candidates until they reach the interview stage.
ALTER TABLE "JobPost" ADD COLUMN "isAnonymous" BOOLEAN NOT NULL DEFAULT false;
