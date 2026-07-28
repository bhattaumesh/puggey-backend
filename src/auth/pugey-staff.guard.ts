import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthenticatedRequest } from '../common/tenant-context.service';

// Platform-only endpoints (tenant provisioning, plan/billing management) use this
// instead of RolesGuard -- Pugey staff never hold a TenantRole, so the ordinary
// role check doesn't apply to them at all.
@Injectable()
export class PugeyStaffGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.isPugeyStaff) {
      throw new ForbiddenException({ error: 'not_authorized', message: 'You do not have access to this.' });
    }
    return true;
  }
}
