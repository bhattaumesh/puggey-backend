import { Global, Module } from '@nestjs/common';
import { TenantContextService } from './tenant-context.service';

// Global so any module can inject TenantContextService without an explicit
// import cycle back through AuthModule (which itself needs PrismaModule).
@Global()
@Module({
  providers: [TenantContextService],
  exports: [TenantContextService],
})
export class CommonModule {}
