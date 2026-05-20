import { DataSource } from 'typeorm';
import { Category } from '../../categories/schema/category.schema';
import {
  CATEGORIES_API_URL,
  API_TIMEOUT_MS,
  API_MAX_RETRIES,
  API_RETRY_DELAY_MS,
} from './constants';
import { validateCategory } from './validators';
import {
  createCategoryEntity,
  ApiCategory,
} from './factories/category.factory';

async function fetchWithRetry(
  url: string,
  retries = API_MAX_RETRIES,
): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return response;
    } catch (error) {
      if (attempt === retries) throw error;
      const delay = API_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      console.log(`  ⚠️  Attempt ${attempt} failed, retrying in ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error('Max retries exceeded');
}

export async function seedCategories(
  dataSource: DataSource,
): Promise<Map<string, string>> {
  console.log('\n📂 Seeding categories...');

  console.log('  → Fetching from API...');
  const response = await fetchWithRetry(CATEGORIES_API_URL);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const apiCategories: unknown[] = await response.json();

  if (!Array.isArray(apiCategories)) {
    throw new Error('Invalid API response: expected array of categories');
  }

  console.log(`  → Found ${apiCategories.length} categories from API`);

  const categoryRepo = dataSource.getRepository(Category);

  const existingCategories = await categoryRepo.find({
    select: ['id', 'slug'],
  });
  const existingSlugs = new Set(existingCategories.map((c) => c.slug));

  let inserted = 0;
  let skipped = 0;
  let invalid = 0;

  const validCategories: Partial<Category>[] = [];

  for (const apiCategory of apiCategories) {
    if (!validateCategory(apiCategory)) {
      invalid++;
      console.log(`  ⚠️  Invalid category: ${JSON.stringify(apiCategory)}`);
      continue;
    }

    const cat = apiCategory as ApiCategory;

    if (existingSlugs.has(cat.slug)) {
      skipped++;
      continue;
    }

    const entity = createCategoryEntity(cat, validCategories.length);
    validCategories.push(entity);
  }

  if (validCategories.length > 0) {
    console.log(`  → Inserting ${validCategories.length} new categories...`);

    await dataSource.transaction(async (transactionalEntityManager) => {
      for (const categoryData of validCategories) {
        const category = categoryRepo.create(categoryData);
        await transactionalEntityManager.save(category);
        inserted++;
      }
    });
  }

  const allCategories = await categoryRepo.find({
    select: ['id', 'slug'],
  });
  const slugToIdMap = new Map(allCategories.map((c) => [c.slug, c.id]));

  console.log(`  → Inserted: ${inserted}`);
  console.log(`  → Skipped (existing): ${skipped}`);
  console.log(`  → Invalid: ${invalid}`);
  console.log(`✅ Categories seeded successfully\n`);

  return slugToIdMap;
}
