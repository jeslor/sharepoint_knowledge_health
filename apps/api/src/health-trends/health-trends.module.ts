import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrganizationAccessGuard } from '../common/organization-access.guard';
import { HealthTrendsController } from './health-trends.controller';
import { HealthTrendsService } from './health-trends.service';

@Module({
  imports: [AuthModule],
  controllers: [HealthTrendsController],
  providers: [HealthTrendsService, OrganizationAccessGuard],
})
export class HealthTrendsModule {}
