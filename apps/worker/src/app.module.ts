import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { QueueModule } from './queue/queue.module';
import { SchedulerModule } from './scheduler/scheduler.module';

@Module({
  imports: [
    // Root .env is used for local dev only (cwd = apps/worker when running
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
    QueueModule,
    SchedulerModule,
  ],
})
export class AppModule {}
