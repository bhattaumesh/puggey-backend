-- CreateEnum
CREATE TYPE "PayrollContributionScheme" AS ENUM ('NONE', 'PF_GRATUITY', 'SSF');

-- AlterTable: rename (not drop+add) so any rate a tenant admin already
-- entered under the old flat field carries forward as the employee-side
-- rate under the new scheme-aware model.
ALTER TABLE "payroll_settings" RENAME COLUMN "providentFundPercent" TO "employeeContributionPercent";

-- AlterTable: existing tenants default to NONE/0 -- nothing is assumed on
-- their behalf, same principle as the REQUIRES_VERIFICATION rates already here.
ALTER TABLE "payroll_settings" ADD COLUMN "contributionScheme" "PayrollContributionScheme" NOT NULL DEFAULT 'NONE';
ALTER TABLE "payroll_settings" ADD COLUMN "employerContributionPercent" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- AlterTable: frozen employer-side amount per payslip, mirrors providentFund's freeze pattern.
ALTER TABLE "payslips" ADD COLUMN "employerContribution" DECIMAL(12,2) NOT NULL DEFAULT 0;
