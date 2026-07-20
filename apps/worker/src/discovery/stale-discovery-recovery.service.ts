import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { recoverStaleDiscoveries } from '@sph/database';

// Mirrors StaleScanRecoveryService's STALE_SCAN_THRESHOLD_MS rationale —
// shorter here (discovery lists sites, not documents; ADR-0014 §1's own
// reasoning is that site counts are far smaller than document counts, so
// a genuinely-in-progress discovery finishing in under 30 minutes is the
// expected case even for a large enterprise tenant), while still bounded
// enough to provide real recovery within a single operating day.
const STALE_DISCOVERY_THRESHOLD_MS = 30 * 60 * 1000;

/**
 * Recovers a MicrosoftTenant left stuck at discoveryStatus: 'Running' by an
 * unclean worker shutdown — SiteDiscoveryProcessor has no way to mark its
 * own job Failed after the process running it no longer exists. Runs once
 * per worker boot, matching StaleScanRecoveryService's exact shape
 * (startup-time reconciliation is production-safe here for the same reason:
 * Azure Container Apps restarts a crashed container, and a boot is exactly
 * the moment recovery is needed most).
 */
@Injectable()
export class StaleDiscoveryRecoveryService implements OnModuleInit {
  private readonly logger = new Logger(StaleDiscoveryRecoveryService.name);

  async onModuleInit(): Promise<void> {
    const recoveredCount = await recoverStaleDiscoveries(new Date(), STALE_DISCOVERY_THRESHOLD_MS);
    if (recoveredCount > 0) {
      this.logger.warn(
        `Recovered ${recoveredCount} stale MicrosoftTenant discovery job(s) stuck Running past ${STALE_DISCOVERY_THRESHOLD_MS / 60_000} minutes — marked Failed.`,
      );
    } else {
      this.logger.log('No stale discovery jobs found at startup.');
    }
  }
}
