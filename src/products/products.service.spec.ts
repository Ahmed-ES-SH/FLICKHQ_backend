import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, QueryFailedError } from 'typeorm';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { ProductsService } from './products.service';
import { Product } from './schema/product.schema';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import {
  FilterProductsQueryDto,
  ProductSortField,
} from './dto/filter-products-query.dto';
import { CategoriesService } from '../categories/categories.service';
import { SortOrder } from '../common/dto/pagination-query.dto';

// Mock the slug utility
jest.mock('../common/utils/slug.util', () => ({
  generateUniqueSlug: jest.fn((title) =>
    Promise.resolve(title.toLowerCase().replace(/\s+/g, '-')),
  ),
}));

/** Helper to build a mock Product with all entity methods */
function createMockProduct(
  overrides: Partial<Product> = {},
): jest.Mocked<Product> {
  return {
    id: 'prod-001',
    title: 'Test Product',
    slug: 'test-product',
    description: 'A test product',
    shortDescription: null,
    price: 99.99,
    discountPercentage: 10,
    discountedPrice: 89.99,
    stock: 50,
    sku: 'TEST-001',
    minimumOrderQuantity: 1,
    availabilityStatus: 'In Stock',
    categoryId: 'cat-001',
    category: null,
    tags: ['test'],
    brand: 'TestBrand',
    weight: 1.5,
    dimensions: null,
    images: [],
    thumbnail: null,
    warrantyInformation: null,
    shippingInformation: null,
    returnPolicy: null,
    reviews: [],
    rating: 0,
    barcode: null,
    qrCode: null,
    isPublished: false,
    deletedAt: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    // Entity methods (no-ops for mocks)
    generateSlug: () => '',
    generateSlugOnInsert: () => {},
    normalizeTags: () => {},
    computeDiscountedPrice: () => {},
    computeRating: () => {},
    ...overrides,
  } as unknown as jest.Mocked<Product>;
}

