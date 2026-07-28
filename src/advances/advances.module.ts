import { Module } from '@nestjs/common';
import { AdvancesService } from './advances.service';
import { AdvancesController } from './advances.controller';
import { AdvanceCategoriesService } from './advance-categories.service';
import { AdvanceCategoriesController } from './advance-categories.controller';
import { AdvanceRequestsService } from './advance-requests.service';
import { AdvanceRequestsController } from './advance-requests.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [AdvancesService, AdvanceCategoriesService, AdvanceRequestsService],
  controllers: [AdvancesController, AdvanceCategoriesController, AdvanceRequestsController],
  exports: [AdvancesService],
})
export class AdvancesModule {}
