import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { recoverStaleScanJobs } from '@sph/database';

// 2 hours: generous enough that even a large-tenant scan (thousands of
// documents across many sites — see docs/testing/local-acceptance-testing.md
// §3.4) should comfortably finish well inside it under normal conditions,
// but bounded enough to provide real recovery within a single operating day
// rather than leaving an operator to fix it by hand indefinitely.
const STALE_SCAN_THRESHOLD_MS = 2 * 60 * 60 * 1000;

/**
 * Phase 9.5: recovers a ScanJob left stuck at 'Running' by an unclean
 * worker shutdown (docs/testing/local-acceptance-testing.md §1.4/5.19.1) —
 * DocumentCollectorProcessor has no way to mark its own job Failed after
 * the process that was running it no longer exists. Runs once per worker
 * boot, matching SchedulerBootstrapService's OnModuleInit shape.
 *
 * Startup-time reconciliation (rather than a periodic in-process sweep) is
 * the simplest solution that's still production-safe: Azure Container Apps
 * (ADR-0006) automatically restarts a crashed container, so a boot is
 * exactly the moment recovery is needed most, and the 2-hour threshold
 * protects a *different* worker replica's still-genuinely-in-progress scan
 * from ever being marked stale by this replica's own restart (multiple
 * replicas share one Postgres, not one worker process's lifetime).
 */
@Injectable()
export class StaleScanRecoveryService implements OnModuleInit {
  private readonly logger = new Logger(StaleScanRecoveryService.name);

  async onModuleInit(): Promise<void> {
    const recoveredCount = await recoverStaleScanJobs(new Date(), STALE_SCAN_THRESHOLD_MS);
    if (recoveredCount > 0) {
      this.logger.warn(
        `Recovered ${recoveredCount} stale ScanJob(s) stuck Running past ${STALE_SCAN_THRESHOLD_MS / 60_000} minutes — marked Failed.`,
      );
    } else {
      this.logger.log('No stale ScanJobs found at startup.');
    }
  }
}
