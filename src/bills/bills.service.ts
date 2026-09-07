import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { TenantContextService } from '../common/tenant-context.service';
import { CreateBillDto } from './dto/create-bill.dto';
import { EnterBillDto } from './dto/enter-bill.dto';

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

  // Draft bills -- created automatically when a product is received with a
  // bill number, still missing the amount/date someone needs to fill in --
  // oldest first, since those are the ones that have been sitting longest.
  pending() {
    return this.tenantPrisma.run((tx) =>
      tx.bill.findMany({ where: { status: 'draft' }, orderBy: { createdAt: 'asc' }, include: BILL_INCLUDE }),
    );
  }

  async mine() {
    return this.tenantPrisma.run(async (tx) => {
      const membershipId = await this.myMembershipId(tx);
      return tx.bill.findMany({ where: { membershipId }, orderBy: { createdAt: 'desc' }, take: RECENT_LIMIT, include: BILL_INCLUDE });
    });
  }

  // Bills that have actually been entered (pending payment or already
  // paid) -- drafts aren't "entered" yet, so they're excluded here and only
  // show up in pending().
  recent() {
    return this.tenantPrisma.run((tx) =>
      tx.bill.findMany({ where: { status: { not: 'draft' } }, orderBy: { createdAt: 'desc' }, take: RECENT_LIMIT, include: BILL_INCLUDE }),
    );
  }

  // Fills in the amount/date a draft is missing and flips it to "pending"
  // (awaiting payment) -- the same state a manually-entered bill starts in.
  // Open to any employee, not just whoever received the goods: entering the
  // bill is a separate, later step someone else may end up doing.
  async markEntered(billId: string, dto: EnterBillDto) {
    return this.tenantPrisma.run(async (tx) => {
      const bill = await tx.bill.findUnique({ where: { id: billId } });
      if (!bill) throw new NotFoundException({ error: 'not_found', message: 'No such bill.' });
      if (bill.status !== 'draft') throw new BadRequestException({ error: 'already_entered', message: 'This bill has already been entered.' });
      const membershipId = await this.myMembershipId(tx);
      return tx.bill.update({
        where: { id: billId },
        data: {
          amount: dto.amount,
          billDate: new Date(dto.billDate),
          remarks: dto.remarks !== undefined ? dto.remarks : bill.remarks,
          status: 'pending',
          membershipId,
        },
        include: BILL_INCLUDE,
      });
    });
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
