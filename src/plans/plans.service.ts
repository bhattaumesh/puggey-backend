import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { runInTenantContext } from '../prisma/rls.util';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';

@Injectable()
export class PlansService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return runInTenantContext(this.prisma, { isPugeyStaff: true }, (tx) => tx.plan.findMany({ orderBy: { sortOrder: 'asc' } }));
  }

  create(dto: CreatePlanDto) {
    return runInTenantContext(this.prisma, { isPugeyStaff: true }, async (tx) => {
      const existing = await tx.plan.findUnique({ where: { key: dto.key } });
      if (existing) throw new ConflictException({ error: 'plan_exists', message: 'A plan with that key already exists.' });
      const count = await tx.plan.count();
      return tx.plan.create({
        data: { key: dto.key, label: dto.label, maxEmployees: dto.maxEmployees ?? null, features: dto.features, sortOrder: count },
      });
    });
  }

  async update(key: string, dto: UpdatePlanDto) {
    return runInTenantContext(this.prisma, { isPugeyStaff: true }, async (tx) => {
      const existing = await tx.plan.findUnique({ where: { key } });
      if (!existing) throw new NotFoundException({ error: 'not_found', message: 'No such plan.' });
      return tx.plan.update({
        where: { key },
        data: { label: dto.label, maxEmployees: dto.maxEmployees, features: dto.features },
      });
    });
  }

  // Blocks rather than cascades -- a plan with companies currently on it
  // needs those moved to a different plan first, deliberately, rather than
  // silently leaving them on a plan key that no longer resolves to anything.
  async remove(key: string) {
    return runInTenantContext(this.prisma, { isPugeyStaff: true }, async (tx) => {
      const existing = await tx.plan.findUnique({ where: { key } });
      if (!existing) throw new NotFoundException({ error: 'not_found', message: 'No such plan.' });
      const inUse = await tx.tenant.count({ where: { plan: key } });
      if (inUse > 0) {
        throw new ConflictException({
          error: 'plan_in_use',
          message: `${inUse} ${inUse === 1 ? 'company is' : 'companies are'} still on this plan. Move them first, then remove it.`,
        });
      }
      await tx.plan.delete({ where: { key } });
      return { ok: true };
    });
  }
}
