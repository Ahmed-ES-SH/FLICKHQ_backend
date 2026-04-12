import { IsString, IsEmail, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateContactMessageDto {
  @ApiProperty({ description: 'Full name of the sender', maxLength: 100 })
  @IsString()
  @MaxLength(100)
  fullName: string;

  @ApiProperty({ description: 'Email address of the sender', maxLength: 255 })
  @IsEmail()
  @MaxLength(255)
  email: string;

  @ApiProperty({ description: 'Subject of the message', maxLength: 200 })
  @IsString()
  @MaxLength(200)
  subject: string;

  @ApiProperty({ description: 'Message content' })
  @IsString()
  message: string;
}
