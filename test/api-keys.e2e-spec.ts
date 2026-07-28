import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';

// Phase 9 (Extensions): API keys are the one place a chicken-and-egg RLS
// bypass (see ApiKeyGuard) runs on every request, not just at creation --
// so this suite leans hardest on proving tenant isolation still holds, plus
// the ordinary permission/lifecycle surface (only Super Admin manages keys,
// revoked/garbage keys are rejected).
describe('API keys (e2e)', () => {
  let app: INestApplication<App>;
  const setupPrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

  const SUFFIX = `apikey-${Date.now()}`;
  let tenantA: { id: string; slug: string };
  let tenantB: { id: string; slug: string };
  let adminAToken: string;
  let employeeAToken: string;
  let adminBToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const passwordHash = await bcrypt.hash('ApiKeyTest123!', 10);

    tenantA = await setupPrisma.tenant.create({ data: { slug: `apikey-a-${SUFFIX}`, name: 'API Key Tenant A' } });
    tenantB = await setupPrisma.tenant.create({ data: { slug: `apikey-b-${SUFFIX}`, name: 'API Key Tenant B' } });

    const adminAUser = await setupPrisma.user.create({ data: { email: `admin-a-${SUFFIX}@test.local`, passwordHash } });
    const employeeAUser = await setupPrisma.user.create({ data: { email: `employee-a-${SUFFIX}@test.local`, passwordHash } });
    const adminBUser = await setupPrisma.user.create({ data: { email: `admin-b-${SUFFIX}@test.local`, passwordHash } });

    await setupPrisma.tenantMembership.create({ data: { tenantId: tenantA.id, userId: adminAUser.id, role: 'SUPER_ADMIN' } });
    await setupPrisma.tenantMembership.create({ data: { tenantId: tenantA.id, userId: employeeAUser.id, role: 'EMPLOYEE' } });
    await setupPrisma.tenantMembership.create({ data: { tenantId: tenantB.id, userId: adminBUser.id, role: 'SUPER_ADMIN' } });

    const login = async (email: string) => (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'ApiKeyTest123!' })).body.accessToken;
    adminAToken = await login(adminAUser.email);
    employeeAToken = await login(employeeAUser.email);
    adminBToken = await login(adminBUser.email);
  });

  afterAll(async () => {
    await setupPrisma.apiKey.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
    await setupPrisma.refreshToken.deleteMany({ where: { user: { email: { endsWith: `${SUFFIX}@test.local` } } } });
    await setupPrisma.tenantMembership.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
    await setupPrisma.user.deleteMany({ where: { email: { endsWith: `${SUFFIX}@test.local` } } });
    await setupPrisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
    await setupPrisma.$disconnect();
    await app.close();
  });

  it('a plain employee cannot create an API key', async () => {
    const res = await request(app.getHttpServer()).post('/api-keys').set('Authorization', `Bearer ${employeeAToken}`).send({ name: 'sneaky' });
    expect(res.status).toBe(403);
  });

  it("Super Admin creates a key, and the raw key only ever appears in that one response", async () => {
    const res = await request(app.getHttpServer()).post('/api-keys').set('Authorization', `Bearer ${adminAToken}`).send({ name: 'Integration A' });
    expect(res.status).toBe(201);
    expect(res.body.key).toMatch(/^pugey_live_[a-f0-9]{48}$/);

    const list = await request(app.getHttpServer()).get('/api-keys').set('Authorization', `Bearer ${adminAToken}`);
    expect(list.status).toBe(200);
    expect(list.body.every((k: Record<string, unknown>) => !('key' in k) && !('keyHash' in k))).toBe(true);
  });

  it('the raw key authenticates the external API and returns only that tenant\'s employees', async () => {
    const created = await request(app.getHttpServer()).post('/api-keys').set('Authorization', `Bearer ${adminAToken}`).send({ name: 'Integration A2' });
    const rawKey = created.body.key;

    const res = await request(app.getHttpServer()).get('/external/v1/employees').set('Authorization', `Bearer ${rawKey}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    const emails = res.body.map((e: { user: { email: string } }) => e.user.email);
    expect(emails.every((e: string) => e.endsWith(`${SUFFIX}@test.local`))).toBe(true);
    expect(emails.some((e: string) => e.includes('admin-b'))).toBe(false);
  });

  it("tenant B's admin token cannot see or revoke tenant A's key (IDOR)", async () => {
    const created = await request(app.getHttpServer()).post('/api-keys').set('Authorization', `Bearer ${adminAToken}`).send({ name: 'Integration A3' });
    const keyId = created.body.id;

    const listAsB = await request(app.getHttpServer()).get('/api-keys').set('Authorization', `Bearer ${adminBToken}`);
    expect(listAsB.body.some((k: { id: string }) => k.id === keyId)).toBe(false);

    const revokeAsB = await request(app.getHttpServer()).patch(`/api-keys/${keyId}/revoke`).set('Authorization', `Bearer ${adminBToken}`);
    expect(revokeAsB.status).toBe(404);
  });

  it('a revoked key is rejected by the external API', async () => {
    const created = await request(app.getHttpServer()).post('/api-keys').set('Authorization', `Bearer ${adminAToken}`).send({ name: 'Integration A4' });
    const rawKey = created.body.key;

    await request(app.getHttpServer()).patch(`/api-keys/${created.body.id}/revoke`).set('Authorization', `Bearer ${adminAToken}`);

    const res = await request(app.getHttpServer()).get('/external/v1/employees').set('Authorization', `Bearer ${rawKey}`);
    expect(res.status).toBe(401);
  });

  it('a garbage key is rejected, not crashed on', async () => {
    const res = await request(app.getHttpServer()).get('/external/v1/employees').set('Authorization', 'Bearer pugey_live_not_a_real_key');
    expect(res.status).toBe(401);
  });

  it('the external API rejects a normal user JWT (it only accepts API keys)', async () => {
    const res = await request(app.getHttpServer()).get('/external/v1/employees').set('Authorization', `Bearer ${adminAToken}`);
    expect(res.status).toBe(401);
  });
});
