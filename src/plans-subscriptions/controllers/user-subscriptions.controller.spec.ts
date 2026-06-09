/**
 * HTTP-layer tests for the user subscriptions controller. Verifies
 * that request params are forwarded to the history services.
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
import { UserSubscriptionsController } from './user-subscriptions.controller';
import { UserBillingHistoryService } from '../services/user-billing-history.service';
import { SubscriptionHistoryService } from '../services/subscription-history.service';
import { PaginationQueryDto } from '../dto/pagination-query.dto';
import { UserSubscriptionHistoryItemDto } from '../dto/user-subscription-history.dto';
import { BillingSubscriptionStatus } from '../../billing/common/billing.enums';

describe('UserSubscriptionsController', () => {
  let controller: UserSubscriptionsController;
  let userBillingHistory: jest.Mocked<UserBillingHistoryService>;
  let subscriptionHistory: jest.Mocked<SubscriptionHistoryService>;

  beforeEach(async () => {
    userBillingHistory = {
      getCurrentSubscription: jest.fn(),
      getUserSubscriptionHistory: jest.fn(),
    } as any;

    subscriptionHistory = {
      getHistoryForSubscription: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserSubscriptionsController],
      providers: [
        { provide: UserBillingHistoryService, useValue: userBillingHistory },
        { provide: SubscriptionHistoryService, useValue: subscriptionHistory },
      ],
    }).compile();

    controller = module.get<UserSubscriptionsController>(
      UserSubscriptionsController,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /subscriptions/current', () => {
    it('should return current active subscription', async () => {
      userBillingHistory.getCurrentSubscription.mockResolvedValueOnce({
        id: 'sub-1',
        status: BillingSubscriptionStatus.ACTIVE,
      } as any);

      const result = await controller.getCurrentSubscription(1);

      expect(userBillingHistory.getCurrentSubscription).toHaveBeenCalledWith(1);
      expect(result!.status).toBe(BillingSubscriptionStatus.ACTIVE);
    });

    it('should return null when no active subscription', async () => {
      userBillingHistory.getCurrentSubscription.mockResolvedValueOnce(null);

      const result = await controller.getCurrentSubscription(1);

      expect(result).toBeNull();
    });
  });

  describe('GET /subscriptions/history', () => {
    it('should return paginated subscription history', async () => {
      const paginatedResult = {
        items: [
          {
            id: 's1',
            status: BillingSubscriptionStatus.ACTIVE,
          } as UserSubscriptionHistoryItemDto,
        ],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      };
      userBillingHistory.getUserSubscriptionHistory.mockResolvedValueOnce(
        paginatedResult,
      );

      const pagination: PaginationQueryDto = { page: 1, limit: 20 };
      const result = await controller.getSubscriptionHistory(1, pagination);

      expect(
        userBillingHistory.getUserSubscriptionHistory,
      ).toHaveBeenCalledWith(1, pagination);
      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
    });
  });

  describe('GET /subscriptions/history/:subscriptionId', () => {
    it('should return timeline for a subscription', async () => {
      const timeline = [
        { id: 'h1', newStatus: BillingSubscriptionStatus.ACTIVE },
        { id: 'h2', newStatus: BillingSubscriptionStatus.CANCELED },
      ];
      subscriptionHistory.getHistoryForSubscription.mockResolvedValueOnce(
        timeline as any,
      );

      const result = await controller.getSubscriptionTimeline('sub-uuid');

      expect(
        subscriptionHistory.getHistoryForSubscription,
      ).toHaveBeenCalledWith('sub-uuid');
      expect(result).toHaveLength(2);
    });
  });
});
