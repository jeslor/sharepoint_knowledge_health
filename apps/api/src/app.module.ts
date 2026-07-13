import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { SharePointSitesModule } from './sharepoint-sites/sharepoint-sites.module';
import { DocumentsModule } from './documents/documents.module';
import { ScansModule } from './scans/scans.module';
import { HealthSummaryModule } from './health-summary/health-summary.module';
import { ScanScheduleModule } from './scan-schedule/scan-schedule.module';
import { HealthTrendsModule } from './health-trends/health-trends.module';
import { GovernanceIssuesModule } from './governance/governance-issues.module';

@Module({
  imports: [
    // Root .env is used for local dev only (cwd = apps/api when running
    // `nest start`). In Docker/CI there is no .env file, so this silently
    // falls through to process.env, which is where those environments
    // inject config instead.
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '../../.env' }),
    BullModule.forRootAsync({
      useFactory: () => ({
        connection: {
          url: process.env.REDIS_URL,
        },
      }),
    }),
    HealthModule,
    AuthModule,
    SharePointSitesModule,
    DocumentsModule,
    ScansModule,
    HealthSummaryModule,
    ScanScheduleModule,
    HealthTrendsModule,
    GovernanceIssuesModule,
  ],
})
export class AppModule {}
