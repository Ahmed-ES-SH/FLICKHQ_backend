import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { Request } from 'express';
import { AuthService } from '../auth.service';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

const COOKIE_NAME = 'sanad_auth_token';

export interface RequestWithToken extends Request {
  cookies: Record<string, string>;
  user: {
    id: string;
    email: string;
    role: string;
  };
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly jwtService: JwtService,
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestWithToken>();
    const token: string | undefined = request.cookies?.[COOKIE_NAME];

    if (!token) {
      throw new UnauthorizedException('Authentication cookie not found');
    }

    try {
      const decodedToken = await this.jwtService.verifyAsync<{
        id: string;
        email: string;
        role: string;
      }>(token);

      const isBlacklisted = await this.authService.isTokenBlacklisted(token);
      if (isBlacklisted) {
        throw new UnauthorizedException('This token has been revoked');
      }

      request['user'] = decodedToken;

      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
