import { Injectable, Scope } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { TenantContextService } from '../common/tenant-context.service';
import { runInTenantContext } from './rls.util';

// Request-scoped wrapper: every controller/service that touches tenant-owned data
// calls tenantPrisma.run(tx => tx.someModel.findMany(...)) instead of holding a
// plain PrismaClient. This is the only path into the database for tenant data, so
// there is exactly one place tenant scoping can be forgotten -- and if it is,
// Postgres RLS is the backstop, not application code.
@Injectable({ scope: Scope.REQUEST })
export class TenantPrismaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContextService,
  ) {}

  run<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return runInTenantContext(
      this.prisma,
      {
        tenantId: this.ctx.tenantId,
        currentUserId: this.ctx.userId,
        isPugeyStaff: this.ctx.isPugeyStaff,
      },
      fn,
    );
  }
}
