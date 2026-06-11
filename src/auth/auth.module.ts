import { ConfigModule, ConfigService } from '@nestjs/config';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { APP_GUARD } from '@nestjs/core';
import { AuthService } from './auth.service';
import { UserModule } from '../user/user.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../user/schema/user.entity';
import { AuthController } from './auth.controller';
import { GoogleStrategy } from './strategies/google.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { MailModule } from '../mail/mail.module';
import { AuthGuard } from './guards/auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthCookieService } from './auth-cookie.service';
import { BlackList } from './schema/blacklist-tokens.schema';
import { AuthPublicController } from './auth.public.controller';
import { ListsModule } from '../modules/lists/lists.module';
import { BillingSubscription } from '../billing/entities/billing-subscription.entity';
import { BillingPlan } from '../billing/entities/billing-plan.entity';
import { BillingPrice } from '../billing/entities/billing-price.entity';

// JWT Options
function ReturnJWTOptions(config: ConfigService) {
  const expiresIn = config.getOrThrow<string>('JWT_EXPIRES_IN');

  return {
    secret: config.getOrThrow<string>('JWT_SECRET'),
    signOptions: {
      expiresIn: expiresIn as never,
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

@Module({
  imports: [
    TypeOrmModule.forFeature([User, BlackList, BillingSubscription, BillingPlan, BillingPrice]),
    JwtModule.registerAsync(JWT_OPTIONS),
    MailModule,
    ConfigModule,
    UserModule,
    PassportModule,
    ListsModule,
  ],
  controllers: [AuthController, AuthPublicController],
  providers: [
    AuthService,
    AuthCookieService,
    GoogleStrategy,
    JwtStrategy,
    JwtAuthGuard,
    // Global guard — handles auth for all routes, respects @Public()
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
