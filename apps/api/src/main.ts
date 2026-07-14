import 'reflect-metadata';
import { validateEnvOrExit } from '@sph/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// Phase 9: previously enableCors() with no options, which reflects back
// whatever Origin a request sends — effectively allow-all. Since every
// route here is bearer-token authenticated (never cookies), CORS isn't a
// CSRF boundary the way it would be for a session-cookie API, but it's
// still the only thing standing between "a script on an arbitrary website
// that somehow obtained a token" and being able to read this API's
// responses back in-browser. Restricted to the actual configured
// frontend origin(s); comma-separated to support e.g. a staging + prod
// frontend against the same API. Defaults to the frontend's own default
// local dev port so `pnpm dev` keeps working with zero configuration.
function corsOrigins(): string[] {
  const configured = process.env.WEB_APP_ORIGIN;
  if (!configured) return ['http://localhost:3000'];
  return configured.split(',').map((origin) => origin.trim());
}

async function bootstrap(): Promise<void> {
  // Phase 9: fail fast with a clear message if required config is
  // missing/invalid, rather than failing later and cryptically the first
  // time a request touches Prisma or the Entra JWT guard.
  validateEnvOrExit();

  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: corsOrigins() });
  const port = process.env.API_PORT ?? 3001;
  await app.listen(port);
}

void bootstrap();
