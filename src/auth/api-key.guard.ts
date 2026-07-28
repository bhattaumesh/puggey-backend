import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { runInTenantContext } from '../prisma/rls.util';
import { AuthenticatedRequest } from '../common/tenant-context.service';
import { hashApiKey } from '../api-keys/api-key.util';

// Guards the read-only external API (ExternalController) only -- never the
// main app's own endpoints. An API key identifies a tenant, not a person, so
// this sets tenantId but deliberately leaves userId unset; the resolved
// tenant's data is still fully RLS-scoped once the request context is set.
//
// The lookup-by-hash happens before any tenant is known, so it runs under the
// same platform-bypass context as every other chicken-and-egg read/write in
// this app (see EmployeesService.create for the canonical example).
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer pugey_live_')) {
      throw new UnauthorizedException({ error: 'not_authenticated', message: 'A valid API key is required.' });
    }
    const raw = header.slice(7);
    const hash = hashApiKey(raw);

    const apiKey = await runInTenantContext(this.prisma, { isPugeyStaff: true }, (tx) => tx.apiKey.findUnique({ where: { keyHash: hash } }));

    if (!apiKey || apiKey.revokedAt) {
      throw new UnauthorizedException({ error: 'not_authenticated', message: 'A valid API key is required.' });
    }

    await runInTenantContext(this.prisma, { isPugeyStaff: true }, (tx) => tx.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } }));

    request.tenantId = apiKey.tenantId;
    request.isPugeyStaff = false;
    request.isApiKey = true;
    return true;
  }
}
