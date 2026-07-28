import { Body, Controller, Get, Param, Patch, Post, Delete, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { AdvancesService } from './advances.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CreateAdvanceDto } from './dto/create-advance.dto';
import { UpdateAdvanceDto } from './dto/update-advance.dto';
import { ApplyRecoveryDto } from './dto/apply-recovery.dto';

function parsePeriod(year: string | undefined, month: string | undefined): { year: number; month: number } {
  const y = parseInt(year ?? '', 10);
  const m = parseInt(month ?? '', 10);
  if (!y || !m || m < 1 || m > 12) {
    throw new BadRequestException({ error: 'invalid_period', message: 'Provide a valid year and month.' });
  }
  return { year: y, month: m };
}

@Controller('advances')
@UseGuards(JwtAuthGuard)
export class AdvancesController {
  constructor(private readonly advances: AdvancesService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  create(@Body() dto: CreateAdvanceDto) {
    return this.advances.create(dto);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  update(@Param('id') id: string, @Body() dto: UpdateAdvanceDto) {
    return this.advances.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  remove(@Param('id') id: string) {
    return this.advances.remove(id);
  }

  @Get('member/:membershipId')
  listFor(@Param('membershipId') membershipId: string) {
    return this.advances.listFor(membershipId);
  }

  @Get('net-pay/:membershipId')
  netPay(
    @Param('membershipId') membershipId: string,
    @Query('year') year: string,
    @Query('month') month: string,
    @Query('availableNetPay') availableNetPay: string | undefined,
  ) {
    const cap = availableNetPay !== undefined ? parseFloat(availableNetPay) : undefined;
    return this.advances.netPayPreview(membershipId, parsePeriod(year, month), cap);
  }

  @Post('recovery/:membershipId')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  applyRecovery(@Param('membershipId') membershipId: string, @Body() dto: ApplyRecoveryDto) {
    return this.advances.applyRecovery(membershipId, dto);
  }
}
