import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { runInTenantContext } from '../prisma/rls.util';
import { CreateBusinessTypeDto } from './dto/create-business-type.dto';
import { UpdateBusinessTypeDto } from './dto/update-business-type.dto';

@Injectable()
export class BusinessTypesService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return runInTenantContext(this.prisma, { isPugeyStaff: true }, (tx) => tx.businessType.findMany({ orderBy: { sortOrder: 'asc' } }));
  }

  create(dto: CreateBusinessTypeDto) {
    return runInTenantContext(this.prisma, { isPugeyStaff: true }, async (tx) => {
      const existing = await tx.businessType.findUnique({ where: { key: dto.key } });
      if (existing) throw new ConflictException({ error: 'business_type_exists', message: 'A business type with that key already exists.' });
      const count = await tx.businessType.count();
      return tx.businessType.create({ data: { key: dto.key, label: dto.label, sortOrder: count } });
    });
  }

  async update(key: string, dto: UpdateBusinessTypeDto) {
    return runInTenantContext(this.prisma, { isPugeyStaff: true }, async (tx) => {
      const existing = await tx.businessType.findUnique({ where: { key } });
      if (!existing) throw new NotFoundException({ error: 'not_found', message: 'No such business type.' });
      return tx.businessType.update({ where: { key }, data: { label: dto.label } });
    });
  }

  // Blocks rather than cascades -- a business type with companies currently
  // on it needs those moved to a different type first, same guard as Plan.
  async remove(key: string) {
    return runInTenantContext(this.prisma, { isPugeyStaff: true }, async (tx) => {
      const existing = await tx.businessType.findUnique({ where: { key } });
      if (!existing) throw new NotFoundException({ error: 'not_found', message: 'No such business type.' });
      const inUse = await tx.tenant.count({ where: { businessType: key } });
      if (inUse > 0) {
        throw new ConflictException({
          error: 'business_type_in_use',
          message: `${inUse} ${inUse === 1 ? 'company is' : 'companies are'} still on this business type. Move them first, then remove it.`,
        });
      }
      await tx.businessType.delete({ where: { key } });
      return { ok: true };
    });
  }
}
