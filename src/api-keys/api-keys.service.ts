import { NotFoundException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { TenantContextService } from '../common/tenant-context.service';
import { generateApiKey } from './api-key.util';

@Injectable()
export class ApiKeysService {
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

  list() {
    return this.tenantPrisma.run((tx) =>
      tx.apiKey.findMany({
        where: { tenantId: this.ctx.tenantId! },
        select: { id: true, name: true, keyPrefix: true, lastUsedAt: true, revokedAt: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  async create(name: string) {
    const { raw, hash, prefix } = generateApiKey();
    const created = await this.tenantPrisma.run(async (tx) => {
      const createdByMembershipId = await this.myMembershipId(tx);
      return tx.apiKey.create({
        data: { tenantId: this.ctx.tenantId!, name, keyHash: hash, keyPrefix: prefix, createdByMembershipId },
      });
    });
    // The only moment the raw key is ever available. The frontend must show
    // it once and tell the user to copy it now; there is no "reveal again."
    return { id: created.id, name: created.name, key: raw, keyPrefix: created.keyPrefix, createdAt: created.createdAt };
  }

  async revoke(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const existing = await tx.apiKey.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException({ error: 'not_found', message: 'No such API key.' });
      return tx.apiKey.update({
        where: { id },
        data: { revokedAt: new Date() },
        select: { id: true, name: true, keyPrefix: true, lastUsedAt: true, revokedAt: true, createdAt: true },
      });
    });
  }
}
