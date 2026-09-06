import { Module } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './common/common.module';
import { EmailModule } from './email/email.module';
import { AuthModule } from './auth/auth.module';
import { TenantsModule } from './tenants/tenants.module';
import { TenantMembershipsModule } from './tenant-memberships/tenant-memberships.module';
import { EmployeesModule } from './employees/employees.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AttendanceModule } from './attendance/attendance.module';
import { LeaveModule } from './leave/leave.module';
import { ReportsModule } from './reports/reports.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { ExternalModule } from './external/external.module';
import { PlansModule } from './plans/plans.module';
import { PayrollModule } from './payroll/payroll.module';
import { DocumentsModule } from './documents/documents.module';
import { AdvancesModule } from './advances/advances.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { TasksModule } from './tasks/tasks.module';
import { RacksModule } from './racks/racks.module';
import { VendorsModule } from './vendors/vendors.module';
import { ProductsModule } from './products/products.module';
import { ShiftsModule } from './shifts/shifts.module';

@Module({
  imports: [
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 100 }] }),
    CommonModule,
    PrismaModule,
    EmailModule,
    AuthModule,
    TenantsModule,
    TenantMembershipsModule,
    EmployeesModule,
    NotificationsModule,
    AttendanceModule,
    LeaveModule,
    ReportsModule,
    ApiKeysModule,
    ExternalModule,
    PlansModule,
    PayrollModule,
    DocumentsModule,
    AdvancesModule,
    DashboardModule,
    TasksModule,
    RacksModule,
    VendorsModule,
    ProductsModule,
    ShiftsModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
