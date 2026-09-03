import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';

// The "Create payslip" quick action lets an admin generate/regenerate one
// employee's payslip without touching everyone else's -- GeneratePayslipsDto's
// optional membershipId filter. This proves the scoping actually holds: only
// the named employee gets a payslip, and re-running for that one employee
// alone still doesn't touch the other's existing payslip for the same period.
describe('Payroll single-employee generation (e2e)', () => {
  let app: INestApplication<App>;
  const setupPrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

  const SUFFIX = `payroll-single-${Date.now()}`;
  let tenant: { id: string };
  let adminToken: string;
  let employeeAMembershipId: string;
  let employeeBMembershipId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const passwordHash = await bcrypt.hash('PayrollSingleTest123!', 10);
    tenant = await setupPrisma.tenant.create({ data: { slug: `payroll-single-${SUFFIX}`, name: 'Payroll Single Test Co', plan: 'growth' } });

    const adminUser = await setupPrisma.user.create({ data: { email: `payroll-single-admin-${SUFFIX}@test.local`, passwordHash } });
    const employeeAUser = await setupPrisma.user.create({ data: { email: `payroll-single-a-${SUFFIX}@test.local`, passwordHash } });
    const employeeBUser = await setupPrisma.user.create({ data: { email: `payroll-single-b-${SUFFIX}@test.local`, passwordHash } });

    await setupPrisma.tenantMembership.create({ data: { tenantId: tenant.id, userId: adminUser.id, role: 'SUPER_ADMIN' } });
    const employeeA = await setupPrisma.tenantMembership.create({
      data: { tenantId: tenant.id, userId: employeeAUser.id, role: 'EMPLOYEE', baseSalary: 40000 },
    });
    employeeAMembershipId = employeeA.id;
    const employeeB = await setupPrisma.tenantMembership.create({
      data: { tenantId: tenant.id, userId: employeeBUser.id, role: 'EMPLOYEE', baseSalary: 60000 },
    });
    employeeBMembershipId = employeeB.id;

    const login = async (email: string) =>
      (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'PayrollSingleTest123!' })).body.accessToken;
    adminToken = await login(adminUser.email);
  });

  afterAll(async () => {
    await setupPrisma.payslip.deleteMany({ where: { tenantId: tenant.id } });
    await setupPrisma.payrollSettings.deleteMany({ where: { tenantId: tenant.id } });
    await setupPrisma.notification.deleteMany({ where: { tenantId: tenant.id } });
    await setupPrisma.refreshToken.deleteMany({ where: { user: { email: { endsWith: `${SUFFIX}@test.local` } } } });
    await setupPrisma.tenantMembership.deleteMany({ where: { tenantId: tenant.id } });
    await setupPrisma.user.deleteMany({ where: { email: { endsWith: `${SUFFIX}@test.local` } } });
    await setupPrisma.tenant.deleteMany({ where: { id: tenant.id } });
    await setupPrisma.$disconnect();
    await app.close();
  });

  it('generating with a membershipId only creates a payslip for that one employee', async () => {
    const res = await request(app.getHttpServer())
      .post('/payroll/generate')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ year: 2026, month: 5, membershipId: employeeAMembershipId });
    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].membershipId).toBe(employeeAMembershipId);
    expect(Number(res.body[0].grossPay)).toBe(40000);

    const list = await request(app.getHttpServer())
      .get('/payroll/payslips?year=2026&month=5')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].membershipId).toBe(employeeAMembershipId);
  });

  it('generating for the second employee does not touch the first employee\'s existing payslip', async () => {
    await request(app.getHttpServer())
      .post('/payroll/generate')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ year: 2026, month: 5, membershipId: employeeBMembershipId });

    const list = await request(app.getHttpServer())
      .get('/payroll/payslips?year=2026&month=5')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(list.body).toHaveLength(2);
    const amounts = list.body.map((p: { membershipId: string; grossPay: string }) => ({ id: p.membershipId, gross: Number(p.grossPay) }));
    expect(amounts).toEqual(
      expect.arrayContaining([
        { id: employeeAMembershipId, gross: 40000 },
        { id: employeeBMembershipId, gross: 60000 },
      ]),
    );
  });

  it('regenerating a single employee is an idempotent overwrite, matching create-and-edit semantics', async () => {
    await setupPrisma.payrollSettings.upsert({
      where: { tenantId: tenant.id },
      create: { tenantId: tenant.id, incomeTaxPercent: 10, employeeContributionPercent: 0 },
      update: { incomeTaxPercent: 10, employeeContributionPercent: 0 },
    });

    const res = await request(app.getHttpServer())
      .post('/payroll/generate')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ year: 2026, month: 5, membershipId: employeeAMembershipId });
    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(1);
    expect(Number(res.body[0].incomeTax)).toBe(4000);

    const list = await request(app.getHttpServer())
      .get('/payroll/payslips?year=2026&month=5')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(list.body).toHaveLength(2);
  });

  it('a non-existent membershipId returns 404 instead of silently generating nothing', async () => {
    const res = await request(app.getHttpServer())
      .post('/payroll/generate')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ year: 2026, month: 6, membershipId: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBe(404);
  });
});
