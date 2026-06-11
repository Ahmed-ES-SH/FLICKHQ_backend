import { EjsAdapter } from '@nestjs-modules/mailer/adapters/ejs.adapter';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { join } from 'node:path';

function ReturnMailOptions(config: ConfigService) {
  return {
    transport: {
      host: config.getOrThrow<string>('MAIL_HOST'),
      port: config.get<number>('MAIL_PORT', 587),
      secure: false,
      auth: {
        user: config.getOrThrow<string>('MAIL_USER'),
        pass: config.getOrThrow<string>('MAIL_PASS'),
      },
    },
    defaults: {
      from: config.get<string>('MAIL_FROM'),
    },
    template: {
      dir: join(__dirname, '..', 'mail', 'templates'),
      adapter: new EjsAdapter(),
      options: {
        strict: false,
      },
    },
  };
}

export const MAIL_OPTIONS = {
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    return ReturnMailOptions(config);
  },
};
