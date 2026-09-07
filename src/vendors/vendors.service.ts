import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { TenantContextService } from '../common/tenant-context.service';
import { CreateVendorDto } from './dto/create-vendor.dto';
import { ReceiveProductDto } from './dto/receive-product.dto';
import { UpdateReceiptProductDto } from './dto/update-receipt-product.dto';

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
          product: true,
          membership: { select: { id: true, user: { select: { fullName: true, email: true } } } },
        },
      }),
    );
  }

  // An employee's own receipts, most recent first -- lets them find one to
  // correct the product tag on without needing the admin-only /recent feed.
  async myReceipts(limit = 20) {
    return this.tenantPrisma.run(async (tx) => {
      const membershipId = await this.myMembershipId(tx);
      return tx.productReceivedLog.findMany({
        where: { membershipId },
        orderBy: { receivedAt: 'desc' },
        take: limit,
        include: { vendor: true, product: true },
      });
    });
  }

  async history(vendorId: string, limit?: number) {
    return this.tenantPrisma.run(async (tx) => {
      const vendor = await tx.vendor.findUnique({ where: { id: vendorId } });
      if (!vendor) throw new NotFoundException({ error: 'not_found', message: 'No such vendor.' });
      return tx.productReceivedLog.findMany({
        where: { vendorId },
        orderBy: { receivedAt: 'desc' },
        take: limit,
        include: { product: true, membership: { select: { id: true, user: { select: { fullName: true, email: true } } } } },
      });
    });
  }

  async receive(vendorId: string, dto: ReceiveProductDto) {
    return this.tenantPrisma.run(async (tx) => {
      const vendor = await tx.vendor.findUnique({ where: { id: vendorId } });
      if (!vendor) throw new NotFoundException({ error: 'not_found', message: 'No such vendor.' });
      if (dto.productId) {
        const product = await tx.product.findUnique({ where: { id: dto.productId } });
        if (!product) throw new NotFoundException({ error: 'not_found', message: 'No such product.' });
      }
      const membershipId = await this.myMembershipId(tx);
      return tx.productReceivedLog.create({
        data: { tenantId: this.ctx.tenantId!, vendorId, membershipId, remarks: dto.remarks, productId: dto.productId, billNumber: dto.billNumber },
        include: { product: true, membership: { select: { id: true, user: { select: { fullName: true, email: true } } } } },
      });
    });
  }

  // The employee who logged the receipt can tag or re-tag which product it
  // was after the fact (they may not have known/decided at the time); an
  // admin can correct anyone's. Nobody else may touch someone else's log.
  async updateReceiptProduct(logId: string, dto: UpdateReceiptProductDto) {
    return this.tenantPrisma.run(async (tx) => {
      const log = await tx.productReceivedLog.findUnique({ where: { id: logId } });
      if (!log) throw new NotFoundException({ error: 'not_found', message: 'No such receipt.' });
      const membershipId = await this.myMembershipId(tx);
      if (log.membershipId !== membershipId && this.ctx.role !== 'SUPER_ADMIN') {
        throw new ForbiddenException({ error: 'forbidden', message: 'You can only tag receipts you logged yourself.' });
      }
      if (dto.productId) {
        const product = await tx.product.findUnique({ where: { id: dto.productId } });
        if (!product) throw new NotFoundException({ error: 'not_found', message: 'No such product.' });
      }
      return tx.productReceivedLog.update({
        where: { id: logId },
        data: { productId: dto.productId ?? null },
        include: {
          vendor: true,
          product: true,
          membership: { select: { id: true, user: { select: { fullName: true, email: true } } } },
        },
      });
    });
  }
}
