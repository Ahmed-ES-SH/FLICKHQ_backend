import {
  IsNotEmpty,
  IsString,
  IsArray,
  IsOptional,
  IsObject,
} from 'class-validator';

export class BroadcastNotificationDto {
  @IsNotEmpty()
  @IsString()
  title: string;

  @IsNotEmpty()
  @IsString()
  message: string;

  @IsOptional()
  @IsArray()
  targetUserIds?: string[];

  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
}
