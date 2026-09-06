import { Module } from '@nestjs/common';
import { CountersService } from './counters.service';
import { CountersController } from './counters.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [CountersService],
  controllers: [CountersController],
})
export class CountersModule {}
