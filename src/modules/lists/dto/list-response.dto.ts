import { ApiProperty } from '@nestjs/swagger';

export class ListResponseDto {
  @ApiProperty({ description: 'List UUID' })
  id: string;

  @ApiProperty({ description: 'List name' })
  name: string;

  @ApiProperty({ description: 'URL-safe slug' })
  slug: string;

  @ApiProperty({ description: 'System list key or custom:<uuid>' })
  listKey: string;

  @ApiProperty({ description: 'Whether this is a system-generated list' })
  isSystem: boolean;

  @ApiProperty({ description: 'Number of items in the list' })
  itemCount: number;

  @ApiProperty({ description: 'Creation timestamp' })
  createdAt: Date;

  @ApiProperty({ description: 'Last update timestamp' })
  updatedAt: Date;
}
