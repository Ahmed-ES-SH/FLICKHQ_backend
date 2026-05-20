import { Product } from '../../../products/schema/product.schema';
import { SHORT_DESCRIPTION_MAX_LENGTH } from '../constants';
import { sanitizeString, normalizeAvailabilityStatus } from '../validators';

export interface ApiProductReview {
  rating: number;
  comment: string;
  date: string;
  reviewerName: string;
  reviewerEmail: string;
}

export interface ApiProductDimensions {
  width: number;
  height: number;
  depth: number;
}

export interface ApiProduct {
  id: number;
  title: string;
  description: string;
  category: string;
  price: number;
  discountPercentage: number;
  rating: number;
  stock: number;
  tags: string[];
  brand: string;
  sku: string;
  weight: number;
  dimensions: ApiProductDimensions;
  warrantyInformation: string;
  shippingInformation: string;
  availabilityStatus: string;
  reviews: ApiProductReview[];
  returnPolicy: string;
  minimumOrderQuantity: number;
  meta: {
    createdAt: string;
    updatedAt: string;
    barcode: string;
    qrCode: string;
  };
  images: string[];
  thumbnail: string;
}

function generateSlug(title: string, sku: string): string {
  const baseSlug = title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const skuSuffix = sku
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .split('-')
    .slice(-2)
    .join('-');

  return `${baseSlug}-${skuSuffix}`;
}

function computeDiscountedPrice(
  price: number,
  discountPercentage: number,
): number {
  return Math.round((price - (price * discountPercentage) / 100) * 100) / 100;
}

function computeRating(reviews: ApiProductReview[]): number {
  if (!reviews || reviews.length === 0) return 0;
  const sum = reviews.reduce((acc, r) => acc + Number(r.rating), 0);
  return Math.round((sum / reviews.length) * 100) / 100;
}

export function createProductEntity(
  apiProduct: ApiProduct,
  categoryId: string,
): Partial<Product> {
  const title = sanitizeString(apiProduct.title);
  const description = sanitizeString(apiProduct.description);
  const sku = sanitizeString(apiProduct.sku);
  const slug = generateSlug(title, sku);

  const shortDescription =
    description.length > SHORT_DESCRIPTION_MAX_LENGTH
      ? description.substring(0, SHORT_DESCRIPTION_MAX_LENGTH) + '...'
      : description;

  const price = Number(apiProduct.price);
  const discountPercentage = Number(apiProduct.discountPercentage) || 0;
  const discountedPrice = computeDiscountedPrice(price, discountPercentage);

  const stock = Number(apiProduct.stock);
  const availabilityStatus = normalizeAvailabilityStatus(
    apiProduct.availabilityStatus,
    stock,
  );

  const reviews = Array.isArray(apiProduct.reviews) ? apiProduct.reviews : [];
  const rating = computeRating(reviews);

  const tags = Array.isArray(apiProduct.tags)
    ? apiProduct.tags
        .map((tag) => sanitizeString(tag).toLowerCase())
        .filter(Boolean)
    : [];

  const images = Array.isArray(apiProduct.images)
    ? apiProduct.images.map((img) => sanitizeString(img)).filter(Boolean)
    : [];

  return {
    title,
    slug,
    description,
    shortDescription,
    price,
    discountPercentage,
    discountedPrice,
    stock,
    sku,
    minimumOrderQuantity: Number(apiProduct.minimumOrderQuantity) || 1,
    availabilityStatus,
    categoryId,
    tags,
    brand: apiProduct.brand ? sanitizeString(apiProduct.brand) : null,
    weight: apiProduct.weight ? Number(apiProduct.weight) : null,
    dimensions: apiProduct.dimensions || null,
    images,
    thumbnail: apiProduct.thumbnail
      ? sanitizeString(apiProduct.thumbnail)
      : null,
    warrantyInformation: apiProduct.warrantyInformation
      ? sanitizeString(apiProduct.warrantyInformation)
      : null,
    shippingInformation: apiProduct.shippingInformation
      ? sanitizeString(apiProduct.shippingInformation)
      : null,
    returnPolicy: apiProduct.returnPolicy
      ? sanitizeString(apiProduct.returnPolicy)
      : null,
    reviews,
    rating,
    barcode: apiProduct.meta?.barcode
      ? sanitizeString(apiProduct.meta.barcode)
      : null,
    qrCode: apiProduct.meta?.qrCode
      ? sanitizeString(apiProduct.meta.qrCode)
      : null,
    isPublished: true,
  };
}
