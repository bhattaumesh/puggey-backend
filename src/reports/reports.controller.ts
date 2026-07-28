import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('attendance.xlsx')
  async attendance(
    @Query('days') days: string | undefined,
    @Query('download') download: string | undefined,
    @Res() res: Response,
  ) {
    const buffer = await this.reports.attendanceWorkbook(days ? parseInt(days, 10) : 30);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="attendance.xlsx"`,
    });
    res.send(buffer);
  }

  @Get('leave.xlsx')
  async leave(
    @Query('year') year: string | undefined,
    @Query('download') download: string | undefined,
    @Res() res: Response,
  ) {
    const buffer = await this.reports.leaveWorkbook(year ? parseInt(year, 10) : new Date().getUTCFullYear());
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="leave.xlsx"`,
    });
    res.send(buffer);
  }
}
