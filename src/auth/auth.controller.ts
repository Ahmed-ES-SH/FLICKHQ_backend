import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { AuthCookieService } from './auth-cookie.service';
import { GetUser } from './decorators/current-user.decorator';
import type { RequestWithUser } from './types/request.interface';
import type { Response } from 'express';

@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly authCookieService: AuthCookieService,
  ) {}

  /**
   * Logs out the current user by blacklisting their JWT and clearing the cookie.
   * Reads the token from the HttpOnly cookie — no request body needed.
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: RequestWithUser,
    @Res({ passthrough: true }) res: Response,
    @GetUser('id') userId: number,
  ) {
    const token: string | undefined =
      req.cookies?.[this.authCookieService.name];

    if (!token) {
      throw new UnauthorizedException('Authentication cookie not found');
    }

    // Blacklist the token so it can't be reused
    await this.authService.logout(token, userId.toString());

    // Clear the HttpOnly cookie from the browser
    this.authCookieService.clearAuthCookie(res);

    return { message: 'User logged out successfully' };
  }

  /**
   * Retrieves the profile of the currently authenticated user.
   * Includes subscription/plan data — active plan if subscribed,
   * free plan indicator otherwise.
   */
  @Get('current-user')
  async getProfile(@Req() req: RequestWithUser) {
    return this.authService.getCurrentUserWithPlan(req.user.id);
  }
}
