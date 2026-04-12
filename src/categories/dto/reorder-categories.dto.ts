import { IsArray, IsUUID, ValidateNested, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class ReorderCategoryItemDto {
  @IsUUID()
  @ApiProperty({ description: 'Category ID' })
  id: string;

  @IsInt()
  @Min(0)
  @ApiProperty({ description: 'New order value' })
  order: number;
}

export class ReorderCategoriesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReorderCategoryItemDto)
  @ApiProperty({
    type: [ReorderCategoryItemDto],
    description: 'Array of category IDs with new order values',
  })
  categories: ReorderCategoryItemDto[];
}
