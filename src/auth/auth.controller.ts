import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { GoogleLoginDto } from './dto/google-login.dto';
import { SignUpDto } from './dto/signup.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { TenantContextService } from '../common/tenant-context.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { effectivePermissions } from '../permissions/permissions';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly ctx: TenantContextService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly jwt: JwtService,
  ) {}

  // 5 attempts per minute per IP. Login, export, and report endpoints are the
  // ones the spec calls out by name for rate limiting.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password, dto.companyCode);
  }

  // The one endpoint an anonymous caller can use to create real data --
  // deliberately the tightest rate limit in the controller.
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('signup')
  @HttpCode(200)
  signUp(@Body() dto: SignUpDto) {
    return this.auth.signUp(dto.companyName, dto.slug, dto.email, dto.password);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('google')
  @HttpCode(200)
  googleLogin(@Body() dto: GoogleLoginDto) {
    return this.auth.loginWithGoogle(dto.idToken, dto.companyCode);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Body() dto: RefreshDto) {
    await this.auth.revokeRefreshToken(dto.refreshToken);
  }

  // Always the same response regardless of whether the email exists -- this is
  // the anti-enumeration guarantee, enforced here at the controller boundary so
  // it can't be accidentally bypassed by a future change to the service method.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('forgot-password')
  @HttpCode(200)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.auth.requestPasswordReset(dto.email);
    return { message: "If an account uses that email, we've sent a reset link." };
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('reset-password')
  @HttpCode(200)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto.token, dto.newPassword);
    return { message: 'Password updated. You can sign in now.' };
  }

  // Mints a short-lived (5 min) token carrying the same claim shape as a
  // normal access token, meant only to sit in the query string of a plain
  // file link (payslip PDF, Excel export) that a page navigates to directly --
  // something a fetch-with-Authorization-header can't produce, since a real
  // browser navigation or <a download> click carries no custom headers.
  @UseGuards(JwtAuthGuard)
  @Get('download-token')
  issueDownloadToken() {
    const token = this.jwt.sign(
      { sub: this.ctx.userId, tenantId: this.ctx.tenantId, role: this.ctx.role, isPugeyStaff: this.ctx.isPugeyStaff },
      { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '5m' },
    );
    return { token };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/permissions')
  async myPermissions() {
    const role = this.ctx.isPugeyStaff ? 'PUGEY_STAFF' : this.ctx.role!;
    const isDelegatedLeaveApprover = await this.checkIsDelegatedLeaveApprover();
    return effectivePermissions(role, { isDelegatedLeaveApprover });
  }

  // "Delegated approver" here means: is this person anyone's direct supervisor
  // (the default leave-approval chain), or has anyone named them as a stand-in
  // via ApprovalDelegation. Either makes them a real approver for someone, which
  // is what gates whether the frontend shows the Leave Approvals view at all.
  private async checkIsDelegatedLeaveApprover(): Promise<boolean> {
    if (this.ctx.isPugeyStaff || !this.ctx.tenantId || !this.ctx.userId) return false;
    return this.tenantPrisma.run(async (tx) => {
      const membership = await tx.tenantMembership.findUnique({
        where: { tenantId_userId: { tenantId: this.ctx.tenantId!, userId: this.ctx.userId! } },
        select: { id: true },
      });
      if (!membership) return false;
      const [reportsCount, delegateCount] = await Promise.all([
        tx.tenantMembership.count({ where: { supervisorMembershipId: membership.id, status: 'active' } }),
        tx.approvalDelegation.count({ where: { delegateMembershipId: membership.id, active: true } }),
      ]);
      return reportsCount > 0 || delegateCount > 0;
    });
  }
}
