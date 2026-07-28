-- CreateEnum
CREATE TYPE "RackAssignmentStatus" AS ENUM ('pending', 'completed', 'cancelled');

-- CreateTable
CREATE TABLE "rack_assignments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "rackId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "assignedByMembershipId" TEXT NOT NULL,
    "status" "RackAssignmentStatus" NOT NULL DEFAULT 'pending',
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cleaningLogId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rack_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rack_assignments_cleaningLogId_key" ON "rack_assignments"("cleaningLogId");

-- CreateIndex
CREATE INDEX "rack_assignments_tenantId_idx" ON "rack_assignments"("tenantId");

-- CreateIndex
CREATE INDEX "rack_assignments_rackId_idx" ON "rack_assignments"("rackId");

-- CreateIndex
CREATE INDEX "rack_assignments_membershipId_idx" ON "rack_assignments"("membershipId");

-- AddForeignKey
ALTER TABLE "rack_assignments" ADD CONSTRAINT "rack_assignments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rack_assignments" ADD CONSTRAINT "rack_assignments_rackId_fkey" FOREIGN KEY ("rackId") REFERENCES "racks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rack_assignments" ADD CONSTRAINT "rack_assignments_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "tenant_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rack_assignments" ADD CONSTRAINT "rack_assignments_assignedByMembershipId_fkey" FOREIGN KEY ("assignedByMembershipId") REFERENCES "tenant_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rack_assignments" ADD CONSTRAINT "rack_assignments_cleaningLogId_fkey" FOREIGN KEY ("cleaningLogId") REFERENCES "rack_cleaning_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS: ordinary tenant-scoped table, same pattern as racks/rack_cleaning_logs.
ALTER TABLE "rack_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rack_assignments" FORCE ROW LEVEL SECURITY;
CREATE POLICY rack_assignment_tenant_scoped ON "rack_assignments"
  USING (
    current_setting('app.is_pugey_staff', true) = 'true'
    OR "tenantId"::text = current_setting('app.tenant_id', true)
  );
