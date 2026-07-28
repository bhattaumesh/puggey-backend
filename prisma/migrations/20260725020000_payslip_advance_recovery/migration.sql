-- AlterTable: wire Payslip to the Advances module. netPayable starts equal
-- to netPay for every existing payslip (they predate advances, so there was
-- nothing to recover against them) -- the default of 0 stays in place
-- afterward only as a safety net for any future raw insert, since the app
-- always computes and sets both columns explicitly.
ALTER TABLE "payslips" ADD COLUMN     "advanceRecovery" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "netPayable" DECIMAL(12,2) NOT NULL DEFAULT 0;

UPDATE "payslips" SET "netPayable" = "netPay" WHERE "netPayable" = 0;
