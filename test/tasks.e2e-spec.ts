import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';

// Tasks are assigned from an employee's profile page, not a standalone
// board -- assigning is canCreateEditDeleteAnyRecord-gated (SUPER_ADMIN),
// updating status is allowed for SUPER_ADMIN or the assignee themselves.
describe('Tasks (e2e)', () => {
  let app: INestApplication<App>;
  const setupPrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

  const SUFFIX = `tasks-${Date.now()}`;
  let tenant: { id: string };
  let otherTenant: { id: string };
  let adminToken: string;
  let employeeToken: string;
  let otherEmployeeToken: string;
  let otherTenantAdminToken: string;
  let employeeMembershipId: string;
  let otherTenantEmployeeMembershipId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const passwordHash = await bcrypt.hash('TasksTest123!', 10);
    tenant = await setupPrisma.tenant.create({ data: { slug: `tasks-${SUFFIX}`, name: 'Tasks Test Co', plan: 'gold' } });
    otherTenant = await setupPrisma.tenant.create({ data: { slug: `tasks-other-${SUFFIX}`, name: 'Tasks Other Co', plan: 'gold' } });

    const adminUser = await setupPrisma.user.create({ data: { email: `tasks-admin-${SUFFIX}@test.local`, passwordHash } });
    const employeeUser = await setupPrisma.user.create({ data: { email: `tasks-employee-${SUFFIX}@test.local`, passwordHash } });
    const otherEmployeeUser = await setupPrisma.user.create({ data: { email: `tasks-other-employee-${SUFFIX}@test.local`, passwordHash } });
    const otherAdminUser = await setupPrisma.user.create({ data: { email: `tasks-other-admin-${SUFFIX}@test.local`, passwordHash } });
    const otherTenantEmployeeUser = await setupPrisma.user.create({ data: { email: `tasks-othertenant-employee-${SUFFIX}@test.local`, passwordHash } });

    await setupPrisma.tenantMembership.create({ data: { tenantId: tenant.id, userId: adminUser.id, role: 'SUPER_ADMIN' } });
    const employeeMembership = await setupPrisma.tenantMembership.create({ data: { tenantId: tenant.id, userId: employeeUser.id, role: 'EMPLOYEE' } });
    employeeMembershipId = employeeMembership.id;
    await setupPrisma.tenantMembership.create({ data: { tenantId: tenant.id, userId: otherEmployeeUser.id, role: 'EMPLOYEE' } });
    await setupPrisma.tenantMembership.create({ data: { tenantId: otherTenant.id, userId: otherAdminUser.id, role: 'SUPER_ADMIN' } });
    const otherTenantEmployeeMembership = await setupPrisma.tenantMembership.create({
      data: { tenantId: otherTenant.id, userId: otherTenantEmployeeUser.id, role: 'EMPLOYEE' },
    });
    otherTenantEmployeeMembershipId = otherTenantEmployeeMembership.id;

    const login = async (email: string) => (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'TasksTest123!' })).body.accessToken;
    adminToken = await login(adminUser.email);
    employeeToken = await login(employeeUser.email);
    otherEmployeeToken = await login(otherEmployeeUser.email);
    otherTenantAdminToken = await login(otherAdminUser.email);
  });

  afterAll(async () => {
    await setupPrisma.task.deleteMany({ where: { tenantId: { in: [tenant.id, otherTenant.id] } } });
    await setupPrisma.notification.deleteMany({ where: { tenantId: { in: [tenant.id, otherTenant.id] } } });
    await setupPrisma.refreshToken.deleteMany({ where: { user: { email: { endsWith: `${SUFFIX}@test.local` } } } });
    await setupPrisma.tenantMembership.deleteMany({ where: { tenantId: { in: [tenant.id, otherTenant.id] } } });
    await setupPrisma.user.deleteMany({ where: { email: { endsWith: `${SUFFIX}@test.local` } } });
    await setupPrisma.tenant.deleteMany({ where: { id: { in: [tenant.id, otherTenant.id] } } });
    await setupPrisma.$disconnect();
    await app.close();
  });

  let taskId: string;

  it('an employee cannot assign a task', async () => {
    const res = await request(app.getHttpServer())
      .post('/tasks')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ membershipId: employeeMembershipId, title: 'Should fail' });
    expect(res.status).toBe(403);
  });

  it('an admin assigns a task, and the assignee is notified', async () => {
    const res = await request(app.getHttpServer())
      .post('/tasks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ membershipId: employeeMembershipId, title: 'Restock shelf A', description: 'Count and restock', dueDate: '2026-08-01' });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Restock shelf A');
    expect(res.body.status).toBe('pending');
    taskId = res.body.id;

    const notifications = await setupPrisma.notification.findMany({ where: { tenantId: tenant.id, type: 'task_assigned' } });
    expect(notifications.length).toBe(1);
  });

  it('the assignee can list and see their own task', async () => {
    const res = await request(app.getHttpServer())
      .get(`/tasks/member/${employeeMembershipId}`)
      .set('Authorization', `Bearer ${employeeToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(taskId);
  });

  it('a different employee cannot list someone else\'s tasks', async () => {
    const res = await request(app.getHttpServer())
      .get(`/tasks/member/${employeeMembershipId}`)
      .set('Authorization', `Bearer ${otherEmployeeToken}`);
    expect(res.status).toBe(403);
  });

  it('the assignee can update their own task\'s status', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/tasks/${taskId}/status`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ status: 'in_progress' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('in_progress');
  });

  it('a different employee cannot update someone else\'s task status', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/tasks/${taskId}/status`)
      .set('Authorization', `Bearer ${otherEmployeeToken}`)
      .send({ status: 'completed' });
    expect(res.status).toBe(403);
  });

  it('an admin from a different tenant cannot see or touch this task (RLS isolation)', async () => {
    // SUPER_ADMIN bypasses the own-membership check (same as AdvancesService),
    // but RLS on the tasks table still scopes the query to their own tenant,
    // so a foreign membershipId/taskId simply returns nothing -- 200/empty
    // and 404, not a leak.
    const list = await request(app.getHttpServer())
      .get(`/tasks/member/${employeeMembershipId}`)
      .set('Authorization', `Bearer ${otherTenantAdminToken}`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(0);

    const statusUpdate = await request(app.getHttpServer())
      .patch(`/tasks/${taskId}/status`)
      .set('Authorization', `Bearer ${otherTenantAdminToken}`)
      .send({ status: 'completed' });
    expect(statusUpdate.status).toBe(404);
  });

  it('an admin cannot assign a task to an employee in a different tenant', async () => {
    const res = await request(app.getHttpServer())
      .post('/tasks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ membershipId: otherTenantEmployeeMembershipId, title: 'Cross tenant' });
    expect(res.status).toBe(404);
  });

  it('an employee cannot delete a task', async () => {
    const res = await request(app.getHttpServer()).delete(`/tasks/${taskId}`).set('Authorization', `Bearer ${employeeToken}`);
    expect(res.status).toBe(403);
  });

  it('an admin can delete a task', async () => {
    const res = await request(app.getHttpServer()).delete(`/tasks/${taskId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);

    const list = await request(app.getHttpServer())
      .get(`/tasks/member/${employeeMembershipId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(list.body).toHaveLength(0);
  });
});
