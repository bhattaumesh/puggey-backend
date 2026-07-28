import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { TenantContextService } from '../common/tenant-context.service';
import { CreateVendorDto } from './dto/create-vendor.dto';
import { ReceiveProductDto } from './dto/receive-product.dto';

const RECENT_LIMIT = 30;

type Tx = Prisma.TransactionClient;

@Injectable()
export class VendorsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly ctx: TenantContextService,
  ) {}

  private async myMembershipId(tx: Tx): Promise<string> {
    const userId = this.ctx.userId;
    const tenantId = this.ctx.tenantId;
    if (!userId || !tenantId) throw new NotFoundException({ error: 'not_found', message: 'No employee record for this account.' });
    const membership = await tx.tenantMembership.findUnique({ where: { tenantId_userId: { tenantId, userId } }, select: { id: true } });
    if (!membership) throw new NotFoundException({ error: 'not_found', message: 'No employee record for this account.' });
    return membership.id;
  }

  createVendor(dto: CreateVendorDto) {
    return this.tenantPrisma.run(async (tx) => {
      const existing = await tx.vendor.findFirst({ where: { name: dto.name } });
      if (existing) throw new ConflictException({ error: 'vendor_exists', message: 'A vendor with that name already exists.' });
      return tx.vendor.create({ data: { tenantId: this.ctx.tenantId!, name: dto.name } });
    });
  }

  search(query: string) {
    return this.tenantPrisma.run((tx) =>
      tx.vendor.findMany({
        where: query ? { name: { contains: query, mode: 'insensitive' } } : {},
        orderBy: { name: 'asc' },
      }),
    );
  }

  list() {
    return this.tenantPrisma.run((tx) => tx.vendor.findMany({ orderBy: { name: 'asc' } }));
  }

  // Admin's "Recent Product Received": a chronological feed of receipt
  // events, not deduped per vendor -- a vendor can deliver many separate
  // times, and each is its own entry the admin wants to see.
  recent() {
    return this.tenantPrisma.run((tx) =>
      tx.productReceivedLog.findMany({
        where: { tenantId: this.ctx.tenantId! },
        orderBy: { receivedAt: 'desc' },
        take: RECENT_LIMIT,
        include: {
          vendor: true,
          membership: { include: { user: { select: { fullName: true, email: true } } } },
        },
      }),
    );
  }

  async history(vendorId: string, limit?: number) {
    return this.tenantPrisma.run(async (tx) => {
      const vendor = await tx.vendor.findUnique({ where: { id: vendorId } });
      if (!vendor) throw new NotFoundException({ error: 'not_found', message: 'No such vendor.' });
      return tx.productReceivedLog.findMany({
        where: { vendorId },
        orderBy: { receivedAt: 'desc' },
        take: limit,
        include: { membership: { include: { user: { select: { fullName: true, email: true } } } } },
      });
    });
  }

  async receive(vendorId: string, dto: ReceiveProductDto) {
    return this.tenantPrisma.run(async (tx) => {
      const vendor = await tx.vendor.findUnique({ where: { id: vendorId } });
      if (!vendor) throw new NotFoundException({ error: 'not_found', message: 'No such vendor.' });
      const membershipId = await this.myMembershipId(tx);
      return tx.productReceivedLog.create({
        data: { tenantId: this.ctx.tenantId!, vendorId, membershipId, remarks: dto.remarks },
        include: { membership: { include: { user: { select: { fullName: true, email: true } } } } },
      });
    });
  }
}
