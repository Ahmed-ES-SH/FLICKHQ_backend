import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, QueryFailedError } from 'typeorm';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { CategoriesService } from './categories.service';
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

describe('CategoriesService', () => {
  let service: CategoriesService;

  let categoryRepo: jest.Mocked<Repository<Category>>;
  let productRepo: jest.Mocked<Repository<Product>>;
  let articleRepo: jest.Mocked<Repository<Article>>;

  const mockCategory: Category = {
    id: 'cat-001',
    name: 'Electronics',
    slug: 'electronics',
    description: 'Electronic devices',
    color: '#FF5733',
    icon: 'laptop',
    order: 1,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    articles: [],
    products: [],
  };

  const mockQueryBuilder = {
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn().mockResolvedValue([[mockCategory], 1]),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoriesService,
        {
          provide: getRepositoryToken(Category),
          useValue: {
            create: jest.fn((dto) => ({ ...dto, id: 'cat-001' })),
            save: jest.fn((entity) => Promise.resolve(entity)),
            findOne: jest.fn(),
            findBy: jest.fn(),
            remove: jest.fn(),
            find: jest.fn(),
            createQueryBuilder: jest.fn(() => mockQueryBuilder),
            manager: {
              transaction: jest.fn(async (cb) =>
                cb({ update: jest.fn().mockResolvedValue({}) }),
              ),
            },
          },
        },
        {
          provide: getRepositoryToken(Product),
          useValue: {
            count: jest.fn().mockResolvedValue(0),
          },
        },
        {
          provide: getRepositoryToken(Article),
          useValue: {
            count: jest.fn().mockResolvedValue(0),
          },
        },
      ],
    }).compile();

    service = module.get<CategoriesService>(CategoriesService);
    categoryRepo = module.get(getRepositoryToken(Category));
    productRepo = module.get(getRepositoryToken(Product));
    articleRepo = module.get(getRepositoryToken(Article));

    jest.clearAllMocks();
  });

  // ── create ────────────────────────────────────────────────────

  describe('create', () => {
    it('should create a category with auto-generated slug', async () => {
      const dto: CreateCategoryDto = { name: 'New Category' };
      categoryRepo.save.mockResolvedValueOnce(mockCategory);

      const result = await service.create(dto);

      expect(categoryRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'New Category',
          slug: 'new-category',
        }),
      );
      expect(categoryRepo.save).toHaveBeenCalled();
      expect(result).toEqual(mockCategory);
    });

    it('should throw ConflictException on duplicate name/slug', async () => {
      const dto: CreateCategoryDto = { name: 'Duplicate' };
      const error = new QueryFailedError(
        'INSERT INTO categories ...',
        [],
        new Error('duplicate key value violates unique constraint') as never,
      );
      (error as any).code = '23505';
      (error as any).detail = 'Key (name)=(Duplicate) already exists';
      categoryRepo.save.mockRejectedValueOnce(error);

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });
  });

  // ── getAll ────────────────────────────────────────────────────

  describe('getAll', () => {
    it('should return paginated categories', async () => {
      const filters: FilterCategoriesQueryDto = {
        page: 1,
        limit: 10,
        sortBy: CategorySortField.order,
        sortOrder: CategorySortOrder.ASC,
      };

      const result = await service.getAll(filters);

      expect(categoryRepo.createQueryBuilder).toHaveBeenCalledWith('category');
      expect(result).toEqual({
        data: [mockCategory],
        total: 1,
        totalPages: 1,
        page: 1,
        limit: 10,
      });
    });

    it('should apply search filter', async () => {
      const filters: FilterCategoriesQueryDto = {
        page: 1,
        limit: 10,
        search: 'electro',
        sortBy: CategorySortField.order,
        sortOrder: CategorySortOrder.ASC,
      };

      await service.getAll(filters);

      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'category.name ILIKE :search',
        { search: '%electro%' },
      );
    });

    it('should use whitelisted sort column mapping', async () => {
      const filters: FilterCategoriesQueryDto = {
        page: 1,
        limit: 10,
        sortBy: CategorySortField.createdAt,
        sortOrder: CategorySortOrder.DESC,
      };

      await service.getAll(filters);

      // Verifies orderBy was called with the mapped column, not raw user input
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'category.created_at',
        'DESC',
      );
    });
  });

  // ── getById ───────────────────────────────────────────────────

  describe('getById', () => {
    it('should return a category by ID', async () => {
      categoryRepo.findOne.mockResolvedValueOnce(mockCategory);

      const result = await service.getById('cat-001');

      expect(result).toEqual(mockCategory);
    });

    it('should throw NotFoundException if category not found', async () => {
      categoryRepo.findOne.mockResolvedValueOnce(null);

      await expect(service.getById('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── getBySlug ─────────────────────────────────────────────────

  describe('getBySlug', () => {
    it('should return a category by slug', async () => {
      categoryRepo.findOne.mockResolvedValueOnce(mockCategory);

      const result = await service.getBySlug('electronics');

      expect(result).toEqual(mockCategory);
    });

    it('should throw NotFoundException if slug not found', async () => {
      categoryRepo.findOne.mockResolvedValueOnce(null);

      await expect(service.getBySlug('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── update ────────────────────────────────────────────────────

  describe('update', () => {
    it('should update a category', async () => {
      categoryRepo.findOne.mockResolvedValueOnce(mockCategory);
      categoryRepo.save.mockResolvedValueOnce({
        ...mockCategory,
        name: 'Updated Name',
      });

      const dto: UpdateCategoryDto = { name: 'Updated Name' };
      const result = await service.update('cat-001', dto);

      expect(categoryRepo.save).toHaveBeenCalled();
      expect(result.name).toBe('Updated Name');
    });

    it('should regenerate slug when name changes without explicit slug', async () => {
      categoryRepo.findOne.mockResolvedValueOnce(mockCategory);
      categoryRepo.save.mockResolvedValueOnce({
        ...mockCategory,
        name: 'New Name',
        slug: 'new-name',
      });

      const dto: UpdateCategoryDto = { name: 'New Name' };
      await service.update('cat-001', dto);

      expect(categoryRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ slug: 'new-name' }),
      );
    });

    it('should NOT regenerate slug when explicit slug is provided', async () => {
      categoryRepo.findOne.mockResolvedValueOnce(mockCategory);
      categoryRepo.save.mockResolvedValueOnce({
        ...mockCategory,
        name: 'New Name',
        slug: 'custom-slug',
      });

      const dto: UpdateCategoryDto = { name: 'New Name', slug: 'custom-slug' };
      await service.update('cat-001', dto);

      expect(categoryRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ slug: 'custom-slug' }),
      );
    });

    it('should throw ConflictException on duplicate name/slug', async () => {
      categoryRepo.findOne.mockResolvedValueOnce(mockCategory);
      const error = new QueryFailedError(
        'UPDATE categories ...',
        [],
        new Error('duplicate key value violates unique constraint') as never,
      );
      (error as any).code = '23505';
      (error as any).detail = 'Key (slug)=(duplicate) already exists';
      categoryRepo.save.mockRejectedValueOnce(error);

      const dto: UpdateCategoryDto = { slug: 'duplicate' };
      await expect(service.update('cat-001', dto)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ── delete ────────────────────────────────────────────────────

  describe('delete', () => {
    it('should delete a category', async () => {
      categoryRepo.findOne.mockResolvedValueOnce(mockCategory);
      categoryRepo.remove.mockResolvedValueOnce(mockCategory);

      const result = await service.delete('cat-001');

      expect(articleRepo.count).toHaveBeenCalledWith({
        where: { category: { id: 'cat-001' } },
      });
      expect(productRepo.count).toHaveBeenCalledWith({
        where: { category: { id: 'cat-001' } },
      });
      expect(categoryRepo.remove).toHaveBeenCalledWith(mockCategory);
      expect(result).toEqual({ message: 'Category deleted successfully' });
    });

    it('should throw NotFoundException if category not found', async () => {
      categoryRepo.findOne.mockResolvedValueOnce(null);

      await expect(service.delete('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── getByIdWithCounts ─────────────────────────────────────────

  describe('getByIdWithCounts', () => {
    it('should return category with counts', async () => {
      categoryRepo.findOne.mockResolvedValueOnce(mockCategory);
      articleRepo.count.mockResolvedValue(5);
      productRepo.count.mockResolvedValue(10);

      const result = await service.getByIdWithCounts('cat-001');

      expect(result).toEqual(
        expect.objectContaining({
          ...mockCategory,
          articlesCount: 5,
          productsCount: 10,
        }),
      );
    });

    it('should count articles and products in parallel using entity relations', async () => {
      categoryRepo.findOne.mockResolvedValueOnce(mockCategory);
      articleRepo.count.mockResolvedValue(3);
      productRepo.count.mockResolvedValue(7);

      await service.getByIdWithCounts('cat-001');

      expect(articleRepo.count).toHaveBeenCalledWith({
        where: { category: { id: 'cat-001' } },
      });
      expect(productRepo.count).toHaveBeenCalledWith({
        where: { category: { id: 'cat-001' } },
      });
    });
  });

  // ── reorder ───────────────────────────────────────────────────

  describe('reorder', () => {
    it('should reorder categories in a transaction with individual updates', async () => {
      const dto: ReorderCategoriesDto = {
        categories: [
          { id: 'cat-001', order: 2 },
          { id: 'cat-002', order: 1 },
        ],
      };
      const cat1 = { ...mockCategory, id: 'cat-001', order: 1 };
      const cat2 = { ...mockCategory, id: 'cat-002', order: 2 };
      categoryRepo.findBy.mockResolvedValueOnce([cat1, cat2]);
      categoryRepo.findBy.mockResolvedValueOnce([
        { ...cat1, order: 2 },
        { ...cat2, order: 1 },
      ]);

      const mockTxUpdate = jest.fn().mockResolvedValue({});
      (categoryRepo.manager.transaction as jest.Mock).mockImplementation(
        async (cb) => cb({ update: mockTxUpdate }),
      );

      const result = await service.reorder(dto);

      // findBy is called with { id: In([...]) } — verify it was called twice
      expect(categoryRepo.findBy).toHaveBeenCalledTimes(2);
      expect(mockTxUpdate).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(2);
      // Verify sorted by order
      expect(result[0].order).toBe(1);
      expect(result[1].order).toBe(2);
    });

    it('should throw NotFoundException if some categories are missing', async () => {
      const dto: ReorderCategoriesDto = {
        categories: [
          { id: 'cat-001', order: 1 },
          { id: 'cat-999', order: 2 },
        ],
      };
      categoryRepo.findBy.mockResolvedValueOnce([
        { ...mockCategory, id: 'cat-001' },
      ]);

      await expect(service.reorder(dto)).rejects.toThrow(NotFoundException);
    });
  });

  // ── getAllPublic ──────────────────────────────────────────────

  describe('getAllPublic', () => {
    it('should return all categories ordered by order and name', async () => {
      categoryRepo.find.mockResolvedValueOnce([mockCategory]);

      const result = await service.getAllPublic();

      expect(categoryRepo.find).toHaveBeenCalledWith({
        order: { order: 'ASC', name: 'ASC' },
      });
      expect(result).toEqual([mockCategory]);
    });
  });

  // ── getBySlugPublic ───────────────────────────────────────────

  describe('getBySlugPublic', () => {
    it('should delegate to getBySlug', async () => {
      categoryRepo.findOne.mockResolvedValueOnce(mockCategory);

      const result = await service.getBySlugPublic('electronics');

      expect(result).toEqual(mockCategory);
    });
  });
});
