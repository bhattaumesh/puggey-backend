import { Controller, Get, UseGuards } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { TenantContextService } from '../common/tenant-context.service';
import { ApiKeyGuard } from '../auth/api-key.guard';

// Phase 9 (Extensions): the read-only external API. Deliberately narrow --
// one real endpoint, proving the key round-trip end to end, rather than a
// wide surface nobody asked for yet. Add more read-only endpoints here as
// integrations actually need them.
@Controller('external/v1')
@UseGuards(ApiKeyGuard)
export class ExternalController {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly ctx: TenantContextService,
  ) {}

  @Get('employees')
  listEmployees() {
    return this.tenantPrisma.run((tx) =>
      tx.tenantMembership.findMany({
        where: { tenantId: this.ctx.tenantId!, status: 'active' },
        select: {
          id: true,
          role: true,
          designation: true,
          employeeCode: true,
          department: { select: { name: true } },
          user: { select: { fullName: true, email: true } },
        },
        orderBy: { joinedAt: 'asc' },
      }),
    );
  }
}
