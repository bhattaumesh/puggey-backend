import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CorrectAttendanceDto } from './dto/correct-attendance.dto';

@Controller('attendance')
@UseGuards(JwtAuthGuard)
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Post('check-in')
  checkIn() {
    return this.attendance.checkIn();
  }

  @Post('check-out')
  checkOut() {
    return this.attendance.checkOut();
  }

  @Get('today')
  today() {
    return this.attendance.today();
  }

  @Get('me')
  history(@Query('days') days?: string) {
    return this.attendance.history(days ? parseInt(days, 10) : 30);
  }

  @Get(':membershipId')
  historyForMembership(@Param('membershipId') membershipId: string, @Query('days') days?: string) {
    return this.attendance.historyForMembership(membershipId, days ? parseInt(days, 10) : 30);
  }

  // Delegated (supervisor-own-team) correction rights are a later feature --
  // for now only Admin (TenantRole.SUPER_ADMIN) can correct, matching the
  // permission map's default in permissions.ts.
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @Post(':membershipId/correct')
  correct(@Param('membershipId') membershipId: string, @Body() dto: CorrectAttendanceDto) {
    return this.attendance.correct(membershipId, dto);
  }
}
