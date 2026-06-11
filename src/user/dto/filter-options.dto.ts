import { IsEnum, IsOptional, IsString } from 'class-validator';
import { StatusEnum } from '../../auth/types/StatusEnum';
import { UserRoleEnum } from '../../auth/types/UserRoleEnum';
import { PaginationDto } from '../../common/dto/pagination.dto';

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
