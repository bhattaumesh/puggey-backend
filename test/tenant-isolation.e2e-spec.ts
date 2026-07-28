import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';

// The highest-value test suite in the product, per the Pugey spec (section 3 and
// 23): authenticate as tenant A, request tenant B's resource, assert failure.
// This exercises the real HTTP layer end-to-end -- real login, real JWTs, real
// Postgres RLS -- not a mocked permission check, because the property we're
// proving is that the database itself refuses to leak rows, not that our
// application code remembered to filter them.
describe('Cross-tenant isolation (e2e)', () => {
  let app: INestApplication<App>;
  // Setup connects as the superuser role (DATABASE_URL) deliberately -- seeding
  // legitimately needs to write into two tenants in one run, which the app's own
  // restricted connection (APP_DATABASE_URL) is not allowed to do.
  const setupPrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

  const SUFFIX = `iso-${Date.now()}`;
  let tenantA: { id: string; slug: string };
  let tenantB: { id: string; slug: string };
  let tokenA: string;
  let tokenB: string;
  let membershipIdA: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const passwordHash = await bcrypt.hash('IsoTest123!', 10);

    tenantA = await setupPrisma.tenant.create({ data: { slug: `tenant-a-${SUFFIX}`, name: 'Isolation Tenant A' } });
    tenantB = await setupPrisma.tenant.create({ data: { slug: `tenant-b-${SUFFIX}`, name: 'Isolation Tenant B' } });

    const userA = await setupPrisma.user.create({ data: { email: `a-${SUFFIX}@test.local`, passwordHash } });
    const userB = await setupPrisma.user.create({ data: { email: `b-${SUFFIX}@test.local`, passwordHash } });

    const membershipA = await setupPrisma.tenantMembership.create({ data: { tenantId: tenantA.id, userId: userA.id, role: 'SUPER_ADMIN' } });
    await setupPrisma.tenantMembership.create({ data: { tenantId: tenantB.id, userId: userB.id, role: 'SUPER_ADMIN' } });
    membershipIdA = membershipA.id;

    const loginA = await request(app.getHttpServer()).post('/auth/login').send({ email: userA.email, password: 'IsoTest123!' });
    const loginB = await request(app.getHttpServer()).post('/auth/login').send({ email: userB.email, password: 'IsoTest123!' });
    tokenA = loginA.body.accessToken;
    tokenB = loginB.body.accessToken;
  });

  afterAll(async () => {
    await setupPrisma.refreshToken.deleteMany({ where: { user: { email: { endsWith: `${SUFFIX}@test.local` } } } });
    await setupPrisma.tenantMembership.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
    await setupPrisma.user.deleteMany({ where: { email: { endsWith: `${SUFFIX}@test.local` } } });
    await setupPrisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
    await setupPrisma.$disconnect();
    await app.close();
  });

  it('logged in as tenant A and B successfully', () => {
    expect(tokenA).toBeTruthy();
    expect(tokenB).toBeTruthy();
  });

  it('tenant B cannot fetch tenant A membership by exact ID (IDOR)', async () => {
    const res = await request(app.getHttpServer()).get(`/tenant-memberships/${membershipIdA}`).set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });

  it('tenant A can fetch its own membership by the same ID', async () => {
    const res = await request(app.getHttpServer()).get(`/tenant-memberships/${membershipIdA}`).set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(membershipIdA);
  });

  it("tenant B's membership list never contains tenant A's rows", async () => {
    const res = await request(app.getHttpServer()).get('/tenant-memberships').set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(200);
    expect(res.body.every((m: { tenantId: string }) => m.tenantId === tenantB.id)).toBe(true);
    expect(res.body.some((m: { id: string }) => m.id === membershipIdA)).toBe(false);
  });

  it('/tenants/me returns only the caller\'s own tenant', async () => {
    const res = await request(app.getHttpServer()).get('/tenants/me').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(tenantA.id);
  });

  it('requests with no token get a clean 401, never a raw error', async () => {
    const res = await request(app.getHttpServer()).get('/tenant-memberships');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('not_authenticated');
  });

  it('unknown email and wrong password produce an identical failure shape (anti-enumeration)', async () => {
    const wrongPassword = await request(app.getHttpServer()).post('/auth/login').send({ email: `a-${SUFFIX}@test.local`, password: 'WrongPassword!' });
    const unknownEmail = await request(app.getHttpServer()).post('/auth/login').send({ email: `nobody-${SUFFIX}@test.local`, password: 'Whatever123!' });
    expect(wrongPassword.status).toBe(unknownEmail.status);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
  });
});
