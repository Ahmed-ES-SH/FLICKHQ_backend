import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsService } from './notifications.service';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsController } from './notifications.controller';
import { NotificationsClientController } from './notifications.client.controller';
import { PusherAuthController } from './pusher.auth.controller';
import { PusherService } from './pusher.service';
import { Notification } from './schema/notification.schema';
import { NotificationPreferences } from './schema/notification-preferences.schema';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../auth/auth.module';
import { createPusherClient } from '../config/pusher.config';
import Pusher from 'pusher';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification, NotificationPreferences]),

    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: config.get<number>('JWT_EXPIRES_IN'),
        },
      }),
    }),

    AuthModule,
  ],
  controllers: [
    NotificationsController,
    NotificationsClientController,
    PusherAuthController,
  ],
  providers: [
    NotificationsService,
    NotificationsGateway,
    PusherService,
    {
      provide: Pusher,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        createPusherClient(configService),
    },
  ],
  exports: [NotificationsService, NotificationsGateway, PusherService],
})
export class NotificationsModule {}
