import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';
import { AuthenticatedRequest } from '../common/tenant-context.service';
import { TenantRole } from '@prisma/client';

// Authorization check, run after JwtAuthGuard. Denies with a clean, generic
// "not authorized" shape -- never a raw 500, never a partial response -- so the
// client can render one consistent not-authorized state everywhere.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<TenantRole[]>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.isPugeyStaff || !request.role || !required.includes(request.role)) {
      throw new ForbiddenException({ error: 'not_authorized', message: 'You do not have access to this.' });
    }
    return true;
  }
}
