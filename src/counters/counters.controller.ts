import { Body, Controller, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CountersService } from './counters.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CreateCounterDto } from './dto/create-counter.dto';
import { OpenCounterSessionDto } from './dto/open-session.dto';
import { CloseCounterSessionDto } from './dto/close-session.dto';
import { AddCashMovementDto } from './dto/add-cash-movement.dto';
import { VerifyCounterSessionDto } from './dto/verify-session.dto';
import { EditClosingDetailsDto } from './dto/edit-closing-details.dto';

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

  @Get('overview')
  overview() {
    return this.counters.overview();
  }

  @Get('my-active-session')
  myActiveSession() {
    return this.counters.myActiveSession();
  }

  @Get('sessions/by-employee/:membershipId')
  sessionsForMembership(@Param('membershipId') membershipId: string) {
    return this.counters.sessionsForMembership(membershipId);
  }

  @Get('sessions/recent')
  recentSessions(@Query('limit') limit?: string) {
    return this.counters.recentSessions(limit ? Number(limit) : 25);
  }

  // Open to every role -- lets an employee "assign themselves" a counter.
  // assertCanAssign() in the service enforces the actual boundary: yourself,
  // always; someone else, only if you're an admin or their supervisor.
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

  @Patch('sessions/:id/closing-details')
  editClosingDetails(@Param('id') id: string, @Body() dto: EditClosingDetailsDto) {
    return this.counters.editClosingDetails(id, dto);
  }

  // Open to every role, like openSession -- the real boundary (anyone but
  // the person who handled the till) is enforced in verifySession().
  @Patch('sessions/:id/verify')
  verifySession(@Param('id') id: string, @Body() dto: VerifyCounterSessionDto) {
    return this.counters.verifySession(id, dto);
  }

  @Get('sessions/:id/report')
  report(@Param('id') id: string) {
    return this.counters.report(id);
  }

  @Get('sessions/:id/report/pdf')
  async reportPdf(@Param('id') id: string, @Query('download') download: string | undefined, @Res() res: Response) {
    const buffer = await this.counters.getReportPdf(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="counter-report-${id}.pdf"`,
    });
    res.send(buffer);
  }
}
