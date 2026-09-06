import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { TenantContextService } from '../common/tenant-context.service';
import { CreateShiftDto } from './dto/create-shift.dto';
import { AssignShiftDto } from './dto/assign-shift.dto';

type Tx = Prisma.TransactionClient;

// select, not include -- a plain include on membership/assignedBy would
// also pull baseSalary, photoData (raw image bytes), and other sensitive
// fields nothing here displays.
const ASSIGNMENT_INCLUDE = {
  shift: true,
  membership: { select: { id: true, user: { select: { fullName: true, email: true } } } },
  assignedBy: { select: { id: true, user: { select: { fullName: true, email: true } } } },
} satisfies Prisma.ShiftAssignmentInclude;

@Injectable()
export class ShiftsService {
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

  // Same recursive CTE every other module re-derives locally rather than
  // importing from EmployeesService (see attendance/dashboard/reports/racks)
  // -- every membership that reports up to `rootId`, directly or indirectly.
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

  // SUPER_ADMIN can schedule anyone; SUPERVISOR only their own reporting
  // subtree (same authority boundary as rack assignment and My Team).
  private async assertCanSchedule(tx: Tx, targetMembershipId: string) {
    if (this.ctx.role === 'SUPER_ADMIN') return;
    if (this.ctx.role === 'SUPERVISOR') {
      const myId = await this.myMembershipId(tx);
      const subtreeIds = await this.getReportSubtreeIds(tx, myId);
      if (subtreeIds.includes(targetMembershipId)) return;
      throw new ForbiddenException({ error: 'not_authorized', message: 'You can only schedule your own team.' });
    }
    throw new ForbiddenException({ error: 'not_authorized', message: 'You are not allowed to schedule shifts.' });
  }

  createShift(dto: CreateShiftDto) {
    return this.tenantPrisma.run(async (tx) => {
      const existing = await tx.shift.findFirst({ where: { name: dto.name } });
      if (existing) throw new ConflictException({ error: 'shift_exists', message: 'A shift with that name already exists.' });
      return tx.shift.create({
        data: { tenantId: this.ctx.tenantId!, name: dto.name, startTime: dto.startTime, endTime: dto.endTime },
      });
    });
  }

  listShifts() {
    return this.tenantPrisma.run((tx) => tx.shift.findMany({ orderBy: { startTime: 'asc' } }));
  }

  // Admin sees the whole company's calendar; a supervisor sees their own
  // subtree's -- same scoping rule as My Team, not the leave-approval chain.
  async calendar(start: string, end: string) {
    return this.tenantPrisma.run(async (tx) => {
      const startDate = new Date(start);
      const endDate = new Date(end);

      if (this.ctx.role === 'SUPER_ADMIN' || this.ctx.role === 'ADMIN') {
        return tx.shiftAssignment.findMany({
          where: { date: { gte: startDate, lte: endDate } },
          orderBy: { date: 'asc' },
          include: ASSIGNMENT_INCLUDE,
        });
      }
      if (this.ctx.role === 'SUPERVISOR') {
        const myId = await this.myMembershipId(tx);
        const subtreeIds = await this.getReportSubtreeIds(tx, myId);
        return tx.shiftAssignment.findMany({
          where: { date: { gte: startDate, lte: endDate }, membershipId: { in: [myId, ...subtreeIds] } },
          orderBy: { date: 'asc' },
          include: ASSIGNMENT_INCLUDE,
        });
      }
      throw new ForbiddenException({ error: 'not_authorized', message: 'You do not have access to the team schedule.' });
    });
  }

  // Every employee's own view, regardless of role -- "my upcoming shifts"
  // isn't a team-management surface, so it isn't gated by myTeamScope.
  async myUpcoming() {
    return this.tenantPrisma.run(async (tx) => {
      const myId = await this.myMembershipId(tx);
      return tx.shiftAssignment.findMany({
        where: { membershipId: myId, date: { gte: new Date(new Date().toISOString().slice(0, 10)) } },
        orderBy: { date: 'asc' },
        include: ASSIGNMENT_INCLUDE,
      });
    });
  }

  // Upsert on (membershipId, date) -- assigning a new shift for a date
  // someone is already scheduled on replaces it rather than erroring, since
  // re-rostering a day is the common case, not a mistake to block.
  async assign(dto: AssignShiftDto) {
    return this.tenantPrisma.run(async (tx) => {
      await this.assertCanSchedule(tx, dto.membershipId);
      const shift = await tx.shift.findUnique({ where: { id: dto.shiftId } });
      if (!shift) throw new NotFoundException({ error: 'not_found', message: 'No such shift.' });
      const member = await tx.tenantMembership.findUnique({ where: { id: dto.membershipId } });
      if (!member) throw new NotFoundException({ error: 'not_found', message: 'No such employee.' });
      const assignedByMembershipId = await this.myMembershipId(tx);
      const date = new Date(dto.date);

      return tx.shiftAssignment.upsert({
        where: { membershipId_date: { membershipId: dto.membershipId, date } },
        create: { tenantId: this.ctx.tenantId!, membershipId: dto.membershipId, shiftId: dto.shiftId, date, assignedByMembershipId },
        update: { shiftId: dto.shiftId, assignedByMembershipId },
        include: ASSIGNMENT_INCLUDE,
      });
    });
  }

  async unassign(assignmentId: string) {
    return this.tenantPrisma.run(async (tx) => {
      const assignment = await tx.shiftAssignment.findUnique({ where: { id: assignmentId } });
      if (!assignment) throw new NotFoundException({ error: 'not_found', message: 'No such assignment.' });
      await this.assertCanSchedule(tx, assignment.membershipId);
      await tx.shiftAssignment.delete({ where: { id: assignmentId } });
      return { ok: true };
    });
  }
}
