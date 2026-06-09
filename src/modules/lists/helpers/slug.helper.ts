import { Repository, Not, FindOptionsWhere } from 'typeorm';
import { ObjectLiteral } from 'typeorm';

export function generateListSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^\u0600-\u06FFa-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function generateUniqueListSlug<T extends ObjectLiteral>(
  title: string,
  repository: Repository<T>,
  options?: {
    slugColumn?: keyof T;
    idColumn?: keyof T;
    excludeId?: string | number;
  },
): Promise<string> {
  const slugColumn = (options?.slugColumn ?? 'slug') as keyof T;
  const idColumn = (options?.idColumn ?? 'id') as keyof T;
  const excludeId = options?.excludeId;

  const baseSlug = generateListSlug(title);
  let slug = baseSlug;
  let counter = 1;

  while (true) {
    const where: FindOptionsWhere<T> = {
      [slugColumn]: slug,
    } as FindOptionsWhere<T>;

    if (excludeId !== undefined) {
      Object.assign(where, { [idColumn]: Not(excludeId) });
    }

    const exists = await repository.findOne({ where });
    if (!exists) return slug;

    slug = `${baseSlug}-${counter++}`;
  }
}
