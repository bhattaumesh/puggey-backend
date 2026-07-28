import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { TenantContextService } from '../common/tenant-context.service';
import { CreateAdvanceCategoryDto } from './dto/create-advance-category.dto';
import { UpdateAdvanceCategoryDto } from './dto/update-advance-category.dto';

@Injectable()
export class AdvanceCategoriesService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly ctx: TenantContextService,
  ) {}

  // Active categories only -- what the "record an advance" dropdown offers.
  // Soft-deleted categories stay resolvable on the advances that reference
  // them (see AdvancesService), just hidden from new selection.
  list() {
    return this.tenantPrisma.run((tx) =>
      tx.advanceCategory.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } }),
    );
  }

  async create(dto: CreateAdvanceCategoryDto) {
    return this.tenantPrisma.run(async (tx) => {
      const existing = await tx.advanceCategory.findFirst({ where: { name: dto.name, deletedAt: null } });
      if (existing) throw new ConflictException({ error: 'category_exists', message: 'That category already exists.' });
      return tx.advanceCategory.create({ data: { tenantId: this.ctx.tenantId!, name: dto.name } });
    });
  }

  // Renaming updates the label everywhere it's referenced automatically --
  // Advance stores categoryId, not a copy of the name.
  async update(id: string, dto: UpdateAdvanceCategoryDto) {
    return this.tenantPrisma.run(async (tx) => {
      const existing = await tx.advanceCategory.findUnique({ where: { id } });
      if (!existing || existing.deletedAt) throw new NotFoundException({ error: 'not_found', message: 'No such category.' });
      return tx.advanceCategory.update({ where: { id }, data: { name: dto.name } });
    });
  }

  usageCount(id: string) {
    return this.tenantPrisma.run((tx) => tx.advance.count({ where: { categoryId: id } }));
  }

  // Soft-delete: hides the category from new-advance selection, but every
  // Advance already referencing it keeps resolving it by id -- the one
  // correctness trap this feature has, per spec.
  async remove(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const existing = await tx.advanceCategory.findUnique({ where: { id } });
      if (!existing || existing.deletedAt) throw new NotFoundException({ error: 'not_found', message: 'No such category.' });
      const advanceCount = await tx.advance.count({ where: { categoryId: id } });
      await tx.advanceCategory.update({ where: { id }, data: { deletedAt: new Date() } });
      return { deleted: true, advanceCount };
    });
  }
}
