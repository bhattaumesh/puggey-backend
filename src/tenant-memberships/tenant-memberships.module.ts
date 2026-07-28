import { Module } from '@nestjs/common';
import { TenantMembershipsService } from './tenant-memberships.service';
import { TenantMembershipsController } from './tenant-memberships.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [TenantMembershipsService],
  controllers: [TenantMembershipsController],
})
export class TenantMembershipsModule {}
