import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LogoutDto } from './dto/logout.dto';
import { GetUser } from './decorators/current-user.decorator';
import type { RequestWithUser } from './types/request.interface';

@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Logs out the current user by adding their token to the blacklist.
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Body() dto: LogoutDto, @GetUser('id') userId: number) {
    return this.authService.logout(dto, userId.toString());
  }

  /**
   * Retrieves the profile of the currently authenticated user.
   * Returns the decoded JWT payload (id, email, role).
   */
  @Get('current-user')
  getProfile(@Req() req: RequestWithUser) {
    return req.user;
  }
}
