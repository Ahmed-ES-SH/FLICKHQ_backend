import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';
import { WebSocketData } from '../../config/ws.config';
import { AuthService } from '../auth.service';

const COOKIE_NAME = 'HQ_auth_token';

/** Parse a raw cookie header string into a key→value map. */
function parseCookies(cookieHeader: string): Record<string, string> {
  return cookieHeader.split(';').reduce<Record<string, string>>((acc, pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return acc;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    acc[key] = decodeURIComponent(value);
    return acc;
  }, {});
}

@Injectable()
export class WsJwtGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client: Socket = context.switchToWs().getClient();
    const token = this.extractToken(client);

    if (!token) {
      throw new UnauthorizedException('WebSocket token not provided');
    }

    // Check if token is blacklisted
    const isBlacklisted = await this.authService.isTokenBlacklisted(token);
    if (isBlacklisted) {
      throw new ForbiddenException('Token has been revoked');
    }

    try {
      const payload = this.jwtService.verify(token);

      // Attach user data to the socket for typed access
      (client as any).data = {
        userId: payload.sub || payload.id,
        userName: payload.name || payload.email || 'Unknown',
      } as WebSocketData;

      return true;
    } catch (error) {
      throw new UnauthorizedException('Invalid WebSocket token');
    }
  }

  private extractToken(client: Socket): string | undefined {
    // 1. Try httpOnly cookie from the WS handshake headers (preferred)
    const cookieHeader = client.handshake.headers.cookie;
    if (cookieHeader) {
      const cookies = parseCookies(cookieHeader);
      if (cookies[COOKIE_NAME]) {
        return cookies[COOKIE_NAME];
      }
    }

    // 2. Fallback: query parameter (e.g. native mobile clients)
    const query = client.handshake.query;
    if (query.token && typeof query.token === 'string') {
      return query.token;
    }

    // 3. Fallback: Authorization header
    const authHeader = client.handshake.headers.authorization;
    if (authHeader) {
      const [type, token] = authHeader.split(' ');
      if (type === 'Bearer') {
        return token;
      }
    }

    return undefined;
  }
}
