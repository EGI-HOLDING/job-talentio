-- Telegram (and future passwordless) accounts may exist before the user adds an email.
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;
