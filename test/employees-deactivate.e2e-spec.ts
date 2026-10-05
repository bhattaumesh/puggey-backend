import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';

// Deactivating an employee is a soft-delete (status: disabled) that also
// records the last working day, why they left, and who recorded it, and moves
// them to the "Old employees" list. Attendance, leave, payslip, and advance
// history all reference the membership row, so it is never a hard DELETE.
jest.setTimeout(180_000);

describe('Employees deactivate (e2e)', () => {
  let app: INestApplication<App>;
  const setupPrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

  const SUFFIX = `emp-deact-${Date.now()}`;
  const PASSWORD = 'EmpDeactTest123!';
  let tenant: { id: string };
  let otherTenant: { id: string };
  let adminToken: string;
  let supervisorToken: string;
  let employeeToken: string;
  let otherTenantAdminToken: string;
  let adminId: string;
  let supervisorId: string;
  let reportId: string; // reports to the supervisor
  let strangerId: string; // reports to nobody
  let otherTenantEmployeeId: string;
  let reportsEmail: string;
  const mk = (n: string) => `${n}-${SUFFIX}@test.local`;

  const body = (over: Record<string, unknown> = {}) => ({ lastWorkingDay: '2026-10-01', exitType: 'resigned', remarks: 'Moving to another city.', ...over });
  // /auth/login is throttled to 5 a minute per IP, so wait it out when a
  // run needs more sign-ins than that.
  const login = async (email: string) => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const res = await request(app.getHttpServer()).post('/auth/login').send({ email, password: PASSWORD });
      if (res.body.accessToken) return res.body;
      if (res.status !== 429) return res.body;
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
    throw new Error('login stayed throttled');
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    tenant = await setupPrisma.tenant.create({ data: { slug: `deact-${SUFFIX}`, name: 'Deactivate Test Co', plan: 'gold' } });
    otherTenant = await setupPrisma.tenant.create({ data: { slug: `deact-other-${SUFFIX}`, name: 'Deactivate Other Co', plan: 'gold' } });
    const user = (name: string) => setupPrisma.user.create({ data: { email: mk(name), fullName: name, passwordHash } });
    const member = async (t: { id: string }, name: string, role: 'SUPER_ADMIN' | 'SUPERVISOR' | 'EMPLOYEE', supervisorMembershipId?: string) =>
      setupPrisma.tenantMembership.create({
        data: { tenantId: t.id, userId: (await user(name)).id, role, supervisorMembershipId, joinedAt: new Date('2026-01-01T00:00:00Z') },
      });

    adminId = (await member(tenant, 'admin', 'SUPER_ADMIN')).id;
    supervisorId = (await member(tenant, 'supervisor', 'SUPERVISOR')).id;
    reportId = (await member(tenant, 'report', 'EMPLOYEE', supervisorId)).id;
    reportsEmail = mk('report');
    strangerId = (await member(tenant, 'stranger', 'EMPLOYEE')).id;
    await member(otherTenant, 'other-admin', 'SUPER_ADMIN');
    otherTenantEmployeeId = (await member(otherTenant, 'other-employee', 'EMPLOYEE')).id;

    adminToken = (await login(mk('admin'))).accessToken;
    supervisorToken = (await login(mk('supervisor'))).accessToken;
    employeeToken = (await login(mk('stranger'))).accessToken;
    otherTenantAdminToken = (await login(mk('other-admin'))).accessToken;
  });

  afterAll(async () => {
    await setupPrisma.notification.deleteMany({ where: { tenantId: { in: [tenant.id, otherTenant.id] } } });
    await setupPrisma.refreshToken.deleteMany({ where: { user: { email: { endsWith: `${SUFFIX}@test.local` } } } });
    await setupPrisma.tenantMembership.deleteMany({ where: { tenantId: { in: [tenant.id, otherTenant.id] } } });
    await setupPrisma.user.deleteMany({ where: { email: { endsWith: `${SUFFIX}@test.local` } } });
    await setupPrisma.tenant.deleteMany({ where: { id: { in: [tenant.id, otherTenant.id] } } });
    await setupPrisma.$disconnect();
    await app.close();
  });

  const deactivate = (id: string, token: string, payload: object = body()) =>
    request(app.getHttpServer()).post(`/employees/${id}/deactivate`).set('Authorization', `Bearer ${token}`).send(payload);

  it('a plain employee cannot deactivate anyone', async () => {
    expect((await deactivate(reportId, employeeToken)).status).toBe(403);
  });

  it('nobody can deactivate their own account', async () => {
    const res = await deactivate(adminId, adminToken);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('cannot_remove_self');
  });

  it('cannot reach an employee of a different tenant', async () => {
    expect((await deactivate(otherTenantEmployeeId, adminToken)).status).toBe(404);
    const stored = await setupPrisma.tenantMembership.findUnique({ where: { id: otherTenantEmployeeId } });
    expect(stored?.status).toBe('active');
  });

  it('remarks, a valid exit type and a valid date are required', async () => {
    expect((await deactivate(strangerId, adminToken, body({ remarks: '   ' }))).status).toBe(400);
    expect((await deactivate(strangerId, adminToken, body({ exitType: 'vanished' }))).status).toBe(400);
    expect((await deactivate(strangerId, adminToken, body({ lastWorkingDay: '2026-02-31' }))).status).toBe(400);
    expect((await deactivate(strangerId, adminToken, body({ lastWorkingDay: '2025-12-31' }))).status).toBe(400); // before joining
    const stored = await setupPrisma.tenantMembership.findUnique({ where: { id: strangerId } });
    expect(stored?.status).toBe('active');
  });

  it('a supervisor cannot deactivate someone outside their team, or an admin', async () => {
    expect((await deactivate(strangerId, supervisorToken)).status).toBe(403);
    expect((await deactivate(adminId, supervisorToken)).status).toBe(403);
  });

  it('a supervisor can deactivate their own report, recording who did it', async () => {
    const res = await deactivate(reportId, supervisorToken, body({ exitType: 'terminated', remarks: ' Repeated absence. ' }));
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('disabled');
    expect(res.body.exitType).toBe('terminated');
    expect(res.body.exitRemarks).toBe('Repeated absence.');
    expect(res.body.exitRecordedByName).toBe('supervisor');
    expect(res.body.lastWorkingDay.slice(0, 10)).toBe('2026-10-01');
    expect(res.body.leftAt).not.toBeNull();

    expect((await deactivate(reportId, supervisorToken)).body.error).toBe('already_deactivated');
  });

  it('a deactivated employee leaves the roster, shows under former employees, and cannot sign in', async () => {
    const list = await request(app.getHttpServer()).get('/employees').set('Authorization', `Bearer ${adminToken}`);
    expect(list.body.find((e: { id: string }) => e.id === reportId)).toBeUndefined();

    const former = await request(app.getHttpServer()).get('/employees/former').set('Authorization', `Bearer ${adminToken}`);
    expect(former.status).toBe(200);
    expect(former.body.map((e: { id: string }) => e.id)).toEqual([reportId]);

    const supFormer = await request(app.getHttpServer()).get('/employees/former').set('Authorization', `Bearer ${supervisorToken}`);
    expect(supFormer.body.map((e: { id: string }) => e.id)).toEqual([reportId]);

    expect((await request(app.getHttpServer()).get('/employees/former').set('Authorization', `Bearer ${employeeToken}`)).status).toBe(403);
    expect((await request(app.getHttpServer()).get('/employees/former').set('Authorization', `Bearer ${otherTenantAdminToken}`)).body).toEqual([]);

    const attempt = await request(app.getHttpServer()).post('/auth/login').send({ email: reportsEmail, password: PASSWORD });
    expect(attempt.body.accessToken).toBeUndefined();
  });

  it('hands the people who reported to a leaving supervisor up to their own supervisor', async () => {
    const extra = await setupPrisma.user.create({ data: { email: mk('extra'), fullName: 'extra', passwordHash: 'x' } });
    const extraMembership = await setupPrisma.tenantMembership.create({
      data: { tenantId: tenant.id, userId: extra.id, role: 'EMPLOYEE', supervisorMembershipId: supervisorId },
    });
    const res = await deactivate(supervisorId, adminToken);
    expect(res.status).toBe(201);
    const moved = await setupPrisma.tenantMembership.findUnique({ where: { id: extraMembership.id } });
    expect(moved?.supervisorMembershipId).toBeNull();
    // Already-left people keep pointing at the supervisor they had.
    const left = await setupPrisma.tenantMembership.findUnique({ where: { id: reportId } });
    expect(left?.supervisorMembershipId).toBe(supervisorId);
  });

  it('a deactivated supervisor cannot refresh their session', async () => {
    const fresh = await setupPrisma.user.create({ data: { email: mk('late'), fullName: 'late', passwordHash: await bcrypt.hash(PASSWORD, 10) } });
    const m = await setupPrisma.tenantMembership.create({ data: { tenantId: tenant.id, userId: fresh.id, role: 'EMPLOYEE' } });
    const session = await login(mk('late'));
    expect((await deactivate(m.id, adminToken, body({ lastWorkingDay: new Date().toISOString().slice(0, 10) }))).status).toBe(201);
    const refreshed = await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: session.refreshToken });
    expect(refreshed.status).toBe(401);
  });

  it('the last active Super Admin cannot be deactivated', async () => {
    const second = await setupPrisma.user.create({ data: { email: mk('admin2'), fullName: 'admin2', passwordHash: await bcrypt.hash(PASSWORD, 10) } });
    const secondM = await setupPrisma.tenantMembership.create({
      data: { tenantId: tenant.id, userId: second.id, role: 'SUPER_ADMIN', joinedAt: new Date('2026-01-01T00:00:00Z') },
    });
    const secondToken = (await login(mk('admin2'))).accessToken;
    expect((await deactivate(adminId, secondToken)).status).toBe(201); // admin2 is now the only one left
    // The first admin's old token still works for a few minutes; it must not be able to remove the last one.
    const res = await deactivate(secondM.id, adminToken);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('last_admin');
  });

  it('only Super Admin can reactivate, which clears the exit record', async () => {
    expect((await request(app.getHttpServer()).post(`/employees/${reportId}/reactivate`).set('Authorization', `Bearer ${employeeToken}`)).status).toBe(403);
    const admin2Token = (await login(mk('admin2'))).accessToken;
    const res = await request(app.getHttpServer()).post(`/employees/${reportId}/reactivate`).set('Authorization', `Bearer ${admin2Token}`);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('active');
    expect(res.body.exitRemarks).toBeNull();
    expect(res.body.lastWorkingDay).toBeNull();
    expect((await request(app.getHttpServer()).post(`/employees/${reportId}/reactivate`).set('Authorization', `Bearer ${admin2Token}`)).body.error).toBe('not_deactivated');
  });
});
