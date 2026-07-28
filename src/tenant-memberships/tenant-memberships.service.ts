import { Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

@Injectable()
export class TenantMembershipsService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  // Intentionally takes a raw :id with no WHERE tenantId = ... in the query --
  // the point is to prove RLS itself blocks cross-tenant access even when the
  // application code "forgets" to scope by hand. If this ever returns a tenant
  // B row while authenticated as tenant A, the isolation model is broken.
  findOne(id: string) {
    return this.tenantPrisma.run((tx) => tx.tenantMembership.findUnique({ where: { id }, include: { user: true } }));
  }

  listMine() {
    return this.tenantPrisma.run((tx) => tx.tenantMembership.findMany({ include: { user: true } }));
  }
}
