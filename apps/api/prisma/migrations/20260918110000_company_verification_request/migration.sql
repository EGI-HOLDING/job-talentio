-- Employers ask for the verified badge with their legal name, STIR/INN and a document; admins decide.
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "CompanyVerificationRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "submittedById" TEXT,
    "legalName" TEXT NOT NULL,
    "taxId" VARCHAR(20) NOT NULL,
    "note" TEXT,
    "documentKey" TEXT,
    "documentName" TEXT,
    "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyVerificationRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CompanyVerificationRequest_companyId_createdAt_idx" ON "CompanyVerificationRequest"("companyId", "createdAt");
CREATE INDEX "CompanyVerificationRequest_status_idx" ON "CompanyVerificationRequest"("status");

ALTER TABLE "CompanyVerificationRequest" ADD CONSTRAINT "CompanyVerificationRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyVerificationRequest" ADD CONSTRAINT "CompanyVerificationRequest_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CompanyVerificationRequest" ADD CONSTRAINT "CompanyVerificationRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
