-- CreateTable
CREATE TABLE "attendance_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL DEFAULT 'web',
    "reason" TEXT,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attendance_events_tenantId_idx" ON "attendance_events"("tenantId");

-- CreateIndex
CREATE INDEX "attendance_events_membershipId_occurredAt_idx" ON "attendance_events"("membershipId", "occurredAt");

-- AddForeignKey
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "tenant_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS: ordinary tenant-scoped table, same pattern as everything else.
ALTER TABLE "attendance_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attendance_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY attendance_event_tenant_scoped ON "attendance_events"
  USING (
    current_setting('app.is_pugey_staff', true) = 'true'
    OR "tenantId"::text = current_setting('app.tenant_id', true)
  );
