-- Notifications become language-independent: the key plus its params are
-- rendered in the reader's language on read. Existing rows keep using the
-- stored title/body, which stays the fallback when no key is present.
ALTER TABLE "Notification" ADD COLUMN "messageKey" TEXT;
ALTER TABLE "Notification" ADD COLUMN "messageParams" JSONB;
