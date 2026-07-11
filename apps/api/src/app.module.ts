import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    // Root .env is used for local dev only (cwd = apps/api when running
    // `nest start`). In Docker/CI there is no .env file, so this silently
    // falls through to process.env, which is where those environments
    // inject config instead.
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '../../.env' }),
    HealthModule,
    AuthModule,
  ],
})
export class AppModule {}
