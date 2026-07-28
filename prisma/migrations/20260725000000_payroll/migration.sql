-- AlterTable
ALTER TABLE "tenant_memberships" ADD COLUMN "baseSalary" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "payroll_settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "incomeTaxPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "providentFundPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payslips" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "grossPay" DECIMAL(12,2) NOT NULL,
    "incomeTax" DECIMAL(12,2) NOT NULL,
    "providentFund" DECIMAL(12,2) NOT NULL,
    "netPay" DECIMAL(12,2) NOT NULL,
    "generatedByMembershipId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payslips_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payroll_settings_tenantId_key" ON "payroll_settings"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "payslips_membershipId_year_month_key" ON "payslips"("membershipId", "year", "month");
CREATE INDEX "payslips_tenantId_idx" ON "payslips"("tenantId");

-- AddForeignKey
ALTER TABLE "payroll_settings" ADD CONSTRAINT "payroll_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "tenant_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS: ordinary tenant-scoped tables, same pattern as everything else.
ALTER TABLE "payroll_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY payroll_settings_tenant_scoped ON "payroll_settings"
  USING (
    current_setting('app.is_pugey_staff', true) = 'true'
    OR "tenantId"::text = current_setting('app.tenant_id', true)
  );

ALTER TABLE "payslips" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payslips" FORCE ROW LEVEL SECURITY;
CREATE POLICY payslip_tenant_scoped ON "payslips"
  USING (
    current_setting('app.is_pugey_staff', true) = 'true'
    OR "tenantId"::text = current_setting('app.tenant_id', true)
  );
