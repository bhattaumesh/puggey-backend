import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CountersService } from './counters.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CreateCounterDto } from './dto/create-counter.dto';
import { OpenCounterSessionDto } from './dto/open-session.dto';
import { CloseCounterSessionDto } from './dto/close-session.dto';
import { AddCashMovementDto } from './dto/add-cash-movement.dto';

@Controller('counters')
@UseGuards(JwtAuthGuard)
export class CountersController {
  constructor(private readonly counters: CountersService) {}

  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @Post()
  createCounter(@Body() dto: CreateCounterDto) {
    return this.counters.createCounter(dto);
  }

  @Get()
  listCounters() {
    return this.counters.listCounters();
  }

  @Get('my-active-session')
  myActiveSession() {
    return this.counters.myActiveSession();
  }

  @Get('sessions/by-employee/:membershipId')
  sessionsForMembership(@Param('membershipId') membershipId: string) {
    return this.counters.sessionsForMembership(membershipId);
  }

  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'SUPERVISOR')
  @Post('sessions')
  openSession(@Body() dto: OpenCounterSessionDto) {
    return this.counters.openSession(dto);
  }

  @Post('sessions/:id/movements')
  addMovement(@Param('id') id: string, @Body() dto: AddCashMovementDto) {
    return this.counters.addMovement(id, dto);
  }

  @Patch('sessions/:id/close')
  closeSession(@Param('id') id: string, @Body() dto: CloseCounterSessionDto) {
    return this.counters.closeSession(id, dto);
  }

  @Get('sessions/:id/report')
  report(@Param('id') id: string) {
    return this.counters.report(id);
  }
}
