import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { TenantMembershipsService } from './tenant-memberships.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('tenant-memberships')
@UseGuards(JwtAuthGuard)
export class TenantMembershipsController {
  constructor(private readonly memberships: TenantMembershipsService) {}

  @Get()
  listMine() {
    return this.memberships.listMine();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const membership = await this.memberships.findOne(id);
    if (!membership) {
      // RLS makes a cross-tenant row invisible, not merely forbidden -- from the
      // caller's point of view it does not exist, which is the correct signal
      // (existence itself is tenant-scoped information).
      throw new NotFoundException({ error: 'not_found', message: 'No such record.' });
    }
    return membership;
  }
}
