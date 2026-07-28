import { Body, Controller, Get, NotFoundException, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { PugeyStaffGuard } from '../auth/pugey-staff.guard';
import { Roles } from '../auth/roles.decorator';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { UpdateTenantPlanDto } from './dto/update-tenant-plan.dto';

@Controller('tenants')
@UseGuards(JwtAuthGuard)
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get('me')
  async getMyTenant() {
    const tenant = await this.tenants.getMyTenant();
    if (!tenant) {
      throw new NotFoundException({ error: 'not_found', message: 'No workspace found for this account.' });
    }
    return tenant;
  }

  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @Patch('me')
  updateMyTenant(@Body() dto: UpdateTenantDto) {
    return this.tenants.updateMyTenant(dto);
  }

  // Platform-only: Pugey Staff creates a new company and grants its first admin.
  @UseGuards(PugeyStaffGuard)
  @Post()
  createTenant(@Body() dto: CreateTenantDto) {
    return this.tenants.createTenantWithAdmin(dto);
  }

  // Platform-only: every company, with plan and current employee usage.
  @UseGuards(PugeyStaffGuard)
  @Get()
  listAllTenants() {
    return this.tenants.listAllTenants();
  }

  // Platform-only: move a company between plan tiers.
  @UseGuards(PugeyStaffGuard)
  @Patch(':id/plan')
  updateTenantPlan(@Param('id') id: string, @Body() dto: UpdateTenantPlanDto) {
    return this.tenants.updateTenantPlan(id, dto);
  }
}
