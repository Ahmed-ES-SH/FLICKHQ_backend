import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, FindOptionsWhere, Repository } from 'typeorm';
import { User } from './schema/user.entity';
import * as argon2 from 'argon2';
import { paginate, PaginatedResult } from '../helpers/paginate.helper';
import { FilterOptionsDto } from './dto/filter-options.dto';
import { UserRoleEnum } from '../auth/types/UserRoleEnum';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async create(dto: CreateUserDto): Promise<User> {
    const isExists = await this.userRepo.findOne({
      where: { email: dto.email },
    });

    if (isExists) throw new BadRequestException('User already exists');

    const hashedPassword = await argon2.hash(dto.password);

    const user = this.userRepo.create({ ...dto, password: hashedPassword });
    return this.userRepo.save(user);
  }

  async stats(): Promise<{
    adminsNumber: number;
    verifiedUsersNumber: number;
    unverifiedUsersNumber: number;
  }> {
    const [adminsNumber, verifiedUsersNumber, unverifiedUsersNumber] =
      await Promise.all([
        this.userRepo.count({ where: { role: UserRoleEnum.ADMIN } }),
        this.userRepo.count({ where: { isEmailVerified: true } }),
        this.userRepo.count({ where: { isEmailVerified: false } }),
      ]);

    return {
      adminsNumber,
      verifiedUsersNumber,
      unverifiedUsersNumber,
    };
  }

  async findAll(options: FilterOptionsDto): Promise<PaginatedResult<User>> {
    const { page, limit, role, search, status } = options;

    const baseWhere: FindOptionsWhere<User> = {};
    if (role) baseWhere.role = role;
    if (status) baseWhere.status = status;

    // Build where clause: if search is present, use OR across name/email
    const where: FindOptionsWhere<User> | FindOptionsWhere<User>[] = search
      ? [
          { ...baseWhere, name: ILike(`%${search}%`) },
          { ...baseWhere, email: ILike(`%${search}%`) },
        ]
      : baseWhere;

    return paginate(this.userRepo, page, limit, {
      where,
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: number, currentUser?: User): Promise<User> {
    const user = await this.userRepo.findOne({ where: { id } });

    if (!user) throw new NotFoundException(`User with ID ${id} not found`);

    // Non-admin users can only view their own profile
    if (
      currentUser &&
      currentUser.role !== UserRoleEnum.ADMIN &&
      currentUser.id !== user.id
    ) {
      throw new ForbiddenException('You can only view your own profile');
    }

    return user;
  }

  async update(
    id: number,
    dto: UpdateUserDto,
    currentUser?: User,
  ): Promise<User> {
    const user = await this.userRepo.findOne({ where: { id } });

    if (!user) throw new NotFoundException(`User with ID ${id} not found`);

    // Non-admin users can only update their own profile
    if (
      currentUser &&
      currentUser.role !== UserRoleEnum.ADMIN &&
      currentUser.id !== user.id
    ) {
      throw new ForbiddenException('You can only update your own profile');
    }

    const isAdmin = currentUser?.role === UserRoleEnum.ADMIN;

    if (dto.email && dto.email !== user.email) {
      user.email = dto.email;
      user.isEmailVerified = false; // require re-verification after email change
    }
    if (dto.password) user.password = await argon2.hash(dto.password);
    if (dto.name) user.name = dto.name;
    if (dto.avatar) user.avatar = dto.avatar;

    // Only admins can change role and status
    if (isAdmin && dto.role) user.role = dto.role;
    if (isAdmin && dto.status) user.status = dto.status;

    return this.userRepo.save(user);
  }

  async remove(id: number): Promise<User> {
    const user = await this.userRepo.findOne({ where: { id } });

    if (!user) throw new NotFoundException(`User with ID ${id} not found`);

    return this.userRepo.remove(user);
  }

  async findById(id: number): Promise<User> {
    return this.findOne(id);
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { email } });
  }

  async saveVerificationToken(
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

  async verifyEmail(token: string): Promise<User> {
    const user = await this.userRepo.findOne({
      where: { emailVerificationToken: token },
    });

    if (!user) {
      throw new NotFoundException('Invalid verification token');
    }

    if (
      user.emailVerificationTokenExpiry &&
      user.emailVerificationTokenExpiry < new Date()
    ) {
      throw new BadRequestException('Verification token has expired');
    }

    user.isEmailVerified = true;
    user.emailVerificationToken = null;
    user.emailVerificationTokenExpiry = null;

    return this.userRepo.save(user);
  }
}
