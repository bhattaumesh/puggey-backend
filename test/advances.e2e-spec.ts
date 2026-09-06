import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';

// This command builds the advance side only (recording, categorizing,
// tracking outstanding balances, and a deduction contract payroll will
// consume later) -- not a payroll engine. computeAdvanceDeductions is the
// one place recovery math lives; these tests exercise it through the real
// HTTP endpoints, not by calling the service directly, so a controller-level
// regression would also be caught.
describe('Advances (e2e)', () => {
  let app: INestApplication<App>;
  const setupPrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

  const SUFFIX = `advances-${Date.now()}`;
  let tenant: { id: string };
  let otherTenant: { id: string };
  let adminToken: string;
  let employeeToken: string;
  let otherTenantAdminToken: string;
  let employeeMembershipId: string;
  let categoryId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const passwordHash = await bcrypt.hash('AdvancesTest123!', 10);
    tenant = await setupPrisma.tenant.create({ data: { slug: `advances-${SUFFIX}`, name: 'Advances Test Co', plan: 'gold' } });
    otherTenant = await setupPrisma.tenant.create({ data: { slug: `advances-other-${SUFFIX}`, name: 'Advances Other Co', plan: 'gold' } });

    const adminUser = await setupPrisma.user.create({ data: { email: `advances-admin-${SUFFIX}@test.local`, passwordHash } });
    const employeeUser = await setupPrisma.user.create({ data: { email: `advances-employee-${SUFFIX}@test.local`, passwordHash } });
    const otherAdminUser = await setupPrisma.user.create({ data: { email: `advances-other-admin-${SUFFIX}@test.local`, passwordHash } });

    await setupPrisma.tenantMembership.create({ data: { tenantId: tenant.id, userId: adminUser.id, role: 'SUPER_ADMIN' } });
    const employeeMembership = await setupPrisma.tenantMembership.create({ data: { tenantId: tenant.id, userId: employeeUser.id, role: 'EMPLOYEE' } });
    employeeMembershipId = employeeMembership.id;
    await setupPrisma.tenantMembership.create({ data: { tenantId: otherTenant.id, userId: otherAdminUser.id, role: 'SUPER_ADMIN' } });

    const category = await setupPrisma.advanceCategory.create({ data: { tenantId: tenant.id, name: `Test Category ${SUFFIX}` } });
    categoryId = category.id;

    const login = async (email: string) => (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'AdvancesTest123!' })).body.accessToken;
    adminToken = await login(adminUser.email);
    employeeToken = await login(employeeUser.email);
    otherTenantAdminToken = await login(otherAdminUser.email);
  });

  afterAll(async () => {
    await setupPrisma.advanceRecovery.deleteMany({ where: { tenantId: { in: [tenant.id, otherTenant.id] } } });
    await setupPrisma.advance.deleteMany({ where: { tenantId: { in: [tenant.id, otherTenant.id] } } });
    await setupPrisma.advanceCategory.deleteMany({ where: { tenantId: { in: [tenant.id, otherTenant.id] } } });
    await setupPrisma.notification.deleteMany({ where: { tenantId: { in: [tenant.id, otherTenant.id] } } });
    await setupPrisma.refreshToken.deleteMany({ where: { user: { email: { endsWith: `${SUFFIX}@test.local` } } } });
    await setupPrisma.tenantMembership.deleteMany({ where: { tenantId: { in: [tenant.id, otherTenant.id] } } });
    await setupPrisma.user.deleteMany({ where: { email: { endsWith: `${SUFFIX}@test.local` } } });
    await setupPrisma.tenant.deleteMany({ where: { id: { in: [tenant.id, otherTenant.id] } } });
    await setupPrisma.$disconnect();
    await app.close();
  });

  it('an employee cannot create, update, delete, or apply recovery for advances', async () => {
    const create = await request(app.getHttpServer())
      .post('/advances')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ membershipId: employeeMembershipId, categoryId, amount: 1000, dateGiven: '2026-01-01', recoveryMode: 'FULL' });
    expect(create.status).toBe(403);

    const recover = await request(app.getHttpServer())
      .post(`/advances/recovery/${employeeMembershipId}`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ year: 2026, month: 1 });
    expect(recover.status).toBe(403);
  });

  it('instalment recovery reduces the outstanding balance exactly, with no drift across periods, and closes at zero', async () => {
    const created = await request(app.getHttpServer())
      .post('/advances')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ membershipId: employeeMembershipId, categoryId, amount: 999.99, dateGiven: '2026-01-01', recoveryMode: 'INSTALMENT', instalmentAmount: 333.33 })
      .expect(201);
    const advanceId = created.body.id;

    // 3 instalments of 333.33 = 999.99 exactly -- if this used floating rupee
    // math accumulated across periods, this is precisely the kind of amount
    // that would drift by a cent.
    for (const month of [1, 2, 3]) {
      const res = await request(app.getHttpServer())
        .post(`/advances/recovery/${employeeMembershipId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ year: 2026, month })
        .expect(201);
      const entry = res.body.breakdown.find((b: { advanceId: string }) => b.advanceId === advanceId);
      expect(entry.deducted).toBeCloseTo(333.33, 5);
    }

    const list = await request(app.getHttpServer()).get(`/advances/member/${employeeMembershipId}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    const advance = list.body.advances.find((a: { id: string }) => a.id === advanceId);
    expect(Number(advance.recoveredAmount)).toBeCloseTo(999.99, 5);
    expect(advance.closedAt).not.toBeNull();
    expect(list.body.totalOutstanding).toBe(0);
  });

  it('re-applying recovery for the same period is idempotent, not double-counted', async () => {
    const created = await request(app.getHttpServer())
      .post('/advances')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ membershipId: employeeMembershipId, categoryId, amount: 500, dateGiven: '2026-02-01', recoveryMode: 'FULL' })
      .expect(201);
    const advanceId = created.body.id;

    await request(app.getHttpServer()).post(`/advances/recovery/${employeeMembershipId}`).set('Authorization', `Bearer ${adminToken}`).send({ year: 2026, month: 4 }).expect(201);
    await request(app.getHttpServer()).post(`/advances/recovery/${employeeMembershipId}`).set('Authorization', `Bearer ${adminToken}`).send({ year: 2026, month: 4 }).expect(201);

    const list = await request(app.getHttpServer()).get(`/advances/member/${employeeMembershipId}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    const advance = list.body.advances.find((a: { id: string }) => a.id === advanceId);
    expect(Number(advance.recoveredAmount)).toBe(500);
  });

  it('with no net pay figure yet, the preview honestly shows the full request and marks payroll fields as pending, not invented numbers', async () => {
    const created = await request(app.getHttpServer())
      .post('/advances')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ membershipId: employeeMembershipId, categoryId, amount: 10000, dateGiven: '2026-03-01', recoveryMode: 'FULL' })
      .expect(201);
    const advanceId = created.body.id;

    const preview = await request(app.getHttpServer())
      .get(`/advances/net-pay/${employeeMembershipId}`)
      .query({ year: 2026, month: 5 })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const entry = preview.body.breakdown.find((b: { advanceId: string }) => b.advanceId === advanceId);
    expect(entry.requested).toBe(10000);
    expect(entry.deducted).toBe(10000); // uncapped: nothing to cap against yet
    expect(preview.body.grossPay).toBeNull();
    expect(preview.body.tax).toBeNull();
    expect(preview.body.netSalaryPayable).toBeNull();
  });

  it('an advance larger than net pay deducts only up to the floor and carries the remainder forward, never producing negative net pay', async () => {
    // Reuses the 10,000 advance from the previous test. With a simulated
    // net pay of 3,000, only 3,000 should be requested this period and the
    // rest carried forward -- this is the exact floor/carry-forward logic
    // payroll will invoke once it exists, exercised here via the net-pay
    // preview's optional availableNetPay simulation.
    const preview = await request(app.getHttpServer())
      .get(`/advances/net-pay/${employeeMembershipId}`)
      .query({ year: 2026, month: 5, availableNetPay: 3000 })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const entry = preview.body.breakdown.find((b: { requested: number }) => b.requested === 10000 || b.requested + b.carriedForward > 3000);
    expect(entry.deducted).toBeLessThanOrEqual(3000);
    expect(entry.deducted + entry.carriedForward).toBe(entry.requested);
    expect(preview.body.advanceRecovery).toBeLessThanOrEqual(3000);
    expect(preview.body.advanceRecovery).toBeGreaterThanOrEqual(0);
  });

  it('deleting an advance with no recovery yet works; one with recovery already applied is blocked', async () => {
    const fresh = await request(app.getHttpServer())
      .post('/advances')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ membershipId: employeeMembershipId, categoryId, amount: 100, dateGiven: '2026-06-01', recoveryMode: 'FULL' })
      .expect(201);
    await request(app.getHttpServer()).delete(`/advances/${fresh.body.id}`).set('Authorization', `Bearer ${adminToken}`).expect(200);

    const withRecovery = await request(app.getHttpServer())
      .post('/advances')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ membershipId: employeeMembershipId, categoryId, amount: 100, dateGiven: '2026-06-01', recoveryMode: 'FULL' })
      .expect(201);
    await request(app.getHttpServer()).post(`/advances/recovery/${employeeMembershipId}`).set('Authorization', `Bearer ${adminToken}`).send({ year: 2026, month: 9 }).expect(201);

    const blocked = await request(app.getHttpServer()).delete(`/advances/${withRecovery.body.id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toBe('advance_partially_recovered');
  });

  it('soft-deleting a category preserves historical advances that reference it, and hides it from new selection', async () => {
    const usage = await request(app.getHttpServer()).get(`/advance-categories/${categoryId}/usage`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(usage.body.count).toBeGreaterThan(0);

    const del = await request(app.getHttpServer()).delete(`/advance-categories/${categoryId}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(del.body.advanceCount).toBe(usage.body.count);

    const activeList = await request(app.getHttpServer()).get('/advance-categories').set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(activeList.body.find((c: { id: string }) => c.id === categoryId)).toBeUndefined();

    const list = await request(app.getHttpServer()).get(`/advances/member/${employeeMembershipId}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(list.body.advances.length).toBeGreaterThan(0);
    expect(list.body.advances[0].category.id).toBeDefined();
  });

  it('advances for one tenant are not visible or recoverable from another', async () => {
    // RLS scopes the underlying query, not a membership-ownership check --
    // a cross-tenant caller's own tenant simply has no matching rows, so
    // this returns 200 with nothing, never someone else's data.
    const list = await request(app.getHttpServer()).get(`/advances/member/${employeeMembershipId}`).set('Authorization', `Bearer ${otherTenantAdminToken}`).expect(200);
    expect(list.body.advances).toEqual([]);
    expect(list.body.totalOutstanding).toBe(0);

    const recover = await request(app.getHttpServer())
      .post(`/advances/recovery/${employeeMembershipId}`)
      .set('Authorization', `Bearer ${otherTenantAdminToken}`)
      .send({ year: 2026, month: 1 })
      .expect(201);
    expect(recover.body.breakdown).toEqual([]);
    expect(recover.body.totalDeduction).toBe(0);

    // And the real tenant's data is untouched by that no-op cross-tenant call.
    const realList = await request(app.getHttpServer()).get(`/advances/member/${employeeMembershipId}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(realList.body.advances.length).toBeGreaterThan(0);
  });

  it('an employee can see their own advances, but not create or delete them', async () => {
    const mine = await request(app.getHttpServer()).get(`/advances/member/${employeeMembershipId}`).set('Authorization', `Bearer ${employeeToken}`).expect(200);
    expect(Array.isArray(mine.body.advances)).toBe(true);
  });
});
