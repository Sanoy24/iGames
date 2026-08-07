import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { AuthIdentity } from './entities/auth-identity.entity';
import { RefreshSession } from '../auth/entities/refresh-session.entity';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { AgentMatchController } from './agent-match.controller';
import { AdminBootstrapService } from './admin-bootstrap.service';
import { KenoModule } from '../keno/keno.module';
import { BingoModule } from '../bingo/bingo.module';

import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

@Module({
  imports: [
    JwtModule.register({}),
    TypeOrmModule.forFeature([User, AuthIdentity, RefreshSession]),
    forwardRef(() => KenoModule),
    forwardRef(() => BingoModule)
  ],
  controllers: [UsersController, AgentMatchController],
  providers: [UsersService, JwtAuthGuard, RolesGuard, AdminBootstrapService],
  exports: [UsersService, TypeOrmModule]
})
export class UsersModule {}
