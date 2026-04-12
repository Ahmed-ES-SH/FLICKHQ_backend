import { IsEnum, IsOptional, IsString } from 'class-validator';
import { StatusEnum } from 'src/auth/types/StatusEnum';
import { UserRoleEnum } from 'src/auth/types/UserRoleEnum';
import { PaginationDto } from 'src/common/dto/pagination.dto';

export class FilterOptionsDto extends PaginationDto {
  @IsOptional()
  @IsEnum(UserRoleEnum)
  role?: UserRoleEnum;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(StatusEnum)
  status?: StatusEnum;
}
