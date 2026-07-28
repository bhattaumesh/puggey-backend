import { Body, Controller, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { PayrollService } from './payroll.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UpdatePayrollSettingsDto } from './dto/update-payroll-settings.dto';
import { GeneratePayslipsDto } from './dto/generate-payslips.dto';

@Controller('payroll')
@UseGuards(JwtAuthGuard)
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Get('settings')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  getSettings() {
    return this.payroll.getSettings();
  }

  @Patch('settings')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  updateSettings(@Body() dto: UpdatePayrollSettingsDto) {
    return this.payroll.updateSettings(dto);
  }

  @Post('generate')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  generate(@Body() dto: GeneratePayslipsDto) {
    return this.payroll.generate(dto);
  }

  @Get('preview')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  preview(
    @Query('membershipId') membershipId: string,
    @Query('year') year: string,
    @Query('month') month: string,
    @Query('receivable') receivable: string | undefined,
  ) {
    return this.payroll.preview(membershipId, parseInt(year, 10), parseInt(month, 10), parseFloat(receivable ?? '0') || 0);
  }

  @Get('payslips')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  listForMonth(@Query('year') year: string, @Query('month') month: string) {
    return this.payroll.listForMonth(parseInt(year, 10), parseInt(month, 10));
  }

  @Get('my-payslips')
  myPayslips() {
    return this.payroll.myPayslips();
  }

  @Get('payslips/:id/pdf')
  async payslipPdf(@Param('id') id: string, @Query('download') download: string | undefined, @Res() res: Response) {
    const buffer = await this.payroll.getPayslipPdf(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="payslip-${id}.pdf"`,
    });
    res.send(buffer);
  }
}
