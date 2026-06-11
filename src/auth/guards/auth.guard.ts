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
import { User } from '../../user/schema/user.entity';

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly cookieName: string;

  constructor(
    private readonly authService: AuthService,
    private readonly jwtService: JwtService,
    private reflector: Reflector,
    private readonly configService: ConfigService,
  ) {
    this.cookieName = this.configService.getOrThrow<string>('AUTH_TOKEN');
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
        role: string;
      }>(token);

      const isBlacklisted = await this.authService.isTokenBlacklisted(token);
      if (isBlacklisted) {
        throw new UnauthorizedException('This token has been revoked');
      }

      request.user = decodedToken as User;

      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
