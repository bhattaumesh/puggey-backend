import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';

// A cash outflow at the counter can be for an employee advance or an
// employee purchase. Those are mirrored into the employee's advances so
// payroll recovers them from net pay, and stay in step if the entry is
// edited or removed (until payroll has recovered some of it).
jest.setTimeout(120_000);

describe('Counter outflow -> employee advance (e2e)', () => {
  let app: INestApplication<App>;
  const setupPrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

  const SUFFIX = `outflow-${Date.now()}`;
  const PASSWORD = 'OutflowTest123!';
  const mk = (n: string) => `${n}-${SUFFIX}@test.local`;
  let tenant: { id: string };
  let adminToken: string;
  let cashierToken: string;
  let buyerToken: string;
  let cashierId: string;
  let buyerId: string;
  let sessionId: string;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  const outflow = (token: string, body: Record<string, unknown>) =>
    request(app.getHttpServer()).post(`/counters/sessions/${sessionId}/movements`).set(auth(token)).send({ type: 'outflow', ...body });
  const advancesOf = async (id: string) => (await request(app.getHttpServer()).get(`/advances/member/${id}`).set(auth(adminToken))).body;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    tenant = await setupPrisma.tenant.create({ data: { slug: `outflow-${SUFFIX}`, name: 'Outflow Test Co', plan: 'gold' } });
    const member = async (name: string, role: 'SUPER_ADMIN' | 'EMPLOYEE') => {
      const user = await setupPrisma.user.create({ data: { email: mk(name), fullName: name, passwordHash } });
      return setupPrisma.tenantMembership.create({ data: { tenantId: tenant.id, userId: user.id, role } });
    };
    await member('admin', 'SUPER_ADMIN');
    cashierId = (await member('cashier', 'EMPLOYEE')).id;
    buyerId = (await member('buyer', 'EMPLOYEE')).id;

    const login = async (name: string) => {
      for (let i = 0; i < 8; i++) {
        const res = await request(app.getHttpServer()).post('/auth/login').send({ email: mk(name), password: PASSWORD });
        if (res.body.accessToken) return res.body.accessToken as string;
        await new Promise((r) => setTimeout(r, 10_000));
      }
      throw new Error('login stayed throttled');
    };
    adminToken = await login('admin');
    cashierToken = await login('cashier');
    buyerToken = await login('buyer');

    const counter = await request(app.getHttpServer()).post('/counters').set(auth(adminToken)).send({ name: 'Front till' });
    const session = await request(app.getHttpServer())
      .post('/counters/sessions')
      .set(auth(adminToken))
      .send({ membershipId: cashierId, counterId: counter.body.id, openingDenominations: { '1000': 5 }, previousSale: 0 });
    sessionId = session.body.id;
  });

  afterAll(async () => {
    await setupPrisma.counterCashMovement.deleteMany({ where: { tenantId: tenant.id } });
    await setupPrisma.counterSession.deleteMany({ where: { tenantId: tenant.id } });
    await setupPrisma.counter.deleteMany({ where: { tenantId: tenant.id } });
    await setupPrisma.auditLog.deleteMany({ where: { tenantId: tenant.id } });
    await setupPrisma.advanceRecovery.deleteMany({ where: { tenantId: tenant.id } });
    await setupPrisma.advance.deleteMany({ where: { tenantId: tenant.id } });
    await setupPrisma.advanceCategory.deleteMany({ where: { tenantId: tenant.id } });
    await setupPrisma.notification.deleteMany({ where: { tenantId: tenant.id } });
    await setupPrisma.refreshToken.deleteMany({ where: { user: { email: { endsWith: `${SUFFIX}@test.local` } } } });
    await setupPrisma.tenantMembership.deleteMany({ where: { tenantId: tenant.id } });
    await setupPrisma.user.deleteMany({ where: { email: { endsWith: `${SUFFIX}@test.local` } } });
    await setupPrisma.tenant.deleteMany({ where: { id: tenant.id } });
    await setupPrisma.$disconnect();
    await app.close();
  });

  it('validates what an outflow needs', async () => {
    expect((await outflow(cashierToken, { amount: 100, purpose: 'other' })).body.error).toBe('reason_required');
    expect((await outflow(cashierToken, { amount: 100 })).body.error).toBe('reason_required');
    expect((await outflow(cashierToken, { amount: 100, purpose: 'advance' })).body.error).toBe('employee_required');
    expect((await outflow(cashierToken, { amount: 100, purpose: 'bribe', reason: 'x' })).status).toBe(400);
    expect((await request(app.getHttpServer()).post(`/counters/sessions/${sessionId}/movements`).set(auth(cashierToken)).send({ type: 'inflow', amount: 5, purpose: 'advance', employeeMembershipId: buyerId })).body.error).toBe('purpose_outflow_only');
    expect((await outflow(cashierToken, { amount: 100, purpose: 'advance', employeeMembershipId: '00000000-0000-4000-8000-000000000000' })).status).toBe(404);
    expect((await advancesOf(buyerId)).advances).toHaveLength(0);
  });

  it('a cashier cannot record an advance or purchase for themselves', async () => {
    const res = await outflow(cashierToken, { amount: 100, purpose: 'advance', employeeMembershipId: cashierId });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('cannot_record_for_self');
  });

  it('"other" outflows (vendors, operations) stay plain cash movements', async () => {
    const res = await outflow(cashierToken, { amount: 300, purpose: 'other', reason: 'Vendor payment' });
    expect(res.status).toBe(201);
    expect(res.body.movements[0].purpose).toBe('other');
    expect((await advancesOf(buyerId)).advances).toHaveLength(0);
  });

  let advanceMovementId: string;
  let purchaseMovementId: string;

  it('an advance payment creates an advance for that employee', async () => {
    const res = await outflow(cashierToken, { amount: 2000, purpose: 'advance', employeeMembershipId: buyerId });
    expect(res.status).toBe(201);
    const movement = res.body.movements.find((m: { purpose: string }) => m.purpose === 'advance');
    advanceMovementId = movement.id;
    expect(movement.employee.user.fullName).toBe('buyer');
    expect(movement.reason).toBe('Advance payment - buyer');

    const { advances, totalOutstanding } = await advancesOf(buyerId);
    expect(advances).toHaveLength(1);
    expect(Number(advances[0].amount)).toBe(2000);
    expect(advances[0].recoveryMode).toBe('FULL');
    expect(advances[0].category.name).toBe('Advance salary');
    expect(advances[0].reason).toContain('Front till');
    expect(totalOutstanding).toBe(2000);
  });

  it('an employee purchase becomes a "Purchase" advance, recovered in full', async () => {
    const res = await outflow(cashierToken, { amount: 450.5, purpose: 'employee_purchase', employeeMembershipId: buyerId, reason: 'Groceries', recoveryMode: 'INSTALMENT', instalmentAmount: 10 });
    expect(res.status).toBe(201);
    purchaseMovementId = res.body.movements.find((m: { purpose: string }) => m.purpose === 'employee_purchase').id;
    const { advances, totalOutstanding } = await advancesOf(buyerId);
    const purchase = advances.find((a: { category: { name: string } }) => a.category.name === 'Purchase');
    expect(Number(purchase.amount)).toBe(450.5);
    expect(purchase.recoveryMode).toBe('FULL'); // purchases ignore instalments
    expect(totalOutstanding).toBe(2450.5);
  });

  it('an advance can be paid back in instalments', async () => {
    const bad = await outflow(cashierToken, { amount: 900, purpose: 'advance', employeeMembershipId: buyerId, recoveryMode: 'INSTALMENT' });
    expect(bad.body.error).toBe('instalment_amount_required');
    const ok = await outflow(cashierToken, { amount: 900, purpose: 'advance', employeeMembershipId: buyerId, recoveryMode: 'INSTALMENT', instalmentAmount: 300 });
    expect(ok.status).toBe(201);
    const { advances } = await advancesOf(buyerId);
    const inst = advances.find((a: { recoveryMode: string }) => a.recoveryMode === 'INSTALMENT');
    expect(Number(inst.instalmentAmount)).toBe(300);
    // tidy up so later totals stay simple
    const movementId = ok.body.movements.find((m: { advanceId: string; purpose: string; amount: string }) => m.purpose === 'advance' && Number(m.amount) === 900).id;
    expect((await request(app.getHttpServer()).delete(`/counters/sessions/${sessionId}/movements/${movementId}`).set(auth(adminToken))).status).toBe(200);
  });

  it('the staff list is for people at a counter or with team access only', async () => {
    const ok = await request(app.getHttpServer()).get('/counters/staff').set(auth(cashierToken));
    expect(ok.status).toBe(200);
    expect(ok.body.map((s: { name: string }) => s.name)).toEqual(['admin', 'buyer', 'cashier']);
    expect((await request(app.getHttpServer()).get('/counters/staff').set(auth(buyerToken))).status).toBe(403);
    expect((await request(app.getHttpServer()).get('/counters/staff').set(auth(adminToken))).status).toBe(200);
  });

  it('editing the entry updates the advance; removing it removes the advance', async () => {
    const edit = await request(app.getHttpServer())
      .patch(`/counters/sessions/${sessionId}/movements/${advanceMovementId}`)
      .set(auth(adminToken))
      .send({ amount: 1800, reason: 'Advance payment - buyer (corrected)' });
    expect(edit.status).toBe(200);
    const after = await advancesOf(buyerId);
    expect(after.advances.map((a: { amount: string }) => Number(a.amount)).sort((x: number, y: number) => x - y)).toEqual([450.5, 1800]);

    const del = await request(app.getHttpServer()).delete(`/counters/sessions/${sessionId}/movements/${purchaseMovementId}`).set(auth(adminToken));
    expect(del.status).toBe(200);
    expect((await advancesOf(buyerId)).advances.map((a: { amount: string }) => Number(a.amount))).toEqual([1800]);
  });

  it('once payroll has recovered some of it, the entry can no longer be changed here', async () => {
    const advance = (await advancesOf(buyerId)).advances[0];
    await setupPrisma.advance.update({ where: { id: advance.id }, data: { recoveredAmount: 100 } });
    const edit = await request(app.getHttpServer()).patch(`/counters/sessions/${sessionId}/movements/${advanceMovementId}`).set(auth(adminToken)).send({ amount: 1000, reason: 'x' });
    expect(edit.status).toBe(400);
    expect(edit.body.error).toBe('advance_partially_recovered');
    const del = await request(app.getHttpServer()).delete(`/counters/sessions/${sessionId}/movements/${advanceMovementId}`).set(auth(adminToken));
    expect(del.body.error).toBe('advance_partially_recovered');
    expect((await advancesOf(buyerId)).advances).toHaveLength(1);
  });
});
