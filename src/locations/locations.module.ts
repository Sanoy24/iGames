import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { User } from '../users/entities/user.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AgentLocation } from './entities/agent-location.entity';
import { Location } from './entities/location.entity';
import { LocationsController } from './locations.controller';
import { LocationsService } from './locations.service';

// Depends on the User *entity* rather than UsersModule, so admin/telegram can
// import this module without dragging in a circular users dependency.
@Module({
  imports: [
    JwtModule.register({}),
    TypeOrmModule.forFeature([Location, AgentLocation, User]),
  ],
  controllers: [LocationsController],
  providers: [LocationsService, JwtAuthGuard, RolesGuard],
  exports: [LocationsService, TypeOrmModule],
})
export class LocationsModule {}
