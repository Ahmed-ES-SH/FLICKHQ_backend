import * as argon2 from 'argon2';
import * as crypto from 'crypto';

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  RequestTimeoutException,
  UnauthorizedException,
} from '@nestjs/common';
import { LoginDto } from './dto/login.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from '../user/schema/user.schema';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { UserService } from '../user/user.service';
import { validateGoogleUserType } from './types/validateGoogleUser';
import { MailService } from '../mail/mail.service';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { verifyRestTokenDTO } from './dto/verify-rest-password-token.dto';
import { sendResetPasswordDTO } from './dto/send-rest-password.dto';
import { BlackList } from './schema/blacklisk-tokens.schema';
import { logoutDTO } from './dto/logout.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly mailService: MailService,
    private readonly jwtService: JwtService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(BlackList)
    private readonly blackListRepo: Repository<BlackList>,
  ) {}

  ////////////////////////////////////////////////////////////////////////////////////////
  /////////// normal auth methods - login, logout, verify email, reset password
  ////////////////////////////////////////////////////////////////////////////////////////

  async login(dto: LoginDto) {
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
      throw new ForbiddenException('you need to verify your email first');
    }

    const payload = { id: user.id, email: user.email, role: user.role };
    const token = await this.jwtService.signAsync(payload);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, ...userWithoutPassword } = user;

    return { user: userWithoutPassword, access_token: token };
  }

  async sendRestPassword(dto: sendResetPasswordDTO) {
    const user = await this.userRepo.findOne({ where: { email: dto.email } });

    if (user) {
      const token = this.generateToken();
      const hashedToken = await argon2.hash(token);

      await this.addRestToken(user.id, hashedToken);

      await this.mailService.sendRestPassword(user, token);
    }

    return {
      message:
        'If an account exists with this email, a reset link has been sent.',
    };
  }

  async verifyRestToken(dto: verifyRestTokenDTO) {
    const { token, email } = dto;

    const user = await this.userRepo.findOne({
      where: { email: email },
    });

    if (!user || !user.passwordResetToken) {
      throw new BadRequestException('Invalid token or user not found');
    }

    const currentTime = new Date();
    if (currentTime > user.passwordResetTokenExpiry!) {
      throw new BadRequestException('Token has expired');
    }

    const isValid = await argon2.verify(user.passwordResetToken, token);

    if (!isValid) {
      throw new BadRequestException('Invalid token');
    }

    return { message: 'This token is valid', userId: user.id };
  }

  async restPassword(dto: ResetPasswordDto) {
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

    if (new Date() > user.passwordResetTokenExpiry!) {
      throw new BadRequestException('Token has expired');
    }

    const isTokenValid = await argon2.verify(user.passwordResetToken, token);
    if (!isTokenValid) {
      throw new BadRequestException('Invalid token');
    }

    const hashPassword = await argon2.hash(password);

    user.password = hashPassword;
    user.passwordResetToken = null;
    user.passwordResetTokenExpiry = null;

    await this.userRepo.save(user);

    return { message: 'password changed successfully' };
  }

  async verifyEmail(token: string) {
    if (!token) throw new BadRequestException('The token is required');

    const user = await this.userRepo.findOne({
      where: { emailVerificationToken: token },
    });

    if (user?.isEmailVerified)
      throw new BadRequestException('The user is already verified');

    if (!user) {
      throw new BadRequestException('Invalid or expired token');
    }

    user.isEmailVerified = true;
    user.emailVerificationToken = null;
    user.emailVerificationTokenExpiry = null;

    await this.userRepo.save(user);

    return { message: 'Email verified successfully' };
  }

  async logout(dto: logoutDTO, userId: string) {
    const { token } = dto;
    await this.blackListRepo.save({ token, userId });
    return { message: 'User logged out successfully' };
  }

  async isTokenBlacklisted(token: string) {
    const isTokenBlacklisted = await this.blackListRepo.findOne({
      where: { token },
    });
    return isTokenBlacklisted;
  }

  /////////////////////////////////////////////////////////////////
  /////////// validate google user
  /////////////////////////////////////////////////////////////////
  async validateGoogleUser({
    googleId,
    email,
    name,
    avatar,
  }: validateGoogleUserType) {
    if (!email) throw new UnauthorizedException('No email from Google');

    let user = await this.userRepo.findOne({
      where: { googleId: googleId },
    });

    if (!user) {
      user = await this.userRepo.findOne({ where: { email } });
      if (user) {
        user.googleId = googleId;
        user.avatar = avatar;
        user.name = name;
        user.isEmailVerified = true;
        user = await this.userRepo.save(user);
      } else {
        user = await this.userRepo.save({
          email,
          googleId,
          name,
          avatar,
          isEmailVerified: true,
        });
      }
    }

    const payload = { id: user?.id, email: user?.email, role: user?.role };
    const access_token = await this.jwtService.signAsync(payload);

    return { access_token, user };
  }

  /////////////////////////////////////////////////////////////////
  /////////// private methods
  /////////////////////////////////////////////////////////////////

  private async addVerificationToken(userId: number, token: string) {
    const expiry = new Date();
    expiry.setHours(expiry.getHours() + 1); // 1hour

    await this.userRepo.update(userId, {
      emailVerificationToken: token,
      emailVerificationTokenExpiry: expiry,
      isEmailVerified: false,
    });

    return token;
  }

  private async addRestToken(userId: number, token: string) {
    const expiry = new Date();
    expiry.setHours(expiry.getHours() + 1); // 1hour

    await this.userRepo.update(userId, {
      passwordResetToken: token,
      passwordResetTokenExpiry: expiry,
    });

    return token;
  }

  private async sendVerificationEmail(user: User) {
    try {
      const token = await this.mailService.sendVerificationEmail(user);
      await this.addVerificationToken(user.id, token);
    } catch (error) {
      console.log(error);
      throw new RequestTimeoutException();
    }
  }

  private generateToken() {
    const token = crypto.randomBytes(32).toString('hex');

    const expiry = new Date();
    expiry.setHours(expiry.getHours() + 1); // 1hour

    return token;
  }
}
