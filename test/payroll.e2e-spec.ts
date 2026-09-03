import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';

// Phase 8 (Payroll): both rates are REQUIRES_VERIFICATION and default to zero
// until a tenant's own Super Admin sets them (never inferred by the app).
// This suite also covers the salary-confidentiality gap fixed in
// EmployeesService: baseSalary must never leak to a Supervisor/Viewer who
// can otherwise see the whole profile, only to Super Admin or the employee
// themselves.
describe('Payroll (e2e)', () => {
  let app: INestApplication<App>;
  const setupPrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

  const SUFFIX = `payroll-${Date.now()}`;
  let tenant: { id: string };
  let otherTenant: { id: string };
  let adminToken: string;
  let supervisorToken: string;
  let employeeToken: string;
  let employeeMembershipId: string;
  let otherTenantAdminToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const passwordHash = await bcrypt.hash('PayrollTest123!', 10);
    tenant = await setupPrisma.tenant.create({ data: { slug: `payroll-${SUFFIX}`, name: 'Payroll Test Co', plan: 'growth' } });
    otherTenant = await setupPrisma.tenant.create({ data: { slug: `payroll-other-${SUFFIX}`, name: 'Payroll Other Co', plan: 'growth' } });

    const adminUser = await setupPrisma.user.create({ data: { email: `payroll-admin-${SUFFIX}@test.local`, passwordHash } });
    const supervisorUser = await setupPrisma.user.create({ data: { email: `payroll-supervisor-${SUFFIX}@test.local`, passwordHash } });
    const employeeUser = await setupPrisma.user.create({ data: { email: `payroll-employee-${SUFFIX}@test.local`, passwordHash } });
    const otherAdminUser = await setupPrisma.user.create({ data: { email: `payroll-other-admin-${SUFFIX}@test.local`, passwordHash } });

    await setupPrisma.tenantMembership.create({ data: { tenantId: tenant.id, userId: adminUser.id, role: 'SUPER_ADMIN' } });
    const supervisorMembership = await setupPrisma.tenantMembership.create({ data: { tenantId: tenant.id, userId: supervisorUser.id, role: 'SUPERVISOR' } });
    const employeeMembership = await setupPrisma.tenantMembership.create({
      data: { tenantId: tenant.id, userId: employeeUser.id, role: 'EMPLOYEE', baseSalary: 50000, supervisorMembershipId: supervisorMembership.id },
    });
    employeeMembershipId = employeeMembership.id;
    await setupPrisma.tenantMembership.create({ data: { tenantId: otherTenant.id, userId: otherAdminUser.id, role: 'SUPER_ADMIN' } });

    const login = async (email: string) => (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'PayrollTest123!' })).body.accessToken;
    adminToken = await login(adminUser.email);
    supervisorToken = await login(supervisorUser.email);
    employeeToken = await login(employeeUser.email);
    otherTenantAdminToken = await login(otherAdminUser.email);
  });

  afterAll(async () => {
    await setupPrisma.advanceRecovery.deleteMany({ where: { tenantId: { in: [tenant.id, otherTenant.id] } } });
    await setupPrisma.advance.deleteMany({ where: { tenantId: { in: [tenant.id, otherTenant.id] } } });
    await setupPrisma.advanceCategory.deleteMany({ where: { tenantId: { in: [tenant.id, otherTenant.id] } } });
    await setupPrisma.payslip.deleteMany({ where: { tenantId: { in: [tenant.id, otherTenant.id] } } });
    await setupPrisma.payrollSettings.deleteMany({ where: { tenantId: { in: [tenant.id, otherTenant.id] } } });
    await setupPrisma.notification.deleteMany({ where: { tenantId: { in: [tenant.id, otherTenant.id] } } });
    await setupPrisma.refreshToken.deleteMany({ where: { user: { email: { endsWith: `${SUFFIX}@test.local` } } } });
    await setupPrisma.tenantMembership.deleteMany({ where: { tenantId: { in: [tenant.id, otherTenant.id] } } });
    await setupPrisma.user.deleteMany({ where: { email: { endsWith: `${SUFFIX}@test.local` } } });
    await setupPrisma.tenant.deleteMany({ where: { id: { in: [tenant.id, otherTenant.id] } } });
    await setupPrisma.$disconnect();
    await app.close();
  });

  it('a Supervisor cannot read or change payroll settings, or generate payslips', async () => {
    const get = await request(app.getHttpServer()).get('/payroll/settings').set('Authorization', `Bearer ${supervisorToken}`);
    expect(get.status).toBe(403);
    const patch = await request(app.getHttpServer())
      .patch('/payroll/settings')
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({ incomeTaxPercent: 5, contributionScheme: 'PF_GRATUITY', employeeContributionPercent: 10, employerContributionPercent: 10 });
    expect(patch.status).toBe(403);
    const gen = await request(app.getHttpServer()).post('/payroll/generate').set('Authorization', `Bearer ${supervisorToken}`).send({ year: 2026, month: 1 });
    expect(gen.status).toBe(403);
  });

  it('a Supervisor viewing the team roster never sees baseSalary, even though they can see the whole profile', async () => {
    const list = await request(app.getHttpServer()).get('/employees').set('Authorization', `Bearer ${supervisorToken}`);
    expect(list.status).toBe(200);
    const row = list.body.find((e: { id: string }) => e.id === employeeMembershipId);
    expect(row.baseSalary).toBeNull();

    const one = await request(app.getHttpServer()).get(`/employees/${employeeMembershipId}`).set('Authorization', `Bearer ${supervisorToken}`);
    expect(one.body.baseSalary).toBeNull();
  });

  it('the employee sees their own baseSalary via self-view, and Super Admin sees it via the roster', async () => {
    const self = await request(app.getHttpServer()).get(`/employees/${employeeMembershipId}`).set('Authorization', `Bearer ${employeeToken}`);
    expect(Number(self.body.baseSalary)).toBe(50000);

    const asAdmin = await request(app.getHttpServer()).get(`/employees/${employeeMembershipId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(Number(asAdmin.body.baseSalary)).toBe(50000);
  });

  it('Super Admin sets payroll settings, which persist', async () => {
    const patch = await request(app.getHttpServer())
      .patch('/payroll/settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ incomeTaxPercent: 10, contributionScheme: 'SSF', employeeContributionPercent: 5, employerContributionPercent: 20 });
    expect(patch.status).toBe(200);

    const get = await request(app.getHttpServer()).get('/payroll/settings').set('Authorization', `Bearer ${adminToken}`);
    expect(Number(get.body.incomeTaxPercent)).toBe(10);
    expect(get.body.contributionScheme).toBe('SSF');
    expect(Number(get.body.employeeContributionPercent)).toBe(5);
    expect(Number(get.body.employerContributionPercent)).toBe(20);
  });

  it('generating payslips computes tax/PF/net correctly from baseSalary, and skips members with no baseSalary set', async () => {
    const gen = await request(app.getHttpServer()).post('/payroll/generate').set('Authorization', `Bearer ${adminToken}`).send({ year: 2026, month: 1 });
    expect(gen.status).toBe(201);

    const forEmployee = gen.body.find((p: { membershipId: string }) => p.membershipId === employeeMembershipId);
    expect(Number(forEmployee.grossPay)).toBe(50000);
    expect(Number(forEmployee.incomeTax)).toBe(5000);
    expect(Number(forEmployee.providentFund)).toBe(2500);
    expect(Number(forEmployee.netPay)).toBe(42500);

    // Admin and Supervisor both have no baseSalary set, so only the one
    // employee should have a payslip for this tenant this month.
    expect(gen.body.length).toBe(1);
  });

  it('re-generating the same month is idempotent (upsert, not a duplicate)', async () => {
    const gen = await request(app.getHttpServer()).post('/payroll/generate').set('Authorization', `Bearer ${adminToken}`).send({ year: 2026, month: 1 });
    expect(gen.status).toBe(201);
    const list = await request(app.getHttpServer()).get('/payroll/payslips?year=2026&month=1').set('Authorization', `Bearer ${adminToken}`);
    expect(list.body.length).toBe(1);
  });

  it('the employee can see their own payslip via my-payslips, and it notified them', async () => {
    const mine = await request(app.getHttpServer()).get('/payroll/my-payslips').set('Authorization', `Bearer ${employeeToken}`);
    expect(mine.status).toBe(200);
    expect(mine.body.length).toBe(1);
    expect(Number(mine.body[0].netPay)).toBe(42500);

    const notifications = await request(app.getHttpServer()).get('/notifications').set('Authorization', `Bearer ${employeeToken}`);
    expect(notifications.body.items.some((n: { type: string }) => n.type === 'payslip_generated')).toBe(true);
  });

  it('a Super Admin from another tenant sees nothing for this tenant (RLS isolation)', async () => {
    const list = await request(app.getHttpServer()).get('/payroll/payslips?year=2026&month=1').set('Authorization', `Bearer ${otherTenantAdminToken}`);
    expect(list.status).toBe(200);
    expect(list.body.length).toBe(0);
  });

  it('an employee cannot list all payslips for the month, only their own', async () => {
    const res = await request(app.getHttpServer()).get('/payroll/payslips?year=2026&month=1').set('Authorization', `Bearer ${employeeToken}`);
    expect(res.status).toBe(403);
  });

  // Advances integration: generating a payslip is what actually commits
  // advance recovery once payroll exists, via the exact same
  // computeAdvanceDeductions/applyRecovery functions the standalone
  // advances endpoints use -- not a second implementation of the same math.
  it('generating a payslip commits advance recovery, capped at netPay, and updates the Advance itself', async () => {
    const category = await setupPrisma.advanceCategory.create({ data: { tenantId: tenant.id, name: `Payroll Test Category ${SUFFIX}` } });
    // Bigger than netPay (42500) on purpose: recovery must cap at netPay, not the full advance.
    const advance = await setupPrisma.advance.create({
      data: {
        tenantId: tenant.id,
        membershipId: employeeMembershipId,
        categoryId: category.id,
        amount: 60000,
        dateGiven: new Date('2026-02-01'),
        recoveryMode: 'FULL',
        createdByMembershipId: employeeMembershipId,
      },
    });

    const gen = await request(app.getHttpServer()).post('/payroll/generate').set('Authorization', `Bearer ${adminToken}`).send({ year: 2026, month: 2 }).expect(201);
    const payslip = gen.body.find((p: { membershipId: string }) => p.membershipId === employeeMembershipId);
    expect(Number(payslip.netPay)).toBe(42500);
    expect(Number(payslip.advanceRecovery)).toBe(42500); // capped at netPay, not 60000
    expect(Number(payslip.netPayable)).toBe(0); // never negative

    const updatedAdvance = await setupPrisma.advance.findUniqueOrThrow({ where: { id: advance.id } });
    expect(Number(updatedAdvance.recoveredAmount)).toBe(42500);
    expect(updatedAdvance.closedAt).toBeNull(); // 42500 < 60000, still outstanding

    const recovery = await setupPrisma.advanceRecovery.findUnique({ where: { advanceId_year_month: { advanceId: advance.id, year: 2026, month: 2 } } });
    expect(Number(recovery?.amountRecovered)).toBe(42500);
  });

  it('the net-pay preview reflects the generated payslip once it exists, instead of "pending payroll"', async () => {
    const preview = await request(app.getHttpServer())
      .get(`/advances/net-pay/${employeeMembershipId}`)
      .query({ year: 2026, month: 2 })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(preview.body.grossPay).toBe(50000);
    expect(preview.body.salaryAfterTax).toBe(42500);
    expect(preview.body.advanceRecovery).toBe(42500);
    expect(preview.body.netSalaryPayable).toBe(0);
  });
});
