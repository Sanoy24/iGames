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
import { DataSource } from 'typeorm';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { runSchemaSync } from './scripts/ensure-schema';

// Run the whole process in UTC so server-side Date handling is timezone-independent
// (all user-facing times are explicitly rendered in Ethiopia time on the client).
process.env.TZ = 'UTC';

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
                          winston.format.printf(
                              ({ level, message, context, timestamp }) =>
                                  `${timestamp} [${context ?? 'App'}] ${level}: ${message}`,
                          ),
                      )
                    : winston.format.combine(
                          winston.format.timestamp(),
                          winston.format.json(),
                      ),
            }),
            ...(isDev
                ? []
                : [
                      new winston.transports.File({
                          filename: 'logs/error.log',
                          level: 'error',
                          format: winston.format.combine(
                              winston.format.timestamp(),
                              winston.format.json(),
                          ),
                      }),
                      new winston.transports.File({
                          filename: 'logs/combined.log',
                          format: winston.format.combine(
                              winston.format.timestamp(),
                              winston.format.json(),
                          ),
                      }),
                  ]),
        ],
    });

    // ── Schema sync ───────────────────────────────────────────────────
    // Bring the DB schema up to date BEFORE Nest connects and any module bootstraps
    // (schedulers query the DB during startup). This replaces TypeORM's unstable
    // `synchronize`  it adds missing columns / new tables without touching existing
    // indexes, so it can't churn or abort. Skipped when TypeORM synchronize is on,
    // or when explicitly disabled. Best-effort: never blocks startup.
    if (
        process.env.DB_SYNCHRONIZE !== 'true' &&
        process.env.DB_SKIP_SCHEMA_SYNC !== 'true'
    ) {
        try {
            const { failures } = await runSchemaSync((m) =>
                logger.log(m, 'SchemaSync'),
            );
            if (failures.length > 0) {
                logger.error(
                    `Schema sync finished with ${failures.length} failed item(s)  see above`,
                    undefined,
                    'SchemaSync',
                );
            }
        } catch (err) {
            logger.error(
                `Schema sync failed (continuing startup): ${err instanceof Error ? err.message : err}`,
                undefined,
                'SchemaSync',
            );
        }
    }

    const app = await NestFactory.create<NestExpressApplication>(AppModule, {
        logger,
    });
    app.enableShutdownHooks();
    const configService = app.get(ConfigService);

    // ── DB timezone: pin every MySQL connection's session to UTC ──────
    // mysql2 is configured with timezone:'Z' (it treats DB datetimes as UTC), but the
    // MySQL *session* time_zone defaults to the host's local zone. On a non-UTC host
    // that mismatch shifts every stored/read timestamp by the host offset (e.g. a
    // 1:16 PM purchase showing 3:16 PM on a UTC+2 host). Pinning the session to +00:00
    // makes 'Z' truthful, so timestamps are true UTC and render correctly in EAT.
    try {
        const dataSource = app.get(DataSource);
        const pool = (
            dataSource.driver as unknown as {
                pool?: {
                    on?: (
                        evt: string,
                        cb: (conn: {
                            query: (sql: string, cb: () => void) => void;
                        }) => void,
                    ) => void;
                };
            }
        ).pool;
        // New connections (the bulk of runtime traffic) get UTC on creation…
        pool?.on?.('connection', (conn) => {
            try {
                conn.query("SET time_zone = '+00:00'", () => {});
            } catch {
                /* noop */
            }
        });
        // …and pin the pool's already-open connection(s) too.
        await dataSource.query("SET time_zone = '+00:00'");
        logger.log('DB session time_zone pinned to UTC (+00:00)', 'Bootstrap');
    } catch (err) {
        logger.error(
            `Failed to pin DB session timezone: ${err instanceof Error ? err.message : err}`,
            undefined,
            'Bootstrap',
        );
    }

    // ── Static uploads (admin broadcast images) ──────────────────────
    // Served at /uploads/** so the admin UI can preview them and Telegram can be
    // handed a local file to upload. Persisted on disk (cPanel provides one).
    app.useStaticAssets(join(process.cwd(), 'uploads'), {
        prefix: '/uploads/',
        // The admin panel is a separate origin, so relax Helmet's default
        // same-origin CORP for these images (they're public promo assets).
        setHeaders: (res) =>
            res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'),
    });

    // ── Security: Helmet HTTP headers ────────────────────────────────
    app.use(
        helmet({
            crossOriginEmbedderPolicy: false, // allow Socket.IO iframe scenarios
        }),
    );

    // ── CORS ──────────────────────────────────────────────────────────
    // Comma-separated list  the player Mini App and the standalone agent Mini
    // App (see TELEGRAM_AGENT_MINIAPP_URL) are served from different origins
    // but both call this same API, so more than one origin must be allowed.
    const allowedOrigin = configService.get<string>('ALLOWED_ORIGIN', '');
    if (!isDev && !allowedOrigin) {
        throw new Error('ALLOWED_ORIGIN env var is required in production');
    }
    const allowedOrigins = allowedOrigin
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);
    app.enableCors({
        origin: isDev ? true : allowedOrigins,
        credentials: true,
    });

    // ── Global pipes / filters / guards ──────────────────────────────
    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
        }),
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
    logger.log(
        `🚀 iGames API running on http://localhost:${port}`,
        'Bootstrap',
    );
    if (isDev) {
        logger.log(
            `📚 Swagger docs at http://localhost:${port}/docs`,
            'Bootstrap',
        );
    }
    logger.log(
        `❤️  Health check at http://localhost:${port}/health`,
        'Bootstrap',
    );
}

void bootstrap();
