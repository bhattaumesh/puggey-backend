-- AlterTable
ALTER TABLE "tenants" ADD COLUMN "businessType" TEXT;

-- CreateTable
CREATE TABLE "business_types" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_types_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "business_types_key_key" ON "business_types"("key");

-- Seed a starter set so the Create Company dropdown isn't empty on first
-- deploy -- Super Admin can rename/add/remove these from the Platform
-- Console as real clients come in.
INSERT INTO "business_types" ("id", "key", "label", "sortOrder", "updatedAt") VALUES
  (gen_random_uuid()::text, 'retail',        'Retail',                0, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'restaurant',    'Restaurant',            1, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'manufacturing', 'Manufacturing',         2, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'services',      'Professional services', 3, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'other',         'Other',                 4, CURRENT_TIMESTAMP);
