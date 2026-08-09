-- Platform email verification is opt-in from profile/settings.
-- Reset every account (including demo/seed users) to unverified.
UPDATE "User" SET "emailVerified" = false WHERE "emailVerified" = true;
