import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';

// Covers the three surfaces the spec calls out for every phase: permission
// (only the resolved approver may decide), calculation (day count + balance
// decrement), and isolation (a request never leaks across a tenant boundary).
describe('Leave (e2e)', () => {
  let app: INestApplication<App>;
  const setupPrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

  const SUFFIX = `leave-${Date.now()}`;
  let tenant: { id: string; slug: string };
  let otherTenant: { id: string; slug: string };
  let adminToken: string;
  let supervisorToken: string;
  let employeeToken: string;
  let strangerToken: string; // same tenant, unrelated to the requester
  let otherTenantToken: string;
  let leaveTypeId: string;
  let requestId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const passwordHash = await bcrypt.hash('LeaveIsoTest123!', 10);

    tenant = await setupPrisma.tenant.create({ data: { slug: `leave-t-${SUFFIX}`, name: 'Leave Test Co' } });
    otherTenant = await setupPrisma.tenant.create({ data: { slug: `leave-other-${SUFFIX}`, name: 'Other Co' } });

    const adminUser = await setupPrisma.user.create({ data: { email: `admin-${SUFFIX}@test.local`, passwordHash } });
    const supervisorUser = await setupPrisma.user.create({ data: { email: `supervisor-${SUFFIX}@test.local`, passwordHash } });
    const employeeUser = await setupPrisma.user.create({ data: { email: `employee-${SUFFIX}@test.local`, passwordHash } });
    const strangerUser = await setupPrisma.user.create({ data: { email: `stranger-${SUFFIX}@test.local`, passwordHash } });
    const otherTenantUser = await setupPrisma.user.create({ data: { email: `otheradmin-${SUFFIX}@test.local`, passwordHash } });

    await setupPrisma.tenantMembership.create({ data: { tenantId: tenant.id, userId: adminUser.id, role: 'SUPER_ADMIN' } });
    const supervisorMembership = await setupPrisma.tenantMembership.create({ data: { tenantId: tenant.id, userId: supervisorUser.id, role: 'SUPERVISOR' } });
    await setupPrisma.tenantMembership.create({
      data: { tenantId: tenant.id, userId: employeeUser.id, role: 'EMPLOYEE', supervisorMembershipId: supervisorMembership.id },
    });
    await setupPrisma.tenantMembership.create({ data: { tenantId: tenant.id, userId: strangerUser.id, role: 'EMPLOYEE' } });
    await setupPrisma.tenantMembership.create({ data: { tenantId: otherTenant.id, userId: otherTenantUser.id, role: 'SUPER_ADMIN' } });

    const login = async (email: string) => (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'LeaveIsoTest123!' })).body.accessToken;
    adminToken = await login(adminUser.email);
    supervisorToken = await login(supervisorUser.email);
    employeeToken = await login(employeeUser.email);
    strangerToken = await login(strangerUser.email);
    otherTenantToken = await login(otherTenantUser.email);

    const typeRes = await request(app.getHttpServer())
      .post('/leave/types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Annual', defaultDaysPerYear: 15 });
    leaveTypeId = typeRes.body.id;
  });

  afterAll(async () => {
    await setupPrisma.leaveApprovalAction.deleteMany({ where: { tenantId: { in: [tenant.id, otherTenant.id] } } });
    await setupPrisma.leaveRequest.deleteMany({ where: { tenantId: { in: [tenant.id, otherTenant.id] } } });
    await setupPrisma.leaveBalance.deleteMany({ where: { tenantId: { in: [tenant.id, otherTenant.id] } } });
    await setupPrisma.leaveType.deleteMany({ where: { tenantId: { in: [tenant.id, otherTenant.id] } } });
    await setupPrisma.notification.deleteMany({ where: { user: { email: { endsWith: `${SUFFIX}@test.local` } } } });
    await setupPrisma.refreshToken.deleteMany({ where: { user: { email: { endsWith: `${SUFFIX}@test.local` } } } });
    await setupPrisma.tenantMembership.deleteMany({ where: { tenantId: { in: [tenant.id, otherTenant.id] } } });
    await setupPrisma.user.deleteMany({ where: { email: { endsWith: `${SUFFIX}@test.local` } } });
    await setupPrisma.tenant.deleteMany({ where: { id: { in: [tenant.id, otherTenant.id] } } });
    await setupPrisma.$disconnect();
    await app.close();
  });

  it('computes an inclusive day count and auto-provisions a balance on first submission', async () => {
    const res = await request(app.getHttpServer())
      .post('/leave/requests')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ leaveTypeId, startDate: '2026-09-01', endDate: '2026-09-03', reason: 'Trip' });

    expect(res.status).toBe(201);
    expect(res.body.days).toBe(3);
    expect(res.body.status).toBe('pending');
    requestId = res.body.id;

    const balance = await request(app.getHttpServer()).get('/leave/me/balances').set('Authorization', `Bearer ${employeeToken}`);
    expect(balance.body.find((b: { leaveTypeId: string }) => b.leaveTypeId === leaveTypeId).allocated).toBe(15);
  });

  it("rejects a submission that exceeds the employee's remaining balance", async () => {
    const res = await request(app.getHttpServer())
      .post('/leave/requests')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ leaveTypeId, startDate: '2026-10-01', endDate: '2026-10-20', reason: 'Too long' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('insufficient_balance');
  });

  it('routes the request to the direct supervisor, not an unrelated employee', async () => {
    const supervisorPending = await request(app.getHttpServer()).get('/leave/approvals/pending').set('Authorization', `Bearer ${supervisorToken}`);
    expect(supervisorPending.body.some((r: { id: string }) => r.id === requestId)).toBe(true);

    const strangerPending = await request(app.getHttpServer()).get('/leave/approvals/pending').set('Authorization', `Bearer ${strangerToken}`);
    expect(strangerPending.body.some((r: { id: string }) => r.id === requestId)).toBe(false);
  });

  it('an unrelated employee cannot decide a request that is not theirs to approve', async () => {
    const res = await request(app.getHttpServer())
      .post(`/leave/requests/${requestId}/decision`)
      .set('Authorization', `Bearer ${strangerToken}`)
      .send({ decision: 'approved' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('not_authorized');
  });

  it("a different tenant's admin cannot see or decide this request (IDOR / RLS)", async () => {
    const decide = await request(app.getHttpServer())
      .post(`/leave/requests/${requestId}/decision`)
      .set('Authorization', `Bearer ${otherTenantToken}`)
      .send({ decision: 'approved' });
    expect(decide.status).toBe(404);

    const pending = await request(app.getHttpServer()).get('/leave/approvals/pending').set('Authorization', `Bearer ${otherTenantToken}`);
    expect(pending.body.some((r: { id: string }) => r.id === requestId)).toBe(false);
  });

  it('the resolved supervisor can approve, which finalizes the request and increments used balance', async () => {
    const res = await request(app.getHttpServer())
      .post(`/leave/requests/${requestId}/decision`)
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({ decision: 'approved', reason: 'Enjoy' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('approved');

    const balance = await request(app.getHttpServer()).get('/leave/me/balances').set('Authorization', `Bearer ${employeeToken}`);
    const annual = balance.body.find((b: { leaveTypeId: string }) => b.leaveTypeId === leaveTypeId);
    expect(annual.used).toBe(3);
    expect(annual.remaining).toBe(12);
  });

  it('a decided request cannot be decided again', async () => {
    const res = await request(app.getHttpServer())
      .post(`/leave/requests/${requestId}/decision`)
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({ decision: 'approved' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('already_decided');
  });

  it('Super Admin can decide any pending request regardless of the org chart', async () => {
    const submit = await request(app.getHttpServer())
      .post('/leave/requests')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ leaveTypeId, startDate: '2026-11-01', endDate: '2026-11-01', reason: 'One day' });
    expect(submit.body.days).toBe(1);

    const res = await request(app.getHttpServer())
      .post(`/leave/requests/${submit.body.id}/decision`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'rejected', reason: 'Not this time' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('rejected');
  });

  it('only Super Admin can create a leave type', async () => {
    const res = await request(app.getHttpServer())
      .post('/leave/types')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ name: 'Sick', defaultDaysPerYear: 10 });
    expect(res.status).toBe(403);
  });
});
