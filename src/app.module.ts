import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { MailerModule } from '@nestjs-modules/mailer';
import { NotificationsModule } from './notifications/notifications.module';
import { ScheduleModule } from '@nestjs/schedule';

import { EventEmitterModule } from '@nestjs/event-emitter';
import { BillingModule } from './billing/billing.module';
import { PlansSubscriptionsModule } from './plans-subscriptions/plans-subscriptions.module';
import { ListsModule } from './modules/lists/lists.module';
import { ContactModule } from './contact/contact.module';

// config files
import { throttlerConfig } from './config/throttler.config';
import { databaseConfig } from './config/database.config';
import { MAIL_OPTIONS } from './config/mail.config';
import { MailModule } from './mail/mail.module';
import { CacheModule } from '@nestjs/cache-manager';
import { CACHE_OPTIONS } from './config/cache.config';
import { AuthGuard } from './auth/guards/auth.guard';
import { JwtModule } from '@nestjs/jwt';
import { validationSchema } from './config/env.validation';

// JWT Options
import { JwtSignOptions } from '@nestjs/jwt';

function ReturnJWTOptions(config: ConfigService): {
  secret: string;
  signOptions: JwtSignOptions;
} {
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
    // config files
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema,
    }),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    TypeOrmModule.forRoot(databaseConfig),
    ThrottlerModule.forRoot(throttlerConfig),
    MailerModule.forRootAsync(MAIL_OPTIONS),
    CacheModule.register(CACHE_OPTIONS),
    JwtModule.registerAsync(JWT_OPTIONS),

    // modules
    AuthModule,
    UserModule,
    MailModule,
    NotificationsModule,
    BillingModule,
    PlansSubscriptionsModule,
    ListsModule,
    ContactModule,
  ],
  controllers: [AppController],
  exports: [JwtModule],
  providers: [
    AppService,
    // guards
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    // auth guard for check the blacklist tokens
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
  ],
})
export class AppModule {}
