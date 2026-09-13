import { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

// Replaces the old hardcoded PLAN_TIERS lookup -- plans are a real,
// Super-Admin-editable table now (see prisma Plan model / PlansService).
// Falls back to a conservative trial-shaped default for a tenant sitting on
// an unknown/legacy plan key, mirroring the old planLimit()'s fallback.
const FALLBACK_PLAN = { label: 'Trial', maxEmployees: 5, features: [] as string[] };

export async function getPlanByKey(tx: Tx, key: string) {
  return tx.plan.findUnique({ where: { key } });
}

export async function planLimit(tx: Tx, key: string): Promise<number | null> {
  const plan = await getPlanByKey(tx, key);
  return plan ? plan.maxEmployees : FALLBACK_PLAN.maxEmployees;
}

export async function planLabel(tx: Tx, key: string): Promise<string> {
  const plan = await getPlanByKey(tx, key);
  return plan ? plan.label : key;
}

export async function planFeatures(tx: Tx, key: string): Promise<string[]> {
  const plan = await getPlanByKey(tx, key);
  return plan ? plan.features : FALLBACK_PLAN.features;
}
