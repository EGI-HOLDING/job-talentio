-- Keep legacy completed profiles readable until the employee adds a number,
-- while enforcing the requirement for every new or modified profile row.
ALTER TABLE "EmployeeProfile"
ADD CONSTRAINT "EmployeeProfile_phone_required_after_onboarding_check"
CHECK (
  "onboardingStatus" = 'IN_PROGRESS'::"EmployeeOnboardingStatus"
  OR NULLIF(BTRIM("phone"), '') IS NOT NULL
) NOT VALID;
