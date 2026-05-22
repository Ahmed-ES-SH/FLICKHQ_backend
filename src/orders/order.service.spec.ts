import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';
import { OrderService } from './order.service';
import { OrderRepository } from './order.repository';
import { OrderStatus } from './types/order-status.enum';
import { Order } from './schema/order.schema';
import { OrderItem } from './schema/order-item.schema';
import { CartResponseDto } from '../cart/dto/cart-response.dto';

describe('OrderService', () => {
  let service: OrderService;

  const mockOrderItem: OrderItem = {
    id: 'order-item-uuid-1',
    orderId: 'order-uuid-1',
    productId: 'product-uuid-1',
    productTitleSnapshot: 'Test Product',
    productThumbnailSnapshot: 'https://example.com/thumb.jpg',
    unitPrice: 2999,
    quantity: 2,
    subtotal: 5998,
    currency: 'usd',
    metadataSnapshot: {},
    createdAt: new Date(),
  } as OrderItem;

  const mockOrder: Order = {
    id: 'order-uuid-1',
    userId: 'user-uuid-1',
    status: OrderStatus.AWAITING_CHECKOUT_SESSION,
    subtotal: 5998,
    taxAmount: 0,
    discountAmount: 0,
    totalAmount: 5998,
    currency: 'usd',
    paymentId: null,
    stripeCheckoutSessionId: null,
    stripePaymentIntentId: null,
    reservationExpiresAt: new Date(Date.now() + 20 * 60 * 1000),
    items: [mockOrderItem],
    payment: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Order;

  const mockCart: CartResponseDto = {
    id: 'cart-uuid-1',
    userId: 'user-uuid-1',
    items: [
      {
        id: 'cart-item-uuid-1',
        productId: 'product-uuid-1',
        productTitle: 'Test Product',
        productThumbnail: 'https://example.com/thumb.jpg',
        unitPrice: 2999,
        quantity: 2,
        subtotal: 5998,
        availableStock: 10,
      },
    ],
    totalItems: 2,
    subtotal: 5998,
    currency: 'usd',
  };

  const mockQueryRunner = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    manager: {
      save: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      getRepository: jest.fn(),
    },
  };

  const mockOrderRepository = {
    findByUserId: jest.fn(),
    findByIdWithItems: jest.fn(),
    findByIdWithItemsAndUser: jest.fn(),
    findByStripeSessionId: jest.fn(),
    findByIdForUpdate: jest.fn(),
    createOrder: jest.fn(),
    createOrderItems: jest.fn(),
    updateStatusWithValidation: jest.fn(),
    findExpiredReservations: jest.fn(),
  };

  const mockDataSource = {
    createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderService,
        {
          provide: OrderRepository,
          useValue: mockOrderRepository,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    service = module.get<OrderService>(OrderService);
    orderRepository = module.get<OrderRepository>(OrderRepository);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createOrderFromCart', () => {
    it('should create order from cart with AWAITING_CHECKOUT_SESSION status', async () => {
      const savedOrder = {
        id: 'order-uuid-1',
        userId: 'user-uuid-1',
        status: OrderStatus.AWAITING_CHECKOUT_SESSION,
        subtotal: 5998,
        taxAmount: 0,
        discountAmount: 0,
        totalAmount: 5998,
        currency: 'usd',
        paymentId: null,
        stripeCheckoutSessionId: null,
        reservationExpiresAt: new Date(Date.now() + 20 * 60 * 1000),
      };
      // create() returns the entity, save() returns the saved entity
      /* eslint-disable @typescript-eslint/no-unsafe-return */
      mockQueryRunner.manager.create.mockImplementation(
        (_entity: any, data: any) => ({
          ...data,
          id: 'order-uuid-1',
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-return */
      mockQueryRunner.manager.save.mockResolvedValue(savedOrder);

      const result = await service.createOrderFromCart(
        'user-uuid-1',
        mockCart,
        mockQueryRunner,
      );

      expect(result).toBeDefined();
      expect(result.status).toBe(OrderStatus.AWAITING_CHECKOUT_SESSION);
      expect(result.subtotal).toBe(5998);
      expect(result.totalAmount).toBe(5998);
      // Order save + OrderItem save = 2 calls
      expect(mockQueryRunner.manager.save).toHaveBeenCalledTimes(2);
      // Order.create + OrderItem.create = 2 create calls
      expect(mockQueryRunner.manager.create).toHaveBeenCalledTimes(2);
    });

    it('should create OrderItem entities for each cart item', async () => {
      const savedOrder = { id: 'order-uuid-1' };

      /* eslint-disable @typescript-eslint/no-unsafe-return */
      mockQueryRunner.manager.create.mockImplementation(
        (_entity: any, data: any) => ({
          ...data,
          id: 'order-uuid-1',
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-return */
      mockQueryRunner.manager.save.mockResolvedValue(savedOrder);

      await service.createOrderFromCart(
        'user-uuid-1',
        mockCart,
        mockQueryRunner,
      );

      // First create call should be for Order entity
      /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
      const orderCreateCall = (mockQueryRunner.manager.create as any).mock
        .calls[0];
      expect(orderCreateCall[0]).toBe(Order);
      /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */

      // Second create call should be for OrderItem entities
      /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
      const itemCreateCall = (mockQueryRunner.manager.create as any).mock
        .calls[1];
      expect(itemCreateCall[0]).toBe(OrderItem);
      /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
    });
  });

  describe('markOrderPendingPayment', () => {
    it('should transition order to PENDING_PAYMENT', async () => {
      mockOrderRepository.updateStatusWithValidation.mockResolvedValue({
        ...mockOrder,
        status: OrderStatus.PENDING_PAYMENT,
      });
      mockQueryRunner.manager.update.mockResolvedValue({ affected: 1 });
      mockOrderRepository.findByIdWithItems.mockResolvedValue({
        ...mockOrder,
        status: OrderStatus.PENDING_PAYMENT,
        stripeCheckoutSessionId: 'cs_test_123',
      });

      const result = await service.markOrderPendingPayment(
        'order-uuid-1',
        'cs_test_123',
      );

      expect(result.status).toBe(OrderStatus.PENDING_PAYMENT);
      expect(
        mockOrderRepository.updateStatusWithValidation,
      ).toHaveBeenCalledWith(
        'order-uuid-1',
        OrderStatus.PENDING_PAYMENT,
        mockQueryRunner,
      );
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    });

    it('should rollback on error', async () => {
      mockOrderRepository.updateStatusWithValidation.mockRejectedValue(
        new Error('DB error'),
      );

      await expect(
        service.markOrderPendingPayment('order-uuid-1', 'cs_test_123'),
      ).rejects.toThrow('DB error');

      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
    });

    it('should use provided QueryRunner instead of creating own transaction', async () => {
      mockOrderRepository.updateStatusWithValidation.mockResolvedValue({
        ...mockOrder,
        status: OrderStatus.PENDING_PAYMENT,
      });
      mockQueryRunner.manager.update.mockResolvedValue({ affected: 1 });
      mockOrderRepository.findByIdWithItems.mockResolvedValue({
        ...mockOrder,
        status: OrderStatus.PENDING_PAYMENT,
        stripeCheckoutSessionId: 'cs_test_123',
      });

      const externalQr = {
        manager: mockQueryRunner.manager,
      } as unknown as QueryRunner;

      await service.markOrderPendingPayment(
        'order-uuid-1',
        'cs_test_123',
        externalQr,
      );

      // Should NOT create a new query runner when one is provided
      expect(mockDataSource.createQueryRunner).not.toHaveBeenCalled();
      expect(
        mockOrderRepository.updateStatusWithValidation,
      ).toHaveBeenCalledWith(
        'order-uuid-1',
        OrderStatus.PENDING_PAYMENT,
        externalQr,
      );
    });
  });

  describe('markOrderPaidWithLock', () => {
    it('should mark order as PAID when in valid state', async () => {
      mockOrderRepository.findByIdForUpdate.mockResolvedValue({
        ...mockOrder,
        status: OrderStatus.PENDING_PAYMENT,
      });
      mockQueryRunner.manager.update.mockResolvedValue({ affected: 1 });
      mockOrderRepository.findByIdWithItems.mockResolvedValue({
        ...mockOrder,
        status: OrderStatus.PAID,
        paymentId: 'payment-uuid-1',
      });

      const result = await service.markOrderPaidWithLock(
        'order-uuid-1',
        'payment-uuid-1',
        mockQueryRunner,
      );

      expect(result.status).toBe(OrderStatus.PAID);
      expect(mockQueryRunner.manager.update).toHaveBeenCalledWith(
        Order,
        'order-uuid-1',
        {
          status: OrderStatus.PAID,
          paymentId: 'payment-uuid-1',
        },
      );
    });

    it('should be idempotent when order is already PAID', async () => {
      mockOrderRepository.findByIdForUpdate.mockResolvedValue({
        ...mockOrder,
        status: OrderStatus.PAID,
      });
      mockOrderRepository.findByIdWithItems.mockResolvedValue({
        ...mockOrder,
        status: OrderStatus.PAID,
      });

      const result = await service.markOrderPaidWithLock(
        'order-uuid-1',
        'payment-uuid-1',
        mockQueryRunner,
      );

      expect(result.status).toBe(OrderStatus.PAID);
      expect(mockQueryRunner.manager.update).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when order not found', async () => {
      mockOrderRepository.findByIdForUpdate.mockResolvedValue(null);

      await expect(
        service.markOrderPaidWithLock(
          'order-uuid-1',
          'payment-uuid-1',
          mockQueryRunner,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw Error for invalid state transition', async () => {
      mockOrderRepository.findByIdForUpdate.mockResolvedValue({
        ...mockOrder,
        status: OrderStatus.FAILED,
      });

      await expect(
        service.markOrderPaidWithLock(
          'order-uuid-1',
          'payment-uuid-1',
          mockQueryRunner,
        ),
      ).rejects.toThrow('Cannot mark order');
    });
  });

  describe('markOrderFailed', () => {
    it('should mark order as FAILED', async () => {
      mockOrderRepository.updateStatusWithValidation.mockResolvedValue({
        ...mockOrder,
        status: OrderStatus.FAILED,
      });
      mockOrderRepository.findByIdWithItems.mockResolvedValue({
        ...mockOrder,
        status: OrderStatus.FAILED,
      });

      const result = await service.markOrderFailed(
        'order-uuid-1',
        'Payment declined',
      );

      expect(result.status).toBe(OrderStatus.FAILED);
      expect(
        mockOrderRepository.updateStatusWithValidation,
      ).toHaveBeenCalledWith(
        'order-uuid-1',
        OrderStatus.FAILED,
        mockQueryRunner,
      );
    });
  });

  describe('markOrderExpired', () => {
    it('should mark order as EXPIRED', async () => {
      mockOrderRepository.updateStatusWithValidation.mockResolvedValue({
        ...mockOrder,
        status: OrderStatus.EXPIRED,
      });
      mockOrderRepository.findByIdWithItems.mockResolvedValue({
        ...mockOrder,
        status: OrderStatus.EXPIRED,
      });

      const result = await service.markOrderExpired('order-uuid-1');

      expect(result.status).toBe(OrderStatus.EXPIRED);
    });
  });

  describe('markOrderRefunded', () => {
    it('should mark order as REFUNDED from PAID status', async () => {
      mockOrderRepository.updateStatusWithValidation.mockResolvedValue({
        ...mockOrder,
        status: OrderStatus.PAID,
      });
      mockOrderRepository.findByIdWithItems.mockResolvedValue({
        ...mockOrder,
        status: OrderStatus.REFUNDED,
      });

      const result = await service.markOrderRefunded('order-uuid-1');

      expect(result.status).toBe(OrderStatus.REFUNDED);
    });
  });

  describe('getOrderHistory', () => {
    it('should return paginated order history', async () => {
      mockOrderRepository.findByUserId.mockResolvedValue([[mockOrder], 1]);

      const result = await service.getOrderHistory('user-uuid-1', 1, 10);

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
      expect(result.totalPages).toBe(1);
    });

    it('should handle empty order history', async () => {
      mockOrderRepository.findByUserId.mockResolvedValue([[], 0]);

      const result = await service.getOrderHistory('user-uuid-1');

      expect(result.data).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  describe('getOrderById', () => {
    it('should return order when found and owned by user', async () => {
      mockOrderRepository.findByIdWithItemsAndUser.mockResolvedValue(mockOrder);

      const result = await service.getOrderById('user-uuid-1', 'order-uuid-1');

      expect(result.id).toBe('order-uuid-1');
      expect(result.userId).toBe('user-uuid-1');
      expect(mockOrderRepository.findByIdWithItemsAndUser).toHaveBeenCalledWith(
        'order-uuid-1',
        'user-uuid-1',
      );
    });

    it('should throw NotFoundException when order not found', async () => {
      mockOrderRepository.findByIdWithItemsAndUser.mockResolvedValue(null);

      await expect(
        service.getOrderById('user-uuid-1', 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when user does not own order (compound where)', async () => {
      // The compound where clause means a different user's order returns null
      mockOrderRepository.findByIdWithItemsAndUser.mockResolvedValue(null);

      await expect(
        service.getOrderById('user-uuid-1', 'order-uuid-1'),
      ).rejects.toThrow(NotFoundException);

      // Verifies the compound where was used — not a separate ownership check
      expect(mockOrderRepository.findByIdWithItemsAndUser).toHaveBeenCalledWith(
        'order-uuid-1',
        'user-uuid-1',
      );
    });
  });
});
