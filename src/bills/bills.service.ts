import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { TenantContextService } from '../common/tenant-context.service';
import { CreateBillDto } from './dto/create-bill.dto';

const RECENT_LIMIT = 30;

type Tx = Prisma.TransactionClient;

const BILL_INCLUDE = {
  vendor: true,
  membership: { select: { id: true, user: { select: { fullName: true, email: true } } } },
  paidBy: { select: { id: true, user: { select: { fullName: true, email: true } } } },
} satisfies Prisma.BillInclude;

@Injectable()
export class BillsService {
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

  create(dto: CreateBillDto) {
    return this.tenantPrisma.run(async (tx) => {
      const membershipId = await this.myMembershipId(tx);
      return tx.bill.create({
        data: {
          tenantId: this.ctx.tenantId!,
          vendorId: dto.vendorId,
          membershipId,
          billNumber: dto.billNumber,
          amount: dto.amount,
          billDate: new Date(dto.billDate),
          remarks: dto.remarks,
        },
        include: BILL_INCLUDE,
      });
    });
  }

  // Every pending bill, oldest first -- the ones that have been sitting
  // longest are the ones that most need attention.
  pending() {
    return this.tenantPrisma.run((tx) =>
      tx.bill.findMany({ where: { status: 'pending' }, orderBy: { billDate: 'asc' }, include: BILL_INCLUDE }),
    );
  }

  async mine() {
    return this.tenantPrisma.run(async (tx) => {
      const membershipId = await this.myMembershipId(tx);
      return tx.bill.findMany({ where: { membershipId }, orderBy: { createdAt: 'desc' }, take: RECENT_LIMIT, include: BILL_INCLUDE });
    });
  }

  recent() {
    return this.tenantPrisma.run((tx) => tx.bill.findMany({ orderBy: { createdAt: 'desc' }, take: RECENT_LIMIT, include: BILL_INCLUDE }));
  }

  async markPaid(billId: string) {
    return this.tenantPrisma.run(async (tx) => {
      const bill = await tx.bill.findUnique({ where: { id: billId } });
      if (!bill) throw new NotFoundException({ error: 'not_found', message: 'No such bill.' });
      const paidByMembershipId = await this.myMembershipId(tx);
      return tx.bill.update({
        where: { id: billId },
        data: { status: 'paid', paidAt: new Date(), paidByMembershipId },
        include: BILL_INCLUDE,
      });
    });
  }
}
