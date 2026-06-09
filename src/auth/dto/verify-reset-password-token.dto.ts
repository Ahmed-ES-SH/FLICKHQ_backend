import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class VerifyResetTokenDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({ description: 'Reset token to verify' })
  token!: string;

  @IsEmail()
  @IsString()
  @IsNotEmpty()
  @ApiProperty({ description: 'User email address' })
  email!: string;
}
