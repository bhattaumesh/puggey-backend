import { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

// Mirrors plans.util.ts's getPlanByKey/planLabel -- Tenant.businessType is a
// free-form string with no FK, so a tenant on an unknown/legacy/unset key
// just falls back to showing the raw key (or null if never set).
export async function getBusinessTypeByKey(tx: Tx, key: string) {
  return tx.businessType.findUnique({ where: { key } });
}

export async function businessTypeLabel(tx: Tx, key: string | null): Promise<string | null> {
  if (!key) return null;
  const type = await getBusinessTypeByKey(tx, key);
  return type ? type.label : key;
}
