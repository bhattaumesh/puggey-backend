import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { BillsService } from './bills.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CreateBillDto } from './dto/create-bill.dto';

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

  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @Get('recent')
  recent() {
    return this.bills.recent();
  }

  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @Patch(':id/pay')
  markPaid(@Param('id') id: string) {
    return this.bills.markPaid(id);
  }
}
