import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

import type { Response } from 'express';
import { logoutDTO } from './dto/logout.dto';
import { GetUser } from './decorators/current-user.decorator';
import { User } from '../user/schema/user.schema';

/**
 * Controller responsible for handling authentication-related requests.
 * Includes Login, Email Verification, Password Reset, and Google OAuth-.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Logs out the current user by adding their token to the blacklist.
   * @param dto - Contains the token and user ID to be blacklisted.
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  logout(@Body() dto: logoutDTO, @GetUser() user: User) {
    return this.authService.logout(dto, user.id.toString());
  }

  /**
   * Retrieves the profile of the currently authenticated user.
   * @param req - The request object containing the user attached by JwtAuthGuard.
   */
  @UseGuards(JwtAuthGuard)
  @Get('current-user')
  getProfile(@Req() req: Response & { user: User }) {
    return req.user;
  }
}
