CREATE TYPE "EmployeeOnboardingStatus" AS ENUM ('NOT_REQUIRED', 'IN_PROGRESS', 'COMPLETED');
ALTER TABLE "EmployeeProfile"
  ALTER COLUMN "desiredSalaryMin" TYPE DECIMAL(18,2) USING "desiredSalaryMin"::DECIMAL(18,2),
  ADD COLUMN "desiredSalaryCurrency" TEXT NOT NULL DEFAULT 'UZS',
  ADD COLUMN "desiredSalaryPeriod" "SalaryPeriod" NOT NULL DEFAULT 'MONTHLY',
  ADD COLUMN "salaryNegotiable" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "desiredPositions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "residenceCountryId" TEXT,
  ADD COLUMN "noExperience" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "onboardingStatus" "EmployeeOnboardingStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  ADD COLUMN "onboardingStep" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "onboardingCompletedAt" TIMESTAMP(3),
  ADD COLUMN "onboardingDraft" JSONB;
-- Existing employees must never be forced through the new-user flow.
UPDATE "EmployeeProfile" SET "onboardingStatus"='NOT_REQUIRED',
  "desiredPositions"=CASE WHEN COALESCE(TRIM("desiredPosition"), '')='' THEN ARRAY[]::TEXT[] ELSE ARRAY["desiredPosition"] END;
ALTER TABLE "EmployeeProfile" ADD CONSTRAINT "EmployeeProfile_residenceCountryId_fkey" FOREIGN KEY ("residenceCountryId") REFERENCES "Country"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE TABLE "_EmployeePreferredCountries" ("A" TEXT NOT NULL, "B" TEXT NOT NULL);
CREATE UNIQUE INDEX "_EmployeePreferredCountries_AB_unique" ON "_EmployeePreferredCountries"("A","B");
CREATE INDEX "_EmployeePreferredCountries_B_index" ON "_EmployeePreferredCountries"("B");
ALTER TABLE "_EmployeePreferredCountries" ADD CONSTRAINT "_EmployeePreferredCountries_A_fkey" FOREIGN KEY ("A") REFERENCES "Country"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_EmployeePreferredCountries" ADD CONSTRAINT "_EmployeePreferredCountries_B_fkey" FOREIGN KEY ("B") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Resume" ADD COLUMN "parseGeneration" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "WorkExperience" ADD COLUMN "countryId" TEXT;
ALTER TABLE "WorkExperience" ADD CONSTRAINT "WorkExperience_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE SET NULL ON UPDATE CASCADE;
