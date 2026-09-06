import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { TenantContextService } from '../common/tenant-context.service';
import { CreateCounterDto } from './dto/create-counter.dto';
import { OpenCounterSessionDto } from './dto/open-session.dto';
import { CloseCounterSessionDto } from './dto/close-session.dto';
import { AddCashMovementDto } from './dto/add-cash-movement.dto';

type Tx = Prisma.TransactionClient;

const SESSION_INCLUDE = {
  counter: true,
  membership: { select: { id: true, user: { select: { fullName: true, email: true } } } },
  assignedBy: { select: { id: true, user: { select: { fullName: true, email: true } } } },
} satisfies Prisma.CounterSessionInclude;

// Standard Nepali Rupee note/coin values -- the frontend uses this same list
// to render the denomination entry grid, but the source of truth for what
// counts as a valid key lives here since this is what actually gets trusted.
export const NPR_DENOMINATIONS = [1000, 500, 100, 50, 20, 10, 5, 2, 1];

@Injectable()
export class CountersService {
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

  private async getReportSubtreeIds(tx: Tx, rootId: string): Promise<string[]> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE subtree AS (
        SELECT id FROM tenant_memberships WHERE id = ${rootId}
        UNION ALL
        SELECT tm.id FROM tenant_memberships tm
        INNER JOIN subtree s ON tm."supervisorMembershipId" = s.id
      )
      SELECT id FROM subtree WHERE id != ${rootId}
    `;
    return rows.map((r) => r.id);
  }

  // Assigning a counter (opening a session for someone else) follows the
  // same authority boundary as shift assignment and rack assignment.
  private async assertCanAssign(tx: Tx, targetMembershipId: string) {
    if (this.ctx.role === 'SUPER_ADMIN') return;
    if (this.ctx.role === 'SUPERVISOR') {
      const myId = await this.myMembershipId(tx);
      const subtreeIds = await this.getReportSubtreeIds(tx, myId);
      if (subtreeIds.includes(targetMembershipId)) return;
      throw new ForbiddenException({ error: 'not_authorized', message: 'You can only assign a counter to your own team.' });
    }
    throw new ForbiddenException({ error: 'not_authorized', message: 'You are not allowed to assign counters.' });
  }

  // Working the till itself (logging a movement, closing it out, viewing its
  // report) is open to the person actually handling it, plus whoever could
  // have assigned it in the first place.
  private async assertCanHandle(tx: Tx, sessionMembershipId: string) {
    const myId = await this.myMembershipId(tx);
    if (myId === sessionMembershipId) return;
    if (this.ctx.role === 'SUPER_ADMIN') return;
    if (this.ctx.role === 'SUPERVISOR') {
      const subtreeIds = await this.getReportSubtreeIds(tx, myId);
      if (subtreeIds.includes(sessionMembershipId)) return;
    }
    throw new ForbiddenException({ error: 'not_authorized', message: 'You do not have access to this counter session.' });
  }

  // Trusts nothing about the shape of the incoming map: every key must be a
  // known denomination, every value a non-negative integer count.
  private validateDenominations(denominations: Record<string, number>): number {
    let total = 0;
    for (const [key, count] of Object.entries(denominations)) {
      const value = Number(key);
      if (!NPR_DENOMINATIONS.includes(value)) {
        throw new BadRequestException({ error: 'invalid_denomination', message: `${key} is not a recognised note/coin value.` });
      }
      if (!Number.isInteger(count) || count < 0) {
        throw new BadRequestException({ error: 'invalid_denomination', message: `Count for ${key} must be a non-negative whole number.` });
      }
      total += value * count;
    }
    return total;
  }

  createCounter(dto: CreateCounterDto) {
    return this.tenantPrisma.run(async (tx) => {
      const existing = await tx.counter.findFirst({ where: { name: dto.name } });
      if (existing) throw new ConflictException({ error: 'counter_exists', message: 'A counter with that name already exists.' });
      return tx.counter.create({ data: { tenantId: this.ctx.tenantId!, name: dto.name } });
    });
  }

  listCounters() {
    return this.tenantPrisma.run((tx) => tx.counter.findMany({ orderBy: { name: 'asc' } }));
  }

  async openSession(dto: OpenCounterSessionDto) {
    return this.tenantPrisma.run(async (tx) => {
      await this.assertCanAssign(tx, dto.membershipId);
      const existing = await tx.counterSession.findFirst({ where: { membershipId: dto.membershipId, status: 'open' } });
      if (existing) throw new ConflictException({ error: 'session_open', message: 'This employee already has an open counter session.' });
      const counter = await tx.counter.findUnique({ where: { id: dto.counterId } });
      if (!counter) throw new NotFoundException({ error: 'not_found', message: 'No such counter.' });
      const member = await tx.tenantMembership.findUnique({ where: { id: dto.membershipId } });
      if (!member) throw new NotFoundException({ error: 'not_found', message: 'No such employee.' });
      const openingCash = this.validateDenominations(dto.openingDenominations);
      const assignedByMembershipId = await this.myMembershipId(tx);

      return tx.counterSession.create({
        data: {
          tenantId: this.ctx.tenantId!,
          counterId: dto.counterId,
          membershipId: dto.membershipId,
          assignedByMembershipId,
          openingCash,
          openingDenominations: dto.openingDenominations,
        },
        include: SESSION_INCLUDE,
      });
    });
  }

  async myActiveSession() {
    return this.tenantPrisma.run(async (tx) => {
      const myId = await this.myMembershipId(tx);
      return tx.counterSession.findFirst({ where: { membershipId: myId, status: 'open' }, include: { ...SESSION_INCLUDE, movements: true } });
    });
  }

  async sessionsForMembership(membershipId: string) {
    return this.tenantPrisma.run(async (tx) => {
      await this.assertCanHandle(tx, membershipId);
      return tx.counterSession.findMany({
        where: { membershipId },
        orderBy: { openedAt: 'desc' },
        include: { ...SESSION_INCLUDE, movements: true },
      });
    });
  }

  async addMovement(sessionId: string, dto: AddCashMovementDto) {
    return this.tenantPrisma.run(async (tx) => {
      const session = await tx.counterSession.findUnique({ where: { id: sessionId } });
      if (!session) throw new NotFoundException({ error: 'not_found', message: 'No such counter session.' });
      if (session.status !== 'open') throw new BadRequestException({ error: 'session_closed', message: 'This counter session is already closed.' });
      await this.assertCanHandle(tx, session.membershipId);
      const membershipId = await this.myMembershipId(tx);

      await tx.counterCashMovement.create({
        data: {
          tenantId: this.ctx.tenantId!,
          counterSessionId: sessionId,
          type: dto.type,
          amount: dto.amount,
          reason: dto.reason,
          membershipId,
        },
      });
      return tx.counterSession.findUnique({ where: { id: sessionId }, include: { ...SESSION_INCLUDE, movements: true } });
    });
  }

  async closeSession(sessionId: string, dto: CloseCounterSessionDto) {
    return this.tenantPrisma.run(async (tx) => {
      const session = await tx.counterSession.findUnique({ where: { id: sessionId } });
      if (!session) throw new NotFoundException({ error: 'not_found', message: 'No such counter session.' });
      if (session.status !== 'open') throw new BadRequestException({ error: 'session_closed', message: 'This counter session is already closed.' });
      await this.assertCanHandle(tx, session.membershipId);
      const closingCash = this.validateDenominations(dto.closingDenominations);

      return tx.counterSession.update({
        where: { id: sessionId },
        data: { status: 'closed', closingCash, closingDenominations: dto.closingDenominations, closedAt: new Date() },
        include: SESSION_INCLUDE,
      });
    });
  }

  // Reconciles opening cash + inflow - outflow (expected) against what was
  // actually counted at close (actual) -- the whole point of tracking
  // denominations in the first place. Available before close too, so
  // whoever's handling the till can sanity-check as they go.
  async report(sessionId: string) {
    return this.tenantPrisma.run(async (tx) => {
      const session = await tx.counterSession.findUnique({ where: { id: sessionId }, include: { ...SESSION_INCLUDE, movements: true } });
      if (!session) throw new NotFoundException({ error: 'not_found', message: 'No such counter session.' });
      await this.assertCanHandle(tx, session.membershipId);

      const totalInflow = session.movements.filter((m) => m.type === 'inflow').reduce((sum, m) => sum + Number(m.amount), 0);
      const totalOutflow = session.movements.filter((m) => m.type === 'outflow').reduce((sum, m) => sum + Number(m.amount), 0);
      const openingCash = Number(session.openingCash);
      const expectedClosing = openingCash + totalInflow - totalOutflow;
      const actualClosing = session.closingCash != null ? Number(session.closingCash) : null;
      const variance = actualClosing != null ? actualClosing - expectedClosing : null;

      return {
        session,
        openingCash,
        totalInflow,
        totalOutflow,
        expectedClosing,
        actualClosing,
        variance,
      };
    });
  }
}
