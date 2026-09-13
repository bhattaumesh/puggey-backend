import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PugeyStaffGuard } from '../auth/pugey-staff.guard';
import { PlansService } from './plans.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';

@Controller('plans')
@UseGuards(JwtAuthGuard, PugeyStaffGuard)
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @Get()
  list() {
    return this.plans.list();
  }

  @Post()
  create(@Body() dto: CreatePlanDto) {
    return this.plans.create(dto);
  }

  @Patch(':key')
  update(@Param('key') key: string, @Body() dto: UpdatePlanDto) {
    return this.plans.update(key, dto);
  }

  @Delete(':key')
  remove(@Param('key') key: string) {
    return this.plans.remove(key);
  }
}
