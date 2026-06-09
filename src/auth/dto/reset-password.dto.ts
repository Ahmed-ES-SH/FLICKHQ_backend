import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsEmail()
  @IsNotEmpty()
  @ApiProperty({ description: 'User email address' })
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  @ApiProperty({ description: 'New password (min 6 characters)' })
  password!: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty({ description: 'Reset token received via email' })
  token!: string;
}
