import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';
import * as path from 'path';
import { AppModule } from '../src/app.module';

// Documents (Citizenship/NID/Driving licence): stored as bytes in Postgres,
// inheriting RLS instead of a new external storage dependency (see the
// schema comment on Document). This suite leans on proving that isolation
// actually holds -- a document belonging to one tenant's employee must never
// be fetchable, even by another tenant's own Super Admin -- plus the file
// constraints (5 MB, MIME allowlist) and EXIF stripping.
describe('Documents (e2e)', () => {
  let app: INestApplication<App>;
  const setupPrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

  const SUFFIX = `docs-${Date.now()}`;
  let tenant: { id: string };
  let otherTenant: { id: string };
  let adminToken: string;
  let employeeToken: string;
  let supervisorToken: string;
  let otherTenantAdminToken: string;
  let employeeMembershipId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const passwordHash = await bcrypt.hash('DocsTest123!', 10);
    tenant = await setupPrisma.tenant.create({ data: { slug: `docs-${SUFFIX}`, name: 'Docs Test Co', plan: 'growth' } });
    otherTenant = await setupPrisma.tenant.create({ data: { slug: `docs-other-${SUFFIX}`, name: 'Docs Other Co', plan: 'growth' } });

    const adminUser = await setupPrisma.user.create({ data: { email: `docs-admin-${SUFFIX}@test.local`, passwordHash } });
    const employeeUser = await setupPrisma.user.create({ data: { email: `docs-employee-${SUFFIX}@test.local`, passwordHash } });
    const supervisorUser = await setupPrisma.user.create({ data: { email: `docs-supervisor-${SUFFIX}@test.local`, passwordHash } });
    const otherAdminUser = await setupPrisma.user.create({ data: { email: `docs-other-admin-${SUFFIX}@test.local`, passwordHash } });

    await setupPrisma.tenantMembership.create({ data: { tenantId: tenant.id, userId: adminUser.id, role: 'SUPER_ADMIN' } });
    const employeeMembership = await setupPrisma.tenantMembership.create({ data: { tenantId: tenant.id, userId: employeeUser.id, role: 'EMPLOYEE' } });
    employeeMembershipId = employeeMembership.id;
    await setupPrisma.tenantMembership.create({ data: { tenantId: tenant.id, userId: supervisorUser.id, role: 'SUPERVISOR' } });
    await setupPrisma.tenantMembership.create({ data: { tenantId: otherTenant.id, userId: otherAdminUser.id, role: 'SUPER_ADMIN' } });

    const login = async (email: string) => (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'DocsTest123!' })).body.accessToken;
    adminToken = await login(adminUser.email);
    employeeToken = await login(employeeUser.email);
    supervisorToken = await login(supervisorUser.email);
    otherTenantAdminToken = await login(otherAdminUser.email);
  });

  afterAll(async () => {
    await setupPrisma.document.deleteMany({ where: { tenantId: { in: [tenant.id, otherTenant.id] } } });
    await setupPrisma.notification.deleteMany({ where: { tenantId: { in: [tenant.id, otherTenant.id] } } });
    await setupPrisma.refreshToken.deleteMany({ where: { user: { email: { endsWith: `${SUFFIX}@test.local` } } } });
    await setupPrisma.tenantMembership.deleteMany({ where: { tenantId: { in: [tenant.id, otherTenant.id] } } });
    await setupPrisma.user.deleteMany({ where: { email: { endsWith: `${SUFFIX}@test.local` } } });
    await setupPrisma.tenant.deleteMany({ where: { id: { in: [tenant.id, otherTenant.id] } } });
    await setupPrisma.$disconnect();
    await app.close();
  });

  it('an employee cannot upload a document, only Super Admin can', async () => {
    const res = await request(app.getHttpServer())
      .post(`/documents/${employeeMembershipId}/CITIZENSHIP`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .attach('file', path.join(__dirname, 'fixtures/with-exif.jpg'));
    expect(res.status).toBe(403);
  });

  it('rejects an oversized file at the server, not only the client', async () => {
    const big = Buffer.alloc(6 * 1024 * 1024, 1); // 6 MB, over the 5 MB limit
    const res = await request(app.getHttpServer())
      .post(`/documents/${employeeMembershipId}/CITIZENSHIP`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', big, { filename: 'big.pdf', contentType: 'application/pdf' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('rejects an unsupported MIME type', async () => {
    const res = await request(app.getHttpServer())
      .post(`/documents/${employeeMembershipId}/NID`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from('#!/bin/sh\necho hi'), { filename: 'script.sh', contentType: 'application/x-sh' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unsupported_file_type');
  });

  it('uploads a citizenship document, strips EXIF/GPS from it, and serves it back via a signed token', async () => {
    const upload = await request(app.getHttpServer())
      .post(`/documents/${employeeMembershipId}/CITIZENSHIP`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', path.join(__dirname, 'fixtures/with-exif.jpg'))
      .expect(201);
    expect(upload.body.mimeType).toBe('image/jpeg');

    const meta = await request(app.getHttpServer()).get(`/documents/${employeeMembershipId}/CITIZENSHIP`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(meta.body.fileName).toBe('with-exif.jpg');
    expect(meta.body.data).toBeUndefined();

    const tokenRes = await request(app.getHttpServer()).get(`/documents/${employeeMembershipId}/CITIZENSHIP/token`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(typeof tokenRes.body.token).toBe('string');

    const download = await request(app.getHttpServer()).get('/documents-download').query({ token: tokenRes.body.token }).expect(200);
    const downloadedBytes: Buffer = download.body instanceof Buffer ? download.body : Buffer.from(download.text, 'binary');
    expect(downloadedBytes.includes('Exif')).toBe(false);
  });

  it('the employee can see their own document; a Supervisor who can see the profile still cannot, since documents are sensitive', async () => {
    const meta = await request(app.getHttpServer()).get(`/documents/${employeeMembershipId}/CITIZENSHIP`).set('Authorization', `Bearer ${employeeToken}`).expect(200);
    expect(meta.body.fileName).toBe('with-exif.jpg');

    const supervisorMeta = await request(app.getHttpServer()).get(`/documents/${employeeMembershipId}/CITIZENSHIP`).set('Authorization', `Bearer ${supervisorToken}`);
    expect(supervisorMeta.status).toBe(403);

    const supervisorToken2 = await request(app.getHttpServer()).get(`/documents/${employeeMembershipId}/CITIZENSHIP/token`).set('Authorization', `Bearer ${supervisorToken}`);
    expect(supervisorToken2.status).toBe(403);
  });

  it('a document uploaded for one tenant is not retrievable by another tenant, even by its Super Admin', async () => {
    const uploadAttempt = await request(app.getHttpServer())
      .post(`/documents/${employeeMembershipId}/NID`)
      .set('Authorization', `Bearer ${otherTenantAdminToken}`)
      .attach('file', path.join(__dirname, 'fixtures/with-exif.jpg'));
    expect([403, 404]).toContain(uploadAttempt.status);

    const meta = await request(app.getHttpServer()).get(`/documents/${employeeMembershipId}/CITIZENSHIP`).set('Authorization', `Bearer ${otherTenantAdminToken}`);
    expect(meta.status).toBe(200);
    expect(meta.body.fileName).toBeUndefined();

    const token = await request(app.getHttpServer()).get(`/documents/${employeeMembershipId}/CITIZENSHIP/token`).set('Authorization', `Bearer ${otherTenantAdminToken}`);
    expect(token.status).toBe(404);
  });

  it('a garbage or expired download token is rejected', async () => {
    const res = await request(app.getHttpServer()).get('/documents-download').query({ token: 'not-a-real-token' });
    expect(res.status).toBe(403);
  });

  it('replacing a document soft-deletes the previous one instead of hard-deleting it', async () => {
    const before = await setupPrisma.document.findMany({ where: { membershipId: employeeMembershipId, type: 'CITIZENSHIP' } });
    expect(before.length).toBe(1);

    await request(app.getHttpServer())
      .post(`/documents/${employeeMembershipId}/CITIZENSHIP`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', path.join(__dirname, 'fixtures/with-exif.jpg'))
      .expect(201);

    const after = await setupPrisma.document.findMany({ where: { membershipId: employeeMembershipId, type: 'CITIZENSHIP' } });
    expect(after.length).toBe(2);
    expect(after.filter((d) => d.deletedAt === null).length).toBe(1);
    expect(after.filter((d) => d.deletedAt !== null).length).toBe(1);
  });
});
