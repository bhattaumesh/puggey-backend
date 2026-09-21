import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { LocationsService } from './locations.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';

@Controller('locations')
@UseGuards(JwtAuthGuard)
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'SUPERVISOR')
  @Post()
  createLocation(@Body() dto: CreateLocationDto) {
    return this.locations.createLocation(dto);
  }

  // Open to every role -- an employee's own clock-in screen needs to know
  // the registered locations' names too (e.g. "You're not near Niuto
  // Store"), not just admins managing them.
  @Get()
  listLocations() {
    return this.locations.listLocations();
  }

  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'SUPERVISOR')
  @Patch(':id')
  updateLocation(@Param('id') id: string, @Body() dto: UpdateLocationDto) {
    return this.locations.updateLocation(id, dto);
  }

  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'SUPERVISOR')
  @Delete(':id')
  deleteLocation(@Param('id') id: string) {
    return this.locations.deleteLocation(id);
  }
}
