import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SharePointMetadataController } from './sharepoint-metadata.controller';
import { SharePointMetadataService } from './sharepoint-metadata.service';
import { OrganizationAccessGuard } from '../common/organization-access.guard';

@Module({
  imports: [AuthModule],
  controllers: [SharePointMetadataController],
  providers: [SharePointMetadataService, OrganizationAccessGuard],
})
export class SharePointMetadataModule {}
