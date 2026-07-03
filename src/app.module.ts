import { APP_GUARD } from "@nestjs/core";
import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AuthModule } from "./auth/auth.module";
import { BingoModule } from "./bingo/bingo.module";
import { BotsModule } from "./bots/bots.module";
import { RequestIdMiddleware } from "./common/middleware/request-id.middleware";
import { validateEnv } from "./config/env.validation";
import { DevModule } from "./dev/dev.module";
import { GameEventsModule } from "./events/game-events.module";
import { HealthModule } from "./health/health.module";
import { KenoModule } from "./keno/keno.module";
import { PaymentsModule } from "./payments/payments.module";
import { RedisModule } from "./redis/redis.module";
import { RngModule } from "./rng/rng.module";
import { SchedulerModule } from "./scheduler/scheduler.module";
import { TelegramModule } from "./telegram/telegram.module";
import { UsersModule } from "./users/users.module";
import { WalletModule } from "./wallet/wallet.module";
import { AdminModule } from "./admin/admin.module";
import { AgentsModule } from "./agents/agents.module";
import { BroadcastModule } from "./broadcast/broadcast.module";
import { CrashModule } from "./crash/crash.module";

const isDev = process.env.NODE_ENV !== "production";

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            validate: validateEnv,
        }),
        TypeOrmModule.forRootAsync({
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => ({
                type: 'mysql',
                host: configService.getOrThrow<string>('DB_HOST'),
                port: configService.getOrThrow<number>('DB_PORT'),
                username: configService.getOrThrow<string>('DB_USERNAME'),
                password: configService.get<string>('DB_PASSWORD', ''),
                database: configService.getOrThrow<string>('DB_DATABASE'),
                autoLoadEntities: true,
                synchronize: true,
                timezone: 'Z',
                charset: 'utf8mb4_unicode_ci',
            }),
        }),
        ThrottlerModule.forRootAsync({
            inject: [ConfigService],
            useFactory: (cfg: ConfigService) => [
                {
                    name: 'default',
                    ttl: cfg.get<number>("THROTTLE_TTL_SECONDS", 60) * 1000,
                    limit: cfg.get<number>("THROTTLE_MAX_REQUESTS", 120),
                },
                {
                    // High default so this bucket only becomes strict where @Throttle({ strict: ... }) overrides it.
                    name: 'strict',
                    ttl: 60_000,
                    limit: 10_000,
                },
            ],
        }),
        ScheduleModule.forRoot(),
        RedisModule,
        AuthModule,
        UsersModule,
        WalletModule,
        PaymentsModule,
        KenoModule,
        BingoModule,
        RngModule,
        TelegramModule,
        HealthModule,
        GameEventsModule,
        SchedulerModule,
        BotsModule,
        AdminModule,
        AgentsModule,
        BroadcastModule,
        CrashModule,
        ...(isDev ? [DevModule] : []),
    ],
    providers: [
        {
            provide: APP_GUARD,
            useClass: ThrottlerGuard,
        },
    ],
})
export class AppModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
        consumer.apply(RequestIdMiddleware).forRoutes("*");
    }
}
