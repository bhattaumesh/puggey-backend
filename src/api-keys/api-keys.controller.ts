import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CreateApiKeyDto } from './dto/create-api-key.dto';

@Controller('api-keys')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Get()
  list() {
    return this.apiKeys.list();
  }

  @Post()
  create(@Body() dto: CreateApiKeyDto) {
    return this.apiKeys.create(dto.name);
  }

  @Patch(':id/revoke')
  revoke(@Param('id') id: string) {
    return this.apiKeys.revoke(id);
  }
}
