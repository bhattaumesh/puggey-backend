import { Module } from '@nestjs/common';
import { RacksService } from './racks.service';
import { RacksController } from './racks.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [RacksService],
  controllers: [RacksController],
})
export class RacksModule {}
