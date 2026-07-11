import { Injectable } from '@nestjs/common';
import type { HealthStatus } from '@sph/types';

@Injectable()
export class HealthService {
  getStatus(): HealthStatus {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
