import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UserService } from '../../user/user.service';
import { RequestWithToken } from '../guards/auth.guard';

const cookieExtractor = (req: RequestWithToken): string | null => {
  return req?.cookies?.['sanad_auth_token'] ?? null;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UserService,
  ) {
    super({
      jwtFromRequest: cookieExtractor,
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET')!,
      passReqToCallback: false,
    });
  }

  async validate(payload: { id: number; email: string }) {
    const user = await this.usersService.findById(payload.id);
    if (!user) {
      throw new UnauthorizedException();
    }
    return user;
  }
}
