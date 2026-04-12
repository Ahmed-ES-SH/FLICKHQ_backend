import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { Public } from './decorators/public.decorator';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { LoginDto } from './dto/login.dto';
import { sendResetPasswordDTO } from './dto/send-rest-password.dto';
import { verifyRestTokenDTO } from './dto/verify-rest-password-token.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { AuthGuard } from '@nestjs/passport';
import type { RequestWithUser } from './types/request.interface';
import type { Response } from 'express';

@Controller('auth')
@Public()
export class AuthPublicController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Authenticates a user and returns a JWT token.
   * @param dto - Login credentials (email and password).
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 6 * 60 * 60 * 1000 } }) // 5 times per 6 hours
  normalLogin(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }
  /**
   * Verifies user email via a unique token.
   * @param token - The verification token sent to the user's email.
   */
  @Post('verify-email')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 6 * 60 * 60 * 1000 } }) // 5 times per 6 hours
  verifyEmail(@Query('token') token: string) {
    return this.authService.verifyEmail(token);
  }
  /**
   * Sends a password reset link to the user's registered email.
   */
  @Post('rest-password/send')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 900000 } })
  async sendRestPassword(@Body() dto: sendResetPasswordDTO) {
    return this.authService.sendRestPassword(dto);
  }

  /**
   * Validates the password reset token before allowing password change.
   */
  @Post('rest-password/verify')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 900000 } })
  async verifyRestPasswordToken(@Body() dto: verifyRestTokenDTO) {
    return this.authService.verifyRestToken(dto);
  }
  /**
   * Resets the user's password using the verified token.
   */
  @Post('rest-password')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 3600000 } })
  async RestPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.restPassword(dto);
  }

  /**
   * Initiates the Google OAuth2 login flow.
   */
  @Get('google')
  @UseGuards(AuthGuard('google'))
  async googleAuth() {}

  /**
   * Handles the callback from Google OAuth2.
   */
  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleAuthRedirect(@Req() req: RequestWithUser, @Res() res: Response) {
    const result = await this.authService.validateGoogleUser({
      googleId: req.user.googleId!,
      email: req.user.email,
      name: req.user.name!,
      avatar: req.user.avatar,
    });

    res.cookie('sanad_auth_token', result.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 5 * 24 * 60 * 60 * 1000,
      path: '/',
    });

    return res.redirect(`${process.env.FRONTEND_URL}?refresh=1`);
  }
}
