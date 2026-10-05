-- AlterTable
ALTER TABLE "counter_cash_movements" ADD COLUMN     "advanceId" TEXT,
ADD COLUMN     "employeeMembershipId" TEXT,
ADD COLUMN     "purpose" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "counter_cash_movements_advanceId_key" ON "counter_cash_movements"("advanceId");

-- AddForeignKey
ALTER TABLE "counter_cash_movements" ADD CONSTRAINT "counter_cash_movements_employeeMembershipId_fkey" FOREIGN KEY ("employeeMembershipId") REFERENCES "tenant_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counter_cash_movements" ADD CONSTRAINT "counter_cash_movements_advanceId_fkey" FOREIGN KEY ("advanceId") REFERENCES "advances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

