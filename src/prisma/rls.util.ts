import { PrismaClient, Prisma } from '@prisma/client';
import { TenantContext } from './tenant-context.interface';

// Every tenant-scoped query must go through this. It opens a transaction, sets the
// three RLS session variables via set_config(..., is_local=true) — the parameterized
// form Prisma's tagged template safely escapes, so this is not string-interpolated
// SQL — then runs the callback against that transaction's client. Postgres enforces
// the actual isolation; this function only ever *asks* the DB to scope itself, it
// never filters rows in application code.
export async function runInTenantContext<T>(
  prisma: PrismaClient,
  ctx: TenantContext,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${ctx.tenantId ?? ''}, true)`;
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${ctx.currentUserId ?? ''}, true)`;
      await tx.$executeRaw`SELECT set_config('app.is_pugey_staff', ${ctx.isPugeyStaff ? 'true' : 'false'}, true)`;
      return fn(tx);
    },
    // Prisma's defaults (2s to acquire a connection, 5s transaction body) assume an
    // always-on database. On serverless Postgres (Neon) a cold compute can take
    // longer than that just to accept the connection, well before any query runs --
    // this only widens the budget, it does not change what counts as "stuck."
    { maxWait: 10000, timeout: 15000 },
  );
}
