import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, QueryFailedError, In } from 'typeorm';
import { Category } from './schema/category.schema';
import { Product } from '../products/schema/product.schema';
import { Article } from '../blog/schema/article.schema';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import {
  FilterCategoriesQueryDto,
  CategorySortField,
  CategorySortOrder,
} from './dto/filter-categories-query.dto';
import { ReorderCategoriesDto } from './dto/reorder-categories.dto';

export interface CategoryWithCounts extends Category {
  articlesCount: number;
  productsCount: number;
}

/** Postgres unique violation error code */
const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class CategoriesService {
  private readonly logger = new Logger(CategoriesService.name);

  constructor(
    @InjectRepository(Category)
    private readonly categoryRepository: Repository<Category>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(Article)
    private readonly articleRepository: Repository<Article>,
  ) {}

  /** Whitelisted sort column mappings — prevents SQL injection */
  private readonly sortColumnMap: Record<CategorySortField, string> = {
    [CategorySortField.name]: 'category.name',
    [CategorySortField.order]: 'category.order',
    [CategorySortField.createdAt]: 'category.created_at',
  };

  // ─────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────

  /**
   * Generate slug from name
   */
  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /**
   * Wrap a DB save and convert unique-violation errors to ConflictException.
   * Handles both `name` and `slug` unique indexes.
   */
  private async saveWithConflictHandling(
    category: Category,
  ): Promise<Category> {
    try {
      return await this.categoryRepository.save(category);
    } catch (err) {
      if (
        err instanceof QueryFailedError &&
        (err as QueryFailedError & { code: string }).code ===
          PG_UNIQUE_VIOLATION
      ) {
        const detail = (err as QueryFailedError & { detail?: string }).detail;
        if (detail?.includes('name')) {
          throw new ConflictException('Category with this name already exists');
        }
        if (detail?.includes('slug')) {
          throw new ConflictException('Category with this slug already exists');
        }
        throw new ConflictException('Category already exists');
      }
      throw err;
    }
  }

  // ─────────────────────────────────────────────
  // CRUD
  // ─────────────────────────────────────────────

  /**
   * Create a new category
   */
  async create(dto: CreateCategoryDto): Promise<Category> {
    const slug = dto.slug || this.generateSlug(dto.name);

    const category = this.categoryRepository.create({
      ...dto,
      slug,
    });

    const saved = await this.saveWithConflictHandling(category);
    this.logger.log(`Category created: ${saved.id}`);
    return saved;
  }

  /**
   * Get all categories with pagination and filters
   */
  async getAll(filters: FilterCategoriesQueryDto): Promise<{
    data: Category[];
    total: number;
    totalPages: number;
    page: number;
    limit: number;
  }> {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 10;
    const { search, sortBy, sortOrder } = filters;

    const queryBuilder = this.categoryRepository.createQueryBuilder('category');

    if (search) {
      queryBuilder.where('category.name ILIKE :search', {
        search: `%${search}%`,
      });
    }

    // Use whitelisted column mapping — never interpolate user input directly
    const orderByColumn =
      sortBy != null ? this.sortColumnMap[sortBy] : this.sortColumnMap.order;
    const orderDirection =
      sortOrder === CategorySortOrder.DESC ? 'DESC' : 'ASC';

    queryBuilder
      .orderBy(orderByColumn, orderDirection)
      .skip((page - 1) * limit)
      .take(limit);

    const [data, total] = await queryBuilder.getManyAndCount();

    const totalPages = Math.ceil(total / limit);

    return { data, total, page, limit, totalPages };
  }

  /**
   * Get category by ID
   */
  async getById(id: string): Promise<Category> {
    const category = await this.categoryRepository.findOne({ where: { id } });
    if (!category) {
      throw new NotFoundException('Category not found');
    }
    return category;
  }

  /**
   * Get category by slug
   */
  async getBySlug(slug: string): Promise<Category> {
    const category = await this.categoryRepository.findOne({ where: { slug } });
    if (!category) {
      throw new NotFoundException('Category not found');
    }
    return category;
  }

  /**
   * Update a category
   */
  async update(id: string, dto: UpdateCategoryDto): Promise<Category> {
    const category = await this.getById(id);

    // If name changes and slug was NOT explicitly provided, regenerate slug
    if (dto.name && dto.name !== category.name && !dto.slug) {
      category.slug = this.generateSlug(dto.name);
    }

    Object.assign(category, dto);

    const updated = await this.saveWithConflictHandling(category);
    this.logger.log(`Category updated: ${id}`);
    return updated;
  }

  /**
   * Delete a category with validation
   *
   * The Article→Category and Product→Category relations both have
   * onDelete: 'SET NULL', so the DB automatically nullifies the FK
   * when the category is removed. We count related entities beforehand
   * only for the warning log.
   */
  async delete(id: string): Promise<{ message: string }> {
    const category = await this.getById(id);

    // Count related entities in parallel using entity-based queries
    const [articlesCount, productsCount] = await Promise.all([
      this.articleRepository.count({ where: { category: { id } } }),
      this.productRepository.count({ where: { category: { id } } }),
    ]);

    if (articlesCount > 0 || productsCount > 0) {
      this.logger.warn(
        `Category "${category.name}" (${id}) is referenced by ` +
          `${articlesCount} article(s) and ${productsCount} product(s). ` +
          `Their categoryId will be set to NULL on deletion.`,
      );
    }

    await this.categoryRepository.remove(category);
    this.logger.log(`Category deleted: ${id}`);

    return { message: 'Category deleted successfully' };
  }

  /**
   * Get category by ID with usage counts
   */
  async getByIdWithCounts(id: string): Promise<CategoryWithCounts> {
    const category = await this.getById(id);

    // Count related entities in parallel using entity-based queries
    const [articlesCount, productsCount] = await Promise.all([
      this.articleRepository.count({ where: { category: { id } } }),
      this.productRepository.count({ where: { category: { id } } }),
    ]);

    return {
      ...category,
      articlesCount,
      productsCount,
    };
  }

  /**
   * Bulk reorder categories — batch fetch + single transaction save
   */
  async reorder(dto: ReorderCategoriesDto): Promise<Category[]> {
    const ids = dto.categories.map((item) => item.id);
    const orderMap = new Map(
      dto.categories.map((item) => [item.id, item.order]),
    );

    // Single query to fetch all categories at once (findByIds is deprecated)
    const categories = await this.categoryRepository.findBy({ id: In(ids) });

    if (categories.length !== ids.length) {
      const foundIds = new Set(categories.map((c) => c.id));
      const missing = ids.filter((id) => !foundIds.has(id));
      throw new NotFoundException(
        `Categories not found: ${missing.join(', ')}`,
      );
    }

    // Atomic save inside a transaction — individual updates per row
    await this.categoryRepository.manager.transaction(async (tx) => {
      for (const category of categories) {
        await tx.update(Category, category.id, {
          order: orderMap.get(category.id)!,
        });
      }
    });

    // Re-fetch to return updated entities
    const updated = await this.categoryRepository.findBy({ id: In(ids) });
    // Sort by the requested order
    updated.sort((a, b) => orderMap.get(a.id)! - orderMap.get(b.id)!);

    this.logger.log('Categories reordered');
    return updated;
  }

  // ─────────────────────────────────────────────
  // Public
  // ─────────────────────────────────────────────

  /**
   * Get all categories for public (no pagination)
   */
  async getAllPublic(): Promise<Category[]> {
    return this.categoryRepository.find({
      order: { order: 'ASC', name: 'ASC' },
    });
  }

  /**
   * Get category by slug for public
   */
  async getBySlugPublic(slug: string): Promise<Category> {
    return this.getBySlug(slug);
  }
}
