-- Dummy / existing recruiter accounts keep the same email; mark verified.
UPDATE "User" SET "emailVerified" = true WHERE role = 'RECRUITER' AND "emailVerified" = false;
