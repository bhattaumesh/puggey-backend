-- CreateTable
CREATE TABLE "racks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "racks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rack_cleaning_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "rackId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "cleanedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "remarks" TEXT,

    CONSTRAINT "rack_cleaning_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "racks_tenantId_idx" ON "racks"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "racks_tenantId_name_key" ON "racks"("tenantId", "name");

-- CreateIndex
CREATE INDEX "rack_cleaning_logs_tenantId_idx" ON "rack_cleaning_logs"("tenantId");

-- CreateIndex
CREATE INDEX "rack_cleaning_logs_rackId_idx" ON "rack_cleaning_logs"("rackId");

-- AddForeignKey
ALTER TABLE "racks" ADD CONSTRAINT "racks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rack_cleaning_logs" ADD CONSTRAINT "rack_cleaning_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rack_cleaning_logs" ADD CONSTRAINT "rack_cleaning_logs_rackId_fkey" FOREIGN KEY ("rackId") REFERENCES "racks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rack_cleaning_logs" ADD CONSTRAINT "rack_cleaning_logs_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "tenant_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "approval_delegations_delegatorMembershipId_delegateMembers_key" RENAME TO "approval_delegations_delegatorMembershipId_delegateMembersh_key";

-- RLS: ordinary tenant-scoped tables, same pattern as tasks/documents/etc.
ALTER TABLE "racks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "racks" FORCE ROW LEVEL SECURITY;
CREATE POLICY rack_tenant_scoped ON "racks"
  USING (
    current_setting('app.is_pugey_staff', true) = 'true'
    OR "tenantId"::text = current_setting('app.tenant_id', true)
  );

ALTER TABLE "rack_cleaning_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rack_cleaning_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY rack_cleaning_log_tenant_scoped ON "rack_cleaning_logs"
  USING (
    current_setting('app.is_pugey_staff', true) = 'true'
    OR "tenantId"::text = current_setting('app.tenant_id', true)
  );
