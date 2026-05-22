import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { PaymentsService } from './payments.service';
import { PaymentsRepository } from './payments.repository';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';
import { PaymentStatus } from './schema/payment-status.enum';
import { Payment } from './schema/payment.schema';
import { OrderService } from '../orders/order.service';
import { CartService } from '../cart/cart.service';
import { OrderStatus } from '../orders/types/order-status.enum';

jest.mock('../config/pricing.config', () => ({
  getProductPrice: jest.fn((productType: string) => {
    const pricing: Record<
      string,
      {
        amount: number;
        currency: string;
        description: string;
        productType: string;
      }
    > = {
      premium_monthly: {
        amount: 999,
        currency: 'usd',
        description: 'Premium Monthly Subscription',
        productType: 'premium_monthly',
      },
      premium_yearly: {
        amount: 7999,
        currency: 'usd',
        description: 'Premium Yearly Subscription',
        productType: 'premium_yearly',
      },
    };
    return pricing[productType] || null;
  }),
}));

// Proper StripeError subclass for instanceof checks
class MockStripeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StripeError';
  }
}

describe('PaymentsService', () => {
  let service: PaymentsService;

  // Type-safe access to private method for testing

  type PrivateMethods = {
    handleCheckoutSessionCompleted: (session: any) => Promise<void>;
  };
  const invokePrivateHandler = (
    session: Parameters<PrivateMethods['handleCheckoutSessionCompleted']>[0],
  ) =>
    (service as unknown as PrivateMethods).handleCheckoutSessionCompleted(
      session,
    );

  const mockStripeClient = {
    paymentIntents: {
      create: jest.fn(),
      retrieve: jest.fn(),
    },
    customers: {
      create: jest.fn(),
    },
    checkout: {
      sessions: {
        create: jest.fn(),
      },
    },
    webhooks: {
      constructEvent: jest.fn(),
    },
    errors: {
      StripeError: MockStripeError,
    },
  };

  const mockPaymentsRepository = {
    findByIdempotencyKey: jest.fn(),
    findByStripePaymentIntent: jest.fn(),
    findByUser: jest.fn(),
    create: jest.fn(),
    updateStatus: jest.fn(),
    findStalePendingPayments: jest.fn(),
  };

  const mockQueryRunner = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    manager: {
      findOne: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockDataSource = {
    createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
  };

  const mockEventEmitter = {
    emit: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'STRIPE_WEBHOOK_SECRET') {
        return 'whsec_test_webhook_secret';
      }
      return undefined;
    }),
  };

  const mockNotificationsGateway = {
    emitPaymentStatus: jest.fn(),
  };

  const mockOrderService = {
    createOrderFromCart: jest.fn(),
    markOrderPendingPayment: jest.fn(),
    markOrderPaidWithLock: jest.fn(),
  };

  const mockCartService = {
    validateCartForCheckout: jest.fn(),
    clearCart: jest.fn(),
  };

  const mockPayment = {
    id: 'payment-uuid-1',
    userId: '1',
    stripePaymentIntent: 'pi_test_123',
    stripeChargeId: undefined,
    amount: 999,
    currency: 'usd',
    status: PaymentStatus.PENDING,
    description: 'Premium Monthly Subscription',
    metadata: {},
    idempotencyKey: 'test-idempotency-key',
    orderId: null,
    order: null,
    stripeCheckoutSessionId: null,
    lineItemsSnapshot: null,
    paymentType: 'ecommerce' as never,
    refunds: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Payment;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockConfigService.get.mockImplementation((key: string) => {
      if (key === 'STRIPE_WEBHOOK_SECRET') {
        return 'whsec_test_webhook_secret';
      }
      return undefined;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        {
          provide: 'STRIPE_CLIENT',
          useValue: mockStripeClient,
        },
        {
          provide: PaymentsRepository,
          useValue: mockPaymentsRepository,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: EventEmitter2,
          useValue: mockEventEmitter,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: NotificationsGateway,
          useValue: mockNotificationsGateway,
        },
        {
          provide: OrderService,
          useValue: mockOrderService,
        },
        {
          provide: CartService,
          useValue: mockCartService,
        },
      ],
    }).compile();

    // Suppress Logger output during tests
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

    service = module.get<PaymentsService>(PaymentsService);
    paymentsRepository = module.get<PaymentsRepository>(PaymentsRepository);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createPaymentIntent', () => {
    const createDto: CreatePaymentIntentDto = {
      productType: 'premium_monthly',
    };

    it('should create payment intent successfully', async () => {
      mockPaymentsRepository.findByIdempotencyKey.mockResolvedValue(null);
      mockQueryRunner.manager.findOne.mockResolvedValue({
        id: 1,
        email: 'test@example.com',
        name: 'Test User',
        stripeCustomerId: null,
      });

      mockStripeClient.customers.create.mockResolvedValue({
        id: 'cus_test_123',
      });

      mockStripeClient.paymentIntents.create.mockResolvedValue({
        id: 'pi_test_123',
        client_secret: 'pi_test_123_secret',
      });

      mockPaymentsRepository.create.mockResolvedValue(mockPayment);

      const result = await service.createPaymentIntent('1', createDto);

      expect(result).toBeDefined();
      expect(result.isExisting).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect((result as any).clientSecret).toBe('pi_test_123_secret');
      expect(result.paymentIntentId).toBe('pi_test_123');
      expect(result.amount).toBe(999);
      expect(result.currency).toBe('usd');
      expect(mockStripeClient.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 999,
          currency: 'usd',
          customer: 'cus_test_123',
        }),
      );
    });

    it('should throw BadRequestException for invalid product type', async () => {
      const invalidDto = {
        productType: 'invalid_product',
      } as unknown as CreatePaymentIntentDto;

      await expect(
        service.createPaymentIntent('1', invalidDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when user not found', async () => {
      mockPaymentsRepository.findByIdempotencyKey.mockResolvedValue(null);
      mockQueryRunner.manager.findOne.mockResolvedValue(null);

      await expect(service.createPaymentIntent('1', createDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException for non-numeric user ID', async () => {
      await expect(
        service.createPaymentIntent('not-a-number', createDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('should return existing payment for duplicate idempotency key', async () => {
      mockPaymentsRepository.findByIdempotencyKey.mockResolvedValue({
        ...mockPayment,
        status: PaymentStatus.PENDING,
      });
      mockQueryRunner.manager.findOne.mockResolvedValue({
        id: 1,
        email: 'test@example.com',
        stripeCustomerId: 'cus_existing',
      });

      const result = await service.createPaymentIntent('1', createDto);

      expect(result.isExisting).toBe(true);
      expect(result.paymentIntentId).toBe('pi_test_123');
      expect(mockStripeClient.paymentIntents.create).not.toHaveBeenCalled();
    });

    it('should rollback transaction on Stripe error', async () => {
      mockPaymentsRepository.findByIdempotencyKey.mockResolvedValue(null);
      mockQueryRunner.manager.findOne.mockResolvedValue({
        id: 1,
        email: 'test@example.com',
        stripeCustomerId: 'cus_test_123',
      });

      // Use the mock StripeError class — in unit tests this won't pass
      // instanceof Stripe.errors.StripeError (real class), so it falls
      // through to InternalServerErrorException. The key assertion is
      // that the transaction is rolled back and the query runner released.
      const stripeError = new mockStripeClient.errors.StripeError(
        'Card declined',
      );
      mockStripeClient.paymentIntents.create.mockRejectedValue(stripeError);

      await expect(service.createPaymentIntent('1', createDto)).rejects.toThrow(
        InternalServerErrorException,
      );

      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
    });
  });

  describe('handleWebhook', () => {
    it('should throw InternalServerErrorException when webhook secret not configured', async () => {
      mockConfigService.get.mockReturnValue(undefined);

      await expect(
        service.handleWebhook(Buffer.from('{}'), 'sig_test'),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('should throw BadRequestException for invalid signature', async () => {
      mockStripeClient.webhooks.constructEvent.mockImplementation(() => {
        throw new Error('Invalid signature');
      });

      await expect(
        service.handleWebhook(Buffer.from('{}'), 'sig_invalid'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should handle payment_intent.succeeded event', async () => {
      const mockEvent = {
        id: 'evt_test_123',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_test_123',
            object: 'payment_intent',
            status: 'succeeded',
            metadata: { userId: '1' },
            latest_charge: 'ch_test_123',
          },
        },
      };

      mockStripeClient.webhooks.constructEvent.mockReturnValue(mockEvent);
      mockPaymentsRepository.findByStripePaymentIntent.mockResolvedValue(
        mockPayment,
      );
      mockQueryRunner.manager.update.mockResolvedValue({ affected: 1 });

      await service.handleWebhook(Buffer.from('{}'), 'sig_valid');

      expect(mockQueryRunner.manager.update).toHaveBeenCalledWith(
        expect.anything(),
        'payment-uuid-1',
        expect.objectContaining({
          status: PaymentStatus.SUCCEEDED,
        }),
      );
      expect(mockEventEmitter.emit).toHaveBeenCalled();
      expect(mockNotificationsGateway.emitPaymentStatus).toHaveBeenCalled();
    });

    it('should handle payment_intent.payment_failed event', async () => {
      const mockEvent = {
        id: 'evt_test_123',
        type: 'payment_intent.payment_failed',
        data: {
          object: {
            id: 'pi_test_123',
            object: 'payment_intent',
            status: 'failed',
            metadata: { userId: '1' },
            last_payment_error: { message: 'Card declined' },
          },
        },
      };

      mockStripeClient.webhooks.constructEvent.mockReturnValue(mockEvent);
      mockPaymentsRepository.findByStripePaymentIntent.mockResolvedValue(
        mockPayment,
      );
      mockPaymentsRepository.updateStatus.mockResolvedValue({
        ...mockPayment,
        status: PaymentStatus.FAILED,
      });

      await service.handleWebhook(Buffer.from('{}'), 'sig_valid');

      expect(mockPaymentsRepository.updateStatus).toHaveBeenCalledWith(
        'payment-uuid-1',
        PaymentStatus.FAILED,
        expect.any(Object),
      );
    });

    it('should handle charge.refunded event', async () => {
      const mockEvent = {
        id: 'evt_test_123',
        type: 'charge.refunded',
        data: {
          object: {
            id: 'ch_test_123',
            object: 'charge',
            payment_intent: 'pi_test_123',
            refunded: true,
          },
        },
      };

      mockStripeClient.webhooks.constructEvent.mockReturnValue(mockEvent);
      mockPaymentsRepository.findByStripePaymentIntent.mockResolvedValue(
        mockPayment,
      );
      mockQueryRunner.manager.update.mockResolvedValue({ affected: 1 });

      await service.handleWebhook(Buffer.from('{}'), 'sig_valid');

      expect(mockQueryRunner.manager.update).toHaveBeenCalledWith(
        expect.anything(),
        'payment-uuid-1',
        expect.objectContaining({
          status: PaymentStatus.REFUNDED,
        }),
      );
    });

    it('should skip premium activation when payment record not found (replay attack prevention)', async () => {
      const mockEvent = {
        id: 'evt_test_123',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_unknown',
            object: 'payment_intent',
            status: 'succeeded',
            metadata: { userId: '1' },
            latest_charge: null,
          },
        },
      };

      mockStripeClient.webhooks.constructEvent.mockReturnValue(mockEvent);
      mockPaymentsRepository.findByStripePaymentIntent.mockResolvedValue(null);

      await service.handleWebhook(Buffer.from('{}'), 'sig_valid');

      // Should NOT update user premium when no payment record exists
      expect(mockQueryRunner.manager.update).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ isPremium: true }),
      );
    });

    it('should re-throw error on payment intent succeeded failure so Stripe retries', async () => {
      const mockEvent = {
        id: 'evt_test_123',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_test_123',
            object: 'payment_intent',
            status: 'succeeded',
            metadata: { userId: '1' },
            latest_charge: 'ch_test_123',
          },
        },
      };

      mockStripeClient.webhooks.constructEvent.mockReturnValue(mockEvent);
      mockPaymentsRepository.findByStripePaymentIntent.mockResolvedValue(
        mockPayment,
      );
      mockQueryRunner.manager.update.mockRejectedValue(
        new Error('DB connection lost'),
      );

      await expect(
        service.handleWebhook(Buffer.from('{}'), 'sig_valid'),
      ).rejects.toThrow('DB connection lost');

      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });
  });

  describe('getPaymentHistory', () => {
    it('should return paginated payment history', async () => {
      mockPaymentsRepository.findByUser.mockResolvedValue([[mockPayment], 1]);

      const result = await service.getPaymentHistory('1', 1, 10);

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
      expect(result.totalPages).toBe(1);
    });

    it('should handle empty payment history', async () => {
      mockPaymentsRepository.findByUser.mockResolvedValue([[], 0]);

      const result = await service.getPaymentHistory('1');

      expect(result.data).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  describe('reconcilePendingPaymentsManually', () => {
    it('should reconcile stale pending payments in parallel', async () => {
      mockPaymentsRepository.findStalePendingPayments.mockResolvedValue([
        mockPayment,
      ]);

      mockStripeClient.paymentIntents.retrieve.mockResolvedValue({
        id: 'pi_test_123',
        status: 'succeeded',
        metadata: { userId: '1' },
        latest_charge: 'ch_test_123',
      });

      mockPaymentsRepository.findByStripePaymentIntent.mockResolvedValue(
        mockPayment,
      );
      mockQueryRunner.manager.update.mockResolvedValue({ affected: 1 });

      await service.reconcilePendingPaymentsManually();

      expect(mockStripeClient.paymentIntents.retrieve).toHaveBeenCalledWith(
        'pi_test_123',
      );
    });

    it('should mark payment as failed when canceled', async () => {
      mockPaymentsRepository.findStalePendingPayments.mockResolvedValue([
        mockPayment,
      ]);

      mockStripeClient.paymentIntents.retrieve.mockResolvedValue({
        id: 'pi_test_123',
        status: 'canceled',
        metadata: {},
        latest_charge: null,
      });

      mockPaymentsRepository.updateStatus.mockResolvedValue({
        ...mockPayment,
        status: PaymentStatus.FAILED,
      });

      await service.reconcilePendingPaymentsManually();

      expect(mockPaymentsRepository.updateStatus).toHaveBeenCalledWith(
        'payment-uuid-1',
        PaymentStatus.FAILED,
        expect.any(Object),
      );
    });

    it('should handle retrieval errors gracefully without throwing', async () => {
      mockPaymentsRepository.findStalePendingPayments.mockResolvedValue([
        mockPayment,
      ]);

      mockStripeClient.paymentIntents.retrieve.mockRejectedValue(
        new Error('Stripe API error'),
      );

      await expect(
        service.reconcilePendingPaymentsManually(),
      ).resolves.not.toThrow();
    });
  });

  describe('createCheckoutSession', () => {
    const checkoutDto: CreateCheckoutSessionDto = {};

    const mockCart = {
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

    const mockOrder = {
      id: 'order-uuid-1',
      userId: 'user-uuid-1',
      status: OrderStatus.AWAITING_CHECKOUT_SESSION,
    };

    it('should create checkout session successfully', async () => {
      mockCartService.validateCartForCheckout.mockResolvedValue({
        isValid: true,
        cart: mockCart,
        errors: [],
      });
      mockOrderService.createOrderFromCart.mockResolvedValue(mockOrder);
      mockStripeClient.checkout.sessions.create = jest.fn().mockResolvedValue({
        id: 'cs_test_123',
        url: 'https://checkout.stripe.com/cs_test_123',
      });
      mockOrderService.markOrderPendingPayment.mockResolvedValue({
        ...mockOrder,
        status: OrderStatus.PENDING_PAYMENT,
      });

      const result = await service.createCheckoutSession('1', checkoutDto);

      expect(result.checkoutUrl).toBe(
        'https://checkout.stripe.com/cs_test_123',
      );
      expect(result.orderId).toBe('order-uuid-1');
      expect(result.sessionId).toBe('cs_test_123');
      expect(mockCartService.validateCartForCheckout).toHaveBeenCalledWith('1');
      expect(mockOrderService.createOrderFromCart).toHaveBeenCalledWith(
        '1',
        mockCart,
        expect.anything(), // queryRunner
      );
      expect(mockOrderService.markOrderPendingPayment).toHaveBeenCalledWith(
        'order-uuid-1',
        'cs_test_123',
        expect.anything(), // queryRunner
      );
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    });

    it('should throw BadRequestException when cart is empty', async () => {
      mockCartService.validateCartForCheckout.mockResolvedValue({
        isValid: false,
        cart: null,
        errors: ['Cart is empty'],
      });

      await expect(
        service.createCheckoutSession('1', checkoutDto),
      ).rejects.toThrow(BadRequestException);

      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(mockOrderService.createOrderFromCart).not.toHaveBeenCalled();
    });

    it('should use custom success/cancel URLs when provided', async () => {
      mockCartService.validateCartForCheckout.mockResolvedValue({
        isValid: true,
        cart: mockCart,
        errors: [],
      });
      mockOrderService.createOrderFromCart.mockResolvedValue(mockOrder);
      mockStripeClient.checkout.sessions.create = jest.fn().mockResolvedValue({
        id: 'cs_test_123',
        url: 'https://checkout.stripe.com/cs_test_123',
      });
      mockOrderService.markOrderPendingPayment.mockResolvedValue({
        ...mockOrder,
        status: OrderStatus.PENDING_PAYMENT,
      });

      const customDto: CreateCheckoutSessionDto = {
        successUrl: 'https://myapp.com/success',
        cancelUrl: 'https://myapp.com/cancel',
      };
      await service.createCheckoutSession('1', customDto);

      expect(mockStripeClient.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          success_url: 'https://myapp.com/success',
          cancel_url: 'https://myapp.com/cancel',
        }),
      );
    });
  });

  describe('handleCheckoutSessionCompleted', () => {
    it('should handle checkout session completed successfully', async () => {
      const mockSession = {
        id: 'cs_test_123',
        object: 'checkout.session',
        payment_status: 'paid' as const,
        status: 'complete' as const,
        amount_total: 5998,
        currency: 'usd',
        payment_intent: 'pi_test_123',
        metadata: {
          orderId: 'order-uuid-1',
          userId: '1',
        },
      };

      mockPaymentsRepository.findByStripePaymentIntent.mockResolvedValue(null);
      mockPaymentsRepository.create.mockResolvedValue({
        ...mockPayment,
        id: 'payment-uuid-1',
        status: PaymentStatus.SUCCEEDED,
        userId: '1',
        amount: 5998,
      });
      mockOrderService.markOrderPaidWithLock.mockResolvedValue({
        id: 'order-uuid-1',
        status: OrderStatus.PAID,
      });

      // Access the private method via (service as any)
      await invokePrivateHandler(mockSession);

      expect(mockPaymentsRepository.create).toHaveBeenCalled();
      expect(mockOrderService.markOrderPaidWithLock).toHaveBeenCalledWith(
        'order-uuid-1',
        'payment-uuid-1',
        expect.anything(), // queryRunner
      );
      expect(mockCartService.clearCart).toHaveBeenCalledWith('1');
      expect(mockEventEmitter.emit).toHaveBeenCalled();
      expect(mockNotificationsGateway.emitPaymentStatus).toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    });

    it('should skip when orderId metadata is missing', async () => {
      const mockSession = {
        id: 'cs_test_123',
        object: 'checkout.session',
        payment_status: 'paid' as const,
        status: 'complete' as const,
        metadata: { userId: '1' }, // no orderId
      };

      await invokePrivateHandler(mockSession);

      expect(
        mockPaymentsRepository.findByStripePaymentIntent,
      ).not.toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    });

    it('should skip when userId metadata is missing', async () => {
      const mockSession = {
        id: 'cs_test_123',
        object: 'checkout.session',
        payment_status: 'paid' as const,
        status: 'complete' as const,
        metadata: { orderId: 'order-uuid-1' }, // no userId
      };

      await invokePrivateHandler(mockSession);

      expect(
        mockPaymentsRepository.findByStripePaymentIntent,
      ).not.toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    });

    it('should update existing payment record if found', async () => {
      const mockSession = {
        id: 'cs_test_123',
        object: 'checkout.session',
        payment_status: 'paid' as const,
        status: 'complete' as const,
        amount_total: 5998,
        currency: 'usd',
        payment_intent: 'pi_test_123',
        metadata: {
          orderId: 'order-uuid-1',
          userId: '1',
        },
      };

      mockPaymentsRepository.findByStripePaymentIntent.mockResolvedValueOnce({
        ...mockPayment,
        status: PaymentStatus.PENDING,
      });
      mockPaymentsRepository.updateStatus.mockResolvedValue({
        ...mockPayment,
        status: PaymentStatus.SUCCEEDED,
      });
      mockPaymentsRepository.findByStripePaymentIntent.mockResolvedValueOnce({
        ...mockPayment,
        status: PaymentStatus.SUCCEEDED,
      });
      mockOrderService.markOrderPaidWithLock.mockResolvedValue({
        id: 'order-uuid-1',
        status: OrderStatus.PAID,
      });

      await invokePrivateHandler(mockSession);

      expect(mockPaymentsRepository.updateStatus).toHaveBeenCalledWith(
        'payment-uuid-1',
        PaymentStatus.SUCCEEDED,
        { stripeCheckoutSessionId: 'cs_test_123' },
        expect.anything(),
      );
    });

    it('should re-throw error on failure so Stripe retries', async () => {
      const mockSession = {
        id: 'cs_test_123',
        object: 'checkout.session',
        payment_status: 'paid' as const,
        status: 'complete' as const,
        amount_total: 5998,
        currency: 'usd',
        payment_intent: 'pi_test_123',
        metadata: {
          orderId: 'order-uuid-1',
          userId: '1',
        },
      };

      mockPaymentsRepository.findByStripePaymentIntent.mockRejectedValue(
        new Error('DB connection lost'),
      );

      await expect(invokePrivateHandler(mockSession)).rejects.toThrow(
        'DB connection lost',
      );

      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });
  });
});
