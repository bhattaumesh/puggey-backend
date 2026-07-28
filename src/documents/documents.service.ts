import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import sharp from 'sharp';
import { DocumentType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { TenantContextService } from '../common/tenant-context.service';
import { runInTenantContext } from '../prisma/rls.util';

// 5 MB, enforced here (not just the client) -- see the spec's file-constraint rule.
const MAX_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const STRIPPABLE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly ctx: TenantContextService,
    private readonly jwt: JwtService,
  ) {}

  private async myMembershipId(tx: { tenantMembership: { findUnique: (args: unknown) => Promise<{ id: string } | null> } }): Promise<string | null> {
    const userId = this.ctx.userId;
    const tenantId = this.ctx.tenantId;
    if (!userId || !tenantId) return null;
    const membership = await tx.tenantMembership.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
      select: { id: true },
    });
    return membership?.id ?? null;
  }

  private assertDocumentType(type: string): DocumentType {
    if (type !== 'CITIZENSHIP' && type !== 'NID' && type !== 'DRIVING_LICENCE') {
      throw new BadRequestException({ error: 'invalid_document_type', message: 'Unknown document type.' });
    }
    return type;
  }

  // Images are re-encoded through sharp without carrying metadata forward --
  // sharp only writes EXIF/ICC/GPS chunks back out when .withMetadata() is
  // called, so simply not calling it strips them. PDFs pass through
  // untouched; EXIF is an image-format concept, not a PDF one.
  private async stripMetadataIfImage(file: UploadedFileLike): Promise<Buffer> {
    if (!STRIPPABLE_IMAGE_TYPES.has(file.mimetype)) return file.buffer;
    return sharp(file.buffer).toBuffer();
  }

  async upload(membershipId: string, typeRaw: string, file: UploadedFileLike) {
    const type = this.assertDocumentType(typeRaw);

    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException({ error: 'unsupported_file_type', message: 'Only PDF, JPG, PNG, WebP, or HEIC files are accepted.' });
    }
    if (file.size > MAX_SIZE_BYTES) {
      throw new BadRequestException({ error: 'file_too_large', message: 'Files must be 5 MB or smaller.' });
    }

    const data = await this.stripMetadataIfImage(file);

    return this.tenantPrisma.run(async (tx) => {
      const member = await tx.tenantMembership.findUnique({ where: { id: membershipId } });
      if (!member) throw new NotFoundException({ error: 'not_found', message: 'No such employee.' });

      const uploadedByMembershipId = await this.myMembershipId(tx);
      if (!uploadedByMembershipId) throw new ForbiddenException({ error: 'not_authorized', message: 'No employee record for this account.' });

      // Replacing keeps history: soft-delete whatever was previously active
      // for this slot, then insert the new row. At most one row per
      // (membershipId, type) has deletedAt = null; enforced here, not by a
      // DB constraint.
      await tx.document.updateMany({
        where: { membershipId, type, deletedAt: null },
        data: { deletedAt: new Date() },
      });

      const created = await tx.document.create({
        data: {
          tenantId: this.ctx.tenantId!,
          membershipId,
          type,
          fileName: file.originalname,
          mimeType: file.mimetype,
          sizeBytes: data.length,
          data: data as unknown as Uint8Array<ArrayBuffer>,
          uploadedByMembershipId,
        },
        select: { id: true, type: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true },
      });

      await tx.auditLog.create({
        data: {
          tenantId: this.ctx.tenantId!,
          actorUserId: this.ctx.userId,
          action: 'document_upload',
          entityType: 'document',
          entityId: created.id,
          targetUserId: member.userId,
          reason: `Uploaded ${type}`,
        },
      });

      return created;
    });
  }

  // Sensitive: same visibility rule as identity numbers -- Super Admin, or
  // the document's own owner, everyone else gets nothing back.
  private async assertCanAccess(tx: { tenantMembership: { findUnique: (args: unknown) => Promise<{ id: string } | null> } }, membershipId: string) {
    if (this.ctx.role === 'SUPER_ADMIN') return;
    const myId = await this.myMembershipId(tx);
    if (myId !== membershipId) {
      throw new ForbiddenException({ error: 'not_authorized', message: 'You do not have access to this document.' });
    }
  }

  async getMeta(membershipId: string, typeRaw: string) {
    const type = this.assertDocumentType(typeRaw);
    return this.tenantPrisma.run(async (tx) => {
      await this.assertCanAccess(tx, membershipId);
      const doc = await tx.document.findFirst({
        where: { membershipId, type, deletedAt: null },
        select: { id: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true },
      });
      return doc;
    });
  }

  // Issues a short-lived, narrowly-scoped signed token for exactly one
  // document -- the frontend equivalent of an S3 presigned URL, without
  // standing up external object storage. The token itself is the access
  // control at download time (see DownloadService.resolve): it is signed
  // with the same secret as ordinary session tokens, expires in 5 minutes,
  // and names one document id, so there is nothing further to authorize.
  async issueDownloadToken(membershipId: string, typeRaw: string) {
    const type = this.assertDocumentType(typeRaw);
    const documentId = await this.tenantPrisma.run(async (tx) => {
      await this.assertCanAccess(tx, membershipId);
      const doc = await tx.document.findFirst({ where: { membershipId, type, deletedAt: null }, select: { id: true } });
      if (!doc) throw new NotFoundException({ error: 'not_found', message: 'No document uploaded for this slot yet.' });
      return doc.id;
    });

    const token = this.jwt.sign({ sub: 'document_download', documentId }, { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '5m' });
    return { token };
  }

  async resolveDownload(token: string) {
    let payload: { sub: string; documentId: string };
    try {
      payload = this.jwt.verify(token, { secret: process.env.JWT_ACCESS_SECRET });
    } catch {
      throw new ForbiddenException({ error: 'invalid_token', message: 'This download link has expired.' });
    }
    if (payload.sub !== 'document_download') {
      throw new ForbiddenException({ error: 'invalid_token', message: 'This download link has expired.' });
    }

    // The signed token is itself the authorization for this one document --
    // there is no session at this call to re-derive a tenant from, so this
    // runs under the platform-bypass context purely to fetch the row the
    // token already names, the same reasoning ApiKeyGuard uses for its own
    // pre-tenant-context lookup.
    const doc = await runInTenantContext(this.prisma, { isPugeyStaff: true }, (tx) =>
      tx.document.findUnique({ where: { id: payload.documentId } }),
    );
    if (!doc || doc.deletedAt) throw new NotFoundException({ error: 'not_found', message: 'Document not found.' });
    return doc;
  }
}
