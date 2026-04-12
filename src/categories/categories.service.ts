import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Category } from './schema/category.schema';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { FilterCategoriesQueryDto } from './dto/filter-categories-query.dto';
import { ReorderCategoriesDto } from './dto/reorder-categories.dto';

export interface CategoryWithCounts extends Category {
  projectsCount: number;
  servicesCount: number;
  articlesCount: number;
}

@Injectable()
export class CategoriesService {
  private readonly logger = new Logger(CategoriesService.name);

  constructor(
    @InjectRepository(Category)
    private readonly categoryRepository: Repository<Category>,
  ) {}

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
   * Check if category name already exists
   */
  private async checkNameExists(
    name: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.categoryRepository.findOne({
      where: { name },
    });
    if (existing && existing.id !== excludeId) {
      throw new ConflictException('Category with this name already exists');
    }
  }

  /**
   * Check if category slug already exists
   */
  private async checkSlugExists(
    slug: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.categoryRepository.findOne({
      where: { slug },
    });
    if (existing && existing.id !== excludeId) {
      throw new ConflictException('Category with this slug already exists');
    }
  }

  /**
   * Create a new category
   */
  async create(dto: CreateCategoryDto): Promise<Category> {
    await this.checkNameExists(dto.name);

    const slug = dto.slug || this.generateSlug(dto.name);
    await this.checkSlugExists(slug);

    const category = this.categoryRepository.create({
      ...dto,
      slug,
    });

    const saved = await this.categoryRepository.save(category);
    this.logger.log(`Category created: ${saved.id}`);
    return saved;
  }

  /**
   * Get all categories with pagination and filters
   */
  async getAll(
    filters: FilterCategoriesQueryDto,
  ): Promise<{ data: Category[]; total: number; page: number; limit: number }> {
    const {
      page = 1,
      limit = 10,
      search,
      sortBy = 'order',
      sortOrder = 'ASC',
    } = filters;

    const queryBuilder = this.categoryRepository.createQueryBuilder('category');

    if (search) {
      queryBuilder.where('category.name ILIKE :search', {
        search: `%${search}%`,
      });
    }

    const validSortFields = ['name', 'order', 'createdAt'];
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'order';

    queryBuilder
      .orderBy(`category.${sortField}`, sortOrder)
      .skip((page - 1) * limit)
      .take(limit);

    const [data, total] = await queryBuilder.getManyAndCount();

    return { data, total, page, limit };
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

    if (dto.name && dto.name !== category.name) {
      await this.checkNameExists(dto.name, id);
    }

    if (dto.slug && dto.slug !== category.slug) {
      await this.checkSlugExists(dto.slug, id);
    }

    const slug =
      dto.slug || (dto.name ? this.generateSlug(dto.name) : category.slug);

    Object.assign(category, dto, { slug });

    const updated = await this.categoryRepository.save(category);
    this.logger.log(`Category updated: ${id}`);
    return updated;
  }

  /**
   * Delete a category with validation
   */
  async delete(id: string): Promise<{ message: string }> {
    const category = await this.getById(id);

    // Check if category is in use by any entity
    const projectsCount = await this.categoryRepository.manager.count(
      'projects',
      { where: { categoryId: id } },
    );
    const servicesCount = await this.categoryRepository.manager.count(
      'services',
      { where: { categoryId: id } },
    );
    const articlesCount = await this.categoryRepository.manager.count(
      'articles',
      { where: { categoryId: id } },
    );

    const totalInUse = projectsCount + servicesCount + articlesCount;

    if (totalInUse > 0) {
      this.logger.warn(
        `Category "${category.name}" (${id}) is still in use by ${projectsCount} projects, ${servicesCount} services, and ${articlesCount} articles. Setting related entities' categoryId to null.`,
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

    const projectsCount = await this.categoryRepository.manager.count(
      'projects',
      { where: { categoryId: id } },
    );
    const servicesCount = await this.categoryRepository.manager.count(
      'services',
      { where: { categoryId: id } },
    );
    const articlesCount = await this.categoryRepository.manager.count(
      'articles',
      { where: { categoryId: id } },
    );

    return {
      ...category,
      projectsCount,
      servicesCount,
      articlesCount,
    };
  }

  /**
   * Bulk reorder categories
   */
  async reorder(dto: ReorderCategoriesDto): Promise<Category[]> {
    const categories: Category[] = [];

    for (const item of dto.categories) {
      const category = await this.getById(item.id);
      category.order = item.order;
      categories.push(category);
    }

    const saved = await this.categoryRepository.save(categories);
    this.logger.log('Categories reordered');
    return saved;
  }

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
