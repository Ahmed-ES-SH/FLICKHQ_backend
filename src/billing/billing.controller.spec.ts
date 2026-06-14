import { Test, TestingModule } from '@nestjs/testing';
import { CanActivate, ExecutionContext } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { User } from '../user/schema/user.entity';

/** Pass-through guard that always allows the request. */
class MockAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    req.user = { id: 1, email: 'test@example.com', role: 'user' };
    return true;
  }
}

describe('BillingController', () => {
  let controller: BillingController;
  let service: BillingService;

  const mockUser: User = {
    id: 1,
    email: 'test@example.com',
    name: 'Test User',
    stripeCustomerId: 'cus_123',
    role: 'user' as any,
    status: 'active' as any,
    createdAt: new Date(),
    updatedAt: new Date(),
    isEmailVerified: true,
  } as User;

  const mockService = {
    ensureCustomer: jest.fn(),
    createCheckoutSession: jest.fn(),
    getCurrentSubscription: jest.fn(),
    getSubscriptionHistory: jest.fn(),
    getPaymentHistory: jest.fn(),
    cancelSubscription: jest.fn(),
    changePlan: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BillingController],
      providers: [{ provide: BillingService, useValue: mockService }],
    })
      .overrideGuard(AuthGuard)
      .useClass(MockAuthGuard)
      .compile();

    controller = module.get(BillingController);
    service = module.get(BillingService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('ensureCustomer (GET /billing/customer)', () => {
    it('delegates to billingService.ensureCustomer with user', async () => {
      const expected = { customerId: 'cus_123', email: 'test@example.com' };
      mockService.ensureCustomer.mockResolvedValue(expected);

      const result = await controller.ensureCustomer(mockUser);

      expect(result).toEqual(expected);
      expect(service.ensureCustomer).toHaveBeenCalledWith(mockUser);
    });
  });

  describe('createCheckout (POST /billing/checkout/embedded-elements)', () => {
    it('delegates with dto.priceId and idempotency-key', async () => {
      const dto = { priceId: 'price-uuid-1' };
      const expected = { clientSecret: 'pi_secret', subscriptionId: 'sub_1' };
      mockService.createCheckoutSession.mockResolvedValue(expected);

      const result = await controller.createCheckout(
        mockUser,
        dto,
        'idem-key-123',
      );

      expect(result).toEqual(expected);
      expect(service.createCheckoutSession).toHaveBeenCalledWith(
        1,
        'price-uuid-1',
        'idem-key-123',
      );
    });

    it('delegates without idempotency-key when not provided', async () => {
      const dto = { priceId: 'price-uuid-2' };
      mockService.createCheckoutSession.mockResolvedValue({
        clientSecret: 'secret',
        subscriptionId: 'sub_2',
      });

      await controller.createCheckout(mockUser, dto);

      expect(service.createCheckoutSession).toHaveBeenCalledWith(
        1,
        'price-uuid-2',
        undefined,
      );
    });
  });

  describe('getCurrentSubscription (GET /subscriptions/current)', () => {
    it('delegates with user.id', async () => {
      const sub = { id: 'sub-1', status: 'active' };
      mockService.getCurrentSubscription.mockResolvedValue(sub);

      const result = await controller.getCurrentSubscription(mockUser);

      expect(result).toEqual(sub);
      expect(service.getCurrentSubscription).toHaveBeenCalledWith(1);
    });
  });

  describe('getSubscriptionHistory (GET /subscriptions/history)', () => {
    it('delegates with user.id', async () => {
      const history = [{ id: 'sub-1' }, { id: 'sub-2' }];
      mockService.getSubscriptionHistory.mockResolvedValue(history);

      const result = await controller.getSubscriptionHistory(mockUser);

      expect(result).toEqual(history);
      expect(service.getSubscriptionHistory).toHaveBeenCalledWith(1);
    });
  });

  describe('getPaymentHistory (GET /payments/history)', () => {
    it('delegates with user.id', async () => {
      const history = [{ id: 'inv_1', amount: 999 }];
      mockService.getPaymentHistory.mockResolvedValue(history);

      const result = await controller.getPaymentHistory(mockUser);

      expect(result).toEqual(history);
      expect(service.getPaymentHistory).toHaveBeenCalledWith(1);
    });
  });

  describe('cancelSubscription (POST /subscriptions/cancel)', () => {
    it('delegates with user.id', async () => {
      const sub = { id: 'sub-1', cancelAtPeriodEnd: true };
      mockService.cancelSubscription.mockResolvedValue(sub);

      const result = await controller.cancelSubscription(mockUser);

      expect(result).toEqual(sub);
      expect(service.cancelSubscription).toHaveBeenCalledWith(1);
    });
  });

  describe('changePlan (POST /subscriptions/change-plan)', () => {
    it('delegates with user.id and dto.priceId', async () => {
      const dto = { priceId: 'price-uuid-new' };
      const sub = { id: 'sub-1', planCode: 'enterprise' };
      mockService.changePlan.mockResolvedValue(sub);

      const result = await controller.changePlan(mockUser, dto);

      expect(result).toEqual(sub);
      expect(service.changePlan).toHaveBeenCalledWith(1, 'price-uuid-new');
    });
  });
});
