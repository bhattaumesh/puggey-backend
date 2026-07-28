import { Module } from '@nestjs/common';
import { ExternalController } from './external.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [ExternalController],
})
export class ExternalModule {}
