-- CreateTable
CREATE TABLE "VoiceInterview" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CREATING',
    "providerId" TEXT,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "promptSnapshot" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "warningAt" TIMESTAMP(3),
    "closingAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "closeReason" TEXT,
    "owner" TEXT NOT NULL,
    "leaseUntil" TIMESTAMP(3) NOT NULL,
    "transcriptComplete" BOOLEAN NOT NULL DEFAULT false,
    "usage" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoiceInterview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoiceFragment" (
    "id" SERIAL NOT NULL,
    "voiceId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "speaker" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoiceFragment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VoiceInterview_sessionId_key" ON "VoiceInterview"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "VoiceInterview_providerId_key" ON "VoiceInterview"("providerId");

-- CreateIndex
CREATE INDEX "VoiceInterview_status_leaseUntil_idx" ON "VoiceInterview"("status", "leaseUntil");

-- CreateIndex
CREATE INDEX "VoiceFragment_voiceId_id_idx" ON "VoiceFragment"("voiceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "VoiceFragment_voiceId_eventId_key" ON "VoiceFragment"("voiceId", "eventId");

-- AddForeignKey
ALTER TABLE "VoiceInterview" ADD CONSTRAINT "VoiceInterview_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AiScreeningSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceFragment" ADD CONSTRAINT "VoiceFragment_voiceId_fkey" FOREIGN KEY ("voiceId") REFERENCES "VoiceInterview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

