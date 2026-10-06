import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { TenantContextService } from '../common/tenant-context.service';
import { myTeamScope } from '../permissions/permissions';
import { SaveVerificationDto } from './dto/save-verification.dto';
import { summarise, verifyPdf, verifyWorkbook, type VerifyRow } from './verify-export.util';

const MAX_LISTED = 300;

interface StoredVerification {
  id: string;
  reportDate: Date;
  note: string | null;
  ignoreOrder: boolean;
  rows: unknown;
  rowCount: number;
  mismatchCount: number;
  softwareTotal: { toString(): string };
  onlineTotal: { toString(): string };
  createdByName: string | null;
  createdAt: Date;
}

function summary(v: StoredVerification) {
  const softwareTotal = Number(v.softwareTotal.toString());
  const onlineTotal = Number(v.onlineTotal.toString());
  return {
    id: v.id,
    reportDate: v.reportDate,
    note: v.note,
    ignoreOrder: v.ignoreOrder,
    rowCount: v.rowCount,
    mismatchCount: v.mismatchCount,
    softwareTotal,
    onlineTotal,
    totalsMatch: Math.round(softwareTotal * 100) === Math.round(onlineTotal * 100),
    createdByName: v.createdByName,
    createdAt: v.createdAt,
  };
}

// Saved "Verify Online Transaction" reports, so yesterday's (or last month's)
// check can be opened again later. Every signed-in employee can verify and
// save their own -- cashiers do this for their own till -- and sees only the
// reports they saved themselves. Super Admin, Admin and supervisors see
// everyone's. Only Super Admin can delete one.
@Injectable()
export class VerificationsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly ctx: TenantContextService,
  ) {}

  private assertCanUse() {
    if (!this.ctx.tenantId || !this.ctx.role) {
      throw new ForbiddenException({ error: 'not_authorized', message: 'You do not have access to verified transactions.' });
    }
  }

  private seesEveryonesReports(): boolean {
    return myTeamScope(this.ctx.role ?? 'EMPLOYEE') !== 'none';
  }

  private async myMembershipId(tx: Prisma.TransactionClient): Promise<string | null> {
    const userId = this.ctx.userId;
    const tenantId = this.ctx.tenantId;
    if (!userId || !tenantId) return null;
    const m = await tx.tenantMembership.findUnique({ where: { tenantId_userId: { tenantId, userId } }, select: { id: true } });
    return m?.id ?? null;
  }

  private parseDate(value: string): Date {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      throw new BadRequestException({ error: 'invalid_date', message: 'Enter a valid date.' });
    }
    return date;
  }

  async save(dto: SaveVerificationDto) {
    this.assertCanUse();
    const reportDate = this.parseDate(dto.reportDate);
    const rows: VerifyRow[] = dto.rows.map((r) => ({ software: r.software ?? null, online: r.online ?? null }));
    const { softwareTotal, onlineTotal, badCount } = summarise(rows);

    const saved = await this.tenantPrisma.run(async (tx) => {
      const userId = this.ctx.userId;
      const tenantId = this.ctx.tenantId!;
      const me = userId
        ? await tx.tenantMembership.findUnique({ where: { tenantId_userId: { tenantId, userId } }, include: { user: { select: { fullName: true, email: true } } } })
        : null;
      return tx.onlineVerification.create({
        data: {
          tenantId,
          reportDate,
          note: dto.note || null,
          ignoreOrder: dto.ignoreOrder ?? false,
          rows: rows as unknown as Prisma.InputJsonValue,
          rowCount: rows.length,
          mismatchCount: badCount,
          softwareTotal,
          onlineTotal,
          createdByMembershipId: me?.id ?? null,
          createdByName: me ? me.user.fullName || me.user.email : null,
        },
      });
    });
    return summary(saved);
  }

  async list(from?: string, to?: string) {
    this.assertCanUse();
    const range: { gte?: Date; lte?: Date } = {};
    if (from) range.gte = this.parseDate(from);
    if (to) range.lte = this.parseDate(to);
    const found = await this.tenantPrisma.run(async (tx) => {
      const mine = this.seesEveryonesReports() ? null : await this.myMembershipId(tx);
      return tx.onlineVerification.findMany({
        where: {
          ...(from || to ? { reportDate: range } : {}),
          ...(this.seesEveryonesReports() ? {} : { createdByMembershipId: mine ?? '-' }),
        },
        orderBy: [{ reportDate: 'desc' }, { createdAt: 'desc' }],
        take: MAX_LISTED,
      });
    });
    return found.map(summary);
  }

  private async load(id: string) {
    const found = await this.tenantPrisma.run(async (tx) => {
      const row = await tx.onlineVerification.findUnique({ where: { id } });
      if (row && !this.seesEveryonesReports() && row.createdByMembershipId !== (await this.myMembershipId(tx))) return null;
      return row;
    });
    if (!found) throw new NotFoundException({ error: 'not_found', message: 'No such saved verification.' });
    return found;
  }

  async get(id: string) {
    this.assertCanUse();
    const found = await this.load(id);
    return { ...summary(found), rows: found.rows as unknown as VerifyRow[] };
  }

  async remove(id: string) {
    await this.load(id);
    await this.tenantPrisma.run((tx) => tx.onlineVerification.delete({ where: { id } }));
    return { ok: true };
  }

  async file(id: string, format: string): Promise<{ buffer: Buffer; contentType: string; fileName: string }> {
    this.assertCanUse();
    if (format !== 'xlsx' && format !== 'pdf') throw new BadRequestException({ error: 'bad_format', message: 'Choose xlsx or pdf.' });
    const found = await this.load(id);
    const rows = found.rows as unknown as VerifyRow[];
    const tenant = await this.tenantPrisma.run((tx) => tx.tenant.findUnique({ where: { id: found.tenantId } }));
    const name = tenant?.name ?? 'Puggey';
    const meta = { reportDate: found.reportDate.toISOString().slice(0, 10), note: found.note, preparedBy: found.createdByName };
    const base = `online-verification-${meta.reportDate}`;
    if (format === 'pdf') return { buffer: await verifyPdf(name, rows, meta), contentType: 'application/pdf', fileName: `${base}.pdf` };
    return {
      buffer: Buffer.from(await verifyWorkbook(name, rows, meta)),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileName: `${base}.xlsx`,
    };
  }
}
