import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { TenantContextService } from '../common/tenant-context.service';
import { runInTenantContext } from '../prisma/rls.util';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto';

// select, not include, on the membership relations themselves -- include
// would return every scalar column on TenantMembership (baseSalary,
// citizenship/PAN/NID/driving-licence numbers, and the photoData/
// photoMimeType bytea added for profile photos), nested inside every task
// response, bypassing the redaction EmployeesService applies on its own
// endpoints. Only the two display fields actually used by the frontend are
// selected here.
const TASK_INCLUDE = {
  membership: { select: { user: { select: { fullName: true, email: true } } } },
  assignedBy: { select: { user: { select: { fullName: true, email: true } } } },
} satisfies Prisma.TaskInclude;

// Assigned from an employee's profile page (My Team), not a standalone task
// board -- see the schema comment on Task. Creating/deleting a task is
// canCreateEditDeleteAnyRecord-gated same as the rest of that screen; the
// assignee can update their own task's status without needing that broader
// permission, since marking your own work done is a much narrower thing to
// allow than editing someone else's HR record.
@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
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

  async assign(dto: CreateTaskDto) {
    const result = await this.tenantPrisma.run(async (tx) => {
      const member = await tx.tenantMembership.findUnique({ where: { id: dto.membershipId } });
      if (!member) throw new NotFoundException({ error: 'not_found', message: 'No such employee.' });

      const assignedByMembershipId = await this.myMembershipId(tx);
      if (!assignedByMembershipId) throw new ForbiddenException({ error: 'not_authorized', message: 'No employee record for this account.' });

      const task = await tx.task.create({
        data: {
          tenantId: this.ctx.tenantId!,
          membershipId: dto.membershipId,
          title: dto.title,
          description: dto.description,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          assignedByMembershipId,
        },
        include: TASK_INCLUDE,
      });

      return { task, assigneeUserId: member.userId };
    });

    // Notification targets the assignee, who is usually someone other than
    // the caller -- same split-transaction pattern as everywhere else a
    // write's notification recipient isn't the actor.
    await runInTenantContext(this.prisma, { isPugeyStaff: true }, (tx) =>
      NotificationsService.create(tx, {
        tenantId: this.ctx.tenantId!,
        userId: result.assigneeUserId,
        type: 'task_assigned',
        message: `You were assigned a new task: ${result.task.title}`,
      }),
    );

    return result.task;
  }

  listForMember(membershipId: string) {
    return this.tenantPrisma.run(async (tx) => {
      await this.assertCanAccess(tx, membershipId);
      return tx.task.findMany({ where: { membershipId }, include: TASK_INCLUDE, orderBy: { createdAt: 'desc' } });
    });
  }

  private async assertCanAccess(tx: Prisma.TransactionClient, membershipId: string) {
    if (this.ctx.role === 'SUPER_ADMIN') return;
    const myId = await this.myMembershipId(tx);
    if (myId !== membershipId) {
      throw new ForbiddenException({ error: 'not_authorized', message: 'You do not have access to these tasks.' });
    }
  }

  async updateStatus(taskId: string, dto: UpdateTaskStatusDto) {
    return this.tenantPrisma.run(async (tx) => {
      const task = await tx.task.findUnique({ where: { id: taskId } });
      if (!task) throw new NotFoundException({ error: 'not_found', message: 'No such task.' });

      if (this.ctx.role !== 'SUPER_ADMIN') {
        const myId = await this.myMembershipId(tx);
        if (myId !== task.membershipId) {
          throw new ForbiddenException({ error: 'not_authorized', message: 'You do not have access to this task.' });
        }
      }

      return tx.task.update({ where: { id: taskId }, data: { status: dto.status }, include: TASK_INCLUDE });
    });
  }

  remove(taskId: string) {
    return this.tenantPrisma.run(async (tx) => {
      const task = await tx.task.findUnique({ where: { id: taskId } });
      if (!task) throw new NotFoundException({ error: 'not_found', message: 'No such task.' });
      await tx.task.delete({ where: { id: taskId } });
      return { deleted: true };
    });
  }
}
