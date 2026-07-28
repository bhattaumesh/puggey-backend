import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomBytes, createHash } from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { PrismaService } from '../prisma/prisma.service';
import { runInTenantContext } from '../prisma/rls.util';
import { EmailService } from '../email/email.service';
import { MembershipStatus } from '@prisma/client';
import { DEFAULT_ADVANCE_CATEGORIES } from '../advances/advance-categories.constants';

// A hash of a password nobody will ever type, compared against on every "user not
// found" path so login takes the same amount of time whether the email exists or
// not. Without this, response timing alone reveals which emails are registered.
const DUMMY_HASH = bcrypt.hashSync(randomBytes(32).toString('hex'), 10);

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  role: string;
  tenant: { id: string; slug: string; name: string; accentColorHex: string | null; logoUrl: string | null } | null;
  isPugeyStaff: boolean;
}

type UserForLogin = NonNullable<Awaited<ReturnType<AuthService['findUserForLogin']>>>;

@Injectable()
export class AuthService {
  private googleClient?: OAuth2Client;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly email: EmailService,
  ) {}

  // Runs the credential lookup with the platform-bypass RLS context. This is the
  // one legitimate cross-tenant read in the system: we don't yet know which tenant
  // the caller belongs to, so we can't scope the query to one. Nothing from this
  // lookup is returned to the client beyond the minimal login response below.
  private async findUserForLogin(email: string) {
    return runInTenantContext(this.prisma, { isPugeyStaff: true }, (tx) =>
      tx.user.findUnique({
        where: { email },
        include: {
          memberships: { where: { status: MembershipStatus.active }, include: { tenant: true } },
          pugeyStaff: true,
        },
      }),
    );
  }

  // Shared by password login and Google login: once we know *who* the user is,
  // resolving *which* tenant they're signing into is identical either way.
  private resolveMembership(user: UserForLogin, companyCode?: string) {
    let membership = user.memberships[0];
    if (user.memberships.length > 1) {
      const match = companyCode
        ? user.memberships.find((m) => m.tenant.slug === companyCode || m.tenant.companyCode === companyCode)
        : undefined;
      if (!match) {
        return { error: 'company_code_required' as const };
      }
      membership = match;
    } else if (user.memberships.length === 0 && !user.pugeyStaff) {
      return { error: 'invalid_credentials' as const };
    }
    return { membership };
  }

  private async issueSession(user: UserForLogin, membership: UserForLogin['memberships'][number] | undefined): Promise<LoginResult> {
    const isPugeyStaff = !membership && !!user.pugeyStaff;
    const tenantId = membership?.tenantId;
    const role = membership ? membership.role : 'PUGEY_STAFF';

    await runInTenantContext(this.prisma, { isPugeyStaff: true }, (tx) =>
      tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
    );

    const accessToken = this.jwt.sign(
      { sub: user.id, tenantId, role, isPugeyStaff },
      { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '15m' },
    );
    const refreshToken = await this.issueRefreshToken(user.id, tenantId);

    return {
      accessToken,
      refreshToken,
      role,
      isPugeyStaff,
      tenant: membership
        ? {
            id: membership.tenant.id,
            slug: membership.tenant.slug,
            name: membership.tenant.name,
            accentColorHex: membership.tenant.accentColorHex,
            logoUrl: membership.tenant.logoUrl,
          }
        : null,
    };
  }

  async login(email: string, password: string, companyCode?: string): Promise<LoginResult | { error: 'company_code_required' }> {
    const user = await this.findUserForLogin(email);

    if (!user) {
      await bcrypt.compare(password, DUMMY_HASH);
      throw new UnauthorizedException({ error: 'invalid_credentials', message: 'Incorrect email or password.' });
    }

    const passwordOk = await bcrypt.compare(password, user.passwordHash);
    if (!passwordOk || user.disabled) {
      throw new UnauthorizedException({ error: 'invalid_credentials', message: 'Incorrect email or password.' });
    }

    const resolved = this.resolveMembership(user, companyCode);
    if ('error' in resolved) {
      if (resolved.error === 'company_code_required') return resolved;
      throw new UnauthorizedException({ error: 'invalid_credentials', message: 'Incorrect email or password.' });
    }

    return this.issueSession(user, resolved.membership);
  }

  // Self-service onboarding: anyone can create a new company and becomes its
  // first Super Admin immediately, no Pugey Staff involved. This is the
  // "self-service, no engineering involvement" onboarding path from the spec --
  // separate from the Platform Console flow, which is for staff provisioning a
  // company on someone else's behalf. Rate-limited hard at the controller since
  // this is the one endpoint that lets an anonymous caller create real data.
  async signUp(companyName: string, slug: string, email: string, password: string): Promise<LoginResult> {
    const user = await runInTenantContext(this.prisma, { isPugeyStaff: true }, async (tx) => {
      const existingSlug = await tx.tenant.findUnique({ where: { slug } });
      if (existingSlug) throw new ConflictException({ error: 'slug_taken', message: 'That company URL is already taken. Try another.' });

      const existingUser = await tx.user.findUnique({ where: { email } });
      if (existingUser) {
        throw new ConflictException({ error: 'email_taken', message: 'An account with this email already exists. Sign in instead.' });
      }

      const tenant = await tx.tenant.create({ data: { slug, name: companyName, status: 'trial' } });
      const passwordHash = await bcrypt.hash(password, 10);
      const createdUser = await tx.user.create({ data: { email, passwordHash } });
      await tx.tenantMembership.create({ data: { tenantId: tenant.id, userId: createdUser.id, role: 'SUPER_ADMIN' } });
      await tx.advanceCategory.createMany({
        data: DEFAULT_ADVANCE_CATEGORIES.map((name) => ({ tenantId: tenant.id, name })),
      });

      return tx.user.findUniqueOrThrow({
        where: { id: createdUser.id },
        include: {
          memberships: { where: { status: MembershipStatus.active }, include: { tenant: true } },
          pugeyStaff: true,
        },
      });
    });

    return this.issueSession(user, user.memberships[0]);
  }

  // Google Sign-In authenticates the *credential*, never provisions access on its
  // own -- the email must already have a membership or platform-staff record.
  // Someone with a valid Google account but no invitation still can't get in,
  // which matches "Admins invite; users set their own password" from the spec
  // even when there's no password at all in this path.
  async loginWithGoogle(idToken: string, companyCode?: string): Promise<LoginResult | { error: 'company_code_required' }> {
    if (!process.env.GOOGLE_CLIENT_ID) {
      throw new BadRequestException({ error: 'google_signin_not_configured', message: 'Sign in with Google is not set up yet.' });
    }
    if (!this.googleClient) {
      this.googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    }

    let email: string;
    try {
      const ticket = await this.googleClient.verifyIdToken({ idToken, audience: process.env.GOOGLE_CLIENT_ID });
      const payload = ticket.getPayload();
      if (!payload?.email || !payload.email_verified) {
        throw new Error('unverified');
      }
      email = payload.email;
    } catch {
      throw new UnauthorizedException({ error: 'invalid_google_token', message: 'Could not verify that Google sign-in.' });
    }

    const user = await this.findUserForLogin(email);
    if (!user || user.disabled) {
      throw new UnauthorizedException({
        error: 'no_account',
        message: 'No Pugey account uses this Google email yet. Ask your admin for an invite.',
      });
    }

    const resolved = this.resolveMembership(user, companyCode);
    if ('error' in resolved) {
      if (resolved.error === 'company_code_required') return resolved;
      throw new UnauthorizedException({ error: 'no_account', message: 'No Pugey account uses this Google email yet.' });
    }

    return this.issueSession(user, resolved.membership);
  }

  // A refresh token must be looked up by exact value on every /auth/refresh call,
  // which rules out bcrypt (salted, non-deterministic, can't be queried by
  // equality). SHA-256 is fine here: the input is 48 random bytes of attacker-
  // uncontrolled entropy, not a human password, so there's nothing for a rainbow
  // table to exploit. The same reasoning applies to password reset tokens below.
  static hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  private async issueRefreshToken(userId: string, tenantId?: string): Promise<string> {
    const raw = randomBytes(48).toString('hex');
    const tokenHash = AuthService.hashToken(raw);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await runInTenantContext(this.prisma, { isPugeyStaff: true }, (tx) =>
      tx.refreshToken.create({ data: { userId, tenantId, tokenHash, expiresAt } }),
    );
    return raw;
  }

  async refresh(rawToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const tokenHash = AuthService.hashToken(rawToken);
    const existing = await runInTenantContext(this.prisma, { isPugeyStaff: true }, (tx) =>
      tx.refreshToken.findUnique({ where: { tokenHash }, include: { user: { include: { memberships: true, pugeyStaff: true } } } }),
    );
    if (!existing || existing.revokedAt || existing.expiresAt < new Date()) {
      throw new UnauthorizedException({ error: 'invalid_refresh_token', message: 'Session expired, please log in again.' });
    }

    await runInTenantContext(this.prisma, { isPugeyStaff: true }, (tx) =>
      tx.refreshToken.update({ where: { id: existing.id }, data: { revokedAt: new Date() } }),
    );

    const membership = existing.tenantId ? existing.user.memberships.find((m) => m.tenantId === existing.tenantId) : undefined;
    const role = membership ? membership.role : 'PUGEY_STAFF';
    const isPugeyStaff = !membership;

    const accessToken = this.jwt.sign(
      { sub: existing.userId, tenantId: existing.tenantId, role, isPugeyStaff },
      { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '15m' },
    );
    const refreshToken = await this.issueRefreshToken(existing.userId, existing.tenantId ?? undefined);
    return { accessToken, refreshToken };
  }

  async revokeRefreshToken(rawToken: string): Promise<void> {
    const tokenHash = AuthService.hashToken(rawToken);
    await runInTenantContext(this.prisma, { isPugeyStaff: true }, (tx) =>
      tx.refreshToken.updateMany({ where: { tokenHash }, data: { revokedAt: new Date() } }),
    );
  }

  // Always the same generic response whether or not the email exists -- the
  // controller returns one fixed message regardless of what this does internally.
  async requestPasswordReset(email: string): Promise<void> {
    const user = await runInTenantContext(this.prisma, { isPugeyStaff: true }, (tx) => tx.user.findUnique({ where: { email } }));
    if (!user || user.disabled) return;

    const raw = randomBytes(32).toString('hex');
    const tokenHash = AuthService.hashToken(raw);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await runInTenantContext(this.prisma, { isPugeyStaff: true }, (tx) =>
      tx.passwordResetToken.create({ data: { userId: user.id, tokenHash, expiresAt } }),
    );

    const base = process.env.WEB_APP_URL ?? 'http://localhost:5173';
    const resetUrl = `${base}/reset-password?token=${raw}`;
    await this.email.sendPasswordResetEmail(email, resetUrl);
  }

  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const tokenHash = AuthService.hashToken(rawToken);
    const record = await runInTenantContext(this.prisma, { isPugeyStaff: true }, (tx) =>
      tx.passwordResetToken.findUnique({ where: { tokenHash } }),
    );
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new BadRequestException({ error: 'invalid_reset_token', message: 'This reset link is invalid or has expired.' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await runInTenantContext(this.prisma, { isPugeyStaff: true }, async (tx) => {
      await tx.user.update({ where: { id: record.userId }, data: { passwordHash } });
      await tx.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
      // A password reset is a strong signal to kill every existing session --
      // if the reset was triggered because credentials leaked, stale refresh
      // tokens must not keep working afterward.
      await tx.refreshToken.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    });
  }
}
