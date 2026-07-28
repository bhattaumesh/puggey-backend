import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { LeaveService } from './leave.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CreateLeaveTypeDto } from './dto/create-leave-type.dto';
import { SubmitLeaveRequestDto } from './dto/submit-leave-request.dto';
import { DecideLeaveRequestDto } from './dto/decide-leave-request.dto';
import { CreateDelegationDto } from './dto/create-delegation.dto';
import { UpdateDelegationDto } from './dto/update-delegation.dto';

@Controller('leave')
@UseGuards(JwtAuthGuard)
export class LeaveController {
  constructor(private readonly leave: LeaveService) {}

  @Get('types')
  listTypes() {
    return this.leave.listTypes();
  }

  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @Post('types')
  createType(@Body() dto: CreateLeaveTypeDto) {
    return this.leave.createType(dto);
  }

  @Get('me/balances')
  myBalances(@Query('year') year?: string) {
    return this.leave.myBalances(year ? parseInt(year, 10) : undefined);
  }

  @Get('me/requests')
  myRequests() {
    return this.leave.myRequests();
  }

  @Post('requests')
  submitRequest(@Body() dto: SubmitLeaveRequestDto) {
    return this.leave.submitRequest(dto);
  }

  @Post('requests/:id/cancel')
  cancelRequest(@Param('id') id: string) {
    return this.leave.cancelRequest(id);
  }

  @Get('approvals/pending')
  pendingApprovals() {
    return this.leave.pendingApprovals();
  }

  @Post('requests/:id/decision')
  decide(@Param('id') id: string, @Body() dto: DecideLeaveRequestDto) {
    return this.leave.decide(id, dto);
  }

  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @Get('delegations')
  listDelegations() {
    return this.leave.listDelegations();
  }

  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @Post('delegations')
  createDelegation(@Body() dto: CreateDelegationDto) {
    return this.leave.createDelegation(dto);
  }

  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @Patch('delegations/:id')
  updateDelegation(@Param('id') id: string, @Body() dto: UpdateDelegationDto) {
    return this.leave.updateDelegation(id, dto);
  }
}
