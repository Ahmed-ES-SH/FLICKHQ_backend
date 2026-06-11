import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UserService } from '../../user/user.service';
import { RequestWithUser } from '../types/request.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly cookieName: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UserService,
  ) {
    const cookieName = configService.getOrThrow<string>('AUTH_TOKEN');

    super({
      jwtFromRequest: (req: RequestWithUser) =>
        req?.cookies?.[cookieName] ?? null,
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET')!,
      passReqToCallback: false,
    });

    this.cookieName = cookieName;
  }

  async validate(payload: { id: number; email: string }) {
    const user = await this.usersService.findById(payload.id);
    if (!user) {
      throw new UnauthorizedException();
    }
    return user;
  }
}
