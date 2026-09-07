-- AlterEnum
ALTER TYPE "BillStatus" ADD VALUE 'draft';

-- AlterTable
ALTER TABLE "bills" ALTER COLUMN "amount" DROP NOT NULL;
ALTER TABLE "bills" ALTER COLUMN "billDate" DROP NOT NULL;
