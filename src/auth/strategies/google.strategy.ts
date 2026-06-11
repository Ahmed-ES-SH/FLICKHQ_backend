import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  private readonly logger = new Logger(GoogleStrategy.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
  ) {
    const clientID = configService.getOrThrow<string>('GOOGLE_CLIENT_ID');
    const clientSecret = configService.getOrThrow<string>('GOOGLE_CLIENT_SECRET');
    const callbackURL = configService.getOrThrow<string>('GOOGLE_CALLBACK_URL');

    super({
      clientID,
      clientSecret,
      callbackURL,
      scope: ['email', 'profile'],
    });

    const maskedSecret = clientSecret.substring(0, 4) + '****';
    this.logger.log(`GoogleStrategy initialized — callbackURL=${callbackURL}, clientID=${clientID}, clientSecret=${maskedSecret}`);
  }

  validate(
    accessToken: string,
    refreshToken: string,
    profile: {
      id: string;
      displayName: string;
      emails: { value: string }[];
      photos: { value: string }[];
    },
    done: VerifyCallback,
  ) {
    const { id, displayName, emails, photos } = profile;

    const email = emails?.[0]?.value;
    const avatar = photos?.[0]?.value;

    this.logger.log(`Google validate called — googleId=${id}, email=${email}, name=${displayName}, avatar=${avatar ? 'present' : 'absent'}`);
    this.logger.debug(`Full profile: id=${id}, displayName=${displayName}, emails=${JSON.stringify(emails)}, photos=${photos?.length ? 'present' : 'none'}`);

    const googleUser = {
      googleId: id,
      email,
      name: displayName,
      avatar,
    };

    done(null, googleUser);
  }
}
