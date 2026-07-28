import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';

// Bio-data/background/contact/identity-number profile fields. Date of birth
// and the four identity numbers are sensitive, redacted by the same rule
// already used for baseSalary (see EmployeesService.redact) -- this suite
// confirms that extension actually holds, plus that the non-sensitive
// fields (address, education, etc.) are ordinary profile data visible to
// anyone who could already see the profile.
describe('Profile fields (e2e)', () => {
  let app: INestApplication<App>;
  const setupPrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

  const SUFFIX = `profile-${Date.now()}`;
  let tenant: { id: string };
  let adminToken: string;
  let supervisorToken: string;
  let employeeToken: string;
  let employeeMembershipId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const passwordHash = await bcrypt.hash('ProfileTest123!', 10);
    tenant = await setupPrisma.tenant.create({ data: { slug: `profile-${SUFFIX}`, name: 'Profile Test Co', plan: 'growth' } });

    const adminUser = await setupPrisma.user.create({ data: { email: `profile-admin-${SUFFIX}@test.local`, passwordHash } });
    const supervisorUser = await setupPrisma.user.create({ data: { email: `profile-supervisor-${SUFFIX}@test.local`, passwordHash } });
    const employeeUser = await setupPrisma.user.create({ data: { email: `profile-employee-${SUFFIX}@test.local`, passwordHash } });

    await setupPrisma.tenantMembership.create({ data: { tenantId: tenant.id, userId: adminUser.id, role: 'SUPER_ADMIN' } });
    const supervisorMembership = await setupPrisma.tenantMembership.create({ data: { tenantId: tenant.id, userId: supervisorUser.id, role: 'SUPERVISOR' } });
    const employeeMembership = await setupPrisma.tenantMembership.create({
      data: { tenantId: tenant.id, userId: employeeUser.id, role: 'EMPLOYEE', supervisorMembershipId: supervisorMembership.id },
    });
    employeeMembershipId = employeeMembership.id;

    const login = async (email: string) => (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'ProfileTest123!' })).body.accessToken;
    adminToken = await login(adminUser.email);
    supervisorToken = await login(supervisorUser.email);
    employeeToken = await login(employeeUser.email);
  });

  afterAll(async () => {
    await setupPrisma.notification.deleteMany({ where: { tenantId: tenant.id } });
    await setupPrisma.refreshToken.deleteMany({ where: { user: { email: { endsWith: `${SUFFIX}@test.local` } } } });
    await setupPrisma.tenantMembership.deleteMany({ where: { tenantId: tenant.id } });
    await setupPrisma.user.deleteMany({ where: { email: { endsWith: `${SUFFIX}@test.local` } } });
    await setupPrisma.tenant.deleteMany({ where: { id: tenant.id } });
    await setupPrisma.$disconnect();
    await app.close();
  });

  it('Super Admin sets the full set of new profile fields', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/employees/${employeeMembershipId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        dateOfBirth: '1995-06-15',
        fatherName: 'Ram Bahadur',
        motherName: 'Sita Devi',
        grandfatherName: 'Hari Prasad',
        education: 'Bachelor of Business Studies',
        pastExperience: '2 years at a retail chain',
        currentAddress: 'Ward 5, Kathmandu',
        permanentAddress: 'Ward 5, Kathmandu',
        mobileNumber: '9800000001',
        emergencyContactNumber: '9800000002',
        citizenshipNumber: '01-02-03-04567',
        panNumber: '123456789',
        nidNumber: 'NID-000111',
        drivingLicenceNumber: '  DL-99887  ',
      })
      .expect(200);

    expect(res.body.education).toBe('Bachelor of Business Studies');
    expect(res.body.currentAddress).toBe('Ward 5, Kathmandu');
    // Trimmed, not format-validated.
    expect(res.body.drivingLicenceNumber).toBe('DL-99887');
  });

  it('a Supervisor who can see the whole profile still cannot see date of birth or identity numbers', async () => {
    const list = await request(app.getHttpServer()).get('/employees').set('Authorization', `Bearer ${supervisorToken}`).expect(200);
    const row = list.body.find((e: { id: string }) => e.id === employeeMembershipId);
    expect(row.dateOfBirth).toBeNull();
    expect(row.citizenshipNumber).toBeNull();
    expect(row.panNumber).toBeNull();
    expect(row.nidNumber).toBeNull();
    expect(row.drivingLicenceNumber).toBeNull();
    // Non-sensitive fields are ordinary profile data, visible as usual.
    expect(row.education).toBe('Bachelor of Business Studies');
    expect(row.currentAddress).toBe('Ward 5, Kathmandu');

    const one = await request(app.getHttpServer()).get(`/employees/${employeeMembershipId}`).set('Authorization', `Bearer ${supervisorToken}`).expect(200);
    expect(one.body.dateOfBirth).toBeNull();
    expect(one.body.panNumber).toBeNull();
  });

  it('the employee sees their own date of birth and identity numbers via self-view', async () => {
    const self = await request(app.getHttpServer()).get(`/employees/${employeeMembershipId}`).set('Authorization', `Bearer ${employeeToken}`).expect(200);
    expect(self.body.dateOfBirth).not.toBeNull();
    expect(self.body.citizenshipNumber).toBe('01-02-03-04567');
    expect(self.body.panNumber).toBe('123456789');
  });

  it('Super Admin sees the full record via the roster', async () => {
    const asAdmin = await request(app.getHttpServer()).get(`/employees/${employeeMembershipId}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(asAdmin.body.nidNumber).toBe('NID-000111');
  });
});
