-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('CITIZENSHIP', 'NID', 'DRIVING_LICENCE');

-- CreateEnum
CREATE TYPE "AdvanceRecoveryMode" AS ENUM ('FULL', 'INSTALMENT');

-- AlterTable
ALTER TABLE "tenant_memberships" ADD COLUMN     "citizenshipNumber" TEXT,
ADD COLUMN     "currentAddress" TEXT,
ADD COLUMN     "dateOfBirth" TIMESTAMP(3),
ADD COLUMN     "drivingLicenceNumber" TEXT,
ADD COLUMN     "education" TEXT,
ADD COLUMN     "emergencyContactNumber" TEXT,
ADD COLUMN     "fatherName" TEXT,
ADD COLUMN     "grandfatherName" TEXT,
ADD COLUMN     "mobileNumber" TEXT,
ADD COLUMN     "motherName" TEXT,
ADD COLUMN     "nidNumber" TEXT,
ADD COLUMN     "panNumber" TEXT,
ADD COLUMN     "pastExperience" TEXT,
ADD COLUMN     "permanentAddress" TEXT;

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploadedByMembershipId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advance_categories" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "advance_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advances" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "dateGiven" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "recoveryMode" "AdvanceRecoveryMode" NOT NULL,
    "instalmentAmount" DECIMAL(12,2),
    "recoveredAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "closedAt" TIMESTAMP(3),
    "createdByMembershipId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "advances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advance_recoveries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "advanceId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "amountRecovered" DECIMAL(12,2) NOT NULL,
    "createdByMembershipId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "advance_recoveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "documents_tenantId_idx" ON "documents"("tenantId");

-- CreateIndex
CREATE INDEX "documents_membershipId_type_idx" ON "documents"("membershipId", "type");

-- CreateIndex
CREATE INDEX "advance_categories_tenantId_idx" ON "advance_categories"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "advance_categories_tenantId_name_key" ON "advance_categories"("tenantId", "name");

-- CreateIndex
CREATE INDEX "advances_tenantId_idx" ON "advances"("tenantId");

-- CreateIndex
CREATE INDEX "advances_membershipId_idx" ON "advances"("membershipId");

-- CreateIndex
CREATE INDEX "advance_recoveries_tenantId_idx" ON "advance_recoveries"("tenantId");

-- CreateIndex
CREATE INDEX "advance_recoveries_membershipId_idx" ON "advance_recoveries"("membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "advance_recoveries_advanceId_year_month_key" ON "advance_recoveries"("advanceId", "year", "month");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "tenant_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advance_categories" ADD CONSTRAINT "advance_categories_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advances" ADD CONSTRAINT "advances_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advances" ADD CONSTRAINT "advances_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "tenant_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advances" ADD CONSTRAINT "advances_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "advance_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advance_recoveries" ADD CONSTRAINT "advance_recoveries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advance_recoveries" ADD CONSTRAINT "advance_recoveries_advanceId_fkey" FOREIGN KEY ("advanceId") REFERENCES "advances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS: ordinary tenant-scoped tables, same pattern as everything else.
ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;
CREATE POLICY document_tenant_scoped ON "documents"
  USING (
    current_setting('app.is_pugey_staff', true) = 'true'
    OR "tenantId"::text = current_setting('app.tenant_id', true)
  );

ALTER TABLE "advance_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "advance_categories" FORCE ROW LEVEL SECURITY;
CREATE POLICY advance_category_tenant_scoped ON "advance_categories"
  USING (
    current_setting('app.is_pugey_staff', true) = 'true'
    OR "tenantId"::text = current_setting('app.tenant_id', true)
  );

ALTER TABLE "advances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "advances" FORCE ROW LEVEL SECURITY;
CREATE POLICY advance_tenant_scoped ON "advances"
  USING (
    current_setting('app.is_pugey_staff', true) = 'true'
    OR "tenantId"::text = current_setting('app.tenant_id', true)
  );

ALTER TABLE "advance_recoveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "advance_recoveries" FORCE ROW LEVEL SECURITY;
CREATE POLICY advance_recovery_tenant_scoped ON "advance_recoveries"
  USING (
    current_setting('app.is_pugey_staff', true) = 'true'
    OR "tenantId"::text = current_setting('app.tenant_id', true)
  );

-- Seed the three default advance categories (spec Part 1) for every tenant
-- that already exists. New tenants get these from TenantsService/AuthService
-- at creation time instead of a migration.
INSERT INTO "advance_categories" ("id", "tenantId", "name", "createdAt")
SELECT gen_random_uuid()::text, t."id", cat.name, CURRENT_TIMESTAMP
FROM "tenants" t
CROSS JOIN (VALUES ('Advance salary'), ('Purchase'), ('Khaja')) AS cat(name)
ON CONFLICT ("tenantId", "name") DO NOTHING;
