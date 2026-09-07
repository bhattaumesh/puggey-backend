import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { BillsService } from './bills.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CreateBillDto } from './dto/create-bill.dto';
import { EnterBillDto } from './dto/enter-bill.dto';

@Controller('bills')
@UseGuards(JwtAuthGuard)
export class BillsController {
  constructor(private readonly bills: BillsService) {}

  @Post()
  create(@Body() dto: CreateBillDto) {
    return this.bills.create(dto);
  }

  @Get('pending')
  pending() {
    return this.bills.pending();
  }

  @Get('mine')
  mine() {
    return this.bills.mine();
  }

  // Every bill entered, any status -- open to any employee (see Command:
  // Bills should be an everyday, not admin-only, screen).
  @Get('recent')
  recent() {
    return this.bills.recent();
  }

  // Open to any employee -- entering a bill's details is a normal part of
  // day-to-day use, not an admin-only action (see Product Received/receive).
  @Patch(':id/enter')
  markEntered(@Param('id') id: string, @Body() dto: EnterBillDto) {
    return this.bills.markEntered(id, dto);
  }

  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @Patch(':id/pay')
  markPaid(@Param('id') id: string) {
    return this.bills.markPaid(id);
  }
}
