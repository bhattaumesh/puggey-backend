import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { TenantContextService } from '../common/tenant-context.service';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';

@Injectable()
export class LocationsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly ctx: TenantContextService,
  ) {}

  createLocation(dto: CreateLocationDto) {
    return this.tenantPrisma.run(async (tx) => {
      const existing = await tx.location.findFirst({ where: { name: dto.name } });
      if (existing) throw new ConflictException({ error: 'location_exists', message: 'A location with that name already exists.' });
      return tx.location.create({
        data: { tenantId: this.ctx.tenantId!, name: dto.name, lat: dto.lat, lng: dto.lng, radiusMeters: dto.radiusMeters ?? 50 },
      });
    });
  }

  listLocations() {
    return this.tenantPrisma.run((tx) => tx.location.findMany({ orderBy: { name: 'asc' } }));
  }

  async updateLocation(id: string, dto: UpdateLocationDto) {
    return this.tenantPrisma.run(async (tx) => {
      const location = await tx.location.findUnique({ where: { id } });
      if (!location) throw new NotFoundException({ error: 'not_found', message: 'No such location.' });
      if (dto.name && dto.name !== location.name) {
        const clash = await tx.location.findFirst({ where: { name: dto.name } });
        if (clash) throw new ConflictException({ error: 'location_exists', message: 'A location with that name already exists.' });
      }
      return tx.location.update({
        where: { id },
        data: { name: dto.name, lat: dto.lat, lng: dto.lng, radiusMeters: dto.radiusMeters },
      });
    });
  }

  async deleteLocation(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const location = await tx.location.findUnique({ where: { id } });
      if (!location) throw new NotFoundException({ error: 'not_found', message: 'No such location.' });
      await tx.location.delete({ where: { id } });
      return { ok: true };
    });
  }
}
