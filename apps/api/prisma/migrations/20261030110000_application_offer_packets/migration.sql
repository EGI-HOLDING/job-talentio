CREATE TYPE "OfferPacketKind" AS ENUM ('OFFER', 'POST_HIRE');
CREATE TYPE "OfferPacketStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED', 'SHARED');

CREATE TABLE "ApplicationOfferPacket" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "kind" "OfferPacketKind" NOT NULL,
    "status" "OfferPacketStatus" NOT NULL,
    "createdById" TEXT,
    "note" VARCHAR(2000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "ApplicationOfferPacket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApplicationOfferDocument" (
    "id" TEXT NOT NULL,
    "packetId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" VARCHAR(255) NOT NULL,
    "contentType" VARCHAR(100) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApplicationOfferDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ApplicationOfferPacket_applicationId_kind_version_key"
    ON "ApplicationOfferPacket"("applicationId", "kind", "version");
CREATE INDEX "ApplicationOfferPacket_applicationId_kind_createdAt_idx"
    ON "ApplicationOfferPacket"("applicationId", "kind", "createdAt");
CREATE INDEX "ApplicationOfferPacket_applicationId_status_idx"
    ON "ApplicationOfferPacket"("applicationId", "status");
CREATE UNIQUE INDEX "ApplicationOfferDocument_storageKey_key"
    ON "ApplicationOfferDocument"("storageKey");
CREATE INDEX "ApplicationOfferDocument_packetId_createdAt_idx"
    ON "ApplicationOfferDocument"("packetId", "createdAt");

ALTER TABLE "ApplicationOfferPacket"
    ADD CONSTRAINT "ApplicationOfferPacket_applicationId_fkey"
    FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApplicationOfferPacket"
    ADD CONSTRAINT "ApplicationOfferPacket_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ApplicationOfferDocument"
    ADD CONSTRAINT "ApplicationOfferDocument_packetId_fkey"
    FOREIGN KEY ("packetId") REFERENCES "ApplicationOfferPacket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApplicationOfferDocument"
    ADD CONSTRAINT "ApplicationOfferDocument_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing OFFER-stage applications predate in-app document decisions. Give
-- them a documentless packet that records the offer without requiring an
-- employee response inside the app.
INSERT INTO "ApplicationOfferPacket" (
    "id", "applicationId", "version", "kind", "status", "createdAt"
)
SELECT
    'legacy-offer-' || a."id", a."id", 1, 'OFFER', 'SHARED', a."updatedAt"
FROM "Application" a
WHERE a."status" = 'OFFER';
