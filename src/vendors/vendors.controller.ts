import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { VendorsService } from './vendors.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CreateVendorDto } from './dto/create-vendor.dto';
import { ReceiveProductDto } from './dto/receive-product.dto';

@Controller('vendors')
@UseGuards(JwtAuthGuard)
export class VendorsController {
  constructor(private readonly vendors: VendorsService) {}

  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @Post()
  create(@Body() dto: CreateVendorDto) {
    return this.vendors.createVendor(dto);
  }

  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @Get('search')
  search(@Query('q') q: string | undefined) {
    return this.vendors.search(q ?? '');
  }

  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @Get('recent')
  recent() {
    return this.vendors.recent();
  }

  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @Get(':id/history')
  history(@Param('id') id: string, @Query('limit') limit: string | undefined) {
    return this.vendors.history(id, limit ? parseInt(limit, 10) : undefined);
  }

  // Any employee can list vendors to pick one when logging a receipt --
  // unlike search/recent/history, this isn't admin-only.
  @Get()
  list() {
    return this.vendors.list();
  }

  @Post(':id/receive')
  receive(@Param('id') id: string, @Body() dto: ReceiveProductDto) {
    return this.vendors.receive(id, dto);
  }
}
