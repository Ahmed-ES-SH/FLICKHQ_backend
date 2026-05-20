import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class SendResetPasswordDto {
  @IsEmail()
  @IsString()
  @IsNotEmpty()
  @ApiProperty({ description: 'User email address' })
  email!: string;
}
