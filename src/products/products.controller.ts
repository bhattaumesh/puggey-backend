import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ProductsService } from './products.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CreateProductDto } from './dto/create-product.dto';

@Controller('products')
@UseGuards(JwtAuthGuard)
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @Post()
  create(@Body() dto: CreateProductDto) {
    return this.products.create(dto);
  }

  // Any employee can list products to tag a receipt with one -- same rule
  // as vendors: browsing the catalog isn't admin-only, creating tags is.
  @Get()
  list() {
    return this.products.list();
  }
}
