import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { MembershipStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { TenantContextService } from '../common/tenant-context.service';
import { runInTenantContext } from '../prisma/rls.util';
import { planLimit, planLabel, isPlanKey } from '../plans/plan-tiers';
import { DEFAULT_ADVANCE_CATEGORIES } from '../advances/advance-categories.constants';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { UpdateTenantPlanDto } from './dto/update-tenant-plan.dto';

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly ctx: TenantContextService,
  ) {}

  // Platform-only: a Pugey Staff member provisions a new company and its first
  // Super Admin in one step. This is the "Super Admin grants rights to a
  // company-based admin" flow -- the platform never hands out access without a
  // staff member deliberately creating it.
  async createTenantWithAdmin(dto: CreateTenantDto) {
    return runInTenantContext(this.prisma, { isPugeyStaff: true }, async (tx) => {
      const existingSlug = await tx.tenant.findUnique({ where: { slug: dto.slug } });
      if (existingSlug) throw new ConflictException({ error: 'slug_taken', message: 'That company slug is already in use.' });

      const tenant = await tx.tenant.create({
        data: { slug: dto.slug, name: dto.name, companyCode: dto.companyCode, accentColorHex: dto.accentColorHex, status: 'active' },
      });

      let user = await tx.user.findUnique({ where: { email: dto.adminEmail } });
      if (!user) {
        const passwordHash = await bcrypt.hash(dto.adminPassword, 10);
        user = await tx.user.create({ data: { email: dto.adminEmail, passwordHash } });
      }

      await tx.tenantMembership.create({ data: { tenantId: tenant.id, userId: user.id, role: 'SUPER_ADMIN' } });
      await tx.advanceCategory.createMany({
        data: DEFAULT_ADVANCE_CATEGORIES.map((name) => ({ tenantId: tenant.id, name })),
      });

      return tenant;
    });
  }

  // Ordinary tenant-scoped read: goes through RLS. Returns null (not an error) if
  // the caller's tenant somehow doesn't resolve, which the controller turns into
  // a clean not-authorized/not-found response rather than leaking a stack trace.
  //
  // Pugey Staff sessions have no tenant at all -- their RLS bypass grants
  // visibility into every tenant row, so an unfiltered findFirst() would return
  // an arbitrary company rather than "none", which is the correct answer here.
  async getMyTenant() {
    if (this.ctx.isPugeyStaff || !this.ctx.tenantId) return null;
    return this.tenantPrisma.run(async (tx) => {
      const tenant = await tx.tenant.findFirst({ where: { id: this.ctx.tenantId } });
      if (!tenant) return null;
      const employeeCount = await tx.tenantMembership.count({ where: { tenantId: tenant.id, status: MembershipStatus.active } });
      return { ...tenant, planLabel: planLabel(tenant.plan), employeeCount, employeeLimit: planLimit(tenant.plan) };
    });
  }

  // Company setup: name/logo/accent color, restricted to Super Admin by the
  // controller's @Roles guard. RLS additionally guarantees this can only ever
  // touch the caller's own tenant row, even if that guard were misconfigured.
  updateMyTenant(dto: UpdateTenantDto) {
    const tenantId = this.ctx.tenantId!;
    return this.tenantPrisma.run((tx) => tx.tenant.update({ where: { id: tenantId }, data: dto }));
  }

  // Platform-only: every company, with plan and current usage, so Pugey staff
  // can see who is near a limit before moving them to a paid tier.
  listAllTenants() {
    return runInTenantContext(this.prisma, { isPugeyStaff: true }, async (tx) => {
      const tenants = await tx.tenant.findMany({ orderBy: { createdAt: 'desc' } });
      const counts = await tx.tenantMembership.groupBy({ by: ['tenantId'], where: { status: MembershipStatus.active }, _count: true });
      const countByTenant = new Map(counts.map((c) => [c.tenantId, c._count]));
      return tenants.map((t) => ({
        id: t.id,
        slug: t.slug,
        name: t.name,
        status: t.status,
        plan: t.plan,
        planLabel: planLabel(t.plan),
        employeeCount: countByTenant.get(t.id) ?? 0,
        employeeLimit: planLimit(t.plan),
        createdAt: t.createdAt,
      }));
    });
  }

  // Platform-only: move a tenant between plan tiers. This only changes the
  // stored limit -- there is no payment step here, see plan-tiers.ts.
  async updateTenantPlan(tenantId: string, dto: UpdateTenantPlanDto) {
    if (!isPlanKey(dto.plan)) {
      throw new NotFoundException({ error: 'unknown_plan', message: 'That plan does not exist.' });
    }
    return runInTenantContext(this.prisma, { isPugeyStaff: true }, async (tx) => {
      const existing = await tx.tenant.findUnique({ where: { id: tenantId } });
      if (!existing) throw new NotFoundException({ error: 'not_found', message: 'No such company.' });
      return tx.tenant.update({ where: { id: tenantId }, data: { plan: dto.plan } });
    });
  }
}
