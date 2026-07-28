import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { TenantContextService } from '../common/tenant-context.service';
import { runInTenantContext } from '../prisma/rls.util';
import { NotificationsService } from '../notifications/notifications.service';
import { AdvancesService } from './advances.service';
import { SubmitAdvanceRequestDto } from './dto/submit-advance-request.dto';
import { DecideAdvanceRequestDto } from './dto/decide-advance-request.dto';

// Employee-initiated counterpart to AdvancesService: any staff member can ask
// for an advance, Super Admin approves or rejects it. Simpler than leave's
// approval chain -- no supervisor hierarchy or delegation, since advances are
// money the tenant's own admin must personally sign off on, not something a
// line manager should be able to approve on the admin's behalf.
@Injectable()
export class AdvanceRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly ctx: TenantContextService,
    private readonly advances: AdvancesService,
  ) {}

  private async myMembershipId(tx: Prisma.TransactionClient): Promise<string> {
    const userId = this.ctx.userId;
    const tenantId = this.ctx.tenantId;
    if (!userId || !tenantId) throw new NotFoundException({ error: 'not_found', message: 'No employee record for this account.' });
    const membership = await tx.tenantMembership.findUnique({ where: { tenantId_userId: { tenantId, userId } }, select: { id: true } });
    if (!membership) throw new NotFoundException({ error: 'not_found', message: 'No employee record for this account.' });
    return membership.id;
  }

  myRequests() {
    return this.tenantPrisma.run(async (tx) => {
      const membershipId = await this.myMembershipId(tx);
      return tx.advanceRequest.findMany({ where: { membershipId }, include: { category: true }, orderBy: { createdAt: 'desc' } });
    });
  }

  async submitRequest(dto: SubmitAdvanceRequestDto) {
    const result = await this.tenantPrisma.run(async (tx) => {
      const membershipId = await this.myMembershipId(tx);

      const category = await tx.advanceCategory.findUnique({ where: { id: dto.categoryId } });
      if (!category || category.deletedAt) throw new NotFoundException({ error: 'not_found', message: 'No such category.' });

      if (dto.recoveryMode === 'INSTALMENT' && !dto.instalmentAmount) {
        throw new BadRequestException({ error: 'instalment_amount_required', message: 'Set an instalment amount for instalment recovery.' });
      }

      const request = await tx.advanceRequest.create({
        data: {
          tenantId: this.ctx.tenantId!,
          membershipId,
          categoryId: dto.categoryId,
          amount: dto.amount,
          reason: dto.reason,
          recoveryMode: dto.recoveryMode,
          instalmentAmount: dto.recoveryMode === 'INSTALMENT' ? dto.instalmentAmount : null,
        },
        include: { category: true },
      });

      const admins = await tx.tenantMembership.findMany({ where: { tenantId: this.ctx.tenantId!, role: 'SUPER_ADMIN', status: 'active' } });
      const requester = await tx.user.findUnique({ where: { id: this.ctx.userId! } });
      return { request, adminUserIds: admins.map((a) => a.userId), requesterName: requester?.fullName || requester?.email || 'An employee' };
    });

    // Notification recipients are always someone other than the caller, so
    // this runs as a follow-up write under the platform-bypass context --
    // same reasoning as LeaveService.submitRequest.
    await runInTenantContext(this.prisma, { isPugeyStaff: true }, async (tx) => {
      for (const userId of result.adminUserIds) {
        await NotificationsService.create(tx, {
          tenantId: this.ctx.tenantId!,
          userId,
          type: 'advance_request_submitted',
          message: `${result.requesterName} requested an advance of ${Number(result.request.amount).toLocaleString()} (${result.request.category.name}) and needs your decision.`,
        });
      }
    });

    return result.request;
  }

  async cancelRequest(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const membershipId = await this.myMembershipId(tx);
      const request = await tx.advanceRequest.findUnique({ where: { id } });
      if (!request || request.membershipId !== membershipId) throw new NotFoundException({ error: 'not_found', message: 'No such request.' });
      if (request.status !== 'pending') throw new BadRequestException({ error: 'not_pending', message: 'Only pending requests can be cancelled.' });
      return tx.advanceRequest.update({ where: { id }, data: { status: 'cancelled' } });
    });
  }

  pendingApprovals() {
    return this.tenantPrisma.run((tx) =>
      tx.advanceRequest.findMany({
        where: { tenantId: this.ctx.tenantId!, status: 'pending' },
        include: { category: true, membership: { include: { user: { select: { fullName: true, email: true } } } } },
        orderBy: { createdAt: 'asc' },
      }),
    );
  }

  async decide(requestId: string, dto: DecideAdvanceRequestDto) {
    const result = await this.tenantPrisma.run(async (tx) => {
      const request = await tx.advanceRequest.findUnique({ where: { id: requestId } });
      if (!request) throw new NotFoundException({ error: 'not_found', message: 'No such request.' });
      if (request.status !== 'pending') throw new BadRequestException({ error: 'already_decided', message: 'This request has already been decided.' });

      const decidedByMembershipId = await this.myMembershipId(tx);

      let createdAdvanceId: string | null = null;
      if (dto.decision === 'approved') {
        const advance = await this.advances.createInTx(tx, {
          membershipId: request.membershipId,
          categoryId: request.categoryId,
          amount: Number(request.amount),
          dateGiven: new Date().toISOString(),
          reason: request.reason ?? undefined,
          recoveryMode: request.recoveryMode,
          instalmentAmount: request.instalmentAmount != null ? Number(request.instalmentAmount) : undefined,
        });
        createdAdvanceId = advance.id;
      }

      const updated = await tx.advanceRequest.update({
        where: { id: requestId },
        data: { status: dto.decision, decidedByMembershipId, decisionReason: dto.reason, createdAdvanceId },
      });

      const requester = await tx.tenantMembership.findUnique({ where: { id: request.membershipId } });
      return { updated, requesterUserId: requester!.userId };
    });

    await runInTenantContext(this.prisma, { isPugeyStaff: true }, (tx) =>
      NotificationsService.create(tx, {
        tenantId: this.ctx.tenantId!,
        userId: result.requesterUserId,
        type: 'advance_request_decision',
        message: `Your advance request was ${dto.decision}${dto.reason ? `: ${dto.reason}` : '.'}`,
      }),
    );

    return result.updated;
  }
}
