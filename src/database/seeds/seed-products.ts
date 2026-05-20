import { DataSource } from 'typeorm';
import { Product } from '../../products/schema/product.schema';
import {
  PRODUCTS_API_URL,
  API_PAGE_SIZE,
  BATCH_SIZE,
  API_TIMEOUT_MS,
  API_MAX_RETRIES,
  API_RETRY_DELAY_MS,
} from './constants';
import { validateProduct } from './validators';
import { createProductEntity, ApiProduct } from './factories/product.factory';

interface ApiProductsResponse {
  products: ApiProduct[];
  total: number;
  skip: number;
  limit: number;
}

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

async function fetchAllProducts(): Promise<ApiProduct[]> {
  console.log('  → Fetching products from API...');

  let allProducts: ApiProduct[] = [];
  let skip = 0;
  let totalPages = 0;

  while (true) {
    const url = `${PRODUCTS_API_URL}?limit=${API_PAGE_SIZE}&skip=${skip}`;
    const response = await fetchWithRetry(url);
    const data: unknown = await response.json();

    if (!data || typeof data !== 'object') {
      throw new Error('Invalid API response: expected object');
    }

    const apiResponse = data as ApiProductsResponse;

    if (!Array.isArray(apiResponse.products)) {
      throw new Error('Invalid API response: expected products array');
    }

    totalPages++;
    console.log(
      `  → Page ${totalPages}: fetched ${apiResponse.products.length} products (skip=${skip}, total=${apiResponse.total})`,
    );

    allProducts = allProducts.concat(apiResponse.products);

    if (allProducts.length >= apiResponse.total) {
      break;
    }

    skip += API_PAGE_SIZE;
  }

  console.log(
    `  → Total fetched: ${allProducts.length} products across ${totalPages} pages`,
  );

  return allProducts;
}

export async function seedProducts(
  dataSource: DataSource,
  slugToIdMap: Map<string, string>,
): Promise<{ inserted: number; skipped: number; invalid: number }> {
  console.log('\n📦 Seeding products...');

  const apiProducts = await fetchAllProducts();

  const productRepo = dataSource.getRepository(Product);

  const existingProducts = await productRepo.find({
    select: ['id', 'sku'],
  });
  const existingSkus = new Set(existingProducts.map((p) => p.sku));

  console.log(`  → Found ${apiProducts.length} products from API`);
  console.log(`  → Existing products in DB: ${existingSkus.size}`);
  console.log('  → Validating and transforming...');

  let inserted = 0;
  let skipped = 0;
  let invalid = 0;
  const failedRecords: string[] = [];

  const validProducts: Partial<Product>[] = [];

  for (const apiProduct of apiProducts) {
    if (!validateProduct(apiProduct)) {
      invalid++;
      const productObj = apiProduct as unknown as Record<string, unknown>;
      const title =
        typeof productObj.title === 'string'
          ? productObj.title
          : `ID: ${String(productObj.id)}`;
      failedRecords.push(title);
      console.log(`  ⚠️  Invalid product: ${title}`);
      continue;
    }

    const product = apiProduct;

    if (!slugToIdMap.has(product.category)) {
      invalid++;
      failedRecords.push(product.title);
      console.log(
        `  ⚠️  Missing category '${product.category}' for: ${product.title}`,
      );
      continue;
    }

    if (existingSkus.has(product.sku)) {
      skipped++;
      continue;
    }

    const categoryId = slugToIdMap.get(product.category)!;
    const entity = createProductEntity(product, categoryId);
    validProducts.push(entity);
  }

  console.log(`  → Valid products to insert: ${validProducts.length}`);
  console.log(`  → Inserting in batches of ${BATCH_SIZE}...`);

  const totalBatches = Math.ceil(validProducts.length / BATCH_SIZE);

  for (let i = 0; i < validProducts.length; i += BATCH_SIZE) {
    const batch = validProducts.slice(i, i + BATCH_SIZE);
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;

    try {
      await dataSource.transaction(async (transactionalEntityManager) => {
        for (const productData of batch) {
          const product = productRepo.create(productData);
          await transactionalEntityManager.save(product);
          inserted++;
        }
      });

      console.log(
        `  → Batch ${batchNumber}/${totalBatches}: ${batch.length} products inserted`,
      );
    } catch (error) {
      console.error(
        `  ❌ Batch ${batchNumber} failed:`,
        error instanceof Error ? error.message : error,
      );
      for (const productData of batch) {
        const title =
          typeof (productData as Record<string, unknown>).title === 'string'
            ? ((productData as Record<string, unknown>).title as string)
            : 'Unknown product';
        failedRecords.push(title);
      }
    }
  }

  console.log(`\n  → Inserted: ${inserted}`);
  console.log(`  → Skipped (existing): ${skipped}`);
  console.log(`  → Invalid: ${invalid}`);

  if (failedRecords.length > 0) {
    console.log(`\n  ⚠️  Failed records summary (${failedRecords.length}):`);
    failedRecords.slice(0, 10).forEach((title) => {
      console.log(`    - ${title}`);
    });
    if (failedRecords.length > 10) {
      console.log(`    ... and ${failedRecords.length - 10} more`);
    }
  }

  console.log(`✅ Products seeded successfully\n`);

  return { inserted, skipped, invalid };
}
