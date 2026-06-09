import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @IsEmail()
  @IsNotEmpty()
  @ApiProperty({ description: 'User email address' })
  email!: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty({ description: 'User password' })
  password!: string;
}
