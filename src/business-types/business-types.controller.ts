import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PugeyStaffGuard } from '../auth/pugey-staff.guard';
import { BusinessTypesService } from './business-types.service';
import { CreateBusinessTypeDto } from './dto/create-business-type.dto';
import { UpdateBusinessTypeDto } from './dto/update-business-type.dto';

@Controller('business-types')
@UseGuards(JwtAuthGuard, PugeyStaffGuard)
export class BusinessTypesController {
  constructor(private readonly businessTypes: BusinessTypesService) {}

  @Get()
  list() {
    return this.businessTypes.list();
  }

  @Post()
  create(@Body() dto: CreateBusinessTypeDto) {
    return this.businessTypes.create(dto);
  }

  @Patch(':key')
  update(@Param('key') key: string, @Body() dto: UpdateBusinessTypeDto) {
    return this.businessTypes.update(key, dto);
  }

  @Delete(':key')
  remove(@Param('key') key: string) {
    return this.businessTypes.remove(key);
  }
}
