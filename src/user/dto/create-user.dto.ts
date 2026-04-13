import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  Matches,
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
  @MinLength(8)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message:
      'Password must contain at least one lowercase letter, one uppercase letter, and one number',
  })
  @ApiProperty({
    description:
      'Password must be at least 8 characters with uppercase, lowercase, and number',
  })
  password: string;
}
