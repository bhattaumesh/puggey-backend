import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { TenantContextService } from '../common/tenant-context.service';
import { runInTenantContext } from '../prisma/rls.util';
import { NotificationsService } from '../notifications/notifications.service';
import { AdvancesService } from '../advances/advances.service';
import { UpdatePayrollSettingsDto } from './dto/update-payroll-settings.dto';
import { GeneratePayslipsDto } from './dto/generate-payslips.dto';
import { renderPayslipPdf } from './payslip-pdf.util';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const BS_MONTH_NAMES_EN = [
  'Baisakh',
  'Jestha',
  'Asar',
  'Shrawan',
  'Bhadra',
  'Aswin',
  'Kartik',
  'Mangsir',
  'Poush',
  'Magh',
  'Falgun',
  'Chaitra',
];
const AD_MONTH_NAMES_EN = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

// Fetches the tenant's logo for embedding in the PDF. Best-effort only --
// a slow, missing, or unsupported-format logo (pdfkit only decodes
// PNG/JPEG) must never block generating the payslip itself.
async function fetchLogoBuffer(logoUrl: string | null | undefined): Promise<Buffer | null> {
  if (!logoUrl) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(logoUrl, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('png') && !contentType.includes('jpeg') && !contentType.includes('jpg')) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly ctx: TenantContextService,
    private readonly advances: AdvancesService,
  ) {}

  private async myMembershipId(tx: Prisma.TransactionClient): Promise<string> {
    const userId = this.ctx.userId;
    const tenantId = this.ctx.tenantId;
    if (!userId || !tenantId) throw new NotFoundException({ error: 'not_found', message: 'No employee record for this account.' });
    const membership = await tx.tenantMembership.findUnique({ where: { tenantId_userId: { tenantId, userId } }, select: { id: true } });
    if (!membership) throw new NotFoundException({ error: 'not_found', message: 'No employee record for this account.' });
    return membership.id;
  }

  // Both rates default to zero until the tenant's own admin sets them --
  // never inferred, never a real Nepal tax bracket guessed by the app.
  getSettings() {
    return this.tenantPrisma.run(async (tx) => {
      const existing = await tx.payrollSettings.findUnique({ where: { tenantId: this.ctx.tenantId! } });
      return (
        existing ?? {
          tenantId: this.ctx.tenantId!,
          incomeTaxPercent: 0,
          contributionScheme: 'NONE' as const,
          employeeContributionPercent: 0,
          employerContributionPercent: 0,
        }
      );
    });
  }

  updateSettings(dto: UpdatePayrollSettingsDto) {
    const tenantId = this.ctx.tenantId!;
    const fields = {
      incomeTaxPercent: dto.incomeTaxPercent,
      contributionScheme: dto.contributionScheme,
      employeeContributionPercent: dto.employeeContributionPercent,
      employerContributionPercent: dto.employerContributionPercent,
    };
    return this.tenantPrisma.run((tx) =>
      tx.payrollSettings.upsert({
        where: { tenantId },
        create: { tenantId, ...fields },
        update: fields,
      }),
    );
  }

  // Idempotent by design: running this again for the same month recomputes
  // and overwrites (upsert), so fixing a base salary or tax rate before the
  // month closes is a normal "generate again," not a support ticket.
  async generate(dto: GeneratePayslipsDto) {
    const tenantId = this.ctx.tenantId!;
    const result = await this.tenantPrisma.run(async (tx) => {
      const generatedByMembershipId = await this.myMembershipId(tx);
      const settings = await tx.payrollSettings.findUnique({ where: { tenantId } });
      const taxPct = settings ? Number(settings.incomeTaxPercent) : 0;
      const employeePct = settings ? Number(settings.employeeContributionPercent) : 0;
      const employerPct = settings ? Number(settings.employerContributionPercent) : 0;

      const members = await tx.tenantMembership.findMany({
        where: { tenantId, status: 'active', baseSalary: { not: null }, ...(dto.membershipId ? { id: dto.membershipId } : {}) },
      });
      if (dto.membershipId && members.length === 0) {
        throw new NotFoundException({ error: 'not_found', message: 'No active employee with a base salary found for that id.' });
      }

      const receivableByMember = new Map<string, number>();
      for (const r of dto.receivables ?? []) receivableByMember.set(r.membershipId, r.amount);

      const payslips: { payslip: Prisma.PayslipGetPayload<Record<string, never>>; userId: string }[] = [];
      for (const m of members) {
        const gross = Number(m.baseSalary);
        const incomeTax = round2(gross * (taxPct / 100));
        const providentFund = round2(gross * (employeePct / 100));
        const employerContribution = round2(gross * (employerPct / 100));
        const netPay = round2(gross - incomeTax - providentFund);
        const previousMonthReceivable = round2(receivableByMember.get(m.id) ?? 0);
        const adjustedPay = round2(netPay + previousMonthReceivable);

        // Advance recovery is capped at this member's adjusted pay (netPay
        // plus any previous month receivable), the minimumNetPay floor
        // stays 0, so netPayable can never go negative -- computeAdvanceDeductionsInTx
        // and applyRecoveryForPayroll are the exact same functions the
        // standalone advances endpoints use, called here inside payroll's
        // own transaction so the payslip and the committed recovery rows
        // can never disagree.
        const period = { year: dto.year, month: dto.month };
        const deductions = await this.advances.computeAdvanceDeductionsInTx(tx, m.id, adjustedPay);
        const advanceRecovery = deductions.totalDeduction;
        const netPayable = round2(adjustedPay - advanceRecovery);

        const payslip = await tx.payslip.upsert({
          where: { membershipId_year_month: { membershipId: m.id, year: dto.year, month: dto.month } },
          create: { tenantId, membershipId: m.id, year: dto.year, month: dto.month, grossPay: gross, incomeTax, providentFund, employerContribution, netPay, previousMonthReceivable, advanceRecovery, netPayable, generatedByMembershipId },
          update: { grossPay: gross, incomeTax, providentFund, employerContribution, netPay, previousMonthReceivable, advanceRecovery, netPayable, generatedByMembershipId },
        });

        if (advanceRecovery > 0) {
          await this.advances.applyRecoveryForPayroll(tx, m.id, period, deductions, generatedByMembershipId);
        }

        payslips.push({ payslip, userId: m.userId });
      }
      return payslips;
    });

    // Notifications are recipient-owned by RLS, so they run as a follow-up
    // write under the platform-bypass context -- same pattern as everywhere
    // else a write targets someone other than the caller.
    await runInTenantContext(this.prisma, { isPugeyStaff: true }, async (tx) => {
      for (const { payslip, userId } of result) {
        await NotificationsService.create(tx, {
          tenantId,
          userId,
          type: 'payslip_generated',
          message: `Your payslip for ${dto.year}-${String(dto.month).padStart(2, '0')} is ready.`,
        });
      }
    });

    return result.map((r) => r.payslip);
  }

  // Read-only counterpart to generate(): same math, same advance-deduction
  // computation, but never upserts a Payslip row or commits recovery --
  // lets the "select employee -> view/edit -> generate" flow show real
  // numbers before the admin commits to anything.
  async preview(membershipId: string, year: number, month: number, previousMonthReceivable: number) {
    const tenantId = this.ctx.tenantId!;
    return this.tenantPrisma.run(async (tx) => {
      const member = await tx.tenantMembership.findUnique({ where: { id: membershipId } });
      if (!member || member.tenantId !== tenantId || member.baseSalary == null) {
        throw new NotFoundException({ error: 'not_found', message: 'No active employee with a base salary found for that id.' });
      }
      const settings = await tx.payrollSettings.findUnique({ where: { tenantId } });
      const taxPct = settings ? Number(settings.incomeTaxPercent) : 0;
      const employeePct = settings ? Number(settings.employeeContributionPercent) : 0;
      const employerPct = settings ? Number(settings.employerContributionPercent) : 0;

      const gross = Number(member.baseSalary);
      const incomeTax = round2(gross * (taxPct / 100));
      const providentFund = round2(gross * (employeePct / 100));
      const employerContribution = round2(gross * (employerPct / 100));
      const netPay = round2(gross - incomeTax - providentFund);
      const receivable = round2(previousMonthReceivable || 0);
      const adjustedPay = round2(netPay + receivable);

      const deductions = await this.advances.computeAdvanceDeductionsInTx(tx, membershipId, adjustedPay);
      const advanceRecovery = deductions.totalDeduction;
      const netPayable = round2(adjustedPay - advanceRecovery);

      const existing = await tx.payslip.findUnique({ where: { membershipId_year_month: { membershipId, year, month } } });

      return {
        grossPay: gross,
        incomeTax,
        providentFund,
        employerContribution,
        netPay,
        previousMonthReceivable: receivable,
        advanceRecovery,
        netPayable,
        alreadyGenerated: existing != null,
      };
    });
  }

  myPayslips() {
    return this.tenantPrisma.run(async (tx) => {
      const myId = await this.myMembershipId(tx);
      return tx.payslip.findMany({ where: { membershipId: myId }, orderBy: [{ year: 'desc' }, { month: 'desc' }] });
    });
  }

  listForMonth(year: number, month: number) {
    return this.tenantPrisma.run((tx) =>
      tx.payslip.findMany({
        where: { tenantId: this.ctx.tenantId!, year, month },
        include: { membership: { include: { user: { select: { fullName: true, email: true } } } } },
        orderBy: { createdAt: 'asc' },
      }),
    );
  }

  // A4 payslip PDF. Access follows the same rule as the standalone advances
  // endpoints -- SUPER_ADMIN sees any payslip in the tenant, everyone else
  // only their own -- and cross-tenant access is already impossible since
  // this runs inside the RLS-scoped tenantPrisma transaction.
  async getPayslipPdf(id: string): Promise<Buffer> {
    const { payslip, tenant } = await this.tenantPrisma.run(async (tx) => {
      const found = await tx.payslip.findUnique({
        where: { id },
        include: { membership: { include: { user: { select: { fullName: true, email: true } }, department: true } } },
      });
      if (!found) throw new NotFoundException({ error: 'not_found', message: 'No such payslip.' });
      if (this.ctx.role !== 'SUPER_ADMIN') {
        const myId = await this.myMembershipId(tx);
        if (myId !== found.membershipId) {
          throw new ForbiddenException({ error: 'not_authorized', message: 'You do not have access to this payslip.' });
        }
      }
      const tenantRow = await tx.tenant.findUnique({ where: { id: this.ctx.tenantId! } });
      return { payslip: found, tenant: tenantRow };
    });

    const logoBuffer = await fetchLogoBuffer(tenant?.logoUrl);
    const isBs = tenant?.calendarPreference === 'BS';
    const monthName = (isBs ? BS_MONTH_NAMES_EN : AD_MONTH_NAMES_EN)[payslip.month - 1] ?? String(payslip.month);
    const periodLabel = `${monthName} ${payslip.year}${isBs ? ' BS' : ''}`;

    return renderPayslipPdf({
      tenantName: tenant?.name ?? 'Puggey',
      logoBuffer,
      periodLabel,
      employeeName: payslip.membership.user.fullName || payslip.membership.user.email,
      employeeCode: payslip.membership.employeeCode || null,
      designation: payslip.membership.designation || null,
      departmentName: payslip.membership.department?.name ?? null,
      grossPay: Number(payslip.grossPay),
      incomeTax: Number(payslip.incomeTax),
      providentFund: Number(payslip.providentFund),
      employerContribution: Number(payslip.employerContribution),
      netPay: Number(payslip.netPay),
      previousMonthReceivable: Number(payslip.previousMonthReceivable),
      advanceRecovery: Number(payslip.advanceRecovery),
      netPayable: Number(payslip.netPayable),
      generatedAt: new Date(),
    });
  }
}
