// Dev/demo seed only. Deliberately connects with DATABASE_URL (the superuser
// migration role, which bypasses RLS) because seeding legitimately needs to write
// into more than one tenant in a single run -- never use this connection string
// for the running application server.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main() {
  const passwordHash = await bcrypt.hash('DemoPass123!', 10);

  const niuto = await prisma.tenant.upsert({
    where: { slug: 'niuto' },
    update: {},
    create: {
      slug: 'niuto',
      name: 'Niuto Store',
      status: 'active',
      accentColorHex: '#3EA832',
      companyCode: 'NIUTO',
    },
  });

  const acme = await prisma.tenant.upsert({
    where: { slug: 'acme' },
    update: {},
    create: {
      slug: 'acme',
      name: 'Acme Traders',
      status: 'active',
      accentColorHex: '#3EA832',
      companyCode: 'ACME',
    },
  });

  const niutoAdmin = await prisma.user.upsert({
    where: { email: 'admin@niuto.test' },
    update: {},
    create: { email: 'admin@niuto.test', passwordHash },
  });
  await prisma.tenantMembership.upsert({
    where: { tenantId_userId: { tenantId: niuto.id, userId: niutoAdmin.id } },
    update: {},
    create: { tenantId: niuto.id, userId: niutoAdmin.id, role: 'SUPER_ADMIN' },
  });

  const niutoEmployee = await prisma.user.upsert({
    where: { email: 'employee@niuto.test' },
    update: {},
    create: { email: 'employee@niuto.test', passwordHash },
  });
  await prisma.tenantMembership.upsert({
    where: { tenantId_userId: { tenantId: niuto.id, userId: niutoEmployee.id } },
    update: {},
    create: { tenantId: niuto.id, userId: niutoEmployee.id, role: 'EMPLOYEE' },
  });

  const acmeAdmin = await prisma.user.upsert({
    where: { email: 'admin@acme.test' },
    update: {},
    create: { email: 'admin@acme.test', passwordHash },
  });
  await prisma.tenantMembership.upsert({
    where: { tenantId_userId: { tenantId: acme.id, userId: acmeAdmin.id } },
    update: {},
    create: { tenantId: acme.id, userId: acmeAdmin.id, role: 'SUPER_ADMIN' },
  });

  // A consultant belonging to both tenants -- the multi-tenant-membership case
  // the login flow's company-code fallback exists to disambiguate.
  const consultant = await prisma.user.upsert({
    where: { email: 'consultant@shared.test' },
    update: {},
    create: { email: 'consultant@shared.test', passwordHash },
  });
  await prisma.tenantMembership.upsert({
    where: { tenantId_userId: { tenantId: niuto.id, userId: consultant.id } },
    update: {},
    create: { tenantId: niuto.id, userId: consultant.id, role: 'EMPLOYEE' },
  });
  await prisma.tenantMembership.upsert({
    where: { tenantId_userId: { tenantId: acme.id, userId: consultant.id } },
    update: {},
    create: { tenantId: acme.id, userId: consultant.id, role: 'SUPERVISOR' },
  });

  const staffUser = await prisma.user.upsert({
    where: { email: 'staff@pugey.test' },
    update: {},
    create: { email: 'staff@pugey.test', passwordHash },
  });
  await prisma.pugeyStaffMember.upsert({
    where: { userId: staffUser.id },
    update: {},
    create: { userId: staffUser.id, role: 'SUPER_ADMIN' },
  });

  console.log('Seeded:', {
    tenants: [niuto.slug, acme.slug],
    users: ['admin@niuto.test', 'employee@niuto.test', 'admin@acme.test', 'consultant@shared.test (both tenants)', 'staff@pugey.test (platform)'],
    password: 'DemoPass123! (all seeded accounts)',
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
