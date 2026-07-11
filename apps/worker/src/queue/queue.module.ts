import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

// Queue name only, registered by name — no @Processor() classes yet.
// Real scan job handling is implemented in a later phase, once the
// ScanJob domain model (ADR-0007) exists; a stub processor now would
// be dead code implying behavior that doesn't exist.
export const SCAN_QUEUE = 'scan-queue';

@Module({
  imports: [
    BullModule.registerQueue({
      name: SCAN_QUEUE,
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
