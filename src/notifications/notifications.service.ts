import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { TenantContextService } from '../common/tenant-context.service';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly ctx: TenantContextService,
  ) {}

  // Called from other services (e.g. EmployeesService on hire) inside the SAME
  // tenant-scoped transaction they're already running -- notifications are
  // written alongside the event that caused them, never as an afterthought that
  // could silently fail.
  static create(tx: Prisma.TransactionClient, data: { tenantId: string; userId: string; type: string; message: string }) {
    return tx.notification.create({ data });
  }

  list() {
    return this.tenantPrisma.run((tx) =>
      tx.notification.findMany({
        where: { userId: this.ctx.userId! },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    );
  }

  unreadCount() {
    return this.tenantPrisma.run((tx) => tx.notification.count({ where: { userId: this.ctx.userId!, readAt: null } }));
  }

  markRead(id: string) {
    return this.tenantPrisma.run((tx) =>
      tx.notification.updateMany({ where: { id, userId: this.ctx.userId! }, data: { readAt: new Date() } }),
    );
  }

  markAllRead() {
    return this.tenantPrisma.run((tx) =>
      tx.notification.updateMany({ where: { userId: this.ctx.userId!, readAt: null }, data: { readAt: new Date() } }),
    );
  }
}
