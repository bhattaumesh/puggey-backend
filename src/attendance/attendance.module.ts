import { Module } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { AttendanceController } from './attendance.controller';
import { AttendanceQrTokenService } from './attendance-qr-token.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [AttendanceService, AttendanceQrTokenService],
  controllers: [AttendanceController],
})
export class AttendanceModule {}
