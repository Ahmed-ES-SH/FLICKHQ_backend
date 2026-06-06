import * as argon2 from 'argon2';
import * as crypto from 'crypto';

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  RequestTimeoutException,
  UnauthorizedException,
} from '@nestjs/common';
import { LoginDto } from './dto/login.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from '../user/schema/user.entity';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { UserService } from '../user/user.service';
import { ValidateGoogleUserInput } from './types/validateGoogleUser';
import { MailService } from '../mail/mail.service';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyResetTokenDto } from './dto/verify-reset-password-token.dto';
import { SendResetPasswordDto } from './dto/send-reset-password.dto';
import { BlackList } from './schema/blacklist-tokens.schema';
import { LogoutDto } from './dto/logout.dto';
import { UserRoleEnum } from './types/UserRoleEnum';

// JWT expiry in hours — used to set blacklist token TTL
const JWT_EXPIRY_HOURS = 24;
const BLACKLIST_BUFFER_HOURS = 24;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly userService: UserService,
    private readonly mailService: MailService,
    private readonly jwtService: JwtService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(BlackList)
    private readonly blackListRepo: Repository<BlackList>,
  ) {}

  // MARK: Authentication — login / logout

  async login(
    dto: LoginDto,
  ): Promise<{ user: Omit<User, 'password'>; access_token: string }> {
    const user = await this.userRepo.findOne({
      where: { email: dto.email },
      select: ['id', 'email', 'role', 'password', 'isEmailVerified', 'avatar'],
    });

    if (!user) throw new BadRequestException('Invalid email or password');

    const isPasswordValid = await argon2.verify(user.password!, dto.password);
    if (!isPasswordValid)
      throw new BadRequestException('Invalid email or password');

    if (!user.isEmailVerified) {
      await this.sendVerificationEmail(user);
      throw new ForbiddenException('You need to verify your email first');
    }

    const payload = { id: user.id, email: user.email, role: user.role };
    const token = this.jwtService.sign(payload);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, ...userWithoutPassword } = user;

    return { user: userWithoutPassword, access_token: token };
  }

  async logout(dto: LogoutDto, userId: string): Promise<{ message: string }> {
    const { token } = dto;

    // Set expiry so the blacklist table doesn't grow unbounded
    const expiresAt = new Date();
    expiresAt.setHours(
      expiresAt.getHours() + JWT_EXPIRY_HOURS + BLACKLIST_BUFFER_HOURS,
    );

    await this.blackListRepo.save({ token, userId, expiresAt });
    return { message: 'User logged out successfully' };
  }

  async isTokenBlacklisted(token: string): Promise<BlackList | null> {
    return this.blackListRepo.findOne({ where: { token } });
  }

  // MARK: Password reset

  async sendResetPassword(
    dto: SendResetPasswordDto,
  ): Promise<{ message: string }> {
    const user = await this.userRepo.findOne({ where: { email: dto.email } });

    if (user) {
      const token = this.generateToken();
      const hashedToken = await argon2.hash(token);

      try {
        await this.mailService.sendResetPassword(user, token);
        await this.addResetToken(user.id, hashedToken);
      } catch (error) {
        this.logger.error(
          'Password reset email failed — token not saved',
          error instanceof Error ? error.stack : String(error),
        );
        // Re-throw so the caller knows the operation failed
        throw new RequestTimeoutException(
          'Failed to send reset email. Please try again.',
        );
      }
    }

    return {
      message:
        'If an account exists with this email, a reset link has been sent.',
    };
  }

  async verifyResetToken(
    dto: VerifyResetTokenDto,
  ): Promise<{ message: string; userId: number }> {
    const { token, email } = dto;

    const user = await this.userRepo.findOne({
      where: { email },
    });

    if (!user || !user.passwordResetToken) {
      throw new BadRequestException('Invalid token or user not found');
    }

    if (
      !user.passwordResetTokenExpiry ||
      new Date() > user.passwordResetTokenExpiry
    ) {
      throw new BadRequestException('Token has expired');
    }

    const isValid = await argon2.verify(user.passwordResetToken, token);

    if (!isValid) {
      throw new BadRequestException('Invalid token');
    }

    return { message: 'This token is valid', userId: user.id };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    const { email, password, token } = dto;
    const user = await this.userRepo.findOne({
      where: { email },
      select: [
        'id',
        'password',
        'passwordResetToken',
        'passwordResetTokenExpiry',
      ],
    });

    if (!user || !user.passwordResetToken) {
      throw new BadRequestException('Invalid request');
    }

    if (
      !user.passwordResetTokenExpiry ||
      new Date() > user.passwordResetTokenExpiry
    ) {
      throw new BadRequestException('Token has expired');
    }

    const isTokenValid = await argon2.verify(user.passwordResetToken, token);
    if (!isTokenValid) {
      throw new BadRequestException('Invalid token');
    }

    const hashedPassword = await argon2.hash(password);

    user.password = hashedPassword;
    user.passwordResetToken = null;
    user.passwordResetTokenExpiry = null;

    await this.userRepo.save(user);

    return { message: 'Password changed successfully' };
  }

  // MARK: Email verification

  async verifyEmail(token: string): Promise<{ message: string }> {
    if (!token) throw new BadRequestException('The token is required');

    const user = await this.userRepo.findOne({
      where: { emailVerificationToken: token },
    });

    if (!user) {
      throw new BadRequestException('Invalid or expired token');
    }

    if (user.isEmailVerified) {
      throw new BadRequestException('The user is already verified');
    }

    user.isEmailVerified = true;
    user.emailVerificationToken = null;
    user.emailVerificationTokenExpiry = null;

    await this.userRepo.save(user);

    return { message: 'Email verified successfully' };
  }

  // MARK: Google OAuth

  async validateGoogleUser({
    googleId,
    email,
    name,
    avatar,
  }: ValidateGoogleUserInput): Promise<{
    access_token: string;
    user: User;
  }> {
    if (!email) throw new UnauthorizedException('No email from Google');

    let user = await this.userRepo.findOne({
      where: { googleId },
    });

    if (!user) {
      user = await this.userRepo.findOne({ where: { email } });
      if (user) {
        // Existing user without Google link — link the account
        user.googleId = googleId;
        user.avatar = avatar;
        user.name = name;
        user.isEmailVerified = true;
        user = await this.userRepo.save(user);
      } else {
        // New user — create with explicit role
        user = await this.userRepo.save({
          email,
          googleId,
          name,
          avatar,
          isEmailVerified: true,
          role: UserRoleEnum.USER,
        });
      }
    }

    const payload = { id: user.id, email: user.email, role: user.role };
    const access_token = this.jwtService.sign(payload);

    return { access_token, user };
  }

  // MARK: Private helpers

  private async addVerificationToken(
    userId: number,
    token: string,
  ): Promise<void> {
    const expiry = new Date();
    expiry.setHours(expiry.getHours() + 1);

    await this.userRepo.update(userId, {
      emailVerificationToken: token,
      emailVerificationTokenExpiry: expiry,
      isEmailVerified: false,
    });
  }

  private async addResetToken(userId: number, token: string): Promise<void> {
    const expiry = new Date();
    expiry.setHours(expiry.getHours() + 1);

    await this.userRepo.update(userId, {
      passwordResetToken: token,
      passwordResetTokenExpiry: expiry,
    });
  }

  private async sendVerificationEmail(user: User): Promise<void> {
    try {
      const token = await this.mailService.sendVerificationEmail(user);
      await this.addVerificationToken(user.id, token);
    } catch (error) {
      this.logger.error(
        'Verification email failed',
        error instanceof Error ? error.stack : String(error),
      );
      throw new RequestTimeoutException();
    }
  }

  private generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }
}
