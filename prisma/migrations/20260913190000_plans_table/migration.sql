-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "maxEmployees" INTEGER,
    "features" TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plans_key_key" ON "plans"("key");

-- Seed the plan tiers that used to be the hardcoded PLAN_TIERS object, with
-- every premium-eligible feature turned on by default -- so no existing
-- tenant loses access to anything the moment this ships. Dial features down
-- per plan afterward from the Platform Console.
INSERT INTO "plans" ("id", "key", "label", "maxEmployees", "features", "sortOrder", "updatedAt") VALUES
  (gen_random_uuid()::text, 'trial',    'Trial',    5,    ARRAY['payroll','bills','retail','reports_export'], 0, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'basic',    'Basic',    10,   ARRAY['payroll','bills','retail','reports_export'], 1, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'silver',   'Silver',   20,   ARRAY['payroll','bills','retail','reports_export'], 2, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'gold',     'Gold',     40,   ARRAY['payroll','bills','retail','reports_export'], 3, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'platinum', 'Platinum', NULL, ARRAY['payroll','bills','retail','reports_export'], 4, CURRENT_TIMESTAMP);
