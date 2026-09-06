CREATE TYPE "BillStatus" AS ENUM ('pending', 'paid');
CREATE TYPE "CounterSessionStatus" AS ENUM ('open', 'closed');
CREATE TYPE "CashMovementType" AS ENUM ('inflow', 'outflow');

CREATE TABLE "bills" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vendorId" TEXT,
    "membershipId" TEXT NOT NULL,
    "billNumber" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "billDate" TIMESTAMP(3) NOT NULL,
    "status" "BillStatus" NOT NULL DEFAULT 'pending',
    "paidAt" TIMESTAMP(3),
    "paidByMembershipId" TEXT,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bills_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "bills_tenantId_idx" ON "bills"("tenantId");
CREATE INDEX "bills_status_idx" ON "bills"("status");

ALTER TABLE "bills" ADD CONSTRAINT "bills_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bills" ADD CONSTRAINT "bills_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "bills" ADD CONSTRAINT "bills_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "tenant_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bills" ADD CONSTRAINT "bills_paidByMembershipId_fkey" FOREIGN KEY ("paidByMembershipId") REFERENCES "tenant_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bills" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bills" FORCE ROW LEVEL SECURITY;
CREATE POLICY bill_tenant_scoped ON "bills"
  USING (
    current_setting('app.is_pugey_staff', true) = 'true'
    OR "tenantId"::text = current_setting('app.tenant_id', true)
  );

CREATE TABLE "counters" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "counters_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "counters_tenantId_name_key" ON "counters"("tenantId", "name");
CREATE INDEX "counters_tenantId_idx" ON "counters"("tenantId");

ALTER TABLE "counters" ADD CONSTRAINT "counters_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "counters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "counters" FORCE ROW LEVEL SECURITY;
CREATE POLICY counter_tenant_scoped ON "counters"
  USING (
    current_setting('app.is_pugey_staff', true) = 'true'
    OR "tenantId"::text = current_setting('app.tenant_id', true)
  );

CREATE TABLE "counter_sessions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "counterId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "assignedByMembershipId" TEXT NOT NULL,
    "status" "CounterSessionStatus" NOT NULL DEFAULT 'open',
    "openingCash" DECIMAL(12,2) NOT NULL,
    "openingDenominations" JSONB NOT NULL,
    "closingCash" DECIMAL(12,2),
    "closingDenominations" JSONB,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "counter_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "counter_sessions_tenantId_idx" ON "counter_sessions"("tenantId");
CREATE INDEX "counter_sessions_membershipId_idx" ON "counter_sessions"("membershipId");

ALTER TABLE "counter_sessions" ADD CONSTRAINT "counter_sessions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "counter_sessions" ADD CONSTRAINT "counter_sessions_counterId_fkey" FOREIGN KEY ("counterId") REFERENCES "counters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "counter_sessions" ADD CONSTRAINT "counter_sessions_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "tenant_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "counter_sessions" ADD CONSTRAINT "counter_sessions_assignedByMembershipId_fkey" FOREIGN KEY ("assignedByMembershipId") REFERENCES "tenant_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "counter_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "counter_sessions" FORCE ROW LEVEL SECURITY;
CREATE POLICY counter_session_tenant_scoped ON "counter_sessions"
  USING (
    current_setting('app.is_pugey_staff', true) = 'true'
    OR "tenantId"::text = current_setting('app.tenant_id', true)
  );

CREATE TABLE "counter_cash_movements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "counterSessionId" TEXT NOT NULL,
    "type" "CashMovementType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "counter_cash_movements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "counter_cash_movements_tenantId_idx" ON "counter_cash_movements"("tenantId");
CREATE INDEX "counter_cash_movements_counterSessionId_idx" ON "counter_cash_movements"("counterSessionId");

ALTER TABLE "counter_cash_movements" ADD CONSTRAINT "counter_cash_movements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "counter_cash_movements" ADD CONSTRAINT "counter_cash_movements_counterSessionId_fkey" FOREIGN KEY ("counterSessionId") REFERENCES "counter_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "counter_cash_movements" ADD CONSTRAINT "counter_cash_movements_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "tenant_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "counter_cash_movements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "counter_cash_movements" FORCE ROW LEVEL SECURITY;
CREATE POLICY counter_cash_movement_tenant_scoped ON "counter_cash_movements"
  USING (
    current_setting('app.is_pugey_staff', true) = 'true'
    OR "tenantId"::text = current_setting('app.tenant_id', true)
  );
