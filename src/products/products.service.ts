import { ConflictException, Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { TenantContextService } from '../common/tenant-context.service';
import { CreateProductDto } from './dto/create-product.dto';

@Injectable()
export class ProductsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly ctx: TenantContextService,
  ) {}

  create(dto: CreateProductDto) {
    return this.tenantPrisma.run(async (tx) => {
      const existing = await tx.product.findFirst({ where: { name: dto.name } });
      if (existing) throw new ConflictException({ error: 'product_exists', message: 'A product with that name already exists.' });
      return tx.product.create({ data: { tenantId: this.ctx.tenantId!, name: dto.name } });
    });
  }

  list() {
    return this.tenantPrisma.run((tx) => tx.product.findMany({ orderBy: { name: 'asc' } }));
  }
}
