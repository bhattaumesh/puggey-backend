import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import sharp from 'sharp';
import { Prisma, MembershipStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { TenantContextService } from '../common/tenant-context.service';
import { runInTenantContext } from '../prisma/rls.util';
import { myTeamScope } from '../permissions/permissions';
import { NotificationsService } from '../notifications/notifications.service';
import { planLimit, planLabel } from '../plans/plan-tiers';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';

const MAX_PHOTO_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_PHOTO_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

interface UploadedFileLike {
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const EMPLOYEE_INCLUDE = {
  user: { select: { id: true, email: true, fullName: true, phone: true } },
  department: true,
  supervisor: { include: { user: { select: { fullName: true, email: true } } } },
} satisfies Prisma.TenantMembershipInclude;

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly ctx: TenantContextService,
  ) {}

  // Recursive CTE: every membership that reports up to `rootId`, directly or
  // indirectly, never including the root itself. Runs inside the RLS-scoped
  // transaction, so it can never cross a tenant boundary no matter what id is
  // passed in -- the query would just return zero rows for a foreign id.
  private async getReportSubtreeIds(tx: Prisma.TransactionClient, rootId: string): Promise<string[]> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE subtree AS (
        SELECT id FROM tenant_memberships WHERE id = ${rootId}
        UNION ALL
        SELECT tm.id FROM tenant_memberships tm
        INNER JOIN subtree s ON tm."supervisorMembershipId" = s.id
      )
      SELECT id FROM subtree WHERE id != ${rootId}
    `;
    return rows.map((r) => r.id);
  }

  private async myMembershipId(tx: Prisma.TransactionClient): Promise<string | null> {
    const userId = this.ctx.userId;
    const tenantId = this.ctx.tenantId;
    if (!userId || !tenantId) return null;
    const membership = await tx.tenantMembership.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
      select: { id: true },
    });
    return membership?.id ?? null;
  }

  // Salary, date of birth, and identity numbers are redacted from every
  // roster/profile response by default, even for roles that can otherwise
  // see the whole org (ADMIN/Viewer is read-only oversight, not access to
  // sensitive personal data) -- only Super Admin and the employee themselves
  // (via me(), not this) ever see the real values here. Payroll's own
  // endpoints are the deliberate exception for salary, guarded separately.
  private redact<
    T extends {
      baseSalary: unknown;
      dateOfBirth: unknown;
      citizenshipNumber: unknown;
      panNumber: unknown;
      nidNumber: unknown;
      drivingLicenceNumber: unknown;
    },
  >(employee: T): T {
    return {
      ...employee,
      baseSalary: null,
      dateOfBirth: null,
      citizenshipNumber: null,
      panNumber: null,
      nidNumber: null,
      drivingLicenceNumber: null,
    };
  }

  // photoData/photoMimeType are the uploaded-photo bytes (see uploadPhoto) --
  // never sent over the wire as their own fields, only ever folded into
  // photoUrl as a data: URI here, the same "no S3, bytea in Postgres"
  // approach the Documents module already uses. A tenant that never uploads
  // a photo keeps whatever plain URL string they pasted into photoUrl.
  private withComputedPhotoUrl<T extends { photoUrl: string | null; photoData: Buffer | Uint8Array | null; photoMimeType: string | null }>(
    employee: T,
  ): Omit<T, 'photoData' | 'photoMimeType'> {
    const { photoData, photoMimeType, ...rest } = employee;
    if (photoData && photoMimeType) {
      const buf = Buffer.isBuffer(photoData) ? photoData : Buffer.from(photoData);
      return { ...rest, photoUrl: `data:${photoMimeType};base64,${buf.toString('base64')}` };
    }
    return rest;
  }

  async list() {
    const scope = myTeamScope(this.ctx.role ?? 'EMPLOYEE');
    if (scope === 'none') {
      throw new ForbiddenException({ error: 'not_authorized', message: 'You do not have access to the team list.' });
    }
    const canSeeSensitive = this.ctx.role === 'SUPER_ADMIN';

    const employees = await this.tenantPrisma.run(async (tx) => {
      if (scope === 'all') {
        return tx.tenantMembership.findMany({
          where: { status: MembershipStatus.active },
          include: EMPLOYEE_INCLUDE,
          orderBy: { joinedAt: 'asc' },
        });
      }

      // scope === 'subtree'
      const myId = await this.myMembershipId(tx);
      if (!myId) return [];
      const subtreeIds = await this.getReportSubtreeIds(tx, myId);
      return tx.tenantMembership.findMany({
        where: { id: { in: subtreeIds }, status: MembershipStatus.active },
        include: EMPLOYEE_INCLUDE,
        orderBy: { joinedAt: 'asc' },
      });
    });
    const withPhotos = employees.map((e) => this.withComputedPhotoUrl(e));
    return canSeeSensitive ? withPhotos : withPhotos.map((e) => this.redact(e));
  }

  async findOne(id: string) {
    const scope = myTeamScope(this.ctx.role ?? 'EMPLOYEE');

    const employee = await this.tenantPrisma.run(async (tx) => {
      const myId = await this.myMembershipId(tx);
      const isSelf = myId === id;

      if (scope === 'none' && !isSelf) {
        throw new ForbiddenException({ error: 'not_authorized', message: 'You do not have access to this profile.' });
      }
      if (scope === 'subtree' && !isSelf) {
        const subtreeIds = myId ? await this.getReportSubtreeIds(tx, myId) : [];
        if (!subtreeIds.includes(id)) {
          throw new ForbiddenException({ error: 'not_authorized', message: 'You do not have access to this profile.' });
        }
      }

      const found = await tx.tenantMembership.findUnique({ where: { id }, include: EMPLOYEE_INCLUDE });
      if (!found) throw new NotFoundException({ error: 'not_found', message: 'No such employee.' });
      return { employee: found, isSelf };
    });

    const withPhoto = this.withComputedPhotoUrl(employee.employee);
    const canSeeSensitive = this.ctx.role === 'SUPER_ADMIN' || employee.isSelf;
    return canSeeSensitive ? withPhoto : this.redact(withPhoto);
  }

  async me() {
    const found = await this.tenantPrisma.run(async (tx) => {
      const myId = await this.myMembershipId(tx);
      if (!myId) throw new NotFoundException({ error: 'not_found', message: 'No employee record for this account.' });
      return tx.tenantMembership.findUnique({ where: { id: myId }, include: EMPLOYEE_INCLUDE });
    });
    return found ? this.withComputedPhotoUrl(found) : found;
  }

  async update(id: string, dto: UpdateEmployeeDto) {
    const updated = await this.tenantPrisma.run(async (tx) => {
      const existing = await tx.tenantMembership.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException({ error: 'not_found', message: 'No such employee.' });

      if (dto.supervisorMembershipId === id) {
        throw new ConflictException({ error: 'circular_report', message: 'An employee cannot report to themselves.' });
      }

      if (dto.fullName) {
        await tx.user.update({ where: { id: existing.userId }, data: { fullName: dto.fullName, phone: dto.phone } });
      } else if (dto.phone !== undefined) {
        await tx.user.update({ where: { id: existing.userId }, data: { phone: dto.phone } });
      }

      return tx.tenantMembership.update({
        where: { id },
        data: {
          designation: dto.designation,
          employeeCode: dto.employeeCode,
          photoUrl: dto.photoUrl,
          departmentId: dto.departmentId,
          supervisorMembershipId: dto.supervisorMembershipId,
          baseSalary: dto.baseSalary,
          dateOfBirth: dto.dateOfBirth === undefined ? undefined : new Date(dto.dateOfBirth),
          fatherName: dto.fatherName,
          motherName: dto.motherName,
          grandfatherName: dto.grandfatherName,
          education: dto.education,
          pastExperience: dto.pastExperience,
          currentAddress: dto.currentAddress,
          permanentAddress: dto.permanentAddress,
          mobileNumber: dto.mobileNumber,
          emergencyContactNumber: dto.emergencyContactNumber,
          citizenshipNumber: dto.citizenshipNumber,
          panNumber: dto.panNumber,
          nidNumber: dto.nidNumber,
          drivingLicenceNumber: dto.drivingLicenceNumber,
        },
        include: EMPLOYEE_INCLUDE,
      });
    });
    return this.withComputedPhotoUrl(updated);
  }

  // Soft-delete: sets status to disabled and stamps leftAt, never a hard
  // DELETE. Attendance, leave, payslip, and advance history all reference
  // this membership by id, and off-boarded staff still need their past
  // records intact (payroll history, audit trail) -- disabled memberships
  // simply stop appearing in list() (already filtered to status: active)
  // and lose their ability to sign in going forward.
  async remove(id: string) {
    const removed = await this.tenantPrisma.run(async (tx) => {
      const existing = await tx.tenantMembership.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException({ error: 'not_found', message: 'No such employee.' });

      const myId = await this.myMembershipId(tx);
      if (myId === id) {
        throw new BadRequestException({ error: 'cannot_remove_self', message: 'You cannot remove your own account.' });
      }

      return tx.tenantMembership.update({
        where: { id },
        data: { status: MembershipStatus.disabled, leftAt: new Date() },
        include: EMPLOYEE_INCLUDE,
      });
    });
    return this.withComputedPhotoUrl(removed);
  }

  // Creating an employee means creating a brand-new `users` row when the email
  // is new -- that row belongs to no tenant yet, so the normal tenant-scoped RLS
  // context (which only ever proves "I am this tenant") has no way to authorize
  // it; even a real member of the tenant can't satisfy that row's own check
  // before it exists. This runs under the platform-bypass context for that
  // reason alone, not because the caller is platform staff -- every value
  // written still comes from `this.ctx.tenantId`, the caller's own tenant from
  // their JWT, and every lookup below re-applies that same filter explicitly
  // since RLS itself won't be doing it in this context.
  async create(dto: CreateEmployeeDto) {
    const tenantId = this.ctx.tenantId!;
    const created = await runInTenantContext(this.prisma, { isPugeyStaff: true }, async (tx) => {
      const tenantForLimit = await tx.tenant.findUnique({ where: { id: tenantId } });
      const limit = planLimit(tenantForLimit?.plan ?? 'trial');
      if (limit !== null) {
        const activeCount = await tx.tenantMembership.count({ where: { tenantId, status: MembershipStatus.active } });
        if (activeCount >= limit) {
          throw new BadRequestException({
            error: 'plan_limit_reached',
            message: `The ${planLabel(tenantForLimit?.plan ?? 'trial')} plan allows up to ${limit} employees. Ask your Puggey contact about upgrading.`,
          });
        }
      }

      if (dto.supervisorMembershipId) {
        const supervisor = await tx.tenantMembership.findUnique({ where: { id: dto.supervisorMembershipId } });
        if (!supervisor || supervisor.tenantId !== tenantId) {
          throw new NotFoundException({ error: 'not_found', message: 'Supervisor not found.' });
        }
      }

      let user = await tx.user.findUnique({ where: { email: dto.email } });
      if (user) {
        const existingMembership = await tx.tenantMembership.findUnique({ where: { tenantId_userId: { tenantId, userId: user.id } } });
        if (existingMembership) {
          throw new ConflictException({ error: 'already_member', message: 'This email already belongs to someone in your company.' });
        }
      } else {
        const passwordHash = await bcrypt.hash(dto.temporaryPassword, 10);
        user = await tx.user.create({ data: { email: dto.email, passwordHash, fullName: dto.fullName } });
      }

      const created = await tx.tenantMembership.create({
        data: {
          tenantId,
          userId: user.id,
          role: dto.role,
          designation: dto.designation,
          departmentId: dto.departmentId,
          supervisorMembershipId: dto.supervisorMembershipId,
        },
        include: EMPLOYEE_INCLUDE,
      });

      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      await NotificationsService.create(tx, {
        tenantId,
        userId: user.id,
        type: 'welcome',
        message: `You were added to ${tenant?.name ?? 'your company'} on Puggey.`,
      });

      const admins = await tx.tenantMembership.findMany({
        where: { tenantId, role: 'SUPER_ADMIN', status: MembershipStatus.active, userId: { not: user.id } },
      });
      const displayName = dto.fullName || dto.email;
      await Promise.all(
        admins.map((admin) =>
          NotificationsService.create(tx, {
            tenantId,
            userId: admin.userId,
            type: 'employee_added',
            message: `${displayName} joined the team as ${dto.role === 'SUPER_ADMIN' ? 'Admin' : dto.role === 'ADMIN' ? 'Viewer' : dto.role === 'SUPERVISOR' ? 'Supervisor' : 'Employee'}.`,
          }),
        ),
      );

      return created;
    });
    return this.withComputedPhotoUrl(created);
  }

  // Resized down and EXIF-stripped through sharp (same de-identification the
  // Documents module applies) before being stored -- a profile photo shown
  // at avatar size has no reason to carry a full-resolution original or its
  // metadata. Overwrites whatever was there before; there is no history to
  // keep for an avatar the way there is for a legal document.
  async uploadPhoto(id: string, file: UploadedFileLike) {
    if (!ALLOWED_PHOTO_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException({ error: 'unsupported_file_type', message: 'Only JPG, PNG, WebP, or HEIC images are accepted.' });
    }
    if (file.size > MAX_PHOTO_SIZE_BYTES) {
      throw new BadRequestException({ error: 'file_too_large', message: 'Photos must be 5 MB or smaller.' });
    }

    // sharp throws on malformed image data (a truncated upload, a renamed
    // non-image file that slipped past the MIME check) -- a system boundary
    // like this must reject cleanly with a 400, not surface as a 500.
    let resized: Buffer;
    try {
      resized = await sharp(file.buffer).resize(320, 320, { fit: 'cover' }).jpeg({ quality: 82 }).toBuffer();
    } catch {
      throw new BadRequestException({ error: 'invalid_image', message: 'That file could not be read as an image.' });
    }

    const updated = await this.tenantPrisma.run(async (tx) => {
      const existing = await tx.tenantMembership.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException({ error: 'not_found', message: 'No such employee.' });

      return tx.tenantMembership.update({
        where: { id },
        data: { photoData: resized as unknown as Uint8Array<ArrayBuffer>, photoMimeType: 'image/jpeg' },
        include: EMPLOYEE_INCLUDE,
      });
    });

    return this.withComputedPhotoUrl(updated);
  }

  listDepartments() {
    return this.tenantPrisma.run((tx) => tx.department.findMany({ orderBy: { name: 'asc' } }));
  }

  async createDepartment(dto: CreateDepartmentDto) {
    return this.tenantPrisma.run(async (tx) => {
      const existing = await tx.department.findFirst({ where: { name: dto.name } });
      if (existing) throw new ConflictException({ error: 'department_exists', message: 'That department already exists.' });
      return tx.department.create({ data: { tenantId: this.ctx.tenantId!, name: dto.name } });
    });
  }

  // Renaming updates the label everywhere it's referenced automatically --
  // TenantMembership stores departmentId, not a copy of the name.
  async updateDepartment(id: string, dto: UpdateDepartmentDto) {
    return this.tenantPrisma.run(async (tx) => {
      const existing = await tx.department.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException({ error: 'not_found', message: 'No such department.' });
      const nameTaken = await tx.department.findFirst({ where: { name: dto.name, id: { not: id } } });
      if (nameTaken) throw new ConflictException({ error: 'department_exists', message: 'That department already exists.' });
      return tx.department.update({ where: { id }, data: { name: dto.name } });
    });
  }

  departmentUsageCount(id: string) {
    return this.tenantPrisma.run((tx) => tx.tenantMembership.count({ where: { departmentId: id } }));
  }

  // Unlike advance categories, nothing needs to keep resolving a deleted
  // department's name after the fact -- there's no historical record tied
  // to it the way an Advance is tied to its category -- so this is a real
  // delete, not a soft one. Any employee in it just loses that label.
  async deleteDepartment(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const existing = await tx.department.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException({ error: 'not_found', message: 'No such department.' });
      await tx.tenantMembership.updateMany({ where: { departmentId: id }, data: { departmentId: null } });
      await tx.department.delete({ where: { id } });
      return { deleted: true };
    });
  }
}
