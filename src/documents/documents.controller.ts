import { Controller, Get, Param, Post, Res, UploadedFile, UseGuards, UseInterceptors, Query, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { DocumentsService } from './documents.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

const MAX_SIZE_BYTES = 5 * 1024 * 1024;

@Controller('documents')
@UseGuards(JwtAuthGuard)
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post(':membershipId/:type')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_SIZE_BYTES } }))
  upload(
    @Param('membershipId') membershipId: string,
    @Param('type') type: string,
    @UploadedFile() file: { originalname: string; mimetype: string; size: number; buffer: Buffer } | undefined,
  ) {
    if (!file) throw new BadRequestException({ error: 'file_required', message: 'Choose a file to upload.' });
    return this.documents.upload(membershipId, type, file);
  }

  @Get(':membershipId/:type')
  getMeta(@Param('membershipId') membershipId: string, @Param('type') type: string) {
    return this.documents.getMeta(membershipId, type);
  }

  @Get(':membershipId/:type/token')
  issueToken(@Param('membershipId') membershipId: string, @Param('type') type: string) {
    return this.documents.issueDownloadToken(membershipId, type);
  }
}

// Separate, guard-free controller: the signed token in the query string is
// the authorization here, not a session header -- this is the URL a plain
// <a href> or <img src> opens, so it can't carry an Authorization header.
@Controller('documents-download')
export class DocumentsDownloadController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  async download(@Query('token') token: string | undefined, @Res() res: Response) {
    if (!token) throw new BadRequestException({ error: 'token_required', message: 'Missing download token.' });
    const doc = await this.documents.resolveDownload(token);
    res.set({
      'Content-Type': doc.mimeType,
      'Content-Disposition': `inline; filename="${doc.fileName.replace(/"/g, '')}"`,
      'Cache-Control': 'private, max-age=60',
    });
    res.send(doc.data);
  }
}
