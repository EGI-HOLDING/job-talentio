ALTER TABLE "LinkedInOAuthState" ADD COLUMN "companyId" TEXT;
ALTER TABLE "LinkedInPreview" ADD COLUMN "organizationUrn" TEXT;
CREATE TABLE "LinkedInCompanyPage" (
    "companyId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "organizationUrn" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LinkedInCompanyPage_pkey" PRIMARY KEY ("companyId", "connectionId"),
    CONSTRAINT "LinkedInCompanyPage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LinkedInCompanyPage_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "LinkedInConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "LinkedInCompanyPage_connectionId_idx" ON "LinkedInCompanyPage" ("connectionId");
