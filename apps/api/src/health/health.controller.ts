import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import type { HealthStatus, ReadinessStatus } from '@sph/types';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  // Liveness: "is this process responsive at all." Deliberately has no
  // external dependency — a transient DB/Redis blip must never cause an
  // orchestrator to kill and restart a process that a restart wouldn't fix.
  @Get()
  check(): HealthStatus {
    return this.healthService.getStatus();
  }

  // Readiness: "can this instance actually serve traffic right now."
  // Returns 503 when degraded so an orchestrator's readiness probe (which
  // checks the status code, not the body) correctly stops routing traffic
  // to this instance until the dependency recovers.
  @Get('ready')
  async ready(): Promise<ReadinessStatus> {
    const readiness = await this.healthService.getReadiness();
    if (readiness.status === 'degraded') {
      throw new ServiceUnavailableException(readiness);
    }
    return readiness;
  }
}
