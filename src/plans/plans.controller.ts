import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PugeyStaffGuard } from '../auth/pugey-staff.guard';
import { PLAN_TIERS } from './plan-tiers';

@Controller('plans')
@UseGuards(JwtAuthGuard, PugeyStaffGuard)
export class PlansController {
  @Get()
  list() {
    return Object.entries(PLAN_TIERS).map(([key, tier]) => ({ key, ...tier }));
  }
}
