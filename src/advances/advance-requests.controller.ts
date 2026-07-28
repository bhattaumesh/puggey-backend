import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AdvanceRequestsService } from './advance-requests.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { SubmitAdvanceRequestDto } from './dto/submit-advance-request.dto';
import { DecideAdvanceRequestDto } from './dto/decide-advance-request.dto';

@Controller('advance-requests')
@UseGuards(JwtAuthGuard)
export class AdvanceRequestsController {
  constructor(private readonly requests: AdvanceRequestsService) {}

  @Get('mine')
  myRequests() {
    return this.requests.myRequests();
  }

  @Post()
  submitRequest(@Body() dto: SubmitAdvanceRequestDto) {
    return this.requests.submitRequest(dto);
  }

  @Patch(':id/cancel')
  cancelRequest(@Param('id') id: string) {
    return this.requests.cancelRequest(id);
  }

  @Get('pending')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  pendingApprovals() {
    return this.requests.pendingApprovals();
  }

  @Patch(':id/decide')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  decide(@Param('id') id: string, @Body() dto: DecideAdvanceRequestDto) {
    return this.requests.decide(id, dto);
  }
}
