import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

import { AuthService } from '../auth.service';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { RequestWithUser } from '../types/request.interface';
import { UserService } from '../../user/user.service';
import { UserRoleEnum } from '../types/UserRoleEnum';

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly cookieName: string;

  constructor(
    private readonly authService: AuthService,
    private readonly jwtService: JwtService,
    private reflector: Reflector,
    private readonly configService: ConfigService,
    private readonly userService: UserService,
  ) {
    this.cookieName =
      this.configService.get<string>('AUTH_TOKEN') ?? 'flick_auth_token';
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token: string | undefined = request.cookies?.[this.cookieName];

    if (!token) {
      throw new UnauthorizedException('Authentication cookie not found');
    }

    try {
      const decodedToken = await this.jwtService.verifyAsync<{
        id: number;
        email: string;
        role: UserRoleEnum;
      }>(token);

      const isBlacklisted = await this.authService.isTokenBlacklisted(token);
      if (isBlacklisted) {
        throw new UnauthorizedException('This token has been revoked');
      }

      const user = await this.userService.findById(decodedToken.id);
      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      request.user = user;

      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
