import { Expose } from 'class-transformer';

export class CategoryResponseDto {
  @Expose()
  id: string;

  @Expose()
  name: string;

  @Expose()
  slug: string;

  @Expose()
  description: string | null;

  @Expose()
  color: string | null;

  @Expose()
  icon: string | null;

  @Expose()
  order: number;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;
}
