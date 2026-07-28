import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { TenantContextService } from '../common/tenant-context.service';
import { myTeamScope } from '../permissions/permissions';

// Same fixed offset as AttendanceService -- Nepal has no DST, so a business
// "day" is UTC+5:45 everywhere in this app. Duplicated here rather than
// imported, matching the existing convention (each service that needs this
// keeps its own copy; see also AttendanceService/EmployeesService's own
// small private helpers).
const NEPAL_OFFSET_MINUTES = 345;

function nepalDateKey(date: Date): string {
  return new Date(date.getTime() + NEPAL_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

// [start, end) UTC instants covering the current Nepal calendar day, plus
// that day expressed as a UTC-midnight Date for comparing against
// LeaveRequest's date-only startDate/endDate columns (same representation
// LeaveService already stores those in).
function nepalToday(): { start: Date; end: Date; dateOnly: Date; key: string } {
  const now = new Date();
  const key = nepalDateKey(now);
  const start = new Date(Date.parse(`${key}T00:00:00.000Z`) - NEPAL_OFFSET_MINUTES * 60_000);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const dateOnly = new Date(`${key}T00:00:00.000Z`);
  return { start, end, dateOnly, key };
}

export type DashboardMetric = 'present' | 'absent' | 'active' | 'onLeave';

export interface MemberLite {
  id: string;
  fullName: string | null;
  email: string;
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly ctx: TenantContextService,
  ) {}

  private async myMembershipId(tx: Prisma.TransactionClient): Promise<string | null> {
    const userId = this.ctx.userId;
    const tenantId = this.ctx.tenantId;
    if (!userId || !tenantId) return null;
    const membership = await tx.tenantMembership.findUnique({ where: { tenantId_userId: { tenantId, userId } }, select: { id: true } });
    return membership?.id ?? null;
  }

  // Same recursive-CTE subtree resolution used by My Team / attendance
  // history -- duplicated per-service in this codebase rather than shared,
  // so this follows that existing convention rather than introducing a new
  // shared utility module.
  private async getReportSubtreeIds(tx: Prisma.TransactionClient, rootId: string): Promise<string[]> {
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

  // null = no scoping filter needed (Admin/CEO see the whole tenant, which
  // RLS already confines to their own tenant). A Supervisor's scope is their
  // subtree only, same population My Team shows them -- never including
  // themselves, matching getReportSubtreeIds' own exclusion.
  private async resolveScope(tx: Prisma.TransactionClient): Promise<string[] | null> {
    const scope = myTeamScope(this.ctx.role ?? 'EMPLOYEE');
    if (scope === 'none') {
      throw new ForbiddenException({ error: 'not_authorized', message: 'You do not have access to this dashboard.' });
    }
    if (scope === 'all') return null;
    const myId = await this.myMembershipId(tx);
    if (!myId) return [];
    return this.getReportSubtreeIds(tx, myId);
  }

  // Present/active both come from today's raw check-in/check-out events,
  // grouped per person with the exact same tie-break rule
  // AttendanceService.deriveDays uses for a single person's day (earliest
  // check-in, latest check-out) -- just applied across many people for one
  // day instead of one person across many days, since deriveDays itself
  // only ever runs against one membership's events at a time.
  private groupTodayEvents(events: { membershipId: string; type: string; occurredAt: Date }[]): {
    presentIds: Set<string>;
    activeIds: Set<string>;
  } {
    const byMember = new Map<string, { checkIn?: Date; checkOut?: Date }>();
    for (const e of events) {
      const entry = byMember.get(e.membershipId) ?? {};
      if (e.type === 'check_in' && (!entry.checkIn || e.occurredAt < entry.checkIn)) entry.checkIn = e.occurredAt;
      if (e.type === 'check_out' && (!entry.checkOut || e.occurredAt > entry.checkOut)) entry.checkOut = e.occurredAt;
      byMember.set(e.membershipId, entry);
    }
    const presentIds = new Set<string>();
    const activeIds = new Set<string>();
    for (const [id, { checkIn, checkOut }] of byMember) {
      if (checkIn) presentIds.add(id);
      if (checkIn && !checkOut) activeIds.add(id);
    }
    return { presentIds, activeIds };
  }

  // The one formula this whole feature depends on. Absent is a set
  // difference, not arithmetic subtraction, so it can never go negative or
  // double-count someone who is both present and (incorrectly) marked on
  // leave. Present takes priority over on-leave when both are true for the
  // same person -- if they actually checked in today, that is what happened,
  // regardless of what a leave record says.
  //
  // Known gap, stated rather than silently absorbed: this tenant has no
  // shift-scheduling or holiday model yet, so "expected to work today" can
  // only mean "every active employee," and "not scheduled" is always 0.
  // Weekends and tenant holidays are NOT excluded from the population --
  // when that data exists, notScheduledToday should stop being a constant.
  async getSummary() {
    return this.tenantPrisma.run(async (tx) => {
      const scopeIds = await this.resolveScope(tx);
      const { start, end, dateOnly, key } = nepalToday();

      const memberWhere: Prisma.TenantMembershipWhereInput = {
        status: 'active',
        leftAt: null,
        ...(scopeIds ? { id: { in: scopeIds } } : {}),
      };

      const totalEmployees = await tx.tenantMembership.count({ where: memberWhere });

      const todaysEvents = await tx.attendanceEvent.findMany({
        where: { occurredAt: { gte: start, lt: end }, ...(scopeIds ? { membershipId: { in: scopeIds } } : {}) },
        select: { membershipId: true, type: true, occurredAt: true },
      });
      const { presentIds, activeIds } = this.groupTodayEvents(todaysEvents);

      const onLeaveRows = await tx.leaveRequest.findMany({
        where: {
          status: 'approved',
          startDate: { lte: dateOnly },
          endDate: { gte: dateOnly },
          membership: { status: 'active', leftAt: null, ...(scopeIds ? { id: { in: scopeIds } } : {}) },
        },
        select: { membershipId: true },
      });
      const onLeaveIds = new Set(onLeaveRows.map((r) => r.membershipId));
      for (const id of presentIds) onLeaveIds.delete(id);

      const absentCount = Math.max(0, totalEmployees - presentIds.size - onLeaveIds.size);

      return {
        asOfDate: key,
        totalEmployees,
        presentToday: presentIds.size,
        absentToday: absentCount,
        activeNow: activeIds.size,
        onLeaveToday: onLeaveIds.size,
        notScheduledToday: 0,
        caveats: [
          'Absent excludes employees on approved leave today.',
          'Weekly offs and holidays are not tracked yet.',
        ],
      };
    });
  }

  async getDrilldown(metric: DashboardMetric): Promise<MemberLite[]> {
    return this.tenantPrisma.run(async (tx) => {
      const scopeIds = await this.resolveScope(tx);
      const { start, end, dateOnly } = nepalToday();

      const memberWhere: Prisma.TenantMembershipWhereInput = {
        status: 'active',
        leftAt: null,
        ...(scopeIds ? { id: { in: scopeIds } } : {}),
      };

      if (metric === 'present' || metric === 'active') {
        const todaysEvents = await tx.attendanceEvent.findMany({
          where: { occurredAt: { gte: start, lt: end }, ...(scopeIds ? { membershipId: { in: scopeIds } } : {}) },
          select: { membershipId: true, type: true, occurredAt: true },
        });
        const { presentIds, activeIds } = this.groupTodayEvents(todaysEvents);
        const ids = [...(metric === 'present' ? presentIds : activeIds)];
        return this.membersById(tx, ids);
      }

      const onLeaveRows = await tx.leaveRequest.findMany({
        where: { status: 'approved', startDate: { lte: dateOnly }, endDate: { gte: dateOnly }, membership: memberWhere },
        select: { membershipId: true },
      });
      const onLeaveIds = new Set(onLeaveRows.map((r) => r.membershipId));

      if (metric === 'onLeave') {
        return this.membersById(tx, [...onLeaveIds]);
      }

      // absent
      const todaysEvents = await tx.attendanceEvent.findMany({
        where: { occurredAt: { gte: start, lt: end }, ...(scopeIds ? { membershipId: { in: scopeIds } } : {}) },
        select: { membershipId: true, type: true, occurredAt: true },
      });
      const { presentIds } = this.groupTodayEvents(todaysEvents);
      for (const id of presentIds) onLeaveIds.delete(id);

      const allMembers = await tx.tenantMembership.findMany({ where: memberWhere, select: { id: true } });
      const absentIds = allMembers.map((m) => m.id).filter((id) => !presentIds.has(id) && !onLeaveIds.has(id));
      return this.membersById(tx, absentIds);
    });
  }

  private async membersById(tx: Prisma.TransactionClient, ids: string[]): Promise<MemberLite[]> {
    if (ids.length === 0) return [];
    const rows = await tx.tenantMembership.findMany({
      where: { id: { in: ids } },
      select: { id: true, user: { select: { fullName: true, email: true } } },
    });
    return rows.map((r) => ({ id: r.id, fullName: r.user.fullName, email: r.user.email }));
  }
}
