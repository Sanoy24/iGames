import { APP_GUARD } from "@nestjs/core";
import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { MongooseModule } from "@nestjs/mongoose";
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

const isDev = process.env.NODE_ENV !== "production";

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            validate: validateEnv,
        }),
        MongooseModule.forRootAsync({
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => ({
                uri: configService.getOrThrow<string>("MONGODB_URI"),
            }),
        }),
        ThrottlerModule.forRootAsync({
            inject: [ConfigService],
            useFactory: (cfg: ConfigService) => [
                {
                    ttl: cfg.get<number>("THROTTLE_TTL_SECONDS", 60) * 1000,
                    limit: cfg.get<number>("THROTTLE_MAX_REQUESTS", 120),
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
