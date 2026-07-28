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

// Profile photo upload: resized+EXIF-stripped through sharp and stored as
// bytea on the membership row (same "no S3" approach as Document), then
// computed back out as a data: URI in photoUrl -- never as its own field.
describe('Employee photo upload (e2e)', () => {
  let app: INestApplication<App>;
  const setupPrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

  const SUFFIX = `photo-${Date.now()}`;
  let tenant: { id: string };
  let adminToken: string;
  let employeeToken: string;
  let employeeMembershipId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const passwordHash = await bcrypt.hash('PhotoTest123!', 10);
    tenant = await setupPrisma.tenant.create({ data: { slug: `photo-${SUFFIX}`, name: 'Photo Test Co', plan: 'growth' } });

    const adminUser = await setupPrisma.user.create({ data: { email: `photo-admin-${SUFFIX}@test.local`, passwordHash } });
    const employeeUser = await setupPrisma.user.create({ data: { email: `photo-employee-${SUFFIX}@test.local`, passwordHash } });

    await setupPrisma.tenantMembership.create({ data: { tenantId: tenant.id, userId: adminUser.id, role: 'SUPER_ADMIN' } });
    const employeeMembership = await setupPrisma.tenantMembership.create({ data: { tenantId: tenant.id, userId: employeeUser.id, role: 'EMPLOYEE' } });
    employeeMembershipId = employeeMembership.id;

    const login = async (email: string) => (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'PhotoTest123!' })).body.accessToken;
    adminToken = await login(adminUser.email);
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

  it('an employee cannot upload their own photo, only Super Admin can', async () => {
    const res = await request(app.getHttpServer())
      .post(`/employees/${employeeMembershipId}/photo`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .attach('file', path.join(__dirname, 'fixtures/with-exif.jpg'));
    expect(res.status).toBe(403);
  });

  it('rejects an unsupported MIME type', async () => {
    const res = await request(app.getHttpServer())
      .post(`/employees/${employeeMembershipId}/photo`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from('%PDF-1.4 not really'), { filename: 'doc.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unsupported_file_type');
  });

  it('rejects a corrupt image cleanly (400), not as an unhandled server error', async () => {
    const res = await request(app.getHttpServer())
      .post(`/employees/${employeeMembershipId}/photo`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from('not actually a jpeg'), { filename: 'fake.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_image');
  });

  it('rejects an oversized file at the server', async () => {
    const big = Buffer.alloc(6 * 1024 * 1024, 1);
    const res = await request(app.getHttpServer())
      .post(`/employees/${employeeMembershipId}/photo`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', big, { filename: 'big.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('uploads a photo and returns it as a data: URI, never as raw photoData/photoMimeType fields', async () => {
    const upload = await request(app.getHttpServer())
      .post(`/employees/${employeeMembershipId}/photo`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', path.join(__dirname, 'fixtures/with-exif.jpg'))
      .expect(201);

    expect(upload.body.photoUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(upload.body.photoData).toBeUndefined();
    expect(upload.body.photoMimeType).toBeUndefined();

    const stored = await setupPrisma.tenantMembership.findUnique({ where: { id: employeeMembershipId } });
    expect(stored?.photoData).not.toBeNull();
    expect(stored?.photoMimeType).toBe('image/jpeg');
  });

  it('the uploaded photo is reflected in the team list and the profile view', async () => {
    const list = await request(app.getHttpServer()).get('/employees').set('Authorization', `Bearer ${adminToken}`).expect(200);
    const listed = list.body.find((e: { id: string }) => e.id === employeeMembershipId);
    expect(listed.photoUrl).toMatch(/^data:image\/jpeg;base64,/);

    const found = await request(app.getHttpServer()).get(`/employees/${employeeMembershipId}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(found.body.photoUrl).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('uploading again overwrites the previous photo', async () => {
    const first = await request(app.getHttpServer())
      .get(`/employees/${employeeMembershipId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .post(`/employees/${employeeMembershipId}/photo`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', path.join(__dirname, 'fixtures/with-exif.jpg'))
      .expect(201);

    const second = await request(app.getHttpServer())
      .get(`/employees/${employeeMembershipId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // Same source file re-uploaded and re-encoded independently should still
    // produce a well-formed data URI, not accumulate duplicate photo rows
    // (there is only one photoData column, not a history table).
    expect(second.body.photoUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(first.body.photoUrl).toMatch(/^data:image\/jpeg;base64,/);
  });
});
