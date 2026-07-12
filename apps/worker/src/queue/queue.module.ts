import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SCAN_QUEUE } from '@sph/types';
import { DocumentCollectorProcessor } from './document-collector.processor';

@Module({
  imports: [
    BullModule.registerQueue({
      name: SCAN_QUEUE,
    }),
  ],
  providers: [DocumentCollectorProcessor],
  exports: [BullModule],
})
export class QueueModule {}
