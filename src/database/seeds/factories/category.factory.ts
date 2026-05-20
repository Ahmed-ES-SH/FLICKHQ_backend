import { Category } from '../../../categories/schema/category.schema';
import { CATEGORY_META, DEFAULT_CATEGORY_META } from '../constants';
import { sanitizeString } from '../validators';

export interface ApiCategory {
  slug: string;
  name: string;
  url: string;
}

export function createCategoryEntity(
  apiCategory: ApiCategory,
  order: number,
): Partial<Category> {
  const slug = sanitizeString(apiCategory.slug);
  const name = sanitizeString(apiCategory.name);

  const meta = CATEGORY_META[slug] || DEFAULT_CATEGORY_META;

  const description =
    meta.description !== DEFAULT_CATEGORY_META.description
      ? meta.description
      : `Explore our curated collection of ${name.toLowerCase()} products`;

  return {
    name,
    slug,
    description,
    color: meta.color,
    icon: meta.icon,
    order,
  };
}
