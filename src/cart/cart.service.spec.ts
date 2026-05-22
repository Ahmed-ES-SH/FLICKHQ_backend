import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CartService } from './cart.service';
import { CartRepository } from './cart.repository';
import { AddToCartDto } from './dto/add-to-cart.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { Product } from '../products/schema/product.schema';
import { Cart } from './schema/cart.schema';
import { CartItem } from './schema/cart-item.schema';

describe('CartService', () => {
  let service: CartService;

  const mockProduct: Partial<Product> = {
    id: 'product-uuid-1',
    title: 'Test Product',
    slug: 'test-product',
    description: 'A test product',
    price: 29.99,
    stock: 10,
    isPublished: true,
    deletedAt: null,
    thumbnail: 'https://example.com/thumb.jpg',
  };

  const mockCart: Partial<Cart> = {
    id: 'cart-uuid-1',
    userId: 'user-uuid-1',
    items: [],
  };

  const mockCartItem: Partial<CartItem> = {
    id: 'cart-item-uuid-1',
    cartId: 'cart-uuid-1',
    productId: 'product-uuid-1',
    product: mockProduct as Product,
    quantity: 2,
  };

  const mockCartRepository = {
    findByUserIdWithItems: jest.fn(),
    findOrCreate: jest.fn(),
    addItem: jest.fn(),
    updateItemQuantity: jest.fn(),
    removeItem: jest.fn(),
    clearCart: jest.fn(),
    getCartItemCount: jest.fn(),
  };

  const mockProductRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CartService,
        {
          provide: CartRepository,
          useValue: mockCartRepository,
        },
        {
          provide: getRepositoryToken(Product),
          useValue: mockProductRepo,
        },
      ],
    }).compile();

    service = module.get<CartService>(CartService);
    cartRepository = module.get<CartRepository>(CartRepository);
    productRepo = module.get<Repository<Product>>(getRepositoryToken(Product));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('addToCart', () => {
    const addToCartDto: AddToCartDto = {
      productId: 'product-uuid-1',
      quantity: 2,
    };

    it('should add item to cart successfully', async () => {
      mockProductRepo.findOne.mockResolvedValue(mockProduct);
      mockCartRepository.getCartItemCount.mockResolvedValue(0);
      mockCartRepository.findOrCreate.mockResolvedValue(mockCart);
      mockCartRepository.addItem.mockResolvedValue(mockCartItem);
      mockCartRepository.findByUserIdWithItems.mockResolvedValue({
        ...mockCart,
        items: [mockCartItem],
      });

      const result = await service.addToCart('user-uuid-1', addToCartDto);

      expect(result).toBeDefined();
      expect(result.userId).toBe('user-uuid-1');
      expect(result.items).toHaveLength(1);
      expect(result.subtotal).toBe(5998);
      expect(mockCartRepository.addItem).toHaveBeenCalledWith(
        'cart-uuid-1',
        'product-uuid-1',
        2,
      );
    });

    it('should throw NotFoundException when product does not exist', async () => {
      mockProductRepo.findOne.mockResolvedValue(null);

      await expect(
        service.addToCart('user-uuid-1', addToCartDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when product is not published', async () => {
      mockProductRepo.findOne.mockResolvedValue({
        ...mockProduct,
        isPublished: false,
      });

      await expect(
        service.addToCart('user-uuid-1', addToCartDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when product is soft deleted', async () => {
      mockProductRepo.findOne.mockResolvedValue({
        ...mockProduct,
        deletedAt: new Date(),
      });

      await expect(
        service.addToCart('user-uuid-1', addToCartDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when insufficient stock', async () => {
      mockProductRepo.findOne.mockResolvedValue({
        ...mockProduct,
        stock: 1,
      });

      await expect(
        service.addToCart('user-uuid-1', addToCartDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when cart limit exceeded', async () => {
      mockProductRepo.findOne.mockResolvedValue(mockProduct);
      // 49 items already, adding 2 exceeds limit of 50
      mockCartRepository.getCartItemCount.mockResolvedValue(49);

      await expect(
        service.addToCart('user-uuid-1', addToCartDto),
      ).rejects.toThrow('Cart limit exceeded');
    });
  });

  describe('updateCartItem', () => {
    const updateDto: UpdateCartItemDto = { quantity: 3 };

    it('should update cart item quantity successfully', async () => {
      mockCartRepository.findByUserIdWithItems.mockResolvedValue(mockCart);
      mockProductRepo.findOne.mockResolvedValue(mockProduct);
      mockCartRepository.updateItemQuantity.mockResolvedValue(mockCartItem);
      mockCartRepository.findByUserIdWithItems.mockResolvedValueOnce(mockCart);
      mockCartRepository.findByUserIdWithItems.mockResolvedValueOnce({
        ...mockCart,
        items: [mockCartItem],
      });

      const result = await service.updateCartItem(
        'user-uuid-1',
        'product-uuid-1',
        updateDto,
      );

      expect(result).toBeDefined();
      expect(mockCartRepository.updateItemQuantity).toHaveBeenCalledWith(
        'cart-uuid-1',
        'product-uuid-1',
        3,
      );
    });

    it('should throw NotFoundException when cart not found', async () => {
      mockCartRepository.findByUserIdWithItems.mockResolvedValue(null);

      await expect(
        service.updateCartItem('user-uuid-1', 'product-uuid-1', updateDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when product not found', async () => {
      mockCartRepository.findByUserIdWithItems.mockResolvedValue(mockCart);
      mockProductRepo.findOne.mockResolvedValue(null);

      await expect(
        service.updateCartItem('user-uuid-1', 'product-uuid-1', updateDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when insufficient stock', async () => {
      mockCartRepository.findByUserIdWithItems.mockResolvedValue(mockCart);
      mockProductRepo.findOne.mockResolvedValue({
        ...mockProduct,
        stock: 1,
      });

      await expect(
        service.updateCartItem('user-uuid-1', 'product-uuid-1', updateDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when cart item not found', async () => {
      mockCartRepository.findByUserIdWithItems.mockResolvedValue(mockCart);
      mockProductRepo.findOne.mockResolvedValue(mockProduct);
      mockCartRepository.updateItemQuantity.mockResolvedValue(null);

      await expect(
        service.updateCartItem('user-uuid-1', 'product-uuid-1', updateDto),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('removeFromCart', () => {
    it('should remove item from cart successfully', async () => {
      mockCartRepository.findByUserIdWithItems.mockResolvedValue(mockCart);
      mockCartRepository.removeItem.mockResolvedValue(undefined);
      mockCartRepository.findByUserIdWithItems.mockResolvedValueOnce(mockCart);
      mockCartRepository.findByUserIdWithItems.mockResolvedValueOnce({
        ...mockCart,
        items: [],
      });

      const result = await service.removeFromCart(
        'user-uuid-1',
        'product-uuid-1',
      );

      expect(result).toBeDefined();
      expect(mockCartRepository.removeItem).toHaveBeenCalledWith(
        'cart-uuid-1',
        'product-uuid-1',
      );
    });

    it('should throw NotFoundException when cart not found', async () => {
      mockCartRepository.findByUserIdWithItems.mockResolvedValue(null);

      await expect(
        service.removeFromCart('user-uuid-1', 'product-uuid-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('clearCart', () => {
    it('should clear cart successfully', async () => {
      mockCartRepository.findByUserIdWithItems.mockResolvedValue(mockCart);
      mockCartRepository.clearCart.mockResolvedValue(undefined);

      await service.clearCart('user-uuid-1');

      expect(mockCartRepository.clearCart).toHaveBeenCalledWith('cart-uuid-1');
    });

    it('should be idempotent when cart is empty/missing (no error)', async () => {
      mockCartRepository.findByUserIdWithItems.mockResolvedValue(null);

      // Should NOT throw — idempotent behavior
      await expect(service.clearCart('user-uuid-1')).resolves.not.toThrow();

      expect(mockCartRepository.clearCart).not.toHaveBeenCalled();
    });
  });

  describe('getCart', () => {
    it('should return empty cart when user has no cart', async () => {
      mockCartRepository.findByUserIdWithItems.mockResolvedValue(null);
      mockCartRepository.findOrCreate.mockResolvedValue(mockCart);

      const result = await service.getCart('user-uuid-1');

      expect(result).toBeDefined();
      expect(result.items).toHaveLength(0);
      expect(result.totalItems).toBe(0);
      expect(result.subtotal).toBe(0);
      expect(result.currency).toBe('usd');
    });

    it('should return cart with items and calculated totals', async () => {
      const cartWithItems = {
        ...mockCart,
        items: [
          {
            ...mockCartItem,
            quantity: 2,
            product: mockProduct,
          },
          {
            ...mockCartItem,
            id: 'cart-item-uuid-2',
            productId: 'product-uuid-2',
            quantity: 1,
            product: {
              ...mockProduct,
              id: 'product-uuid-2',
              title: 'Another Product',
              price: 49.99,
            },
          },
        ],
      };
      mockCartRepository.findByUserIdWithItems.mockResolvedValue(cartWithItems);

      const result = await service.getCart('user-uuid-1');

      expect(result.items).toHaveLength(2);
      expect(result.totalItems).toBe(3);
      expect(result.subtotal).toBe(5998 + 4999);
      expect(result.items[0]!.unitPrice).toBe(2999);
      expect(result.items[0]!.subtotal).toBe(5998);
    });
  });

  describe('validateCartForCheckout', () => {
    it('should return invalid when cart is empty', async () => {
      mockCartRepository.findByUserIdWithItems.mockResolvedValue({
        ...mockCart,
        items: [],
      });

      const result = await service.validateCartForCheckout('user-uuid-1');

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Cart is empty');
      expect(result.cart).toBeNull();
    });

    it('should return invalid when cart is null', async () => {
      mockCartRepository.findByUserIdWithItems.mockResolvedValue(null);

      const result = await service.validateCartForCheckout('user-uuid-1');

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Cart is empty');
    });

    it('should return valid when all products are available with sufficient stock', async () => {
      const cartWithItems = {
        ...mockCart,
        items: [mockCartItem],
      };
      mockCartRepository.findByUserIdWithItems.mockResolvedValue(cartWithItems);
      mockProductRepo.find.mockResolvedValue([mockProduct]);
      mockCartRepository.findByUserIdWithItems.mockResolvedValueOnce({
        ...mockCart,
        items: [mockCartItem],
      });

      const result = await service.validateCartForCheckout('user-uuid-1');

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.cart).not.toBeNull();
    });

    it('should return errors when product no longer exists', async () => {
      const cartWithItems = {
        ...mockCart,
        items: [mockCartItem],
      };
      mockCartRepository.findByUserIdWithItems.mockResolvedValue(cartWithItems);
      mockProductRepo.find.mockResolvedValue([]);

      const result = await service.validateCartForCheckout('user-uuid-1');

      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain('no longer exists');
    });

    it('should return errors when product is not published', async () => {
      const cartWithItems = {
        ...mockCart,
        items: [mockCartItem],
      };
      mockCartRepository.findByUserIdWithItems.mockResolvedValue(cartWithItems);
      mockProductRepo.find.mockResolvedValue([
        { ...mockProduct, isPublished: false },
      ]);

      const result = await service.validateCartForCheckout('user-uuid-1');

      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain('no longer available');
    });

    it('should return errors when insufficient stock', async () => {
      const cartWithItems = {
        ...mockCart,
        items: [{ ...mockCartItem, quantity: 100 }],
      };
      mockCartRepository.findByUserIdWithItems.mockResolvedValue(cartWithItems);
      mockProductRepo.find.mockResolvedValue([mockProduct]);

      const result = await service.validateCartForCheckout('user-uuid-1');

      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain('Insufficient stock');
    });
  });
});
