-- Phone number as a login identity, verified through a Telegram contact share or an SMS code.
ALTER TABLE "User" ADD COLUMN "phone" VARCHAR(20);
ALTER TABLE "User" ADD COLUMN "phoneVerifiedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

CREATE TYPE "PhoneLoginStatus" AS ENUM ('PENDING', 'CONTACT_REQUESTED', 'COMPLETED');

-- One web sign-in attempt through the bot: the browser polls until the bot has received the contact.
CREATE TABLE "PhoneLoginToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "PhoneLoginStatus" NOT NULL DEFAULT 'PENDING',
    "chatId" TEXT,
    "userId" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'uz',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhoneLoginToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PhoneLoginToken_tokenHash_key" ON "PhoneLoginToken"("tokenHash");
CREATE INDEX "PhoneLoginToken_chatId_idx" ON "PhoneLoginToken"("chatId");
CREATE INDEX "PhoneLoginToken_expiresAt_idx" ON "PhoneLoginToken"("expiresAt");

ALTER TABLE "PhoneLoginToken" ADD CONSTRAINT "PhoneLoginToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SMS one-time codes (only when an SMS provider is configured).
CREATE TABLE "PhoneOtp" (
    "id" TEXT NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhoneOtp_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PhoneOtp_phone_idx" ON "PhoneOtp"("phone");
CREATE INDEX "PhoneOtp_expiresAt_idx" ON "PhoneOtp"("expiresAt");
