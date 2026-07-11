import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  // createApplicationContext never allocates an HTTP adapter — this is what
  // structurally enforces "worker never exposes a public HTTP endpoint"
  // (ADR-0009) in code, not just via Container Apps ingress configuration.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const logger = new Logger('Worker');
  logger.log('Worker application context started — no HTTP server, BullMQ-driven only.');

  const shutdown = async (signal: string): Promise<void> => {
    logger.log(`Received ${signal}, shutting down worker...`);
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void bootstrap();
