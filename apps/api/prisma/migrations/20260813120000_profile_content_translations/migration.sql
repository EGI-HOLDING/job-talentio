-- Per-language versions of candidate narrative fields. Proper names
-- (person, company, school, issuer) stay on the parent rows.
CREATE TABLE "EmployeeProfileTranslation" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "headline" TEXT,
    "summary" TEXT,
    "isMachine" BOOLEAN NOT NULL DEFAULT false,
    "sourceHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeProfileTranslation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmployeeProfileTranslation_profileId_locale_key" ON "EmployeeProfileTranslation"("profileId", "locale");
CREATE INDEX "EmployeeProfileTranslation_profileId_idx" ON "EmployeeProfileTranslation"("profileId");

ALTER TABLE "EmployeeProfileTranslation" ADD CONSTRAINT "EmployeeProfileTranslation_profileId_fkey"
    FOREIGN KEY ("profileId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WorkExperienceTranslation" (
    "id" TEXT NOT NULL,
    "experienceId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "isMachine" BOOLEAN NOT NULL DEFAULT false,
    "sourceHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkExperienceTranslation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkExperienceTranslation_experienceId_locale_key" ON "WorkExperienceTranslation"("experienceId", "locale");
CREATE INDEX "WorkExperienceTranslation_experienceId_idx" ON "WorkExperienceTranslation"("experienceId");

ALTER TABLE "WorkExperienceTranslation" ADD CONSTRAINT "WorkExperienceTranslation_experienceId_fkey"
    FOREIGN KEY ("experienceId") REFERENCES "WorkExperience"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EducationTranslation" (
    "id" TEXT NOT NULL,
    "educationId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "isMachine" BOOLEAN NOT NULL DEFAULT false,
    "sourceHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EducationTranslation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EducationTranslation_educationId_locale_key" ON "EducationTranslation"("educationId", "locale");
CREATE INDEX "EducationTranslation_educationId_idx" ON "EducationTranslation"("educationId");

ALTER TABLE "EducationTranslation" ADD CONSTRAINT "EducationTranslation_educationId_fkey"
    FOREIGN KEY ("educationId") REFERENCES "Education"("id") ON DELETE CASCADE ON UPDATE CASCADE;
