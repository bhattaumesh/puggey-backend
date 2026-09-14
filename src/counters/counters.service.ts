import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { TenantContextService } from '../common/tenant-context.service';
import { CreateCounterDto } from './dto/create-counter.dto';
import { OpenCounterSessionDto } from './dto/open-session.dto';
import { CloseCounterSessionDto } from './dto/close-session.dto';
import { AddCashMovementDto } from './dto/add-cash-movement.dto';
import { VerifyCounterSessionDto } from './dto/verify-session.dto';
import { EditClosingDetailsDto } from './dto/edit-closing-details.dto';
import { renderCounterReportPdf } from './counter-report-pdf.util';

type Tx = Prisma.TransactionClient;

const SESSION_INCLUDE = {
  counter: true,
  membership: { select: { id: true, user: { select: { fullName: true, email: true } } } },
  assignedBy: { select: { id: true, user: { select: { fullName: true, email: true } } } },
  verifiedBy: { select: { id: true, user: { select: { fullName: true, email: true } } } },
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

  // Assigning a counter (opening a session) is allowed for yourself -- "Assign
  // yourself" -- by any role, or for someone else if you're an admin/supervisor
  // with authority over them. Same authority boundary as shift/rack assignment.
  private async assertCanAssign(tx: Tx, targetMembershipId: string) {
    const myId = await this.myMembershipId(tx);
    if (myId === targetMembershipId) return;
    if (this.ctx.role === 'SUPER_ADMIN') return;
    if (this.ctx.role === 'SUPERVISOR') {
      const subtreeIds = await this.getReportSubtreeIds(tx, myId);
      if (subtreeIds.includes(targetMembershipId)) return;
      throw new ForbiddenException({ error: 'not_authorized', message: 'You can only assign a counter to your own team.' });
    }
    throw new ForbiddenException({ error: 'not_authorized', message: 'You are not allowed to assign counters.' });
  }

  // Working the till itself (logging a movement, closing it out, editing its
  // closing details) is open to the person actually handling it, plus
  // whoever could have assigned it in the first place.
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

  // Viewing a report is looser than handling: a closed session's report is
  // readable by anyone on the tenant, since peer verification requires
  // being able to see the figures before signing off on them. An open
  // session's running total stays as handle-restricted as before.
  private async assertCanView(tx: Tx, session: { membershipId: string; status: string }) {
    if (session.status === 'closed') return;
    await this.assertCanHandle(tx, session.membershipId);
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

  // "Who is assigned to the counter" -- every counter, paired with whoever
  // currently has it open (if anyone), for an at-a-glance overview.
  async overview() {
    return this.tenantPrisma.run(async (tx) => {
      const counters = await tx.counter.findMany({ orderBy: { name: 'asc' } });
      const openSessions = await tx.counterSession.findMany({
        where: { status: 'open' },
        include: { membership: { select: { id: true, user: { select: { fullName: true, email: true } } } } },
      });
      const byCounter = new Map(openSessions.map((s) => [s.counterId, s]));
      return counters.map((counter) => ({ counter, activeSession: byCounter.get(counter.id) ?? null }));
    });
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
          previousSale: dto.previousSale,
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

  // Tenant-wide "who recently staffed a counter" history, most recently
  // closed first -- the counterpart to overview()'s "who's on a counter right
  // now". Same permissiveness as overview() (any authenticated tenant member
  // can see it); the frontend only surfaces it in the admin view.
  async recentSessions(limit: number) {
    return this.tenantPrisma.run((tx) =>
      tx.counterSession.findMany({
        where: { status: 'closed' },
        orderBy: { closedAt: 'desc' },
        take: Math.min(Math.max(limit, 1), 100),
        include: SESSION_INCLUDE,
      }),
    );
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
        data: {
          status: 'closed',
          closingCash,
          closingDenominations: dto.closingDenominations,
          closingSale: dto.closingSale,
          closedAt: new Date(),
        },
        include: SESSION_INCLUDE,
      });
    });
  }

  // Corrects a mistyped closing count/sale after the fact -- same authority
  // as closing it in the first place. Locked out once a peer has verified
  // the session, so a verified report can't quietly change underneath the
  // verification.
  async editClosingDetails(sessionId: string, dto: EditClosingDetailsDto) {
    return this.tenantPrisma.run(async (tx) => {
      const session = await tx.counterSession.findUnique({ where: { id: sessionId } });
      if (!session) throw new NotFoundException({ error: 'not_found', message: 'No such counter session.' });
      if (session.status !== 'closed') throw new BadRequestException({ error: 'session_open', message: 'This counter session is not closed yet.' });
      if (session.verifiedAt) throw new BadRequestException({ error: 'already_verified', message: 'This session has already been verified and can no longer be edited.' });
      await this.assertCanHandle(tx, session.membershipId);
      const closingCash = this.validateDenominations(dto.closingDenominations);

      return tx.counterSession.update({
        where: { id: sessionId },
        data: { closingCash, closingDenominations: dto.closingDenominations, closingSale: dto.closingSale },
        include: SESSION_INCLUDE,
      });
    });
  }

  // Peer verification: any tenant member other than whoever handled the
  // till can double-check a closed session and mark it verified, optionally
  // scoring the work done -- mirrors RacksService.rateCleaning's "the rater
  // is never the doer" rule, but open to any employee rather than just
  // supervisors/admins, per how this tenant wants tills cross-checked.
  async verifySession(sessionId: string, dto: VerifyCounterSessionDto) {
    return this.tenantPrisma.run(async (tx) => {
      const session = await tx.counterSession.findUnique({ where: { id: sessionId } });
      if (!session) throw new NotFoundException({ error: 'not_found', message: 'No such counter session.' });
      if (session.status !== 'closed') throw new BadRequestException({ error: 'session_open', message: 'This counter session is not closed yet.' });
      if (session.verifiedAt) throw new ConflictException({ error: 'already_verified', message: 'This session has already been verified.' });
      const myId = await this.myMembershipId(tx);
      if (myId === session.membershipId) {
        throw new ForbiddenException({ error: 'not_authorized', message: 'You cannot verify your own counter session.' });
      }

      return tx.counterSession.update({
        where: { id: sessionId },
        data: {
          verifiedByMembershipId: myId,
          verifiedAt: new Date(),
          workRating: dto.workRating ?? null,
          verificationRemarks: dto.remarks ?? null,
        },
        include: SESSION_INCLUDE,
      });
    });
  }

  // Reconciles opening cash + inflow + sales - outflow (expected) against what
  // was actually counted at close (actual) -- the whole point of tracking
  // denominations in the first place. Available before close too, so
  // whoever's handling the till can sanity-check as they go.
  async report(sessionId: string) {
    return this.tenantPrisma.run(async (tx) => {
      const session = await tx.counterSession.findUnique({ where: { id: sessionId }, include: { ...SESSION_INCLUDE, movements: true } });
      if (!session) throw new NotFoundException({ error: 'not_found', message: 'No such counter session.' });
      await this.assertCanView(tx, session);
      return this.buildReport(session);
    });
  }

  // Total sales for the shift is the difference between the running
  // sales-counter readings taken at open and close (previousSale/closingSale).
  // Older sessions predating those two columns fall back to summing ad-hoc
  // "sales" cash movements, the previous way sales were tracked.
  private buildReport(session: Prisma.CounterSessionGetPayload<{ include: typeof SESSION_INCLUDE & { movements: true } }>) {
    const totalInflow = session.movements.filter((m) => m.type === 'inflow').reduce((sum, m) => sum + Number(m.amount), 0);
    const totalOutflow = session.movements.filter((m) => m.type === 'outflow').reduce((sum, m) => sum + Number(m.amount), 0);
    const previousSale = session.previousSale != null ? Number(session.previousSale) : null;
    const closingSale = session.closingSale != null ? Number(session.closingSale) : null;
    const totalSalesFromMovements = session.movements.filter((m) => m.type === 'sales').reduce((sum, m) => sum + Number(m.amount), 0);
    const totalSales = previousSale != null && closingSale != null ? closingSale - previousSale : totalSalesFromMovements;
    const openingCash = Number(session.openingCash);
    const expectedClosing = openingCash + totalInflow + totalSales - totalOutflow;
    const actualClosing = session.closingCash != null ? Number(session.closingCash) : null;
    const variance = actualClosing != null ? actualClosing - expectedClosing : null;
    const varianceStatus: 'low' | 'high' | 'exact' | null = variance == null ? null : variance < 0 ? 'low' : variance > 0 ? 'high' : 'exact';
    const verificationStatus: 'pending' | 'verified' | null = session.status !== 'closed' ? null : session.verifiedAt ? 'verified' : 'pending';

    return {
      session,
      openingCash,
      previousSale,
      closingSale,
      totalInflow,
      totalOutflow,
      totalSales,
      expectedClosing,
      actualClosing,
      variance,
      varianceStatus,
      verificationStatus,
    };
  }

  async getReportPdf(sessionId: string): Promise<Buffer> {
    const { report, tenant } = await this.tenantPrisma.run(async (tx) => {
      const session = await tx.counterSession.findUnique({ where: { id: sessionId }, include: { ...SESSION_INCLUDE, movements: true } });
      if (!session) throw new NotFoundException({ error: 'not_found', message: 'No such counter session.' });
      await this.assertCanView(tx, session);
      const tenantRow = await tx.tenant.findUnique({ where: { id: this.ctx.tenantId! } });
      return { report: this.buildReport(session), tenant: tenantRow };
    });

    return renderCounterReportPdf({
      tenantName: tenant?.name ?? 'Puggey',
      counterName: report.session.counter.name,
      employeeName: report.session.membership.user.fullName || report.session.membership.user.email,
      assignedByName: report.session.assignedBy.user.fullName || report.session.assignedBy.user.email,
      openedAt: report.session.openedAt,
      closedAt: report.session.closedAt,
      openingCash: report.openingCash,
      openingDenominations: report.session.openingDenominations as Record<string, number>,
      previousSale: report.previousSale,
      closingCash: report.actualClosing,
      closingDenominations: report.session.closingDenominations as Record<string, number> | null,
      closingSale: report.closingSale,
      totalInflow: report.totalInflow,
      totalOutflow: report.totalOutflow,
      totalSales: report.totalSales,
      expectedClosing: report.expectedClosing,
      variance: report.variance,
      movements: report.session.movements.map((m) => ({ type: m.type, amount: Number(m.amount), reason: m.reason, createdAt: m.createdAt })),
      verificationStatus: report.verificationStatus,
      verifiedByName: report.session.verifiedBy ? report.session.verifiedBy.user.fullName || report.session.verifiedBy.user.email : null,
      verifiedAt: report.session.verifiedAt,
      workRating: report.session.workRating,
      verificationRemarks: report.session.verificationRemarks,
      generatedAt: new Date(),
    });
  }
}
