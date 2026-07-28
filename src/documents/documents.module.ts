import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { DocumentsController, DocumentsDownloadController } from './documents.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [DocumentsService],
  controllers: [DocumentsController, DocumentsDownloadController],
})
export class DocumentsModule {}
