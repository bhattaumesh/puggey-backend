import { Module } from '@nestjs/common';
import { PayrollService } from './payroll.service';
import { PayrollController } from './payroll.controller';
import { AuthModule } from '../auth/auth.module';
import { AdvancesModule } from '../advances/advances.module';

@Module({
  imports: [AuthModule, AdvancesModule],
  providers: [PayrollService],
  controllers: [PayrollController],
})
export class PayrollModule {}
