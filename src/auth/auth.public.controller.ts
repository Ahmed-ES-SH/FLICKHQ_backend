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
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
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
  private readonly cookieName: string;
  private readonly frontendUrl: string;
  private readonly isProduction: boolean;

  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {
    this.cookieName =
      this.configService.get<string>('AUTH_TOKEN') ?? 'sanad_auth_token';
    this.frontendUrl =
      this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
    this.isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';
  }

  /**
   * Authenticates a user and returns a JWT token.
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 15 * 60 * 1000 } }) // 5 attempts per 15 minutes
  normalLogin(@Body() dto: LoginDto) {
    return this.authService.login(dto);
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
   */
  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleAuthRedirect(@Req() req: RequestWithUser, @Res() res: Response) {
    const avatar = req.user.avatar ?? '';

    const result = await this.authService.validateGoogleUser({
      googleId: req.user.googleId!,
      email: req.user.email,
      name: req.user.name!,
      avatar,
    });

    res.cookie(this.cookieName, result.access_token, {
      httpOnly: true,
      secure: this.isProduction,
      sameSite: 'strict',
      maxAge: 5 * 24 * 60 * 60 * 1000,
      path: '/',
    });

    return res.redirect(`${this.frontendUrl}?refresh=1`);
  }
}
