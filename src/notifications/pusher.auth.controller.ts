import {
  Controller,
  Post,
  Body,
  UseGuards,
  Logger,
  ForbiddenException,
  BadRequestException,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import Pusher from 'pusher';

interface AuthRequest {
  user: {
    id: string;
  };
}

@ApiTags('Pusher')
@ApiBearerAuth()
@Controller('pusher')
export class PusherAuthController {
  private readonly logger = new Logger(PusherAuthController.name);

  constructor(private readonly pusher: Pusher) {}

  @Post('auth')
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ summary: 'Authenticate Pusher private channel subscription' })
  @ApiResponse({ status: 200, description: 'Channel authorization successful' })
  @ApiResponse({
    status: 403,
    description: 'Channel ownership verification failed',
  })
  authenticate(
    @Body() body: { channel_name: string; socket_id: string },
    @Request() req: AuthRequest,
  ) {
    const { channel_name, socket_id } = body;
    const userId = req.user?.id;

    if (!channel_name || !socket_id) {
      throw new BadRequestException('channel_name and socket_id are required');
    }

    if (!userId) {
      throw new ForbiddenException('User ID not found in token');
    }

    const channelUserId = channel_name.replace('private-user-', '');

    if (userId !== channelUserId) {
      this.logger.warn(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: 'warn',
          service: 'pusher-auth',
          channel: channel_name,
          requestedUserId: channelUserId,
          authenticatedUserId: userId,
          reason: 'channel_ownership_mismatch',
          status: 'auth_failed',
        }),
      );
      throw new ForbiddenException(
        'You can only subscribe to your own notification channel',
      );
    }

    const authResponse = this.pusher.authorizeChannel(socket_id, channel_name);

    this.logger.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'info',
        service: 'pusher-auth',
        channel: channel_name,
        userId,
        status: 'auth_success',
      }),
    );

    return authResponse;
  }
}
