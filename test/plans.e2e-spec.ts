import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';

// Phase 7 (Commercial) scaffold: the trial tier caps active employees at 5
// (see plan-tiers.ts). No payment step exists yet -- this is what actually
// gates behaviour today. Also covers the platform-only plan-management
// endpoints, since those are ordinary permission surfaces like any other.
describe('Plans (e2e)', () => {
  let app: INestApplication<App>;
  const setupPrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

  const SUFFIX = `plans-${Date.now()}`;
  let tenant: { id: string; slug: string };
  let adminToken: string;
  let employeeToken: string;
  let platformStaffToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const passwordHash = await bcrypt.hash('PlansTest123!', 10);
    tenant = await setupPrisma.tenant.create({ data: { slug: `plans-${SUFFIX}`, name: 'Plans Test Co', plan: 'trial' } });

    const adminUser = await setupPrisma.user.create({ data: { email: `plans-admin-${SUFFIX}@test.local`, passwordHash } });
    const employeeUser = await setupPrisma.user.create({ data: { email: `plans-employee-${SUFFIX}@test.local`, passwordHash } });
    const staffUser = await setupPrisma.user.create({ data: { email: `plans-staff-${SUFFIX}@test.local`, passwordHash } });
    await setupPrisma.tenantMembership.create({ data: { tenantId: tenant.id, userId: adminUser.id, role: 'SUPER_ADMIN' } });
    await setupPrisma.tenantMembership.create({ data: { tenantId: tenant.id, userId: employeeUser.id, role: 'EMPLOYEE' } });
    await setupPrisma.pugeyStaffMember.create({ data: { userId: staffUser.id, role: 'SUPPORT' } });

    const login = async (email: string) => (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'PlansTest123!' })).body.accessToken;
    adminToken = await login(adminUser.email);
    employeeToken = await login(employeeUser.email);
    platformStaffToken = await login(staffUser.email);
  });

  afterAll(async () => {
    await setupPrisma.pugeyStaffMember.deleteMany({ where: { user: { email: { endsWith: `${SUFFIX}@test.local` } } } });
    await setupPrisma.notification.deleteMany({ where: { tenantId: tenant.id } });
    await setupPrisma.refreshToken.deleteMany({ where: { user: { email: { endsWith: `${SUFFIX}@test.local` } } } });
    await setupPrisma.tenantMembership.deleteMany({ where: { tenantId: tenant.id } });
    await setupPrisma.user.deleteMany({ where: { email: { endsWith: `${SUFFIX}@test.local` } } });
    await setupPrisma.tenant.deleteMany({ where: { id: tenant.id } });
    await setupPrisma.$disconnect();
    await app.close();
  });

  it('a plain employee cannot list all tenants or change a plan', async () => {
    const list = await request(app.getHttpServer()).get('/tenants').set('Authorization', `Bearer ${employeeToken}`);
    expect(list.status).toBe(403);
    const change = await request(app.getHttpServer()).patch(`/tenants/${tenant.id}/plan`).set('Authorization', `Bearer ${employeeToken}`).send({ plan: 'growth' });
    expect(change.status).toBe(403);
  });

  it('a tenant Super Admin (not platform staff) also cannot list all tenants or change a plan', async () => {
    const list = await request(app.getHttpServer()).get('/tenants').set('Authorization', `Bearer ${adminToken}`);
    expect(list.status).toBe(403);
  });

  it("the trial plan blocks a 6th active employee, with a clear message naming the limit", async () => {
    // 2 members already exist (admin + the one employee from setup); trial
    // allows 5, so 3 more should succeed and the 4th should be blocked.
    for (let i = 0; i < 3; i++) {
      const res = await request(app.getHttpServer())
        .post('/employees')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ fullName: `Fill ${i}`, email: `plans-fill-${i}-${SUFFIX}@test.local`, temporaryPassword: 'FillTest123!', role: 'EMPLOYEE' });
      expect(res.status).toBe(201);
    }

    const blocked = await request(app.getHttpServer())
      .post('/employees')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fullName: 'One too many', email: `plans-overflow-${SUFFIX}@test.local`, temporaryPassword: 'FillTest123!', role: 'EMPLOYEE' });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toBe('plan_limit_reached');
    expect(blocked.body.message).toContain('5');
  });

  it("/tenants/me reflects the trial limit and today's usage", async () => {
    const me = await request(app.getHttpServer()).get('/tenants/me').set('Authorization', `Bearer ${adminToken}`);
    expect(me.body.employeeLimit).toBe(5);
    expect(me.body.employeeCount).toBe(5);
  });

  it('platform staff can list the tenant with its usage', async () => {
    const list = await request(app.getHttpServer()).get('/tenants').set('Authorization', `Bearer ${platformStaffToken}`);
    expect(list.status).toBe(200);
    const row = list.body.find((t: { id: string }) => t.id === tenant.id);
    expect(row.plan).toBe('trial');
    expect(row.employeeCount).toBe(5);
  });

  it('platform staff moves the tenant to growth (limit 50), which immediately lifts the block', async () => {
    const move = await request(app.getHttpServer()).patch(`/tenants/${tenant.id}/plan`).set('Authorization', `Bearer ${platformStaffToken}`).send({ plan: 'growth' });
    expect(move.status).toBe(200);
    expect(move.body.plan).toBe('growth');

    const res = await request(app.getHttpServer())
      .post('/employees')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fullName: 'Now allowed', email: `plans-nowok-${SUFFIX}@test.local`, temporaryPassword: 'FillTest123!', role: 'EMPLOYEE' });
    expect(res.status).toBe(201);

    const me = await request(app.getHttpServer()).get('/tenants/me').set('Authorization', `Bearer ${adminToken}`);
    expect(me.body.employeeLimit).toBe(50);
    expect(me.body.employeeCount).toBe(6);
  });

  it('an unknown plan name is rejected', async () => {
    const res = await request(app.getHttpServer()).patch(`/tenants/${tenant.id}/plan`).set('Authorization', `Bearer ${platformStaffToken}`).send({ plan: 'diamond' });
    expect(res.status).toBe(404);
  });
});
