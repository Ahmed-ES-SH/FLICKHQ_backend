import { MailerService } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { User } from '../user/schema/user.schema';
import * as crypto from 'crypto';

@Injectable()
export class MailService {
  constructor(
    private readonly configService: ConfigService,
    private readonly mailerService: MailerService,
  ) {}

  async sendVerificationEmail(user: User) {
    const token = this.generateToken();

    const FRONT_URL = this.configService.get<string>('FRONTEND_URL');
    const verifyUrl = `${FRONT_URL}/verify-email?token=${token}`;

    await this.mailerService.sendMail({
      to: user.email,
      subject: 'Thank you to sign in our platform , please Verify your email',
      template: 'email-verification',
      context: {
        name: user.name,
        verificationUrl: verifyUrl,
      },
    });

    return token;
  }

  async sendRestPassword(user: User, token: string) {
    const FRONT_URL = this.configService.get<string>('FRONTEND_URL');
    const resetUrl = `${FRONT_URL}/reset-password?token=${token}&e=${user.email}`;

    await this.mailerService.sendMail({
      to: user.email,
      subject: 'CYPHER , Rest Password',
      template: 'password-reset',
      context: {
        name: user.name,
        resetUrl: resetUrl,
      },
    });
  }

  private generateToken() {
    const token = crypto.randomBytes(32).toString('hex');

    const expiry = new Date();
    expiry.setHours(expiry.getHours() + 1); // 1hour

    return token;
  }
}
