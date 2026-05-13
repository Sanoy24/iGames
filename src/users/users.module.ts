import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthIdentity, AuthIdentitySchema } from './schemas/auth-identity.schema';
import { User, UserSchema } from './schemas/user.schema';
import { UsersService } from './users.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: AuthIdentity.name, schema: AuthIdentitySchema }
    ])
  ],
  providers: [UsersService],
  exports: [UsersService, MongooseModule]
})
export class UsersModule {}
