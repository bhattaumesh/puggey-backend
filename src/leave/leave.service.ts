import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { TenantContextService } from '../common/tenant-context.service';
import { runInTenantContext } from '../prisma/rls.util';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateLeaveTypeDto } from './dto/create-leave-type.dto';
import { SubmitLeaveRequestDto } from './dto/submit-leave-request.dto';
import { DecideLeaveRequestDto } from './dto/decide-leave-request.dto';
import { CreateDelegationDto } from './dto/create-delegation.dto';
import { UpdateDelegationDto } from './dto/update-delegation.dto';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class LeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly ctx: TenantContextService,
  ) {}

  private async myMembershipId(tx: Prisma.TransactionClient): Promise<string> {
    const userId = this.ctx.userId;
    const tenantId = this.ctx.tenantId;
    if (!userId || !tenantId) throw new NotFoundException({ error: 'not_found', message: 'No employee record for this account.' });
    const membership = await tx.tenantMembership.findUnique({ where: { tenantId_userId: { tenantId, userId } }, select: { id: true } });
    if (!membership) throw new NotFoundException({ error: 'not_found', message: 'No employee record for this account.' });
    return membership.id;
  }

  private async isOnApprovedLeaveToday(tx: Prisma.TransactionClient, membershipId: string): Promise<boolean> {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const count = await tx.leaveRequest.count({
      where: { membershipId, status: 'approved', startDate: { lte: today }, endDate: { gte: today } },
    });
    return count > 0;
  }

  // The approval chain is just the org hierarchy: a request goes to the
  // requester's direct supervisor. If that supervisor is themselves on approved
  // leave today, it goes to their designated stand-in (if any), otherwise it
  // escalates to the next supervisor up. Returns null if the chain runs out
  // (no supervisor set anywhere above the requester) -- callers should treat
  // that as "only Super Admin can decide this one."
  private async resolveApprover(tx: Prisma.TransactionClient, requesterMembershipId: string): Promise<string | null> {
    const visited = new Set<string>([requesterMembershipId]);
    let current = await tx.tenantMembership.findUnique({
      where: { id: requesterMembershipId },
      select: { supervisorMembershipId: true },
    });

    while (current?.supervisorMembershipId && !visited.has(current.supervisorMembershipId)) {
      const supervisorId = current.supervisorMembershipId;
      visited.add(supervisorId);

      const onLeave = await this.isOnApprovedLeaveToday(tx, supervisorId);
      if (onLeave) {
        const delegation = await tx.approvalDelegation.findFirst({
          where: { tenantId: this.ctx.tenantId!, delegatorMembershipId: supervisorId, active: true },
        });
        if (delegation) return delegation.delegateMembershipId;
        // no stand-in configured -- keep escalating up the chain
      } else {
        return supervisorId;
      }

      current = await tx.tenantMembership.findUnique({ where: { id: supervisorId }, select: { supervisorMembershipId: true } });
    }
    return null;
  }

  private async ensureBalance(tx: Prisma.TransactionClient, membershipId: string, leaveTypeId: string, year: number, defaultDays: number) {
    const existing = await tx.leaveBalance.findUnique({ where: { membershipId_leaveTypeId_year: { membershipId, leaveTypeId, year } } });
    if (existing) return existing;
    return tx.leaveBalance.create({ data: { tenantId: this.ctx.tenantId!, membershipId, leaveTypeId, year, allocated: defaultDays, used: 0 } });
  }

  listTypes() {
    return this.tenantPrisma.run((tx) => tx.leaveType.findMany({ where: { tenantId: this.ctx.tenantId! }, orderBy: { name: 'asc' } }));
  }

  createType(dto: CreateLeaveTypeDto) {
    return this.tenantPrisma.run(async (tx) => {
      const existing = await tx.leaveType.findFirst({ where: { tenantId: this.ctx.tenantId!, name: dto.name } });
      if (existing) throw new ConflictException({ error: 'leave_type_exists', message: 'That leave type already exists.' });
      return tx.leaveType.create({ data: { tenantId: this.ctx.tenantId!, name: dto.name, defaultDaysPerYear: dto.defaultDaysPerYear } });
    });
  }

  myBalances(year?: number) {
    const y = year ?? new Date().getUTCFullYear();
    return this.tenantPrisma.run(async (tx) => {
      const membershipId = await this.myMembershipId(tx);
      const types = await tx.leaveType.findMany({ where: { tenantId: this.ctx.tenantId! }, orderBy: { name: 'asc' } });
      const balances = await Promise.all(types.map((t) => this.ensureBalance(tx, membershipId, t.id, y, t.defaultDaysPerYear)));
      return types.map((t, i) => ({
        leaveTypeId: t.id,
        leaveTypeName: t.name,
        year: y,
        allocated: balances[i].allocated,
        used: balances[i].used,
        remaining: balances[i].allocated - balances[i].used,
      }));
    });
  }

  myRequests() {
    return this.tenantPrisma.run(async (tx) => {
      const membershipId = await this.myMembershipId(tx);
      return tx.leaveRequest.findMany({ where: { membershipId }, include: { leaveType: true }, orderBy: { createdAt: 'desc' } });
    });
  }

  async submitRequest(dto: SubmitLeaveRequestDto) {
    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    if (end < start) throw new BadRequestException({ error: 'invalid_range', message: 'End date must be on or after the start date.' });
    const days = Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;

    const result = await this.tenantPrisma.run(async (tx) => {
      const membershipId = await this.myMembershipId(tx);
      const leaveType = await tx.leaveType.findUnique({ where: { id: dto.leaveTypeId } });
      if (!leaveType || leaveType.tenantId !== this.ctx.tenantId) {
        throw new NotFoundException({ error: 'not_found', message: 'No such leave type.' });
      }

      const year = start.getUTCFullYear();
      const balance = await this.ensureBalance(tx, membershipId, dto.leaveTypeId, year, leaveType.defaultDaysPerYear);
      if (balance.allocated - balance.used < days) {
        throw new BadRequestException({
          error: 'insufficient_balance',
          message: `Not enough ${leaveType.name} balance left (${balance.allocated - balance.used} day(s) remaining).`,
        });
      }

      const request = await tx.leaveRequest.create({
        data: { tenantId: this.ctx.tenantId!, membershipId, leaveTypeId: dto.leaveTypeId, startDate: start, endDate: end, days, reason: dto.reason },
        include: { leaveType: true },
      });

      const approverId = await this.resolveApprover(tx, membershipId);
      let approverUserIds: string[] = [];
      if (approverId) {
        const approver = await tx.tenantMembership.findUnique({ where: { id: approverId } });
        if (approver) approverUserIds = [approver.userId];
      } else {
        const admins = await tx.tenantMembership.findMany({ where: { tenantId: this.ctx.tenantId!, role: 'SUPER_ADMIN', status: 'active' } });
        approverUserIds = admins.map((a) => a.userId);
      }

      const requester = await tx.user.findUnique({ where: { id: this.ctx.userId! } });
      return { request, approverUserIds, requesterName: requester?.fullName || requester?.email || 'An employee' };
    });

    // Notification recipients here are always someone other than the caller, so
    // this must be a separate follow-up write under the platform-bypass context
    // -- same reasoning as AttendanceService.correct().
    await runInTenantContext(this.prisma, { isPugeyStaff: true }, async (tx) => {
      for (const userId of result.approverUserIds) {
        await NotificationsService.create(tx, {
          tenantId: this.ctx.tenantId!,
          userId,
          type: 'leave_request_submitted',
          message: `${result.requesterName} requested ${result.request.days} day(s) of ${result.request.leaveType.name} leave and needs your decision.`,
        });
      }
    });

    return result.request;
  }

  async cancelRequest(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const membershipId = await this.myMembershipId(tx);
      const request = await tx.leaveRequest.findUnique({ where: { id } });
      if (!request || request.membershipId !== membershipId) throw new NotFoundException({ error: 'not_found', message: 'No such request.' });
      if (request.status !== 'pending') throw new BadRequestException({ error: 'not_pending', message: 'Only pending requests can be cancelled.' });
      return tx.leaveRequest.update({ where: { id }, data: { status: 'cancelled' } });
    });
  }

  pendingApprovals() {
    return this.tenantPrisma.run(async (tx) => {
      const myId = await this.myMembershipId(tx);
      const myRole = this.ctx.role ?? 'EMPLOYEE';
      const pending = await tx.leaveRequest.findMany({
        where: { tenantId: this.ctx.tenantId!, status: 'pending' },
        include: { leaveType: true, membership: { include: { user: { select: { fullName: true, email: true } } } } },
        orderBy: { createdAt: 'asc' },
      });
      if (myRole === 'SUPER_ADMIN') return pending;

      const mine: typeof pending = [];
      for (const request of pending) {
        const approverId = await this.resolveApprover(tx, request.membershipId);
        if (approverId === myId) mine.push(request);
      }
      return mine;
    });
  }

  async decide(requestId: string, dto: DecideLeaveRequestDto) {
    const myRole = this.ctx.role ?? 'EMPLOYEE';
    const result = await this.tenantPrisma.run(async (tx) => {
      const request = await tx.leaveRequest.findUnique({ where: { id: requestId } });
      if (!request) throw new NotFoundException({ error: 'not_found', message: 'No such request.' });
      if (request.status !== 'pending') throw new BadRequestException({ error: 'already_decided', message: 'This request has already been decided.' });

      const myId = await this.myMembershipId(tx);
      if (myRole !== 'SUPER_ADMIN') {
        const approverId = await this.resolveApprover(tx, request.membershipId);
        if (approverId !== myId) throw new ForbiddenException({ error: 'not_authorized', message: 'You are not the approver for this request.' });
      }

      await tx.leaveApprovalAction.create({
        data: { tenantId: this.ctx.tenantId!, leaveRequestId: requestId, approverMembershipId: myId, decision: dto.decision, reason: dto.reason },
      });

      const updated = await tx.leaveRequest.update({ where: { id: requestId }, data: { status: dto.decision } });

      if (dto.decision === 'approved') {
        await tx.leaveBalance.update({
          where: { membershipId_leaveTypeId_year: { membershipId: request.membershipId, leaveTypeId: request.leaveTypeId, year: request.startDate.getUTCFullYear() } },
          data: { used: { increment: request.days } },
        });
      }

      const requester = await tx.tenantMembership.findUnique({ where: { id: request.membershipId } });
      return { updated, requesterUserId: requester!.userId };
    });

    await runInTenantContext(this.prisma, { isPugeyStaff: true }, (tx) =>
      NotificationsService.create(tx, {
        tenantId: this.ctx.tenantId!,
        userId: result.requesterUserId,
        type: 'leave_decision',
        message: `Your leave request was ${dto.decision}${dto.reason ? `: ${dto.reason}` : '.'}`,
      }),
    );

    return result.updated;
  }

  listDelegations() {
    return this.tenantPrisma.run((tx) =>
      tx.approvalDelegation.findMany({
        where: { tenantId: this.ctx.tenantId! },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  createDelegation(dto: CreateDelegationDto) {
    if (dto.delegatorMembershipId === dto.delegateMembershipId) {
      throw new BadRequestException({ error: 'self_delegation', message: 'A supervisor cannot be their own stand-in.' });
    }
    return this.tenantPrisma.run(async (tx) => {
      const [delegator, delegate] = await Promise.all([
        tx.tenantMembership.findUnique({ where: { id: dto.delegatorMembershipId } }),
        tx.tenantMembership.findUnique({ where: { id: dto.delegateMembershipId } }),
      ]);
      if (!delegator || !delegate) throw new NotFoundException({ error: 'not_found', message: 'No such employee.' });

      const existing = await tx.approvalDelegation.findUnique({
        where: { delegatorMembershipId_delegateMembershipId: { delegatorMembershipId: dto.delegatorMembershipId, delegateMembershipId: dto.delegateMembershipId } },
      });
      if (existing) throw new ConflictException({ error: 'delegation_exists', message: 'That delegation already exists.' });

      const createdByMembershipId = await this.myMembershipId(tx);
      return tx.approvalDelegation.create({
        data: {
          tenantId: this.ctx.tenantId!,
          delegatorMembershipId: dto.delegatorMembershipId,
          delegateMembershipId: dto.delegateMembershipId,
          createdByMembershipId,
        },
      });
    });
  }

  updateDelegation(id: string, dto: UpdateDelegationDto) {
    return this.tenantPrisma.run(async (tx) => {
      const existing = await tx.approvalDelegation.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException({ error: 'not_found', message: 'No such delegation.' });
      return tx.approvalDelegation.update({ where: { id }, data: { active: dto.active } });
    });
  }
}
