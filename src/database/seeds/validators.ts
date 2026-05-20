import { AVAILABILITY_STATUS_MAP } from './constants';

export function sanitizeString(str: unknown): string {
  if (typeof str !== 'string') return '';
  return str.trim().replace(/\s+/g, ' ');
}

export function validateRequiredFields(
  obj: Record<string, unknown>,
  fields: string[],
): boolean {
  return fields.every((field) => {
    const value = obj[field];
    return value !== undefined && value !== null && value !== '';
  });
}

export function validateDecimal(
  value: unknown,
  precision: number,
  scale: number,
): number | null {
  const num = Number(value);
  if (isNaN(num) || num < 0) return null;

  const maxIntegerDigits = precision - scale;
  const maxIntegerValue = Math.pow(10, maxIntegerDigits) - 1;
  if (num > maxIntegerValue) return null;

  return Math.round(num * Math.pow(10, scale)) / Math.pow(10, scale);
}

export function validateCategory(apiCategory: unknown): boolean {
  if (!apiCategory || typeof apiCategory !== 'object') return false;

  const cat = apiCategory as Record<string, unknown>;

  if (!validateRequiredFields(cat, ['slug', 'name'])) return false;

  const slug = sanitizeString(cat.slug);
  const name = sanitizeString(cat.name);

  if (slug.length === 0 || name.length === 0) return false;
  if (slug.length > 120 || name.length > 100) return false;

  return true;
}

export function validateProduct(apiProduct: unknown): boolean {
  if (!apiProduct || typeof apiProduct !== 'object') return false;

  const product = apiProduct as Record<string, unknown>;

  if (
    !validateRequiredFields(product, [
      'title',
      'description',
      'category',
      'price',
      'sku',
    ])
  )
    return false;

  const title = sanitizeString(product.title);
  const description = sanitizeString(product.description);
  const category = sanitizeString(product.category);
  const sku = sanitizeString(product.sku);

  if (title.length === 0 || title.length > 300) return false;
  if (description.length === 0) return false;
  if (category.length === 0) return false;
  if (sku.length === 0 || sku.length > 50) return false;

  const price = validateDecimal(product.price, 10, 2);
  if (price === null) return false;

  const stock = Number(product.stock);
  if (isNaN(stock) || stock < 0) return false;

  return true;
}

export function normalizeAvailabilityStatus(
  status: unknown,
  stock: number,
): string {
  if (typeof status === 'string') {
    const normalized = status.toLowerCase().replace(/\s+/g, '');
    const mapped =
      AVAILABILITY_STATUS_MAP[normalized] ||
      AVAILABILITY_STATUS_MAP[status.toLowerCase()] ||
      status;
    return mapped;
  }

  if (stock === 0) return 'Out of Stock';
  if (stock < 10) return 'Low Stock';
  return 'In Stock';
}
