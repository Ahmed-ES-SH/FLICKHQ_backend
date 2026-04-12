import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { UserRoleEnum } from 'src/auth/types/UserRoleEnum';

export class CreateUserDto {
  @IsEmail()
  @IsNotEmpty()
  @ApiProperty()
  email: string;

  @IsString()
  @IsOptional()
  @ApiProperty()
  name?: string;

  @IsString()
  @IsOptional()
  @ApiProperty()
  avatar?: string;

  @IsEnum(UserRoleEnum)
  @IsOptional()
  @ApiProperty()
  role?: UserRoleEnum;

  @IsString()
  @IsOptional()
  @ApiProperty()
  googleId?: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty()
  password: string;
}
