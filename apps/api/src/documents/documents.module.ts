import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GovernanceActivityModule } from '../governance/governance-activity.module';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { OrganizationAccessGuard } from '../common/organization-access.guard';

@Module({
  imports: [AuthModule, GovernanceActivityModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, OrganizationAccessGuard],
})
export class DocumentsModule {}
