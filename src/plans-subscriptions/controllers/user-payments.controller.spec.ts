/**
 * HTTP-layer tests for the user payments controller. Verifies
 * that request params are forwarded to the billing history service.
 *
 * AuthGuard is stubbed via jest.mock to avoid loading the auth
 * module transitively (which pulls in UserService and its
 * `src/helpers/paginate.helper` path-alias import that the
 * unit-test Jest config does not resolve).
 */

jest.mock('../../auth/guards/auth.guard', () => ({
  AuthGuard: class AuthGuard {
    canActivate(): boolean {
      return true;
    }
  },
}));

import { Test, TestingModule } from '@nestjs/testing';
import { UserPaymentsController } from './user-payments.controller';
import { UserBillingHistoryService } from '../services/user-billing-history.service';
import { PaginationQueryDto } from '../dto/pagination-query.dto';
import { UserPaymentHistoryItemDto } from '../dto/user-payment-history.dto';

describe('UserPaymentsController', () => {
  let controller: UserPaymentsController;
  let userBillingHistory: jest.Mocked<UserBillingHistoryService>;

  beforeEach(async () => {
    userBillingHistory = {
      getUserPaymentHistory: jest.fn(),
      getPaymentDetail: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserPaymentsController],
      providers: [
        { provide: UserBillingHistoryService, useValue: userBillingHistory },
      ],
    }).compile();

    controller = module.get<UserPaymentsController>(UserPaymentsController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /payments/history', () => {
    it('should return paginated payment history', async () => {
      const paginatedResult = {
        items: [
          {
            id: 'pay-1',
            amount: 1999,
            currency: 'usd',
          } as UserPaymentHistoryItemDto,
        ],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      };
      userBillingHistory.getUserPaymentHistory.mockResolvedValueOnce(
        paginatedResult,
      );

      const pagination: PaginationQueryDto = { page: 1, limit: 20 };
      const result = await controller.getPaymentHistory(1, pagination);

      expect(userBillingHistory.getUserPaymentHistory).toHaveBeenCalledWith(
        1,
        pagination,
      );
      expect(result.total).toBe(1);
      expect(result.items[0]!.amount).toBe(1999);
    });
  });

  describe('GET /payments/:id', () => {
    it('should return payment detail', async () => {
      const payment = { id: 'pay-1', amount: 1999, invoiceNumber: 'INV-001' };
      userBillingHistory.getPaymentDetail.mockResolvedValueOnce(payment as any);

      const result = await controller.getPaymentDetail('pay-1', 1);

      expect(userBillingHistory.getPaymentDetail).toHaveBeenCalledWith(
        'pay-1',
        1,
      );
      expect(result!.invoiceNumber).toBe('INV-001');
    });

    it('should return null for non-owned payment', async () => {
      userBillingHistory.getPaymentDetail.mockResolvedValueOnce(null);

      const result = await controller.getPaymentDetail('pay-unknown', 2);

      expect(result).toBeNull();
    });
  });
});
