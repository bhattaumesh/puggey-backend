import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { TenantContextService } from '../common/tenant-context.service';
import { myTeamScope } from '../permissions/permissions';

const NEPAL_OFFSET_MINUTES = 345;
function nepaliDateKey(date: Date): string {
  const shifted = new Date(date.getTime() + NEPAL_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(0, 10);
}

// Same "what can this role see" rule as EmployeesService/AttendanceService --
// reports never introduce a new visibility model, they export exactly what
// the caller could already see on screen. Everyone can always see their own
// record even when myTeamScope is 'none' (a plain Employee), since exporting
// your own attendance/leave isn't a team-visibility question.
@Injectable()
export class ReportsService {
  constructor(
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

  private async visibleMembershipIds(tx: Prisma.TransactionClient): Promise<string[]> {
    const myId = await this.myMembershipId(tx);
    const scope = myTeamScope(this.ctx.role ?? 'EMPLOYEE');
    if (scope === 'all') {
      const all = await tx.tenantMembership.findMany({ where: { status: 'active' }, select: { id: true } });
      return all.map((m) => m.id);
    }
    if (scope === 'subtree') {
      const subtreeIds = await this.getReportSubtreeIds(tx, myId);
      return [myId, ...subtreeIds];
    }
    return [myId];
  }

  async attendanceWorkbook(days: number): Promise<ExcelJS.Buffer> {
    const rows = await this.tenantPrisma.run(async (tx) => {
      const membershipIds = await this.visibleMembershipIds(tx);
      const since = new Date(Date.now() - days * 86_400_000);
      const events = await tx.attendanceEvent.findMany({
        where: { membershipId: { in: membershipIds }, occurredAt: { gte: since } },
        include: { membership: { include: { user: { select: { fullName: true, email: true } } } } },
        orderBy: [{ membershipId: 'asc' }, { occurredAt: 'asc' }],
      });

      const byMembershipAndDay = new Map<string, { name: string; checkIn?: Date; checkOut?: Date }>();
      for (const e of events) {
        const key = `${e.membershipId}::${nepaliDateKey(e.occurredAt)}`;
        const entry = byMembershipAndDay.get(key) ?? { name: e.membership.user.fullName || e.membership.user.email };
        if (e.type === 'check_in' && (!entry.checkIn || e.occurredAt < entry.checkIn)) entry.checkIn = e.occurredAt;
        if (e.type === 'check_out' && (!entry.checkOut || e.occurredAt > entry.checkOut)) entry.checkOut = e.occurredAt;
        byMembershipAndDay.set(key, entry);
      }

      return Array.from(byMembershipAndDay.entries())
        .map(([key, v]) => {
          const [, date] = key.split('::');
          const hours = v.checkIn && v.checkOut ? (v.checkOut.getTime() - v.checkIn.getTime()) / 3_600_000 : null;
          return { name: v.name, date, checkIn: v.checkIn?.toISOString() ?? null, checkOut: v.checkOut?.toISOString() ?? null, hours };
        })
        .sort((a, b) => (a.date === b.date ? a.name.localeCompare(b.name) : a.date < b.date ? 1 : -1));
    });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Attendance');
    sheet.columns = [
      { header: 'Employee', key: 'name', width: 28 },
      { header: 'Date (BS day boundary)', key: 'date', width: 22 },
      { header: 'Check in', key: 'checkIn', width: 22 },
      { header: 'Check out', key: 'checkOut', width: 22 },
      { header: 'Hours', key: 'hours', width: 10 },
    ];
    sheet.getRow(1).font = { bold: true };
    // The date already has its own leftmost column, so check-in/out only
    // need to show the time of day -- repeating the full date in both would
    // just be the same value three times per row.
    const TIME_FORMAT = 'hh:mm:ss';
    for (const r of rows) {
      const row = sheet.addRow({
        name: r.name,
        date: r.date,
        checkIn: r.checkIn ? new Date(r.checkIn) : 'Not recorded',
        checkOut: r.checkOut ? new Date(r.checkOut) : 'Not recorded',
        hours: r.hours !== null ? Math.round(r.hours * 100) / 100 : null,
      });
      if (r.checkIn) row.getCell('checkIn').numFmt = TIME_FORMAT;
      if (r.checkOut) row.getCell('checkOut').numFmt = TIME_FORMAT;
    }
    return workbook.xlsx.writeBuffer();
  }

  async leaveWorkbook(year: number): Promise<ExcelJS.Buffer> {
    const requests = await this.tenantPrisma.run(async (tx) => {
      const membershipIds = await this.visibleMembershipIds(tx);
      const start = new Date(Date.UTC(year, 0, 1));
      const end = new Date(Date.UTC(year + 1, 0, 1));
      return tx.leaveRequest.findMany({
        where: { membershipId: { in: membershipIds }, startDate: { gte: start, lt: end } },
        include: { leaveType: true, membership: { include: { user: { select: { fullName: true, email: true } } } } },
        orderBy: [{ startDate: 'asc' }],
      });
    });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Leave');
    sheet.columns = [
      { header: 'Employee', key: 'name', width: 28 },
      { header: 'Leave type', key: 'type', width: 16 },
      { header: 'Start date', key: 'start', width: 14 },
      { header: 'End date', key: 'end', width: 14 },
      { header: 'Days', key: 'days', width: 8 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Reason', key: 'reason', width: 32 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const r of requests) {
      sheet.addRow({
        name: r.membership.user.fullName || r.membership.user.email,
        type: r.leaveType.name,
        start: r.startDate,
        end: r.endDate,
        days: r.days,
        status: r.status,
        reason: r.reason,
      });
    }
    return workbook.xlsx.writeBuffer();
  }
}
