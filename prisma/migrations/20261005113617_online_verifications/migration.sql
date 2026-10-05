-- CreateTable
CREATE TABLE "online_verifications" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reportDate" DATE NOT NULL,
    "note" TEXT,
    "ignoreOrder" BOOLEAN NOT NULL DEFAULT false,
    "rows" JSONB NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "mismatchCount" INTEGER NOT NULL,
    "softwareTotal" DECIMAL(14,2) NOT NULL,
    "onlineTotal" DECIMAL(14,2) NOT NULL,
    "createdByMembershipId" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "online_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "online_verifications_tenantId_reportDate_idx" ON "online_verifications"("tenantId", "reportDate");

-- AddForeignKey
ALTER TABLE "online_verifications" ADD CONSTRAINT "online_verifications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "online_verifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "online_verifications" FORCE ROW LEVEL SECURITY;
CREATE POLICY online_verification_tenant_scoped ON "online_verifications"
  USING (
    current_setting('app.is_pugey_staff', true) = 'true'
    OR "tenantId"::text = current_setting('app.tenant_id', true)
  );
