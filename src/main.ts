import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const isDev = process.env.NODE_ENV !== 'production';

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
      // File transport for production: structured JSON logs
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

  const app = await NestFactory.create(AppModule, { logger });
  const configService = app.get(ConfigService);

  app.enableCors({
    origin: true,
    credentials: true
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true
    })
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  app.useWebSocketAdapter(new IoAdapter(app));

  const swaggerConfig = new DocumentBuilder()
    .setTitle('iGames API')
    .setDescription('Backend API for Keno and 90-ball Bingo.')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const port = configService.getOrThrow<number>('PORT');
  await app.listen(port);
  logger.log(`🚀 iGames API running on http://localhost:${port}`, 'Bootstrap');
  logger.log(`📚 Swagger docs at http://localhost:${port}/docs`, 'Bootstrap');
  logger.log(`❤️  Health check at http://localhost:${port}/health`, 'Bootstrap');
}

void bootstrap();
