import { Module } from '@nestjs/common';
import { CountersService } from './counters.service';
import { CountersController } from './counters.controller';
import { VerificationsService } from './verifications.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [CountersService, VerificationsService],
  controllers: [CountersController],
})
export class CountersModule {}
