import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { TenantContextService } from '../common/tenant-context.service';
import { CreateAdvanceDto } from './dto/create-advance.dto';
import { UpdateAdvanceDto } from './dto/update-advance.dto';

// All recovery arithmetic happens in integer paisa, converting back to a
// rupee number only once per value -- this is what actually satisfies "no
// floats touching money" (the spec's own words) even though the column type
// stays Decimal(12,2) to match the existing baseSalary/Payslip convention
// (see the schema comment on Advance). Recomputing from the persisted 2dp
// value every period, rather than accumulating a running float, is what
// guarantees zero drift across periods.
function toPaisa(value: Prisma.Decimal | number): number {
  return Math.round(Number(value) * 100);
}
function fromPaisa(paisa: number): number {
  return paisa / 100;
}

export interface DeductionBreakdownEntry {
  advanceId: string;
  categoryName: string;
  requested: number;
  deducted: number;
  carriedForward: number;
  outstandingAfter: number;
}

export interface DeductionResult {
  totalDeduction: number;
  breakdown: DeductionBreakdownEntry[];
}

type Tx = Prisma.TransactionClient;

@Injectable()
export class AdvancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly ctx: TenantContextService,
  ) {}

  private async myMembershipId(tx: Tx): Promise<string | null> {
    const userId = this.ctx.userId;
    const tenantId = this.ctx.tenantId;
    if (!userId || !tenantId) return null;
    const membership = await tx.tenantMembership.findUnique({ where: { tenantId_userId: { tenantId, userId } }, select: { id: true } });
    return membership?.id ?? null;
  }

  private async assertCanAccess(tx: Tx, membershipId: string) {
    if (this.ctx.role === 'SUPER_ADMIN') return;
    const myId = await this.myMembershipId(tx);
    if (myId !== membershipId) {
      throw new ForbiddenException({ error: 'not_authorized', message: 'You do not have access to these advances.' });
    }
  }

  create(dto: CreateAdvanceDto) {
    return this.tenantPrisma.run((tx) => this.createInTx(tx, dto));
  }

  // Extracted so AdvanceRequestsService.decide can create the real Advance
  // row on approval inside its own already-open transaction -- calling the
  // public create() there would nest a second tenantPrisma.run transaction
  // on top of the first, the exact nested-transaction hazard PayrollService
  // already avoids for computeAdvanceDeductionsInTx/applyRecoveryInTx.
  async createInTx(tx: Tx, dto: CreateAdvanceDto) {
    const member = await tx.tenantMembership.findUnique({ where: { id: dto.membershipId } });
    if (!member) throw new NotFoundException({ error: 'not_found', message: 'No such employee.' });

    const category = await tx.advanceCategory.findUnique({ where: { id: dto.categoryId } });
    if (!category || category.deletedAt) throw new NotFoundException({ error: 'not_found', message: 'No such category.' });

    if (dto.recoveryMode === 'INSTALMENT' && !dto.instalmentAmount) {
      throw new BadRequestException({ error: 'instalment_amount_required', message: 'Set an instalment amount for instalment recovery.' });
    }

    const createdByMembershipId = await this.myMembershipId(tx);
    if (!createdByMembershipId) throw new ForbiddenException({ error: 'not_authorized', message: 'No employee record for this account.' });

    const advance = await tx.advance.create({
      data: {
        tenantId: this.ctx.tenantId!,
        membershipId: dto.membershipId,
        categoryId: dto.categoryId,
        amount: dto.amount,
        dateGiven: new Date(dto.dateGiven),
        reason: dto.reason,
        recoveryMode: dto.recoveryMode,
        instalmentAmount: dto.recoveryMode === 'INSTALMENT' ? dto.instalmentAmount : null,
        createdByMembershipId,
      },
      include: { category: true },
    });

    await tx.auditLog.create({
      data: {
        tenantId: this.ctx.tenantId!,
        actorUserId: this.ctx.userId,
        action: 'advance_created',
        entityType: 'advance',
        entityId: advance.id,
        targetUserId: member.userId,
        afterJson: JSON.stringify({ amount: dto.amount, recoveryMode: dto.recoveryMode, categoryId: dto.categoryId }),
      },
    });

    return advance;
  }

  // amount is only editable before any recovery has happened -- changing it
  // afterward would silently invalidate the recoveredAmount/outstanding
  // relationship the spec calls out as the thing that must stay consistent.
  async update(id: string, dto: UpdateAdvanceDto) {
    return this.tenantPrisma.run(async (tx) => {
      const existing = await tx.advance.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException({ error: 'not_found', message: 'No such advance.' });

      if (dto.amount !== undefined && Number(existing.recoveredAmount) > 0) {
        throw new BadRequestException({
          error: 'advance_partially_recovered',
          message: 'This advance already has recovery recorded against it, so its amount cannot be changed.',
        });
      }
      if (dto.categoryId) {
        const category = await tx.advanceCategory.findUnique({ where: { id: dto.categoryId } });
        if (!category || category.deletedAt) throw new NotFoundException({ error: 'not_found', message: 'No such category.' });
      }

      const recoveryMode = dto.recoveryMode ?? existing.recoveryMode;
      const updated = await tx.advance.update({
        where: { id },
        data: {
          categoryId: dto.categoryId,
          amount: dto.amount,
          dateGiven: dto.dateGiven ? new Date(dto.dateGiven) : undefined,
          reason: dto.reason,
          recoveryMode: dto.recoveryMode,
          instalmentAmount: recoveryMode === 'INSTALMENT' ? dto.instalmentAmount ?? existing.instalmentAmount : null,
        },
        include: { category: true },
      });

      await tx.auditLog.create({
        data: {
          tenantId: this.ctx.tenantId!,
          actorUserId: this.ctx.userId,
          action: 'advance_updated',
          entityType: 'advance',
          entityId: id,
          beforeJson: JSON.stringify(existing),
          afterJson: JSON.stringify(updated),
        },
      });

      return updated;
    });
  }

  // Blocked once real recovery exists -- deleting a partly-repaid advance
  // would erase the loan half of a real money movement while its recovery
  // history remains, which is exactly what "must be traceable" rules out.
  async remove(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const existing = await tx.advance.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException({ error: 'not_found', message: 'No such advance.' });
      if (Number(existing.recoveredAmount) > 0) {
        throw new BadRequestException({
          error: 'advance_partially_recovered',
          message: 'This advance already has recovery recorded against it and cannot be deleted.',
        });
      }

      await tx.advance.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          tenantId: this.ctx.tenantId!,
          actorUserId: this.ctx.userId,
          action: 'advance_deleted',
          entityType: 'advance',
          entityId: id,
          beforeJson: JSON.stringify(existing),
        },
      });
      return { deleted: true };
    });
  }

  async listFor(membershipId: string) {
    return this.tenantPrisma.run(async (tx) => {
      await this.assertCanAccess(tx, membershipId);
      const advances = await tx.advance.findMany({
        where: { membershipId },
        include: { category: true, recoveries: { orderBy: [{ year: 'desc' }, { month: 'desc' }] } },
        orderBy: { dateGiven: 'desc' },
      });
      const totalOutstanding = advances
        .filter((a) => !a.closedAt)
        .reduce((sum, a) => sum + (toPaisa(a.amount) - toPaisa(a.recoveredAmount)), 0);
      return { advances, totalOutstanding: fromPaisa(totalOutstanding) };
    });
  }

  // The single integration point: everything about what to deduct this
  // period lives here. Called by the net-pay preview endpoint (uncapped when
  // no payslip exists yet for the period) and by PayrollService.generate
  // (capped at that member's netPay for the period) -- same function, same
  // transaction, no separate reimplementation on the payroll side.
  async computeAdvanceDeductionsInTx(
    tx: Tx,
    membershipId: string,
    availableNetPay?: number,
    minimumNetPay = 0,
  ): Promise<DeductionResult> {
    const advances = await tx.advance.findMany({
      where: { membershipId, closedAt: null },
      include: { category: true },
      orderBy: { dateGiven: 'asc' },
    });

    const requestedPaisa = advances.map((a) => {
      const outstanding = toPaisa(a.amount) - toPaisa(a.recoveredAmount);
      const requested = a.recoveryMode === 'FULL' ? outstanding : Math.min(toPaisa(a.instalmentAmount ?? a.amount), outstanding);
      return { advance: a, outstanding, requested };
    });

    const headroomPaisa = availableNetPay === undefined ? Number.POSITIVE_INFINITY : Math.max(0, toPaisa(availableNetPay) - toPaisa(minimumNetPay));

    let remainingHeadroom = headroomPaisa;
    const breakdown: DeductionBreakdownEntry[] = [];
    let totalDeductedPaisa = 0;

    for (const { advance, outstanding, requested } of requestedPaisa) {
      const deducted = Math.min(requested, remainingHeadroom);
      remainingHeadroom = Number.isFinite(remainingHeadroom) ? remainingHeadroom - deducted : remainingHeadroom;
      totalDeductedPaisa += deducted;
      breakdown.push({
        advanceId: advance.id,
        categoryName: advance.category.name,
        requested: fromPaisa(requested),
        deducted: fromPaisa(deducted),
        carriedForward: fromPaisa(requested - deducted),
        outstandingAfter: fromPaisa(outstanding - deducted),
      });
    }

    return { totalDeduction: fromPaisa(totalDeductedPaisa), breakdown };
  }

  // `period` is part of the signature (per spec) for symmetry with
  // applyRecovery, which stamps its written rows with it. This read-only
  // computation itself only needs "as of now" state -- outstanding balances
  // don't depend on which period is asking.
  async computeAdvanceDeductions(
    membershipId: string,
    _period: { year: number; month: number },
    availableNetPay?: number,
    minimumNetPay = 0,
  ): Promise<DeductionResult> {
    return this.tenantPrisma.run((tx) => this.computeAdvanceDeductionsInTx(tx, membershipId, availableNetPay, minimumNetPay));
  }

  // Commits a DeductionResult (already computed by computeAdvanceDeductionsInTx)
  // as real AdvanceRecovery rows, and recomputes each Advance's
  // recoveredAmount/closedAt from those rows -- never incremented, always
  // the fresh sum, so re-running for the same period (e.g. after a
  // correction, or payroll regenerating a payslip) is safe and idempotent
  // rather than double-counting. Shared by the standalone applyRecovery
  // endpoint and PayrollService.generate, so both commit through the exact
  // same write path.
  private async applyRecoveryInTx(
    tx: Tx,
    membershipId: string,
    period: { year: number; month: number },
    result: DeductionResult,
    actorMembershipId: string,
  ) {
    for (const entry of result.breakdown) {
      if (entry.deducted <= 0) continue;

      await tx.advanceRecovery.upsert({
        where: { advanceId_year_month: { advanceId: entry.advanceId, year: period.year, month: period.month } },
        create: {
          tenantId: this.ctx.tenantId!,
          advanceId: entry.advanceId,
          membershipId,
          year: period.year,
          month: period.month,
          amountRecovered: entry.deducted,
          createdByMembershipId: actorMembershipId,
        },
        update: { amountRecovered: entry.deducted, createdByMembershipId: actorMembershipId },
      });

      const recoveries = await tx.advanceRecovery.findMany({ where: { advanceId: entry.advanceId }, select: { amountRecovered: true } });
      const totalRecoveredPaisa = recoveries.reduce((sum, r) => sum + toPaisa(r.amountRecovered), 0);
      const advance = await tx.advance.findUniqueOrThrow({ where: { id: entry.advanceId } });
      const isClosed = totalRecoveredPaisa >= toPaisa(advance.amount);

      await tx.advance.update({
        where: { id: entry.advanceId },
        data: {
          recoveredAmount: fromPaisa(totalRecoveredPaisa),
          closedAt: isClosed ? (advance.closedAt ?? new Date()) : null,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        tenantId: this.ctx.tenantId!,
        actorUserId: this.ctx.userId,
        action: 'advance_recovery_applied',
        entityType: 'advance_recovery',
        targetUserId: (await tx.tenantMembership.findUnique({ where: { id: membershipId } }))?.userId,
        afterJson: JSON.stringify({ period, totalDeduction: result.totalDeduction }),
      },
    });
  }

  // Standalone endpoint for recording a period's recovery before payroll
  // exists to trigger it, or to re-record after a correction. Uncapped --
  // matching the net-pay preview's own uncapped default when there's no
  // payslip yet to bound it.
  async applyRecovery(membershipId: string, period: { year: number; month: number }) {
    return this.tenantPrisma.run(async (tx) => {
      await this.assertCanAccess(tx, membershipId);
      const actorMembershipId = await this.myMembershipId(tx);
      if (!actorMembershipId) throw new ForbiddenException({ error: 'not_authorized', message: 'No employee record for this account.' });

      const result = await this.computeAdvanceDeductionsInTx(tx, membershipId);
      await this.applyRecoveryInTx(tx, membershipId, period, result, actorMembershipId);
      return result;
    });
  }

  // Called by PayrollService.generate, inside its own transaction, once it
  // has already computed a member's netPay for the period -- commits the
  // exact deduction that was capped against that netPay, so Payslip.netPayable
  // and the Advance/AdvanceRecovery rows can never disagree.
  async applyRecoveryForPayroll(
    tx: Tx,
    membershipId: string,
    period: { year: number; month: number },
    result: DeductionResult,
    generatedByMembershipId: string,
  ) {
    return this.applyRecoveryInTx(tx, membershipId, period, result, generatedByMembershipId);
  }

  // Part 4's net-pay display. Once payroll has actually generated a payslip
  // for this member and period, that payslip is the authoritative source --
  // gross/tax/after-tax/net-payable all come from it, including the
  // advanceRecovery payroll itself already committed. Before a payslip
  // exists, there is nothing honest to show for those but "pending", so
  // only the live (uncapped, or admin-simulated) advance computation is
  // shown.
  async netPayPreview(membershipId: string, period: { year: number; month: number }, availableNetPay?: number) {
    return this.tenantPrisma.run(async (tx) => {
      await this.assertCanAccess(tx, membershipId);

      const payslip = await tx.payslip.findUnique({
        where: { membershipId_year_month: { membershipId, year: period.year, month: period.month } },
      });

      if (payslip) {
        return {
          year: period.year,
          month: period.month,
          grossPay: Number(payslip.grossPay),
          tax: Number(payslip.incomeTax) + Number(payslip.providentFund),
          salaryAfterTax: Number(payslip.netPay),
          previousMonthReceivable: Number(payslip.previousMonthReceivable),
          advanceRecovery: Number(payslip.advanceRecovery),
          breakdown: [],
          netSalaryPayable: Number(payslip.netPayable),
        };
      }

      const deductions = await this.computeAdvanceDeductionsInTx(tx, membershipId, availableNetPay);
      return {
        year: period.year,
        month: period.month,
        grossPay: null,
        tax: null,
        salaryAfterTax: null,
        previousMonthReceivable: null,
        advanceRecovery: deductions.totalDeduction,
        breakdown: deductions.breakdown,
        netSalaryPayable: null,
      };
    });
  }
}
