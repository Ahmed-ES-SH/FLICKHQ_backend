import { ConfigModule, ConfigService } from '@nestjs/config';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { UserModule } from '../user/user.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../user/schema/user.schema';
import { AuthController } from './auth.controller';
import { GoogleStrategy } from './strategies/google.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { MailModule } from '../mail/mail.module';

import { AuthGuard } from './guards/auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { BlackList } from './schema/blacklisk-tokens.schema';
import { AuthPublicController } from './auth.public.controller';

// JWT Options
function ReturnJWTOptions(config: ConfigService) {
  return {
    secret: config.get<string>('JWT_SECRET'),
    signOptions: {
      expiresIn: config.get<number>('JWT_EXPIRES_IN'),
    },
  };
}

const JWT_OPTIONS = {
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    return ReturnJWTOptions(config);
  },
};

// module

@Module({
  imports: [
    TypeOrmModule.forFeature([User, BlackList]),
    JwtModule.registerAsync(JWT_OPTIONS),
    MailModule,
    ConfigModule,
    UserModule,
    PassportModule,
  ],
  controllers: [AuthController, AuthPublicController],
  providers: [
    AuthService,
    GoogleStrategy,
    JwtStrategy,
    AuthGuard,
    JwtAuthGuard,
  ],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
