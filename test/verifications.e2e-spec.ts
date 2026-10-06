import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';

// Saved "Verify Online Transaction" reports: the browser matches the two
// amount lists, the server keeps the finished table so it can be reopened
// (and downloaded) on a later day by anyone who can see the verification tab.
jest.setTimeout(120_000);

describe('Saved online verifications (e2e)', () => {
  let app: INestApplication<App>;
  const setupPrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

  const SUFFIX = `verif-${Date.now()}`;
  const PASSWORD = 'VerifTest123!';
  const mk = (n: string) => `${n}-${SUFFIX}@test.local`;
  let tenant: { id: string };
  let otherTenant: { id: string };
  let adminToken: string;
  let supervisorToken: string;
  let employeeToken: string;
  let otherAdminToken: string;

  const rows = [
    { software: 1500, online: 1500 },
    { software: 900, online: 800 },
    { software: 400, online: null },
  ];
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const save = (token: string, over: Record<string, unknown> = {}) =>
    request(app.getHttpServer()).post('/counters/verifications').set(auth(token)).send({ reportDate: '2026-10-04', note: 'Counter 1', rows, ...over });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    tenant = await setupPrisma.tenant.create({ data: { slug: `verif-${SUFFIX}`, name: 'Verif Test Co', plan: 'gold' } });
    otherTenant = await setupPrisma.tenant.create({ data: { slug: `verif-other-${SUFFIX}`, name: 'Verif Other Co', plan: 'gold' } });
    const member = async (t: { id: string }, name: string, role: 'SUPER_ADMIN' | 'SUPERVISOR' | 'EMPLOYEE') => {
      const user = await setupPrisma.user.create({ data: { email: mk(name), fullName: name, passwordHash } });
      await setupPrisma.tenantMembership.create({ data: { tenantId: t.id, userId: user.id, role } });
    };
    await member(tenant, 'admin', 'SUPER_ADMIN');
    await member(tenant, 'supervisor', 'SUPERVISOR');
    await member(tenant, 'employee', 'EMPLOYEE');
    await member(otherTenant, 'other', 'SUPER_ADMIN');

    const login = async (name: string) => {
      for (let i = 0; i < 8; i++) {
        const res = await request(app.getHttpServer()).post('/auth/login').send({ email: mk(name), password: PASSWORD });
        if (res.body.accessToken) return res.body.accessToken as string;
        await new Promise((r) => setTimeout(r, 10_000));
      }
      throw new Error('login stayed throttled');
    };
    adminToken = await login('admin');
    supervisorToken = await login('supervisor');
    employeeToken = await login('employee');
    otherAdminToken = await login('other');
  });

  afterAll(async () => {
    await setupPrisma.onlineVerification.deleteMany({ where: { tenantId: { in: [tenant.id, otherTenant.id] } } });
    await setupPrisma.notification.deleteMany({ where: { tenantId: { in: [tenant.id, otherTenant.id] } } });
    await setupPrisma.refreshToken.deleteMany({ where: { user: { email: { endsWith: `${SUFFIX}@test.local` } } } });
    await setupPrisma.tenantMembership.deleteMany({ where: { tenantId: { in: [tenant.id, otherTenant.id] } } });
    await setupPrisma.user.deleteMany({ where: { email: { endsWith: `${SUFFIX}@test.local` } } });
    await setupPrisma.tenant.deleteMany({ where: { id: { in: [tenant.id, otherTenant.id] } } });
    await setupPrisma.$disconnect();
    await app.close();
  });

  let savedId: string;
  let employeeReportId: string;

  it('a plain employee can verify and save, but only ever sees their own reports', async () => {
    const mine = await save(employeeToken, { reportDate: '2026-10-03', note: 'My till' });
    expect(mine.status).toBe(201);
    expect(mine.body.createdByName).toBe('employee');
    const list = await request(app.getHttpServer()).get('/counters/verifications').set(auth(employeeToken));
    expect(list.body.map((v: { id: string }) => v.id)).toEqual([mine.body.id]);
    expect((await request(app.getHttpServer()).get(`/counters/verifications/${mine.body.id}`).set(auth(employeeToken))).status).toBe(200);
    employeeReportId = mine.body.id;
  });

  it('validates the date and the rows', async () => {
    expect((await save(supervisorToken, { reportDate: '2026-02-31' })).status).toBe(400);
    expect((await save(supervisorToken, { reportDate: 'yesterday' })).status).toBe(400);
    expect((await save(supervisorToken, { rows: [] })).status).toBe(400);
  });

  it('a supervisor can save one; the server works out the totals and mismatches', async () => {
    const res = await save(supervisorToken);
    expect(res.status).toBe(201);
    expect(res.body.rowCount).toBe(3);
    expect(res.body.mismatchCount).toBe(2); // 900 vs 800, and 400 with nothing online
    expect(res.body.softwareTotal).toBe(2800);
    expect(res.body.onlineTotal).toBe(2300);
    expect(res.body.totalsMatch).toBe(false);
    expect(res.body.createdByName).toBe('supervisor');
    savedId = res.body.id;
  });

  it("an employee cannot open or download someone else's report", async () => {
    expect((await request(app.getHttpServer()).get(`/counters/verifications/${savedId}`).set(auth(employeeToken))).status).toBe(404);
    const list = await request(app.getHttpServer()).get('/counters/verifications').set(auth(employeeToken));
    expect(list.body.map((v: { id: string }) => v.id)).toEqual([employeeReportId]);
  });

  it('the admin can list and reopen what the supervisor saved, on a later day', async () => {
    await save(adminToken, { reportDate: '2026-10-01', note: undefined, rows: [{ software: 100, online: 100 }] });

    const all = await request(app.getHttpServer()).get('/counters/verifications').set(auth(adminToken));
    expect(all.status).toBe(200);
    expect(all.body.map((v: { reportDate: string }) => v.reportDate.slice(0, 10))).toEqual(['2026-10-04', '2026-10-03', '2026-10-01']); // newest day first
    expect(all.body[0].rows).toBeUndefined(); // list stays light

    const ranged = await request(app.getHttpServer()).get('/counters/verifications?from=2026-10-04&to=2026-10-05').set(auth(supervisorToken));
    expect(ranged.body).toHaveLength(1);

    const one = await request(app.getHttpServer()).get(`/counters/verifications/${savedId}`).set(auth(adminToken));
    expect(one.body.rows).toEqual(rows);
    expect(one.body.note).toBe('Counter 1');
  });

  it('another tenant cannot see it', async () => {
    expect((await request(app.getHttpServer()).get('/counters/verifications').set(auth(otherAdminToken))).body).toEqual([]);
    expect((await request(app.getHttpServer()).get(`/counters/verifications/${savedId}`).set(auth(otherAdminToken))).status).toBe(404);
  });

  it('downloads a saved report as Excel and PDF', async () => {
    const { token } = (await request(app.getHttpServer()).get('/auth/download-token').set(auth(supervisorToken))).body;
    const xlsx = await request(app.getHttpServer()).get(`/counters/verifications/${savedId}/xlsx?token=${token}`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    expect(xlsx.headers['content-disposition']).toContain('online-verification-2026-10-04.xlsx');
    expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');

    const pdf = await request(app.getHttpServer()).get(`/counters/verifications/${savedId}/pdf?token=${token}`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((await request(app.getHttpServer()).get(`/counters/verifications/${savedId}/doc?token=${token}`)).status).toBe(400);
  });

  it('only a Super Admin can delete', async () => {
    expect((await request(app.getHttpServer()).delete(`/counters/verifications/${savedId}`).set(auth(supervisorToken))).status).toBe(403);
    expect((await request(app.getHttpServer()).delete(`/counters/verifications/${savedId}`).set(auth(adminToken))).status).toBe(200);
    expect((await request(app.getHttpServer()).get(`/counters/verifications/${savedId}`).set(auth(adminToken))).status).toBe(404);
  });
});
