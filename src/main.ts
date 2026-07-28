import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';

// Browser-facing origins only -- CORS is a browser-enforced mechanism, so it
// has no bearing on server-to-server calls (the external API-key
// integrations in ExternalController), only on which web pages' own JS may
// call this API directly.
const ALLOWED_ORIGINS = [
  'https://pugey-web-production.up.railway.app',
  'http://localhost:5173',
];

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(helmet());
  app.enableCors({ origin: ALLOWED_ORIGINS });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
