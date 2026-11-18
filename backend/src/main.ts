import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { setupSwagger } from '@config/swagger.config';
import { AppModule } from './app.module';

export function configureApp(app: INestApplication): void {
  const configService = app.get(ConfigService);

  app.useLogger(app.get(Logger));
  app.use(helmet());

  const allowedOriginsRaw =
    configService.get<string>('CORS_ORIGINS') ??
    configService.get<string>('CORS_ALLOWED_ORIGINS') ??
    'http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,https://sokokuu.tz';
  const allowedOrigins = allowedOriginsRaw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-NextSMS-Gateway-Token',
      'X-Idempotency-Key',
      'X-Merchant-Profile-Id',
    ],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: false,
      },
    }),
  );

  app.enableShutdownHooks();
  setupSwagger(app);
}

async function bootstrap(): Promise<void> {
  process.env.TZ = process.env.TZ ?? 'Africa/Dar_es_Salaam';

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  configureApp(app);

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT') ?? 3001;
  await app.listen(port);
}

if (require.main === module) {
  void bootstrap();
}
