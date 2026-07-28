import { Inject, Injectable, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { Request } from 'express';
import { TenantRole } from '@prisma/client';

export interface AuthenticatedRequest extends Request {
  userId?: string;
  tenantId?: string;
  role?: TenantRole;
  isPugeyStaff?: boolean;
  isApiKey?: boolean;
}

// Request-scoped: populated by JwtAuthGuard once the token is verified. Every
// tenant-scoped service reads the active tenant/user/role from here rather than
// trusting anything the client sends in a body or query string.
@Injectable({ scope: Scope.REQUEST })
export class TenantContextService {
  constructor(@Inject(REQUEST) private readonly request: AuthenticatedRequest) {}

  get userId(): string | undefined {
    return this.request.userId;
  }

  get tenantId(): string | undefined {
    return this.request.tenantId;
  }

  get role(): TenantRole | undefined {
    return this.request.role;
  }

  get isPugeyStaff(): boolean {
    return !!this.request.isPugeyStaff;
  }
}
