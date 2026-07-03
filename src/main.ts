import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { join } from 'path';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const isDev = process.env.NODE_ENV !== 'production';

  // ── Sentry: must init before NestFactory.create ──────────────────
  const sentryDsn = process.env.SENTRY_DSN;
  if (sentryDsn) {
    Sentry.init({
      dsn: sentryDsn,
      environment: process.env.NODE_ENV ?? 'development',
      integrations: [nodeProfilingIntegration()],
      tracesSampleRate: isDev ? 1.0 : 0.1,
      profilesSampleRate: isDev ? 1.0 : 0.05,
    });
    console.log('[Sentry] Initialized');
  }

  const logger = WinstonModule.createLogger({
    transports: [
      new winston.transports.Console({
        format: isDev
          ? winston.format.combine(
              winston.format.timestamp({ format: 'HH:mm:ss' }),
              winston.format.colorize(),
              winston.format.printf(({ level, message, context, timestamp }) =>
                `${timestamp} [${context ?? 'App'}] ${level}: ${message}`
              )
            )
          : winston.format.combine(
              winston.format.timestamp(),
              winston.format.json()
            )
      }),
      ...(isDev
        ? []
        : [
            new winston.transports.File({
              filename: 'logs/error.log',
              level: 'error',
              format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json()
              )
            }),
            new winston.transports.File({
              filename: 'logs/combined.log',
              format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json()
              )
            })
          ])
    ]
  });

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger });
  app.enableShutdownHooks();
  const configService = app.get(ConfigService);

  // ── Static uploads (admin broadcast images) ──────────────────────
  // Served at /uploads/** so the admin UI can preview them and Telegram can be
  // handed a local file to upload. Persisted on disk (cPanel provides one).
  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads/',
    // The admin panel is a separate origin, so relax Helmet's default
    // same-origin CORP for these images (they're public promo assets).
    setHeaders: (res) => res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'),
  });

  // ── Security: Helmet HTTP headers ────────────────────────────────
  app.use(helmet({
    crossOriginEmbedderPolicy: false, // allow Socket.IO iframe scenarios
  }));

  // ── CORS ──────────────────────────────────────────────────────────
  const allowedOrigin = configService.get<string>('ALLOWED_ORIGIN', '');
  if (!isDev && !allowedOrigin) {
    throw new Error('ALLOWED_ORIGIN env var is required in production');
  }
  app.enableCors({
    origin: isDev ? true : allowedOrigin,
    credentials: true,
  });

  // ── Global pipes / filters / guards ──────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true
    })
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  // ── WebSockets ────────────────────────────────────────────────────
  app.useWebSocketAdapter(new IoAdapter(app));

  // ── Swagger (dev only) ────────────────────────────────────────────
  if (isDev) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('iGames API')
      .setDescription('Backend API for Keno and 90-ball Bingo.')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document);
  }

  const port = configService.getOrThrow<number>('PORT');
  await app.listen(port);
  logger.log(`🚀 iGames API running on http://localhost:${port}`, 'Bootstrap');
  if (isDev) {
    logger.log(`📚 Swagger docs at http://localhost:${port}/docs`, 'Bootstrap');
  }
  logger.log(`❤️  Health check at http://localhost:${port}/health`, 'Bootstrap');
}

void bootstrap();
