import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { AuthCookieService } from './auth-cookie.service';
import { Public } from './decorators/public.decorator';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { LoginDto } from './dto/login.dto';
import { SendResetPasswordDto } from './dto/send-reset-password.dto';
import { VerifyResetTokenDto } from './dto/verify-reset-password-token.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { AuthGuard } from '@nestjs/passport';
import type { RequestWithUser } from './types/request.interface';
import type { Response } from 'express';

@ApiTags('auth')
@Controller('auth')
@Public()
export class AuthPublicController {
  constructor(
    private readonly authService: AuthService,
    private readonly authCookieService: AuthCookieService,
  ) {}

  /**
   * Authenticates a user.
   * Sets an HttpOnly cookie with the JWT on success.
   * Returns user data only — the access token is never exposed in the response body.
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 15 * 60 * 1000 } }) // 5 attempts per 15 minutes
  async normalLogin(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(dto);

    // Set JWT as an HttpOnly cookie — never expose it in the response body
    this.authCookieService.setAuthCookie(res, result.access_token);

    return { user: result.user, subscription: result.subscription };
  }

  /**
   * Verifies user email via a unique token.
   */
  @Post('verify-email')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 15 * 60 * 1000 } }) // 5 attempts per 15 minutes
  verifyEmail(@Query('token') token: string) {
    return this.authService.verifyEmail(token);
  }

  /**
   * Sends a password reset link to the user's registered email.
   */
  @Post('reset-password/send')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 15 * 60 * 1000 } }) // 3 attempts per 15 minutes
  async sendResetPassword(@Body() dto: SendResetPasswordDto) {
    return this.authService.sendResetPassword(dto);
  }

  /**
   * Validates the password reset token before allowing password change.
   */
  @Post('reset-password/verify')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 15 * 60 * 1000 } }) // 5 attempts per 15 minutes
  async verifyResetPasswordToken(@Body() dto: VerifyResetTokenDto) {
    return this.authService.verifyResetToken(dto);
  }

  /**
   * Resets the user's password using the verified token.
   */
  @Post('reset-password')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60 * 60 * 1000 } }) // 5 attempts per hour
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  /**
   * Initiates the Google OAuth2 login flow.
   * Passport Google strategy handles the redirect automatically.
   */
  @Get('google')
  @UseGuards(AuthGuard('google'))
  async googleAuth() {
    // Redirect handled by Passport Google strategy
  }

  /**
   * Handles the callback from Google OAuth2.
   * Sets the JWT as an HttpOnly cookie and redirects to the frontend.
   */
  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleAuthRedirect(@Req() req: RequestWithUser, @Res() res: Response) {
    const logger = new Logger('GoogleAuthRedirect');
    const redirectUrl = this.authCookieService.redirectUrl;

    try {
      if (!req.user.googleId) {
        logger.error('Google callback missing googleId in user profile');
        return res.redirect(`${redirectUrl}?error=missing_google_id`);
      }
      if (!req.user.email) {
        logger.error('Google callback missing email in user profile');
        return res.redirect(`${redirectUrl}?error=missing_email`);
      }

      const result = await this.authService.validateGoogleUser({
        googleId: req.user.googleId,
        email: req.user.email,
        name: req.user.name || '',
        avatar: req.user.avatar,
      });

      return res.redirect(
        `${redirectUrl}/auth/google/callback?t=${result.access_token}`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : '';
      logger.error(`Google auth failed — ${errorMessage}`, errorStack);
      return res.redirect(`${redirectUrl}?error=auth_failed`);
    }
  }
}
