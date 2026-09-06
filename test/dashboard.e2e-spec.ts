import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';

// Admin-home summary cards. Absent is deliberately a set difference
// (scheduled - present - on-leave), not total - present, because this
// tenant has no shift/holiday model yet -- see the service's own comment.
// This suite exists specifically to pin the one formula the whole feature
// depends on: present takes priority over on-leave, on-leave is excluded
// from absent, and the four numbers reconcile exactly against the active
// population every time.
describe('Dashboard summary (e2e)', () => {
  let app: INestApplication<App>;
  const setupPrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

  const SUFFIX = `dash-${Date.now()}`;
  let tenant: { id: string };
  let adminToken: string;
  let supervisorToken: string;
  let employeeToken: string;
  let presentMembershipId: string;
  let absentMembershipId: string;
  let onLeaveMembershipId: string;
  let activeMembershipId: string;
  let supervisorMembershipId: string;
  let supervisedMembershipId: string; // reports to supervisor, present -- to prove supervisor scoping

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const passwordHash = await bcrypt.hash('DashTest123!', 10);
    tenant = await setupPrisma.tenant.create({ data: { slug: `dash-${SUFFIX}`, name: 'Dashboard Test Co', plan: 'gold' } });

    const adminUser = await setupPrisma.user.create({ data: { email: `dash-admin-${SUFFIX}@test.local`, passwordHash } });
    const supervisorUser = await setupPrisma.user.create({ data: { email: `dash-supervisor-${SUFFIX}@test.local`, passwordHash } });
    const employeeUser = await setupPrisma.user.create({ data: { email: `dash-employee-${SUFFIX}@test.local`, passwordHash } });
    const presentUser = await setupPrisma.user.create({ data: { email: `dash-present-${SUFFIX}@test.local`, passwordHash } });
    const absentUser = await setupPrisma.user.create({ data: { email: `dash-absent-${SUFFIX}@test.local`, passwordHash } });
    const onLeaveUser = await setupPrisma.user.create({ data: { email: `dash-leave-${SUFFIX}@test.local`, passwordHash } });
    const activeUser = await setupPrisma.user.create({ data: { email: `dash-active-${SUFFIX}@test.local`, passwordHash } });
    const supervisedUser = await setupPrisma.user.create({ data: { email: `dash-supervised-${SUFFIX}@test.local`, passwordHash } });

    await setupPrisma.tenantMembership.create({ data: { tenantId: tenant.id, userId: adminUser.id, role: 'SUPER_ADMIN' } });
    const supervisorMembership = await setupPrisma.tenantMembership.create({ data: { tenantId: tenant.id, userId: supervisorUser.id, role: 'SUPERVISOR' } });
    supervisorMembershipId = supervisorMembership.id;
    await setupPrisma.tenantMembership.create({ data: { tenantId: tenant.id, userId: employeeUser.id, role: 'EMPLOYEE' } });

    const present = await setupPrisma.tenantMembership.create({ data: { tenantId: tenant.id, userId: presentUser.id, role: 'EMPLOYEE' } });
    presentMembershipId = present.id;
    const absent = await setupPrisma.tenantMembership.create({ data: { tenantId: tenant.id, userId: absentUser.id, role: 'EMPLOYEE' } });
    absentMembershipId = absent.id;
    const onLeave = await setupPrisma.tenantMembership.create({ data: { tenantId: tenant.id, userId: onLeaveUser.id, role: 'EMPLOYEE' } });
    onLeaveMembershipId = onLeave.id;
    const active = await setupPrisma.tenantMembership.create({ data: { tenantId: tenant.id, userId: activeUser.id, role: 'EMPLOYEE' } });
    activeMembershipId = active.id;
    const supervised = await setupPrisma.tenantMembership.create({
      data: { tenantId: tenant.id, userId: supervisedUser.id, role: 'EMPLOYEE', supervisorMembershipId: supervisorMembership.id },
    });
    supervisedMembershipId = supervised.id;

    // Present: checked in AND out today.
    await setupPrisma.attendanceEvent.create({ data: { tenantId: tenant.id, membershipId: presentMembershipId, type: 'check_in', occurredAt: new Date() } });
    await setupPrisma.attendanceEvent.create({ data: { tenantId: tenant.id, membershipId: presentMembershipId, type: 'check_out', occurredAt: new Date() } });

    // Active now: checked in, no check-out yet.
    await setupPrisma.attendanceEvent.create({ data: { tenantId: tenant.id, membershipId: activeMembershipId, type: 'check_in', occurredAt: new Date() } });

    // Checked in and out, present, so supervisor's own team has a present member too.
    await setupPrisma.attendanceEvent.create({ data: { tenantId: tenant.id, membershipId: supervisedMembershipId, type: 'check_in', occurredAt: new Date() } });
    await setupPrisma.attendanceEvent.create({ data: { tenantId: tenant.id, membershipId: supervisedMembershipId, type: 'check_out', occurredAt: new Date() } });

    // On approved leave today: no attendance events at all. A real leave
    // request "for today" is submitted with today's Nepal calendar date, not
    // the server's UTC date -- those disagree for part of every day (Nepal is
    // UTC+5:45), so this must match the dashboard's own Nepal-day boundary,
    // not raw UTC midnight.
    const leaveType = await setupPrisma.leaveType.create({ data: { tenantId: tenant.id, name: `Sick ${SUFFIX}`, defaultDaysPerYear: 10 } });
    const nepalTodayKey = new Date(Date.now() + 345 * 60_000).toISOString().slice(0, 10);
    const today = new Date(`${nepalTodayKey}T00:00:00.000Z`);
    await setupPrisma.leaveRequest.create({
      data: {
        tenantId: tenant.id,
        membershipId: onLeaveMembershipId,
        leaveTypeId: leaveType.id,
        startDate: today,
        endDate: today,
        days: 1,
        reason: 'Test leave',
        status: 'approved',
      },
    });

    // absentMembershipId: deliberately no attendance, no leave -- this is
    // also standing in for "not scheduled" (weekend), since this tenant has
    // no way yet to distinguish the two; both currently land in "absent",
    // which is the documented gap this suite pins rather than hides.

    const login = async (email: string) => (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'DashTest123!' })).body.accessToken;
    adminToken = await login(adminUser.email);
    supervisorToken = await login(supervisorUser.email);
    employeeToken = await login(employeeUser.email);
  });

  afterAll(async () => {
    await setupPrisma.leaveRequest.deleteMany({ where: { tenantId: tenant.id } });
    await setupPrisma.leaveType.deleteMany({ where: { tenantId: tenant.id } });
    await setupPrisma.attendanceEvent.deleteMany({ where: { tenantId: tenant.id } });
    await setupPrisma.notification.deleteMany({ where: { tenantId: tenant.id } });
    await setupPrisma.refreshToken.deleteMany({ where: { user: { email: { endsWith: `${SUFFIX}@test.local` } } } });
    await setupPrisma.tenantMembership.deleteMany({ where: { tenantId: tenant.id } });
    await setupPrisma.user.deleteMany({ where: { email: { endsWith: `${SUFFIX}@test.local` } } });
    await setupPrisma.tenant.deleteMany({ where: { id: tenant.id } });
    await setupPrisma.$disconnect();
    await app.close();
  });

  it('a plain employee cannot see the dashboard summary', async () => {
    const res = await request(app.getHttpServer()).get('/dashboard/summary').set('Authorization', `Bearer ${employeeToken}`);
    expect(res.status).toBe(403);
  });

  it('Admin sees the whole tenant: correct present/absent/active/on-leave buckets that reconcile to the total', async () => {
    const res = await request(app.getHttpServer()).get('/dashboard/summary').set('Authorization', `Bearer ${adminToken}`).expect(200);
    const body = res.body;

    // Only numbers and metadata come back -- never employee rows.
    expect(typeof body.totalEmployees).toBe('number');
    expect(Array.isArray(body.caveats)).toBe(true);

    // 8 active memberships created in this tenant (admin, supervisor, employee,
    // present, absent, onLeave, active, supervised).
    expect(body.totalEmployees).toBe(8);
    // Present = at least one check-in today, regardless of checkout --
    // that's present + supervised + active (active also checked in).
    expect(body.presentToday).toBe(3);
    expect(body.activeNow).toBe(1); // active: checked in, not yet checked out
    expect(body.onLeaveToday).toBe(1); // onLeave
    expect(body.absentToday).toBe(body.totalEmployees - body.presentToday - body.onLeaveToday);
    expect(body.presentToday + body.absentToday + body.onLeaveToday + body.notScheduledToday).toBe(body.totalEmployees);
  });

  it('someone on approved leave is never counted as absent', async () => {
    const absentList = await request(app.getHttpServer()).get('/dashboard/drilldown/absent').set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(absentList.body.some((m: { id: string }) => m.id === onLeaveMembershipId)).toBe(false);

    const onLeaveList = await request(app.getHttpServer()).get('/dashboard/drilldown/onLeave').set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(onLeaveList.body.some((m: { id: string }) => m.id === onLeaveMembershipId)).toBe(true);
  });

  it('the present drill-down lists exactly who checked in today, and active lists only who has not checked out', async () => {
    const presentList = await request(app.getHttpServer()).get('/dashboard/drilldown/present').set('Authorization', `Bearer ${adminToken}`).expect(200);
    const presentIds = presentList.body.map((m: { id: string }) => m.id);
    expect(presentIds).toContain(presentMembershipId);
    expect(presentIds).toContain(supervisedMembershipId);
    expect(presentIds).not.toContain(absentMembershipId);

    const activeList = await request(app.getHttpServer()).get('/dashboard/drilldown/active').set('Authorization', `Bearer ${adminToken}`).expect(200);
    const activeIds = activeList.body.map((m: { id: string }) => m.id);
    expect(activeIds).toEqual([activeMembershipId]);
    // Present-and-checked-out is not "active now".
    expect(activeIds).not.toContain(presentMembershipId);
  });

  it('the absent drill-down lists the employee with no check-in and no leave', async () => {
    const absentList = await request(app.getHttpServer()).get('/dashboard/drilldown/absent').set('Authorization', `Bearer ${adminToken}`).expect(200);
    const absentIds = absentList.body.map((m: { id: string }) => m.id);
    expect(absentIds).toContain(absentMembershipId);
    expect(absentIds).not.toContain(presentMembershipId);
    expect(absentIds).not.toContain(activeMembershipId);
  });

  it('a Supervisor sees only their own subtree, not the whole tenant', async () => {
    const res = await request(app.getHttpServer()).get('/dashboard/summary').set('Authorization', `Bearer ${supervisorToken}`).expect(200);
    // Supervisor's subtree here is exactly one report: the supervised, present employee.
    expect(res.body.totalEmployees).toBe(1);
    expect(res.body.presentToday).toBe(1);
    expect(res.body.absentToday).toBe(0);

    const presentList = await request(app.getHttpServer()).get('/dashboard/drilldown/present').set('Authorization', `Bearer ${supervisorToken}`).expect(200);
    expect(presentList.body.map((m: { id: string }) => m.id)).toEqual([supervisedMembershipId]);
  });
});
