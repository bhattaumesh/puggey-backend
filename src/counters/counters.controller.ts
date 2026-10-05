import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CountersService } from './counters.service';
import { VerificationsService } from './verifications.service';
import { SaveVerificationDto } from './dto/save-verification.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CreateCounterDto } from './dto/create-counter.dto';
import { OpenCounterSessionDto } from './dto/open-session.dto';
import { CloseCounterSessionDto } from './dto/close-session.dto';
import { AddCashMovementDto } from './dto/add-cash-movement.dto';
import { VerifyCounterSessionDto } from './dto/verify-session.dto';
import { EditClosingDetailsDto } from './dto/edit-closing-details.dto';
import { EditOpeningDetailsDto } from './dto/edit-opening-details.dto';
import { EditCashMovementDto } from './dto/edit-cash-movement.dto';
import { EditSalesDetailsDto } from './dto/edit-sales-details.dto';
import { UpdateCounterDto } from './dto/update-counter.dto';
import { ReassignCounterStaffDto } from './dto/reassign-counter-staff.dto';
import { VerifyExportDto } from './dto/verify-export.dto';

@Controller('counters')
@UseGuards(JwtAuthGuard)
export class CountersController {
  constructor(
    private readonly counters: CountersService,
    private readonly verifications: VerificationsService,
  ) {}

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

  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @Patch(':id')
  renameCounter(@Param('id') id: string, @Body() dto: UpdateCounterDto) {
    return this.counters.renameCounter(id, dto);
  }

  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @Delete(':id')
  deleteCounter(@Param('id') id: string) {
    return this.counters.deleteCounter(id);
  }

  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @Patch('sessions/:id/staff')
  reassignStaff(@Param('id') id: string, @Body() dto: ReassignCounterStaffDto) {
    return this.counters.reassignStaff(id, dto);
  }

  // The "Verify Online Transaction" tab matches in the browser; these two
  // routes only turn its finished table into an Excel/PDF file. The table is
  // parked for a few minutes so the file can be fetched with a plain GET link
  // (what the app's WebView needs), see openOrDownload in the web client.
  @Post('verify-export')
  createVerifyExport(@Body() dto: VerifyExportDto) {
    return this.counters.createVerifyExport(dto);
  }

  @Get('verify-export/:id/:format')
  async verifyExportFile(@Param('id') id: string, @Param('format') format: string, @Res() res: Response) {
    const { buffer, contentType, fileName } = await this.counters.getVerifyExportFile(id, format);
    res.set({ 'Content-Type': contentType, 'Content-Disposition': `attachment; filename="${fileName}"` });
    res.send(buffer);
  }

  // Saved Verify Online Transaction reports. Any role that can see the tab
  // (Super Admin, Admin, supervisor) can save and read them; only Super Admin
  // can delete one.
  @Post('verifications')
  saveVerification(@Body() dto: SaveVerificationDto) {
    return this.verifications.save(dto);
  }

  @Get('verifications')
  listVerifications(@Query('from') from?: string, @Query('to') to?: string) {
    return this.verifications.list(from, to);
  }

  @Get('verifications/:id')
  getVerification(@Param('id') id: string) {
    return this.verifications.get(id);
  }

  @Get('verifications/:id/:format')
  async verificationFile(@Param('id') id: string, @Param('format') format: string, @Res() res: Response) {
    const { buffer, contentType, fileName } = await this.verifications.file(id, format);
    res.set({ 'Content-Type': contentType, 'Content-Disposition': `attachment; filename="${fileName}"` });
    res.send(buffer);
  }

  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @Delete('verifications/:id')
  deleteVerification(@Param('id') id: string) {
    return this.verifications.remove(id);
  }

  // Names of the employees an outflow can be recorded against (advance /
  // purchase). Open to anyone handling a counter or with team access.
  @Get('staff')
  staff() {
    return this.counters.staffDirectory();
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

  // Admin-only: unlike closing-details (open to whoever handled the till),
  // rewriting the OPENING figures is a more consequential correction, so
  // it's restricted to Super Admin.
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @Patch('sessions/:id/opening-details')
  editOpeningDetails(@Param('id') id: string, @Body() dto: EditOpeningDetailsDto) {
    return this.counters.editOpeningDetails(id, dto);
  }

  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @Patch('sessions/:id/sales')
  editSalesDetails(@Param('id') id: string, @Body() dto: EditSalesDetailsDto) {
    return this.counters.editSalesDetails(id, dto);
  }

  // Admin-only, like editOpeningDetails: correcting or removing a single
  // inflow/outflow entry rewrites part of the reconciliation's history.
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @Patch('sessions/:id/movements/:movementId')
  editMovement(@Param('id') id: string, @Param('movementId') movementId: string, @Body() dto: EditCashMovementDto) {
    return this.counters.editMovement(id, movementId, dto);
  }

  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @Delete('sessions/:id/movements/:movementId')
  deleteMovement(@Param('id') id: string, @Param('movementId') movementId: string) {
    return this.counters.deleteMovement(id, movementId);
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
