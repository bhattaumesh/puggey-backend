import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AdvanceCategoriesService } from './advance-categories.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CreateAdvanceCategoryDto } from './dto/create-advance-category.dto';
import { UpdateAdvanceCategoryDto } from './dto/update-advance-category.dto';

@Controller('advance-categories')
@UseGuards(JwtAuthGuard)
export class AdvanceCategoriesController {
  constructor(private readonly categories: AdvanceCategoriesService) {}

  @Get()
  list() {
    return this.categories.list();
  }

  @Get(':id/usage')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  usage(@Param('id') id: string) {
    return this.categories.usageCount(id).then((count) => ({ count }));
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  create(@Body() dto: CreateAdvanceCategoryDto) {
    return this.categories.create(dto);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  update(@Param('id') id: string, @Body() dto: UpdateAdvanceCategoryDto) {
    return this.categories.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  remove(@Param('id') id: string) {
    return this.categories.remove(id);
  }
}
