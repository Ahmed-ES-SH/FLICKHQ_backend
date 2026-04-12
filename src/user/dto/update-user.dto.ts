import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { UserRoleEnum } from '../../auth/types/UserRoleEnum';
import { StatusEnum } from '../../auth/types/StatusEnum';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateUserDto {
  @IsString()
  @IsOptional()
  @ApiProperty()
  name?: string;

  @IsEmail()
  @IsOptional()
  @ApiProperty()
  email?: string;

  @IsString()
  @IsOptional()
  @ApiProperty()
  avatar?: string;

  @IsEnum(UserRoleEnum)
  @IsOptional()
  @ApiProperty()
  role?: UserRoleEnum;

  @IsString()
  @MinLength(6)
  @IsOptional()
  @ApiProperty()
  password?: string;

  @IsOptional()
  @ApiProperty()
  isEmailVerified?: boolean;

  @IsEnum(StatusEnum)
  @IsOptional()
  @ApiProperty()
  status?: StatusEnum;
}
