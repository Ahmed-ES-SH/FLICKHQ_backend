import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, FindOptionsWhere, Repository } from 'typeorm';
import { User } from './schema/user.schema';
import * as argon2 from 'argon2';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { paginate } from 'src/helpers/paginate.helper';
import { FilterOptionsDto } from './dto/filter-options.dto';
import { UserRoleEnum } from 'src/auth/types/UserRoleEnum';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async create(dto: CreateUserDto) {
    const isExists = await this.userRepo.findOne({
      where: { email: dto.email },
    });

    if (isExists) throw new BadRequestException('The user is Already Exists');

    dto.password = await argon2.hash(dto.password);

    const user = this.userRepo.create(dto);
    return this.userRepo.save(user);
  }

  async stats() {
    const adminsNumber = await this.userRepo.count({
      where: { role: UserRoleEnum.ADMIN },
    });

    const verifiedUsersNumber = await this.userRepo.count({
      where: { isEmailVerified: true },
    });

    const unverifiedUsersNumber = await this.userRepo.count({
      where: { isEmailVerified: false },
    });

    return {
      adminsNumber,
      verifiedUsersNumber,
      unverifiedUsersNumber,
    };
  }

  async findAll(pagination: PaginationDto, filterOptions: FilterOptionsDto) {
    const { page, limit } = pagination;
    const { role, search, status } = filterOptions;

    const where: FindOptionsWhere<User> = {};

    if (role) {
      where.role = role;
    }

    if (status) {
      where.status = status;
    }

    if (search) {
      return paginate(this.userRepo, page, limit, {
        where: [
          { ...where, name: ILike(`%${search}%`) },
          { ...where, email: ILike(`%${search}%`) },
        ],
        order: { createdAt: 'DESC' },
      });
    }

    const result = await paginate(this.userRepo, page, limit, {
      where,
      order: { createdAt: 'DESC' },
    });

    return result;
  }

  async findOne(id: number) {
    return this.userRepo.findOne({ where: { id } });
  }

  async update(id: number, dto: UpdateUserDto) {
    const user = await this.findOne(id);

    if (!user) throw new BadRequestException('The user is not found');

    if (dto.email && !user.isEmailVerified) user.email = dto.email;
    if (dto.password) user.password = await argon2.hash(dto.password);
    if (dto.name) user.name = dto.name;
    if (dto.role) user.role = dto.role;
    if (dto.status) user.status = dto.status;
    if (dto.avatar) user.avatar = dto.avatar;
    if (dto.isEmailVerified !== undefined)
      user.isEmailVerified = dto.isEmailVerified;

    return this.userRepo.save(user);
  }

  async remove(id: number) {
    const user = await this.findOne(id);

    if (!user) throw new BadRequestException('The user is not found');

    return await this.userRepo.remove(user);
  }

  async findById(id: number) {
    const user = await this.userRepo.findOne({ where: { id } });

    if (user) {
      return user;
    }

    throw new BadRequestException('The user not found .');
  }

  async findByEmail(email: string) {
    return this.userRepo.findOne({ where: { email } });
  }
}
