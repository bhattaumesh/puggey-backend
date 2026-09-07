import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ShiftsService } from './shifts.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CreateShiftDto } from './dto/create-shift.dto';
import { UpdateShiftDto } from './dto/update-shift.dto';
import { AssignShiftDto } from './dto/assign-shift.dto';

@Controller('shifts')
@UseGuards(JwtAuthGuard)
export class ShiftsController {
  constructor(private readonly shifts: ShiftsService) {}

  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @Post()
  createShift(@Body() dto: CreateShiftDto) {
    return this.shifts.createShift(dto);
  }

  @Get()
  listShifts() {
    return this.shifts.listShifts();
  }

  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @Patch(':id')
  updateShift(@Param('id') id: string, @Body() dto: UpdateShiftDto) {
    return this.shifts.updateShift(id, dto);
  }

  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @Delete(':id')
  deleteShift(@Param('id') id: string) {
    return this.shifts.deleteShift(id);
  }

  @Get('my-upcoming')
  myUpcoming() {
    return this.shifts.myUpcoming();
  }

  @Get('calendar')
  calendar(@Query('start') start: string, @Query('end') end: string) {
    return this.shifts.calendar(start, end);
  }

  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'SUPERVISOR')
  @Post('assignments')
  assign(@Body() dto: AssignShiftDto) {
    return this.shifts.assign(dto);
  }

  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'SUPERVISOR')
  @Delete('assignments/:id')
  unassign(@Param('id') id: string) {
    return this.shifts.unassign(id);
  }
}
