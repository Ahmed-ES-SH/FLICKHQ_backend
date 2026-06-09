import { ConfigService } from '@nestjs/config';
import Pusher from 'pusher';

export function createPusherClient(configService: ConfigService): Pusher {
  const appId = configService.get<string>('PUSHER_APP_ID');
  const key = configService.get<string>('PUSHER_KEY');
  const secret = configService.get<string>('PUSHER_SECRET');
  const cluster = configService.get<string>('PUSHER_CLUSTER');

  if (!appId || !key || !secret || !cluster) {
    throw new Error(
      `Missing Pusher configuration. Required: PUSHER_APP_ID, PUSHER_KEY, PUSHER_SECRET, PUSHER_CLUSTER`,
    );
  }

  return new Pusher({
    appId,
    key,
    secret,
    cluster,
    useTLS: true,
  });
}
