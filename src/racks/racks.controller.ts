import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { RacksService } from './racks.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CreateRackDto } from './dto/create-rack.dto';
import { UpdateRackDto } from './dto/update-rack.dto';
import { CleanRackDto } from './dto/clean-rack.dto';
import { AssignRackDto } from './dto/assign-rack.dto';

@Controller('racks')
@UseGuards(JwtAuthGuard)
export class RacksController {
  constructor(private readonly racks: RacksService) {}

  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @Post()
  create(@Body() dto: CreateRackDto) {
    return this.racks.createRack(dto);
  }

  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateRackDto) {
    return this.racks.updateRack(id, dto);
  }

  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.racks.deleteRack(id);
  }

  @Get('search')
  search(@Query('q') q: string | undefined) {
    return this.racks.search(q ?? '');
  }

  @Get('recently-cleaned')
  recentlyCleaned() {
    return this.racks.recentlyCleaned();
  }

  @Get('pending')
  pending() {
    return this.racks.pending();
  }

  @Get('my-assignments')
  myAssignments() {
    return this.racks.myAssignments();
  }

  @Get(':id/history')
  history(@Param('id') id: string, @Query('limit') limit: string | undefined) {
    return this.racks.history(id, limit ? parseInt(limit, 10) : undefined);
  }

  @Post(':id/clean')
  clean(@Param('id') id: string, @Body() dto: CleanRackDto) {
    return this.racks.clean(id, dto);
  }

  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'SUPERVISOR')
  @Post(':id/assign')
  assign(@Param('id') id: string, @Body() dto: AssignRackDto) {
    return this.racks.assignRack(id, dto);
  }

  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'SUPERVISOR')
  @Post('assignments/:id/cancel')
  cancelAssignment(@Param('id') id: string) {
    return this.racks.cancelAssignment(id);
  }
}
