import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthenticatedRequest } from '../common/tenant-context.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  // A file link (payslip PDF, Excel export) has to be a plain, navigable URL --
  // no page can attach an Authorization header to a browser's own top-level
  // navigation or an <a download> click. The query token is minted by
  // AuthService.issueDownloadToken from an already-authenticated request and
  // carries the same claim shape as a normal access token, just five minutes
  // instead of fifteen, so it can only ever be used to open one file soon
  // after the app itself requested it.
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    const queryToken = typeof request.query.token === 'string' ? request.query.token : undefined;
    const raw = header?.startsWith('Bearer ') ? header.slice(7) : queryToken;
    if (!raw) {
      throw new UnauthorizedException({ error: 'not_authenticated', message: 'Sign in to continue.' });
    }
    try {
      const payload = this.jwt.verify(raw, { secret: process.env.JWT_ACCESS_SECRET });
      request.userId = payload.sub;
      request.tenantId = payload.tenantId;
      request.role = payload.role;
      request.isPugeyStaff = payload.isPugeyStaff;
      return true;
    } catch {
      throw new UnauthorizedException({ error: 'not_authenticated', message: 'Sign in to continue.' });
    }
  }
}
