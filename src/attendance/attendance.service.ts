import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { TenantContextService } from '../common/tenant-context.service';
import { runInTenantContext } from '../prisma/rls.util';
import { canCheckInOut, myTeamScope } from '../permissions/permissions';
import { NotificationsService } from '../notifications/notifications.service';
import { CorrectAttendanceDto } from './dto/correct-attendance.dto';

// Nepal has one fixed offset year-round (no DST), so a business "day" for
// attendance purposes is UTC+5:45. This is a grouping/presentation concern, not
// a storage one -- occurredAt itself always stays UTC (spec section 12).
const NEPAL_OFFSET_MINUTES = 345;

function nepaliDateKey(date: Date): string {
  const shifted = new Date(date.getTime() + NEPAL_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(0, 10);
}

export interface DayRecord {
  date: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  workedMinutes: number | null;
}

function deriveDays(events: { type: string; occurredAt: Date }[]): DayRecord[] {
  const byDay = new Map<string, { checkIn?: Date; checkOut?: Date }>();
  for (const e of events) {
    const key = nepaliDateKey(e.occurredAt);
    const day = byDay.get(key) ?? {};
    if (e.type === 'check_in' && (!day.checkIn || e.occurredAt < day.checkIn)) day.checkIn = e.occurredAt;
    if (e.type === 'check_out' && (!day.checkOut || e.occurredAt > day.checkOut)) day.checkOut = e.occurredAt;
    byDay.set(key, day);
  }
  return Array.from(byDay.entries())
    .map(([date, { checkIn, checkOut }]) => ({
      date,
      checkInAt: checkIn?.toISOString() ?? null,
      checkOutAt: checkOut?.toISOString() ?? null,
      workedMinutes: checkIn && checkOut ? Math.round((checkOut.getTime() - checkIn.getTime()) / 60_000) : null,
    }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

@Injectable()
export class AttendanceService {
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

  private async assertCanView(tx: Prisma.TransactionClient, membershipId: string, myId: string) {
    if (membershipId === myId) return;
    const scope = myTeamScope(this.ctx.role ?? 'EMPLOYEE');
    if (scope === 'all') return;
    if (scope === 'subtree') {
      const subtreeIds = await this.getReportSubtreeIds(tx, myId);
      if (subtreeIds.includes(membershipId)) return;
    }
    throw new ForbiddenException({ error: 'not_authorized', message: 'You do not have access to this attendance record.' });
  }

  checkIn() {
    if (!canCheckInOut(this.ctx.role ?? 'EMPLOYEE')) {
      throw new ForbiddenException({ error: 'not_authorized', message: 'This role does not check in.' });
    }
    return this.tenantPrisma.run(async (tx) => {
      const membershipId = await this.myMembershipId(tx);
      const todayKey = nepaliDateKey(new Date());
      const events = await tx.attendanceEvent.findMany({ where: { membershipId }, orderBy: { occurredAt: 'desc' }, take: 5 });
      const todaysCheckIn = events.find((e) => e.type === 'check_in' && nepaliDateKey(e.occurredAt) === todayKey);
      const todaysCheckOut = events.find((e) => e.type === 'check_out' && nepaliDateKey(e.occurredAt) === todayKey);
      if (todaysCheckIn && !todaysCheckOut) {
        throw new BadRequestException({ error: 'already_checked_in', message: "You're already checked in today." });
      }
      return tx.attendanceEvent.create({
        data: { tenantId: this.ctx.tenantId!, membershipId, type: 'check_in', actorUserId: this.ctx.userId },
      });
    });
  }

  checkOut() {
    return this.tenantPrisma.run(async (tx) => {
      const membershipId = await this.myMembershipId(tx);
      const todayKey = nepaliDateKey(new Date());
      const events = await tx.attendanceEvent.findMany({ where: { membershipId }, orderBy: { occurredAt: 'desc' }, take: 5 });
      const todaysCheckIn = events.find((e) => e.type === 'check_in' && nepaliDateKey(e.occurredAt) === todayKey);
      const todaysCheckOut = events.find((e) => e.type === 'check_out' && nepaliDateKey(e.occurredAt) === todayKey);
      if (!todaysCheckIn) {
        throw new BadRequestException({ error: 'not_checked_in', message: "You haven't checked in today yet." });
      }
      if (todaysCheckOut) {
        throw new BadRequestException({ error: 'already_checked_out', message: "You're already checked out today." });
      }
      return tx.attendanceEvent.create({
        data: { tenantId: this.ctx.tenantId!, membershipId, type: 'check_out', actorUserId: this.ctx.userId },
      });
    });
  }

  today() {
    return this.tenantPrisma.run(async (tx) => {
      const membershipId = await this.myMembershipId(tx);
      const todayKey = nepaliDateKey(new Date());
      const events = await tx.attendanceEvent.findMany({ where: { membershipId }, orderBy: { occurredAt: 'desc' }, take: 10 });
      const todays = events.filter((e) => nepaliDateKey(e.occurredAt) === todayKey);
      const [derived] = deriveDays(todays);
      return derived ?? { date: todayKey, checkInAt: null, checkOutAt: null, workedMinutes: null };
    });
  }

  history(days: number) {
    return this.tenantPrisma.run(async (tx) => {
      const membershipId = await this.myMembershipId(tx);
      return this.historyFor(tx, membershipId, days);
    });
  }

  historyForMembership(membershipId: string, days: number) {
    return this.tenantPrisma.run(async (tx) => {
      const myId = await this.myMembershipId(tx);
      await this.assertCanView(tx, membershipId, myId);
      return this.historyFor(tx, membershipId, days);
    });
  }

  private async historyFor(tx: Prisma.TransactionClient, membershipId: string, days: number) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const events = await tx.attendanceEvent.findMany({ where: { membershipId, occurredAt: { gte: since } }, orderBy: { occurredAt: 'asc' } });
    return deriveDays(events);
  }

  async correct(membershipId: string, dto: CorrectAttendanceDto) {
    const { event, targetUserId } = await this.tenantPrisma.run(async (tx) => {
      const membership = await tx.tenantMembership.findUnique({ where: { id: membershipId } });
      if (!membership) throw new NotFoundException({ error: 'not_found', message: 'No such employee.' });

      const event = await tx.attendanceEvent.create({
        data: {
          tenantId: this.ctx.tenantId!,
          membershipId,
          type: dto.type,
          occurredAt: new Date(dto.occurredAt),
          source: 'admin_correction',
          reason: dto.reason,
          actorUserId: this.ctx.userId,
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: this.ctx.tenantId!,
          actorUserId: this.ctx.userId,
          action: 'attendance_correction',
          entityType: 'attendance_event',
          entityId: event.id,
          targetUserId: membership.userId,
          reason: dto.reason,
        },
      });

      return { event, targetUserId: membership.userId };
    });

    // Notifications are recipient-owned by RLS (userId = the recipient's own
    // current_user_id), so writing one for someone OTHER than the caller can't
    // happen inside the caller's own tenant-scoped transaction above -- same
    // reasoning as EmployeesService.create(). Run as its own follow-up write
    // under the platform-bypass context.
    await runInTenantContext(this.prisma, { isPugeyStaff: true }, (tx) =>
      NotificationsService.create(tx, {
        tenantId: this.ctx.tenantId!,
        userId: targetUserId,
        type: 'attendance_correction',
        message: `Your ${dto.type === 'check_in' ? 'check-in' : 'check-out'} time was corrected: ${dto.reason}`,
      }),
    );

    return event;
  }
}
