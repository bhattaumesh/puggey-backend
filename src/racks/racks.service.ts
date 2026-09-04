import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { TenantContextService } from '../common/tenant-context.service';
import { runInTenantContext } from '../prisma/rls.util';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateRackDto } from './dto/create-rack.dto';
import { UpdateRackDto } from './dto/update-rack.dto';
import { CleanRackDto } from './dto/clean-rack.dto';
import { AssignRackDto } from './dto/assign-rack.dto';
import { RateCleaningDto } from './dto/rate-cleaning.dto';

const PENDING_AFTER_DAYS = 30;

type Tx = Prisma.TransactionClient;

const ASSIGNMENT_INCLUDE = {
  rack: true,
  membership: { include: { user: { select: { fullName: true, email: true } } } },
  assignedBy: { include: { user: { select: { fullName: true, email: true } } } },
} satisfies Prisma.RackAssignmentInclude;

@Injectable()
export class RacksService {
  constructor(
    private readonly prisma: PrismaService,
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
  // importing from EmployeesService (see attendance/dashboard/reports) --
  // every membership that reports up to `rootId`, directly or indirectly.
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

  // SUPER_ADMIN can assign any rack to anyone; SUPERVISOR only to their own
  // reporting subtree (same authority boundary as My Team and leave
  // approval). Everyone else can't assign at all.
  private async assertCanAssign(tx: Tx, targetMembershipId: string) {
    if (this.ctx.role === 'SUPER_ADMIN') return;
    if (this.ctx.role === 'SUPERVISOR') {
      const myId = await this.myMembershipId(tx);
      const subtreeIds = await this.getReportSubtreeIds(tx, myId);
      if (subtreeIds.includes(targetMembershipId)) return;
      throw new ForbiddenException({ error: 'not_authorized', message: 'You can only assign racks to your own team.' });
    }
    throw new ForbiddenException({ error: 'not_authorized', message: 'You are not allowed to assign racks.' });
  }

  // Current open (pending) assignment per rack, tenant-scoped -- shared by
  // search/recentlyCleaned/pending so "who's assigned, due when" always
  // means the same thing everywhere it's shown.
  private async activeAssignmentByRack(tx: Tx): Promise<Map<string, Prisma.RackAssignmentGetPayload<{ include: typeof ASSIGNMENT_INCLUDE }>>> {
    const assignments = await tx.rackAssignment.findMany({
      where: { tenantId: this.ctx.tenantId!, status: 'pending' },
      include: ASSIGNMENT_INCLUDE,
    });
    return new Map(assignments.map((a) => [a.rackId, a]));
  }

  private assignmentSummary(a: Prisma.RackAssignmentGetPayload<{ include: typeof ASSIGNMENT_INCLUDE }> | undefined) {
    if (!a) return { assignmentId: null, assignedTo: null, assignedBy: null, dueDate: null };
    return {
      assignmentId: a.id,
      assignedTo: a.membership.user.fullName || a.membership.user.email,
      assignedBy: a.assignedBy.user.fullName || a.assignedBy.user.email,
      dueDate: a.dueDate,
    };
  }

  // Latest cleaning log per rack, tenant-scoped -- shared by list/search/pending
  // so "last cleaned" always means the same thing everywhere it's shown.
  private async latestLogByRack(tx: Tx): Promise<Map<string, { cleanedAt: Date; cleanedBy: string; remarks: string | null }>> {
    const logs = await tx.rackCleaningLog.findMany({
      where: { tenantId: this.ctx.tenantId! },
      orderBy: { cleanedAt: 'desc' },
      include: { membership: { include: { user: { select: { fullName: true, email: true } } } } },
    });
    const map = new Map<string, { cleanedAt: Date; cleanedBy: string; remarks: string | null }>();
    for (const log of logs) {
      if (map.has(log.rackId)) continue; // already sorted desc -- first hit per rack is the latest
      map.set(log.rackId, {
        cleanedAt: log.cleanedAt,
        cleanedBy: log.membership.user.fullName || log.membership.user.email,
        remarks: log.remarks,
      });
    }
    return map;
  }

  createRack(dto: CreateRackDto) {
    return this.tenantPrisma.run(async (tx) => {
      const existing = await tx.rack.findFirst({ where: { name: dto.name } });
      if (existing) throw new ConflictException({ error: 'rack_exists', message: 'A rack with that name already exists.' });
      return tx.rack.create({ data: { tenantId: this.ctx.tenantId!, name: dto.name, location: dto.location } });
    });
  }

  async updateRack(id: string, dto: UpdateRackDto) {
    return this.tenantPrisma.run(async (tx) => {
      const existing = await tx.rack.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException({ error: 'not_found', message: 'No such rack.' });
      if (dto.name) {
        const nameTaken = await tx.rack.findFirst({ where: { name: dto.name, id: { not: id } } });
        if (nameTaken) throw new ConflictException({ error: 'rack_exists', message: 'A rack with that name already exists.' });
      }
      return tx.rack.update({ where: { id }, data: { name: dto.name, location: dto.location } });
    });
  }

  async deleteRack(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const existing = await tx.rack.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException({ error: 'not_found', message: 'No such rack.' });
      await tx.rackCleaningLog.deleteMany({ where: { rackId: id } });
      await tx.rack.delete({ where: { id } });
      return { deleted: true };
    });
  }

  search(query: string) {
    return this.tenantPrisma.run(async (tx) => {
      const racks = await tx.rack.findMany({
        where: query ? { name: { contains: query, mode: 'insensitive' } } : {},
        orderBy: { name: 'asc' },
      });
      const latest = await this.latestLogByRack(tx);
      const assigned = await this.activeAssignmentByRack(tx);
      return racks.map((r) => ({
        ...r,
        lastCleanedAt: latest.get(r.id)?.cleanedAt ?? null,
        lastCleanedBy: latest.get(r.id)?.cleanedBy ?? null,
        ...this.assignmentSummary(assigned.get(r.id)),
      }));
    });
  }

  recentlyCleaned() {
    return this.tenantPrisma.run(async (tx) => {
      const racks = await tx.rack.findMany({ where: { tenantId: this.ctx.tenantId! } });
      const latest = await this.latestLogByRack(tx);
      const rackById = new Map(racks.map((r) => [r.id, r]));
      return [...latest.entries()]
        .map(([rackId, entry]) => ({ rack: rackById.get(rackId), ...entry }))
        .filter((e) => e.rack != null)
        .sort((a, b) => b.cleanedAt.getTime() - a.cleanedAt.getTime());
    });
  }

  pending() {
    return this.tenantPrisma.run(async (tx) => {
      const racks = await tx.rack.findMany({ where: { tenantId: this.ctx.tenantId! }, orderBy: { name: 'asc' } });
      const latest = await this.latestLogByRack(tx);
      const assigned = await this.activeAssignmentByRack(tx);
      const cutoff = Date.now() - PENDING_AFTER_DAYS * 24 * 60 * 60 * 1000;
      return racks
        .map((r) => ({
          ...r,
          lastCleanedAt: latest.get(r.id)?.cleanedAt ?? null,
          lastCleanedBy: latest.get(r.id)?.cleanedBy ?? null,
          ...this.assignmentSummary(assigned.get(r.id)),
        }))
        .filter((r) => r.lastCleanedAt == null || r.lastCleanedAt.getTime() < cutoff);
    });
  }

  // SUPER_ADMIN/SUPERVISOR assign a rack to an employee to clean by an
  // optional due date. Only one assignment can be open per rack -- creating
  // a new one cancels whichever was pending, since this is a reassignment,
  // not a queue.
  async assignRack(rackId: string, dto: AssignRackDto) {
    const result = await this.tenantPrisma.run(async (tx) => {
      const rack = await tx.rack.findUnique({ where: { id: rackId } });
      if (!rack) throw new NotFoundException({ error: 'not_found', message: 'No such rack.' });

      const target = await tx.tenantMembership.findUnique({ where: { id: dto.membershipId } });
      if (!target) throw new NotFoundException({ error: 'not_found', message: 'No such employee.' });

      await this.assertCanAssign(tx, dto.membershipId);

      const assignedByMembershipId = await this.myMembershipId(tx);

      await tx.rackAssignment.updateMany({ where: { rackId, status: 'pending' }, data: { status: 'cancelled' } });

      const assignment = await tx.rackAssignment.create({
        data: {
          tenantId: this.ctx.tenantId!,
          rackId,
          membershipId: dto.membershipId,
          assignedByMembershipId,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        },
        include: ASSIGNMENT_INCLUDE,
      });

      return { assignment, assigneeUserId: target.userId };
    });

    // Notification targets the assignee, who is usually someone other than
    // the caller -- same split-transaction pattern as TasksService.assign.
    await runInTenantContext(this.prisma, { isPugeyStaff: true }, (tx) =>
      NotificationsService.create(tx, {
        tenantId: this.ctx.tenantId!,
        userId: result.assigneeUserId,
        type: 'rack_assigned',
        message: `You were assigned to clean ${result.assignment.rack.name}.`,
      }),
    );

    return result.assignment;
  }

  async cancelAssignment(assignmentId: string) {
    return this.tenantPrisma.run(async (tx) => {
      const assignment = await tx.rackAssignment.findUnique({ where: { id: assignmentId } });
      if (!assignment) throw new NotFoundException({ error: 'not_found', message: 'No such assignment.' });
      if (this.ctx.role !== 'SUPER_ADMIN') {
        const myId = await this.myMembershipId(tx);
        if (assignment.assignedByMembershipId !== myId) {
          throw new ForbiddenException({ error: 'not_authorized', message: 'You can only cancel assignments you made.' });
        }
      }
      return tx.rackAssignment.update({ where: { id: assignmentId }, data: { status: 'cancelled' } });
    });
  }

  myAssignments() {
    return this.tenantPrisma.run(async (tx) => {
      const myId = await this.myMembershipId(tx);
      return tx.rackAssignment.findMany({
        where: { membershipId: myId, status: 'pending' },
        include: ASSIGNMENT_INCLUDE,
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
      });
    });
  }

  async history(rackId: string, limit?: number) {
    return this.tenantPrisma.run(async (tx) => {
      const rack = await tx.rack.findUnique({ where: { id: rackId } });
      if (!rack) throw new NotFoundException({ error: 'not_found', message: 'No such rack.' });
      return tx.rackCleaningLog.findMany({
        where: { rackId },
        orderBy: { cleanedAt: 'desc' },
        take: limit,
        include: {
          membership: { include: { user: { select: { fullName: true, email: true } } } },
          ratedBy: { include: { user: { select: { fullName: true, email: true } } } },
        },
      });
    });
  }

  async clean(rackId: string, dto: CleanRackDto) {
    return this.tenantPrisma.run(async (tx) => {
      const rack = await tx.rack.findUnique({ where: { id: rackId } });
      if (!rack) throw new NotFoundException({ error: 'not_found', message: 'No such rack.' });
      const membershipId = await this.myMembershipId(tx);
      const log = await tx.rackCleaningLog.create({
        data: { tenantId: this.ctx.tenantId!, rackId, membershipId, remarks: dto.remarks },
        include: { membership: { include: { user: { select: { fullName: true, email: true } } } } },
      });

      // Closes out whichever assignment was open for this rack, regardless
      // of who's actually assigned to it -- see the schema comment on
      // RackAssignment for why that's the right call here.
      const openAssignment = await tx.rackAssignment.findFirst({ where: { rackId, status: 'pending' } });
      if (openAssignment) {
        await tx.rackAssignment.update({
          where: { id: openAssignment.id },
          data: { status: 'completed', completedAt: log.cleanedAt, cleaningLogId: log.id },
        });
      }

      return log;
    });
  }

  // Supervisor/admin reviews a completed cleaning and scores it -- separate
  // from clean() because the person rating is never the person who cleaned;
  // route access already restricts this to SUPER_ADMIN/SUPERVISOR.
  async rateCleaning(logId: string, dto: RateCleaningDto) {
    return this.tenantPrisma.run(async (tx) => {
      const existing = await tx.rackCleaningLog.findUnique({ where: { id: logId } });
      if (!existing) throw new NotFoundException({ error: 'not_found', message: 'No such cleaning log.' });
      const raterMembershipId = await this.myMembershipId(tx);
      return tx.rackCleaningLog.update({
        where: { id: logId },
        data: { qualityRating: dto.qualityRating, ratedByMembershipId: raterMembershipId, ratedAt: new Date() },
        include: {
          membership: { include: { user: { select: { fullName: true, email: true } } } },
          ratedBy: { include: { user: { select: { fullName: true, email: true } } } },
        },
      });
    });
  }
}