describe('ProductsService', () => {
  let service: ProductsService;

  let productRepo: jest.Mocked<Repository<Product>>;
  let categoriesService: jest.Mocked<CategoriesService>;

  const mockProduct = createMockProduct();

  const mockQueryBuilder = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn().mockResolvedValue([[mockProduct], 1]),
  };

  const mockTransactionEntityManager = {
    findOne: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        {
          provide: getRepositoryToken(Product),
          useValue: {
            create: jest.fn((dto) => ({ ...dto, id: 'prod-001' })),
            save: jest.fn((entity) => Promise.resolve(entity)),
            findOne: jest.fn(),
            findBy: jest.fn(),
            remove: jest.fn(),
            softRemove: jest.fn(),
            increment: jest.fn(),
            merge: jest.fn((entity, dto) => Object.assign(entity, dto)),
            createQueryBuilder: jest.fn(() => mockQueryBuilder),
            manager: {
              transaction: jest.fn(async (cb) =>
                cb(mockTransactionEntityManager),
              ),
            },
          },
        },
        {
          provide: CategoriesService,
          useValue: {
            getById: jest
              .fn()
              .mockResolvedValue({ id: 'cat-001', name: 'Test' }),
            getBySlug: jest
              .fn()
              .mockResolvedValue({ id: 'cat-001', slug: 'test' }),
          },
        },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
    productRepo = module.get(getRepositoryToken(Product));
    categoriesService = module.get(CategoriesService);
  });

  // ── create ────────────────────────────────────────────────────

  describe('create', () => {
    it('should create a product with auto-generated slug', async () => {
      const dto: CreateProductDto = {
        title: 'New Product',
        description: 'A new product',
        price: 49.99,
        sku: 'NEW-001',
      };
      productRepo.save.mockResolvedValueOnce(mockProduct);

      const result = await service.create(dto);

      expect(productRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'New Product',
          slug: 'new-product',
          price: 49.99,
          sku: 'NEW-001',
        }),
      );
      expect(result).toEqual(mockProduct);
    });

    it('should validate category exists when categoryId is provided', async () => {
      const dto: CreateProductDto = {
        title: 'Product',
        description: 'Desc',
        price: 10,
        sku: 'SKU-001',
        categoryId: 'cat-001',
      };
      productRepo.save.mockResolvedValueOnce(mockProduct);

      await service.create(dto);

      expect(categoriesService.getById).toHaveBeenCalledWith('cat-001');
    });

    it('should throw ConflictException on duplicate SKU', async () => {
      const dto: CreateProductDto = {
        title: 'Product',
        description: 'Desc',
        price: 10,
        sku: 'DUPLICATE',
      };
      const error = new QueryFailedError('query', [], {
        code: '23505',
        detail: 'Key (sku)=(DUPLICATE) already exists',
      } as never);
      productRepo.save.mockRejectedValueOnce(error);

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });
  });

  // ── getAll ────────────────────────────────────────────────────

  describe('getAll', () => {
    it('should return paginated products', async () => {
      const filters: FilterProductsQueryDto = {
        page: 1,
        limit: 10,
        sortBy: ProductSortField.createdAt,
        sortOrder: SortOrder.DESC,
      };

      const result = await service.getAll(filters);

      expect(productRepo.createQueryBuilder).toHaveBeenCalledWith('product');
      expect(result).toEqual({
        data: [mockProduct],
        total: 1,
        totalPages: 1,
        page: 1,
        limit: 10,
      });
    });

    it('should apply price range filters', async () => {
      const filters: FilterProductsQueryDto = {
        page: 1,
        limit: 10,
        minPrice: 10,
        maxPrice: 100,
        sortBy: ProductSortField.createdAt,
        sortOrder: SortOrder.DESC,
      };

      await service.getAll(filters);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'product.price >= :minPrice',
        { minPrice: 10 },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'product.price <= :maxPrice',
        { maxPrice: 100 },
      );
    });

    it('should apply search filter on title and description', async () => {
      const filters: FilterProductsQueryDto = {
        page: 1,
        limit: 10,
        search: 'test',
        sortBy: ProductSortField.createdAt,
        sortOrder: SortOrder.DESC,
      };

      await service.getAll(filters);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        '(product.title ILIKE :search OR product.description ILIKE :search)',
        { search: '%test%' },
      );
    });

    it('should apply inStockOnly filter', async () => {
      const filters: FilterProductsQueryDto = {
        page: 1,
        limit: 10,
        inStockOnly: true,
        sortBy: ProductSortField.createdAt,
        sortOrder: SortOrder.DESC,
      };

      await service.getAll(filters);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'product.stock > 0',
      );
    });
  });

  // ── getById ───────────────────────────────────────────────────

  describe('getById', () => {
    it('should return a product by ID', async () => {
      productRepo.findOne.mockResolvedValueOnce(mockProduct);

      const result = await service.getById('prod-001');

      expect(result).toEqual(mockProduct);
    });

    it('should throw NotFoundException if product not found', async () => {
      productRepo.findOne.mockResolvedValueOnce(null);

      await expect(service.getById('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── getBySlug ─────────────────────────────────────────────────

  describe('getBySlug', () => {
    it('should return a product by slug', async () => {
      productRepo.findOne.mockResolvedValueOnce(mockProduct);

      const result = await service.getBySlug('test-product');

      expect(result).toEqual(mockProduct);
    });

    it('should throw NotFoundException if slug not found', async () => {
      productRepo.findOne.mockResolvedValueOnce(null);

      await expect(service.getBySlug('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── update ────────────────────────────────────────────────────

  describe('update', () => {
    it('should update a product', async () => {
      productRepo.findOne.mockResolvedValueOnce(mockProduct);
      productRepo.save.mockResolvedValueOnce(
        createMockProduct({ title: 'Updated Product' }),
      );

      const dto: UpdateProductDto = { title: 'Updated Product' };
      const result = await service.update('prod-001', dto);

      expect(productRepo.merge).toHaveBeenCalled();
      expect(productRepo.save).toHaveBeenCalled();
      expect(result.title).toBe('Updated Product');
    });

    it('should validate category when categoryId changes', async () => {
      productRepo.findOne.mockResolvedValueOnce(mockProduct);
      productRepo.save.mockResolvedValueOnce(mockProduct);

      const dto: UpdateProductDto = { categoryId: 'cat-002' };
      await service.update('prod-001', dto);

      expect(categoriesService.getById).toHaveBeenCalledWith('cat-002');
    });

    it('should throw ConflictException on duplicate SKU', async () => {
      productRepo.findOne.mockResolvedValueOnce(mockProduct);
      const error = new QueryFailedError('query', [], {
        code: '23505',
        detail: 'Key (sku)=(DUPLICATE) already exists',
      } as never);
      productRepo.save.mockRejectedValueOnce(error);

      const dto: UpdateProductDto = { sku: 'DUPLICATE' };
      await expect(service.update('prod-001', dto)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ── delete ────────────────────────────────────────────────────

  describe('delete', () => {
    it('should soft-delete a product', async () => {
      productRepo.findOne.mockResolvedValueOnce(mockProduct);
      productRepo.softRemove.mockResolvedValueOnce(mockProduct);

      const result = await service.delete('prod-001');

      expect(productRepo.softRemove).toHaveBeenCalledWith(mockProduct);
      expect(result).toEqual({ message: 'Product deleted successfully' });
    });

    it('should throw NotFoundException if product not found', async () => {
      productRepo.findOne.mockResolvedValueOnce(null);

      await expect(service.delete('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── togglePublish ─────────────────────────────────────────────

  describe('togglePublish', () => {
    it('should publish an unpublished product', async () => {
      productRepo.findOne.mockResolvedValueOnce(
        createMockProduct({ isPublished: false }),
      );
      productRepo.save.mockResolvedValueOnce(
        createMockProduct({ isPublished: true }),
      );

      const result = await service.togglePublish('prod-001');

      expect(result.isPublished).toBe(true);
      expect(result.message).toBe('Product published successfully');
    });

    it('should unpublish a published product', async () => {
      productRepo.findOne.mockResolvedValueOnce(
        createMockProduct({ isPublished: true }),
      );
      productRepo.save.mockResolvedValueOnce(
        createMockProduct({ isPublished: false }),
      );

      const result = await service.togglePublish('prod-001');

      expect(result.isPublished).toBe(false);
      expect(result.message).toBe('Product unpublished successfully');
    });
  });

  // ── adjustStock ───────────────────────────────────────────────

  describe('adjustStock', () => {
    it('should increase stock within a transaction', async () => {
      mockTransactionEntityManager.findOne.mockResolvedValueOnce(
        createMockProduct({ stock: 50 }),
      );
      mockTransactionEntityManager.save.mockResolvedValueOnce(
        createMockProduct({ stock: 60 }),
      );

      const result = await service.adjustStock('prod-001', 10);

      expect(mockTransactionEntityManager.findOne).toHaveBeenCalledWith(
        Product,
        expect.objectContaining({
          where: { id: 'prod-001' },
          lock: { mode: 'pessimistic_write' },
        }),
      );
      expect(result.stock).toBe(60);
    });

    it('should decrease stock', async () => {
      mockTransactionEntityManager.findOne.mockResolvedValueOnce(
        createMockProduct({ stock: 50 }),
      );
      mockTransactionEntityManager.save.mockResolvedValueOnce(
        createMockProduct({ stock: 40 }),
      );

      const result = await service.adjustStock('prod-001', -10);

      expect(result.stock).toBe(40);
    });

    it('should throw ConflictException if stock would go negative', async () => {
      mockTransactionEntityManager.findOne.mockResolvedValueOnce(
        createMockProduct({ stock: 5 }),
      );

      await expect(service.adjustStock('prod-001', -10)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw NotFoundException if product not found in transaction', async () => {
      mockTransactionEntityManager.findOne.mockResolvedValueOnce(null);

      await expect(service.adjustStock('nonexistent', 10)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should update availabilityStatus based on stock level', async () => {
      mockTransactionEntityManager.findOne.mockResolvedValueOnce(
        createMockProduct({ stock: 50 }),
      );
      mockTransactionEntityManager.save.mockImplementation(
        async (entity) => entity as Product,
      );

      await service.adjustStock('prod-001', -50);

      expect(mockTransactionEntityManager.save).toHaveBeenCalledWith(
        expect.objectContaining({ availabilityStatus: 'Out of Stock' }),
      );
    });
  });

  // ── bulkUpdateStock ───────────────────────────────────────────

  describe('bulkUpdateStock', () => {
    it('should update stock for multiple products within a transaction', async () => {
      mockTransactionEntityManager.update.mockResolvedValue({} as any);

      await service.bulkUpdateStock([
        { id: 'prod-001', stock: 100 },
        { id: 'prod-002', stock: 0 },
      ]);

      expect(mockTransactionEntityManager.update).toHaveBeenCalledTimes(2);
      expect(mockTransactionEntityManager.update).toHaveBeenCalledWith(
        Product,
        'prod-001',
        { stock: 100, availabilityStatus: 'In Stock' },
      );
      expect(mockTransactionEntityManager.update).toHaveBeenCalledWith(
        Product,
        'prod-002',
        { stock: 0, availabilityStatus: 'Out of Stock' },
      );
    });
  });

  // ── getPublicCatalog ──────────────────────────────────────────

  describe('getPublicCatalog', () => {
    it('should only return published products', async () => {
      const filters: FilterProductsQueryDto = {
        page: 1,
        limit: 10,
        sortBy: ProductSortField.createdAt,
        sortOrder: SortOrder.DESC,
      };

      await service.getPublicCatalog(filters);

      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'product.isPublished = :isPublished',
        { isPublished: true },
      );
    });

    it('should filter by categorySlug', async () => {
      const filters: FilterProductsQueryDto = {
        page: 1,
        limit: 10,
        categorySlug: 'electronics',
        sortBy: ProductSortField.createdAt,
        sortOrder: SortOrder.DESC,
      };

      await service.getPublicCatalog(filters);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'category.slug = :categorySlug',
        { categorySlug: 'electronics' },
      );
    });
  });

  // ── getByCategorySlug ─────────────────────────────────────────

  describe('getByCategorySlug', () => {
    it('should verify category exists and return products', async () => {
      const filters: FilterProductsQueryDto = {
        page: 1,
        limit: 10,
        sortBy: ProductSortField.createdAt,
        sortOrder: SortOrder.DESC,
      };

      await service.getByCategorySlug('electronics', filters);

      expect(categoriesService.getBySlug).toHaveBeenCalledWith('electronics');
    });
  });
});
