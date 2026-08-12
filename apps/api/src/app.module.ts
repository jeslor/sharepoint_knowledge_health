import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
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
import { UsersModule } from './users/users.module';
import { OnboardingStatusModule } from './onboarding-status/onboarding-status.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SharePointMetadataModule } from './sharepoint-metadata/sharepoint-metadata.module';
import { requestLoggerMiddleware } from './common/request-logger.middleware';

/**
 * Phase 7 (LAT F2): explicit, bounded connection options — the prior bare
 * `{ url }` config ran on ioredis's defaults (maxRetriesPerRequest: 20,
 * connectTimeout: 10000ms), which let a single queue.add() call during a
 * Redis outage feel indefinite to a caller. Safe to bound tightly here
 * specifically because this connection is producer-only (apps/api never
 * runs a BullMQ Worker) — a Worker connection has a documented BullMQ
 * requirement of maxRetriesPerRequest: null, which is why apps/worker's
 * identical bare config is deliberately NOT touched here (see
 * docs/testing/local-acceptance-testing-report.md, F2). Exported as a
 * standalone function so its shape is unit-testable without booting the
 * module or touching a real Redis connection.
 *
 * Phase 7 correction #2: a first attempt at fixing health.service.ts's
 * hang added an explicit `retryStrategy` that gave up (returned null) after
 * 2 retries. That fixed the hang, but manual verification found a real
 * regression: returning null from retryStrategy doesn't just fail the
 * current attempt fast — it tells ioredis to stop attempting automatic
 * reconnection *permanently*. Once Redis came back, the connection stayed
 * dead until apps/api was restarted (confirmed live: /health/ready kept
 * reporting redis: 'error' with Redis genuinely running again). Reverted —
 * retryStrategy is left at ioredis's own default (infinite retry, capped
 * backoff), so the connection keeps trying in the background and
 * self-heals on its own once Redis returns. maxRetriesPerRequest/
 * connectTimeout alone already correctly bound queue.add() (confirmed:
 * 500 in 45ms during the outage test) — the health-check hang needed a
 * different, narrower fix instead (see health.service.ts).
 */
export function bullConnectionOptions(): {
  url: string | undefined;
  maxRetriesPerRequest: number;
  connectTimeout: number;
} {
  return {
    url: process.env.REDIS_URL,
    maxRetriesPerRequest: 1,
    connectTimeout: 5000,
  };
}

@Module({
  imports: [
    // Root .env is used for local dev only (cwd = apps/api when running
    // `nest start`). In Docker/CI there is no .env file, so this silently
    // falls through to process.env, which is where those environments
    // inject config instead.
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '../../.env' }),
    BullModule.forRootAsync({
      useFactory: () => ({ connection: bullConnectionOptions() }),
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
    UsersModule,
    OnboardingStatusModule,
    AuditLogModule,
    NotificationsModule,
    SharePointMetadataModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Phase 9: applied ahead of every route, including /health — a request
    // ID and a logged line are wanted for liveness/readiness probe traffic
    // too, not just authenticated routes.
    consumer.apply(requestLoggerMiddleware).forRoutes('*');
  }
}
