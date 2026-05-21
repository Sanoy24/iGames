import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthIdentity, AuthIdentitySchema } from './schemas/auth-identity.schema';
import { User, UserSchema } from './schemas/user.schema';
import { RefreshSession, RefreshSessionSchema } from '../auth/schemas/refresh-session.schema';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { KenoModule } from '../keno/keno.module';
import { BingoModule } from '../bingo/bingo.module';

import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

@Module({
  imports: [
    JwtModule.register({}),
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: AuthIdentity.name, schema: AuthIdentitySchema },
      { name: RefreshSession.name, schema: RefreshSessionSchema }
    ]),
    forwardRef(() => KenoModule),
    forwardRef(() => BingoModule)
  ],
  controllers: [UsersController],
  providers: [UsersService, JwtAuthGuard, RolesGuard],
  exports: [UsersService, MongooseModule]
})
export class UsersModule {}
