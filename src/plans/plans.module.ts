import { Module } from '@nestjs/common';
import { PlansController } from './plans.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [PlansController],
})
export class PlansModule {}
