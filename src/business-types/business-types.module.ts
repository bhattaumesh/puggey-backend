import { Module } from '@nestjs/common';
import { BusinessTypesController } from './business-types.controller';
import { BusinessTypesService } from './business-types.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [BusinessTypesController],
  providers: [BusinessTypesService],
  exports: [BusinessTypesService],
})
export class BusinessTypesModule {}
