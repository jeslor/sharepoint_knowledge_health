import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrganizationAccessGuard } from '../common/organization-access.guard';
import { OwnershipController } from './ownership.controller';
import { OwnershipCoverageService } from './ownership.service';

@Module({
  imports: [AuthModule],
  controllers: [OwnershipController],
  providers: [OwnershipCoverageService, OrganizationAccessGuard],
})
export class OwnershipModule {}
