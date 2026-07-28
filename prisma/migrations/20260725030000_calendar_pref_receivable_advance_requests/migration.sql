-- CreateEnum
CREATE TYPE "AdvanceRequestStatus" AS ENUM ('pending', 'approved', 'rejected', 'cancelled');

-- AlterTable
ALTER TABLE "payslips" ADD COLUMN     "previousMonthReceivable" DECIMAL(12,2) NOT NULL DEFAULT 0,
ALTER COLUMN "netPayable" DROP DEFAULT;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "calendarPreference" TEXT NOT NULL DEFAULT 'AD';

-- CreateTable
CREATE TABLE "advance_requests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT,
    "recoveryMode" "AdvanceRecoveryMode" NOT NULL,
    "instalmentAmount" DECIMAL(12,2),
    "status" "AdvanceRequestStatus" NOT NULL DEFAULT 'pending',
    "decidedByMembershipId" TEXT,
    "decisionReason" TEXT,
    "createdAdvanceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "advance_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "advance_requests_tenantId_idx" ON "advance_requests"("tenantId");

-- CreateIndex
CREATE INDEX "advance_requests_membershipId_idx" ON "advance_requests"("membershipId");

-- AddForeignKey
ALTER TABLE "advance_requests" ADD CONSTRAINT "advance_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advance_requests" ADD CONSTRAINT "advance_requests_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "tenant_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advance_requests" ADD CONSTRAINT "advance_requests_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "advance_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS: ordinary tenant-scoped table, same pattern as everything else.
ALTER TABLE "advance_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "advance_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY advance_request_tenant_scoped ON "advance_requests"
  USING (
    current_setting('app.is_pugey_staff', true) = 'true'
    OR "tenantId"::text = current_setting('app.tenant_id', true)
  );
