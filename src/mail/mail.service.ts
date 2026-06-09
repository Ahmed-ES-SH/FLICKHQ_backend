import { MailerService } from '@nestjs-modules/mailer';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { User } from '../user/schema/user.entity';
import * as crypto from 'crypto';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly mailerService: MailerService,
  ) {}

  async sendVerificationEmail(user: User): Promise<string> {
    const token = this.generateToken();
    const frontUrl = this.configService.getOrThrow<string>('FRONTEND_URL');
    const verifyUrl = `${frontUrl}/verify-email?token=${token}`;

    try {
      await this.mailerService.sendMail({
        to: user.email,
        subject: 'Welcome to FLICKHQ — Please verify your email',
        template: 'email-verification',
        context: {
          name: user.name,
          verificationUrl: verifyUrl,
          year: new Date().getFullYear(),
        },
      });

      this.logger.log(`Verification email sent to ${user.email}`);
    } catch (error) {
      this.logger.error(
        `Failed to send verification email to ${user.email}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new Error(
        'Failed to send verification email. Please try again later.',
      );
    }

    return token;
  }

  async sendResetPassword(user: User, token: string): Promise<void> {
    const frontUrl = this.configService.getOrThrow<string>('FRONTEND_URL');
    const resetUrl = `${frontUrl}/reset-password?token=${token}&e=${user.email}`;

    try {
      await this.mailerService.sendMail({
        to: user.email,
        subject: 'FLICKHQ — Reset Your Password',
        template: 'password-reset',
        context: {
          name: user.name,
          resetUrl: resetUrl,
          year: new Date().getFullYear(),
        },
      });

      this.logger.log(`Password reset email sent to ${user.email}`);
    } catch (error) {
      this.logger.error(
        `Failed to send password reset email to ${user.email}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new Error(
        'Failed to send password reset email. Please try again later.',
      );
    }
  }

  private generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }
}
