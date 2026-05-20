import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
  Matches,
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
  @MinLength(8)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message:
      'Password must contain at least one lowercase letter, one uppercase letter, and one number',
  })
  @IsOptional()
  @ApiProperty({
    description:
      'Password must be at least 8 characters with uppercase, lowercase, and number',
  })
  password?: string;

  @IsEnum(StatusEnum)
  @IsOptional()
  @ApiProperty()
  status?: StatusEnum;
}
