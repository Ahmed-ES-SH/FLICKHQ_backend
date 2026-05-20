import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class LogoutDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({ description: 'JWT token to blacklist' })
  token!: string;
}
