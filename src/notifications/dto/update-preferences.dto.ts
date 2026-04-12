import { IsBoolean, IsOptional } from 'class-validator';

export class UpdatePreferencesDto {
  @IsOptional()
  @IsBoolean()
  orderNotifications?: boolean;

  @IsOptional()
  @IsBoolean()
  paymentNotifications?: boolean;

  @IsOptional()
  @IsBoolean()
  systemNotifications?: boolean;

  @IsOptional()
  @IsBoolean()
  emailEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  pushEnabled?: boolean;
}
