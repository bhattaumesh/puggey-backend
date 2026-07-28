import { SetMetadata } from '@nestjs/common';
import { TenantRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

// Tenant-scoped roles only. Platform (Pugey staff) endpoints use @PugeyStaffOnly()
// instead, since staff never hold a TenantRole.
export const Roles = (...roles: TenantRole[]) => SetMetadata(ROLES_KEY, roles);
