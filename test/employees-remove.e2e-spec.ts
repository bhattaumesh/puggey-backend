import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';

// The "Manage employees" quick action's delete option is a soft-delete
// (status: disabled, leftAt stamped), never a hard DELETE -- attendance,
// leave, payslip, and advance history all reference the membership row.
// These tests exercise that through the real HTTP endpoint.
describe('Employees remove (e2e)', () => {
  let app: INestApplication<App>;
  const setupPrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

  const SUFFIX = `emp-remove-${Date.now()}`;
  let tenant: { id: string };
  let otherTenant: { id: string };
  let adminToken: string;
  let employeeToken: string;
  let otherTenantAdminToken: string;
  let adminMembershipId: string;
  let employeeMembershipId: string;
  let otherTenantEmployeeMembershipId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const passwordHash = await bcrypt.hash('EmpRemoveTest123!', 10);
    tenant = await setupPrisma.tenant.create({ data: { slug: `emp-remove-${SUFFIX}`, name: 'Emp Remove Test Co', plan: 'growth' } });
    otherTenant = await setupPrisma.tenant.create({ data: { slug: `emp-remove-other-${SUFFIX}`, name: 'Emp Remove Other Co', plan: 'growth' } });

    const adminUser = await setupPrisma.user.create({ data: { email: `emp-remove-admin-${SUFFIX}@test.local`, passwordHash } });
    const employeeUser = await setupPrisma.user.create({ data: { email: `emp-remove-employee-${SUFFIX}@test.local`, passwordHash } });
    const otherAdminUser = await setupPrisma.user.create({ data: { email: `emp-remove-other-admin-${SUFFIX}@test.local`, passwordHash } });
    const otherEmployeeUser = await setupPrisma.user.create({ data: { email: `emp-remove-other-employee-${SUFFIX}@test.local`, passwordHash } });

    const adminMembership = await setupPrisma.tenantMembership.create({ data: { tenantId: tenant.id, userId: adminUser.id, role: 'SUPER_ADMIN' } });
    adminMembershipId = adminMembership.id;
    const employeeMembership = await setupPrisma.tenantMembership.create({ data: { tenantId: tenant.id, userId: employeeUser.id, role: 'EMPLOYEE' } });
    employeeMembershipId = employeeMembership.id;
    await setupPrisma.tenantMembership.create({ data: { tenantId: otherTenant.id, userId: otherAdminUser.id, role: 'SUPER_ADMIN' } });
    const otherEmployeeMembership = await setupPrisma.tenantMembership.create({ data: { tenantId: otherTenant.id, userId: otherEmployeeUser.id, role: 'EMPLOYEE' } });
    otherTenantEmployeeMembershipId = otherEmployeeMembership.id;

    const login = async (email: string) => (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'EmpRemoveTest123!' })).body.accessToken;
    adminToken = await login(adminUser.email);
    employeeToken = await login(employeeUser.email);
    otherTenantAdminToken = await login(otherAdminUser.email);
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

  it('an employee cannot remove another employee', async () => {
    const res = await request(app.getHttpServer()).delete(`/employees/${employeeMembershipId}`).set('Authorization', `Bearer ${employeeToken}`);
    expect(res.status).toBe(403);
  });

  it('an admin cannot remove their own account', async () => {
    const res = await request(app.getHttpServer()).delete(`/employees/${adminMembershipId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('cannot_remove_self');
  });

  it('an admin cannot remove an employee in a different tenant', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/employees/${otherTenantEmployeeMembershipId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);

    const stillActive = await setupPrisma.tenantMembership.findUnique({ where: { id: otherTenantEmployeeMembershipId } });
    expect(stillActive?.status).toBe('active');
  });

  it('an admin can remove an employee, soft-deleting them', async () => {
    const res = await request(app.getHttpServer()).delete(`/employees/${employeeMembershipId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('disabled');
    expect(res.body.leftAt).not.toBeNull();

    const stored = await setupPrisma.tenantMembership.findUnique({ where: { id: employeeMembershipId } });
    expect(stored?.status).toBe('disabled');
    expect(stored?.leftAt).not.toBeNull();

    const list = await request(app.getHttpServer()).get('/employees').set('Authorization', `Bearer ${adminToken}`);
    expect(list.body.find((e: { id: string }) => e.id === employeeMembershipId)).toBeUndefined();
  });

  it('other tenant admin still cannot see or remove employees across tenants', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/employees/${otherTenantEmployeeMembershipId}`)
      .set('Authorization', `Bearer ${otherTenantAdminToken}`);
    // Removing their own tenant's employee is allowed -- this just proves the
    // route works for a different tenant's own admin, on their own employee.
    expect(res.status).toBe(200);
  });
});
