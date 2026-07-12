import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { OrganizationAccessGuard } from '../common/organization-access.guard';

@Module({
  imports: [AuthModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, OrganizationAccessGuard],
})
export class DocumentsModule {}
