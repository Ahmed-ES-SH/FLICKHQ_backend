import { DataSource } from 'typeorm';
import { Article } from '../../blog/schema/article.schema';

const ARTICLES_API_URL = 'https://dummyjson.com/posts';
const BATCH_SIZE = 50;
const API_PAGE_SIZE = 100;
const API_TIMEOUT_MS = 30000;
const API_MAX_RETRIES = 3;
const API_RETRY_DELAY_MS = 1000;

interface ApiPost {
  id: number;
  title: string;
  body: string;
  userId: number;
  tags: string[];
  reactions: {
    likes: number;
    dislikes: number;
  };
  views: number;
}

interface ApiPostsResponse {
  posts: ApiPost[];
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

async function fetchAllPosts(): Promise<ApiPost[]> {
  console.log('  → Fetching articles from API...');

  let allPosts: ApiPost[] = [];
  let skip = 0;
  let totalPages = 0;

  while (true) {
    const url = `${ARTICLES_API_URL}?limit=${API_PAGE_SIZE}&skip=${skip}`;
    const response = await fetchWithRetry(url);
    const data: unknown = await response.json();

    if (!data || typeof data !== 'object') {
      throw new Error('Invalid API response: expected object');
    }

    const apiResponse = data as ApiPostsResponse;

    if (!Array.isArray(apiResponse.posts)) {
      throw new Error('Invalid API response: expected posts array');
    }

    totalPages++;
    console.log(
      `  → Page ${totalPages}: fetched ${apiResponse.posts.length} posts (skip=${skip}, total=${apiResponse.total})`,
    );

    allPosts = allPosts.concat(apiResponse.posts);

    if (allPosts.length >= apiResponse.total) {
      break;
    }

    skip += API_PAGE_SIZE;
  }

  console.log(
    `  → Total fetched: ${allPosts.length} posts across ${totalPages} pages`,
  );

  return allPosts;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

function generateExcerpt(body: string, maxLength = 150): string {
  if (body.length <= maxLength) return body;
  return body.substring(0, maxLength).trim() + '...';
}

function estimateReadTime(content: string): number {
  const wordsPerMinute = 200;
  const wordCount = content.split(/\s+/).length;
  return Math.max(1, Math.ceil(wordCount / wordsPerMinute));
}

export async function seedArticles(
  dataSource: DataSource,
  slugToIdMap: Map<string, string>,
): Promise<{ inserted: number; skipped: number; invalid: number }> {
  console.log('\n📝 Seeding articles...');

  const apiPosts = await fetchAllPosts();

  const articleRepo = dataSource.getRepository(Article);

  const existingArticles = await articleRepo.find({
    select: ['id', 'slug'],
  });
  const existingSlugs = new Set(existingArticles.map((a) => a.slug));

  console.log(`  → Found ${apiPosts.length} posts from API`);
  console.log(`  → Existing articles in DB: ${existingSlugs.size}`);
  console.log('  → Validating and transforming...');

  let inserted = 0;
  let skipped = 0;
  let invalid = 0;

  const validArticles: Partial<Article>[] = [];

  const categorySlugs = Array.from(slugToIdMap.keys());

  for (const apiPost of apiPosts) {
    const slug = slugify(apiPost.title);
    const uniqueSlug = existingSlugs.has(slug) ? `${slug}-${apiPost.id}` : slug;

    if (existingSlugs.has(uniqueSlug)) {
      skipped++;
      continue;
    }

    if (!apiPost.title || !apiPost.body) {
      invalid++;
      console.log(`  ⚠️  Invalid post: ID ${apiPost.id}`);
      continue;
    }

    const categorySlug = categorySlugs[apiPost.id % categorySlugs.length];
    const categoryId = categorySlug
      ? (slugToIdMap.get(categorySlug) ?? null)
      : null;

    const article: Partial<Article> = {
      title: apiPost.title,
      slug: uniqueSlug,
      content: apiPost.body,
      excerpt: generateExcerpt(apiPost.body),
      tags: apiPost.tags || [],
      categoryId,
      isPublished: true,
      publishedAt: new Date(),
      readTimeMinutes: estimateReadTime(apiPost.body),
      viewsCount: apiPost.views || 0,
    };

    validArticles.push(article);
    existingSlugs.add(uniqueSlug);
  }

  console.log(`  → Valid articles to insert: ${validArticles.length}`);
  console.log(`  → Inserting in batches of ${BATCH_SIZE}...`);

  const totalBatches = Math.ceil(validArticles.length / BATCH_SIZE);

  for (let i = 0; i < validArticles.length; i += BATCH_SIZE) {
    const batch = validArticles.slice(i, i + BATCH_SIZE);
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;

    try {
      await dataSource.transaction(async (transactionalEntityManager) => {
        for (const articleData of batch) {
          const article = articleRepo.create(articleData);
          await transactionalEntityManager.save(article);
          inserted++;
        }
      });

      console.log(
        `  → Batch ${batchNumber}/${totalBatches}: ${batch.length} articles inserted`,
      );
    } catch (error) {
      console.error(
        `  ❌ Batch ${batchNumber} failed:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  console.log(`\n  → Inserted: ${inserted}`);
  console.log(`  → Skipped (existing): ${skipped}`);
  console.log(`  → Invalid: ${invalid}`);
  console.log(`✅ Articles seeded successfully\n`);

  return { inserted, skipped, invalid };
}
