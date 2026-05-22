import { Expose, Type } from 'class-transformer';

export class ProductDimensionsResponseDto {
  @Expose()
  width: number;

  @Expose()
  height: number;

  @Expose()
  depth: number;
}

export class ProductReviewResponseDto {
  @Expose()
  rating: number;

  @Expose()
  comment: string;

  @Expose()
  date: string;

  @Expose()
  reviewerName: string;

  @Expose()
  reviewerEmail: string;
}

export class CategoryBriefResponseDto {
  @Expose()
  id: string;

  @Expose()
  name: string;

  @Expose()
  slug: string;
}

export class ProductResponseDto {
  @Expose()
  id: string;

  @Expose()
  title: string;

  @Expose()
  slug: string;

  @Expose()
  description: string;

  @Expose()
  shortDescription: string | null;

  @Expose()
  price: number;

  @Expose()
  discountPercentage: number;

  @Expose()
  discountedPrice: number;

  @Expose()
  stock: number;

  @Expose()
  sku: string;

  @Expose()
  minimumOrderQuantity: number;

  @Expose()
  availabilityStatus: string;

  @Expose()
  categoryId: string | null;

  @Expose()
  @Type(() => CategoryBriefResponseDto)
  category: CategoryBriefResponseDto | null;

  @Expose()
  tags: string[];

  @Expose()
  brand: string | null;

  @Expose()
  weight: number | null;

  @Expose()
  @Type(() => ProductDimensionsResponseDto)
  dimensions: ProductDimensionsResponseDto | null;

  @Expose()
  images: string[];

  @Expose()
  thumbnail: string | null;

  @Expose()
  warrantyInformation: string | null;

  @Expose()
  shippingInformation: string | null;

  @Expose()
  returnPolicy: string | null;

  @Expose()
  @Type(() => ProductReviewResponseDto)
  reviews: ProductReviewResponseDto[];

  @Expose()
  rating: number;

  @Expose()
  barcode: string | null;

  @Expose()
  qrCode: string | null;

  @Expose()
  isPublished: boolean;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;

  @Expose()
  deletedAt: Date | null;
}
