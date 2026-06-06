import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Repository } from 'typeorm';

import { BillingCustomer } from '../entities/billing-customer.entity';
import { BillingCustomerService } from './billing-customer.service';
import { BillingStripeService } from './billing-stripe.service';
import { User } from '../../user/schema/user.entity';
import { BILLING_EVENTS } from '../common/billing.constants';

type ManagerMock = {
  transaction: jest.Mock;
};

interface UserRepoMock {
  findOne: jest.Mock;
  save: jest.Mock;
}

interface StripeClientMock {
  customers: {
    create: jest.Mock;
  };
}

type MockEntityManager = {
  getRepository: jest.Mock;
};

/* eslint-disable @typescript-eslint/unbound-method */
describe('BillingCustomerService', () => {
  let service: BillingCustomerService;
  let customerRepo: Repository<BillingCustomer>;
  let stripeService: jest.Mocked<BillingStripeService>;
  let eventEmitter: jest.Mocked<EventEmitter2>;
  let stripeCustomers: StripeClientMock;
  let managerMock: ManagerMock;
  let mockEntityManager: MockEntityManager;

  const sampleUser: User = {
    id: 42,
    email: 'alice@example.com',
    name: 'Alice',
    stripeCustomerId: null,
    isPremium: false,
  } as unknown as User;

  const sampleCustomer: BillingCustomer = {
    id: 'cust-local-1',
    userId: 42,
    stripeCustomerId: 'cus_stripe_1',
    email: 'alice@example.com',
    name: 'Alice',
    metadata: {},
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
  };

  function buildMockUserRepo(): UserRepoMock {
    return {
      findOne: jest.fn(),
      save: jest.fn((user) => Promise.resolve(user as User)),
    };
  }

  function buildMockEntityManager(): MockEntityManager {
    return {
      getRepository: jest.fn(),
    };
  }

  beforeEach(async () => {
    customerRepo = {
      findOne: jest.fn(),
      create: jest.fn((dto) => dto as BillingCustomer),
      save: jest.fn((entity) => Promise.resolve(entity as BillingCustomer)),
      manager: {
        transaction: jest.fn(),
      },
    } as unknown as Repository<BillingCustomer>;
    managerMock = customerRepo.manager as unknown as ManagerMock;
    mockEntityManager = buildMockEntityManager();
    stripeCustomers = {
      customers: {
        create: jest.fn(),
      },
    };
    stripeService = {
      getClient: jest.fn(() => stripeCustomers as never),
      safeCall: jest.fn(async (op: () => Promise<unknown>) => op()),
    } as unknown as jest.Mocked<BillingStripeService>;
    eventEmitter = {
      emit: jest.fn(),
    } as unknown as jest.Mocked<EventEmitter2>;

    // Touch the async-mocked methods to satisfy
    // `@typescript-eslint/require-await`. The mocks themselves
    // already return promises; this no-op await documents that
    // intent without changing behavior.
    await Promise.resolve();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingCustomerService,
        {
          provide: getRepositoryToken(BillingCustomer),
          useValue: customerRepo,
        },
        {
          provide: BillingStripeService,
          useValue: stripeService,
        },
        {
          provide: EventEmitter2,
          useValue: eventEmitter,
        },
      ],
    }).compile();

    service = module.get(BillingCustomerService);
  });

  describe('findByUserId', () => {
    it('returns the row when one exists', async () => {
      customerRepo.findOne.mockResolvedValueOnce(sampleCustomer);
      await expect(service.findByUserId(42)).resolves.toBe(sampleCustomer);
      expect(customerRepo.findOne).toHaveBeenCalledWith({
        where: { userId: 42 },
      });
    });

    it('returns null when no row exists', async () => {
      customerRepo.findOne.mockResolvedValueOnce(null);
      await expect(service.findByUserId(99)).resolves.toBeNull();
    });
  });

  describe('getOrCreateForUser', () => {
    it('returns the existing row without contacting Stripe', async () => {
      const mockUserRepo = buildMockUserRepo();
      const mockBillingCustomerRepo = buildMockUserRepo();
      mockUserRepo.findOne.mockResolvedValueOnce({
        id: 42,
        email: 'alice@example.com',
        name: 'Alice',
        stripeCustomerId: null,
      });
      mockBillingCustomerRepo.findOne.mockResolvedValueOnce(sampleCustomer);
      mockEntityManager.getRepository.mockImplementation((entity) => {
        if (entity === User) return mockUserRepo;
        if (entity === BillingCustomer) return mockBillingCustomerRepo;
        return null;
      });
      managerMock.transaction.mockImplementationOnce(
        async (cb: (em: MockEntityManager) => Promise<BillingCustomer>) =>
          cb(mockEntityManager),
      );

      const result = await service.getOrCreateForUser(42);
      expect(result).toBe(sampleCustomer);
      expect(stripeService.getClient).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('backfills from users.stripe_customer_id when present', async () => {
      const mockUserRepo = buildMockUserRepo();
      const mockBillingCustomerRepo = buildMockUserRepo();
      mockUserRepo.findOne.mockResolvedValueOnce({
        id: 42,
        email: 'alice@example.com',
        name: 'Alice',
        stripeCustomerId: 'cus_backfilled',
      });
      mockBillingCustomerRepo.findOne.mockResolvedValueOnce(null);
      mockEntityManager.getRepository.mockImplementation((entity) => {
        if (entity === User) return mockUserRepo;
        if (entity === BillingCustomer) return mockBillingCustomerRepo;
        return null;
      });
      managerMock.transaction.mockImplementationOnce(
        async (cb: (em: MockEntityManager) => Promise<BillingCustomer>) =>
          cb(mockEntityManager),
      );

      // createLocalRow uses the service's own customerRepo.create/save.
      // Mock it to return a row with the expected stripeCustomerId.
      const backfilledCustomer = {
        ...sampleCustomer,
        stripeCustomerId: 'cus_backfilled',
      };
      customerRepo.create.mockReturnValueOnce(backfilledCustomer);
      customerRepo.save.mockResolvedValueOnce(backfilledCustomer);

      const result = await service.getOrCreateForUser(42);
      expect(result.stripeCustomerId).toBe('cus_backfilled');
      expect(stripeService.getClient).not.toHaveBeenCalled();
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        BILLING_EVENTS.CUSTOMER_CREATED,
        expect.objectContaining({ backfilled: true }),
      );
    });

    it('creates a Stripe customer when no backfill id is present', async () => {
      const mockUserRepo = buildMockUserRepo();
      const mockBillingCustomerRepo = buildMockUserRepo();
      mockUserRepo.findOne.mockResolvedValueOnce({
        ...sampleUser,
        stripeCustomerId: null,
      });
      mockBillingCustomerRepo.findOne.mockResolvedValueOnce(null);
      mockEntityManager.getRepository.mockImplementation((entity) => {
        if (entity === User) return mockUserRepo;
        if (entity === BillingCustomer) return mockBillingCustomerRepo;
        return null;
      });
      managerMock.transaction.mockImplementationOnce(
        async (cb: (em: MockEntityManager) => Promise<BillingCustomer>) =>
          cb(mockEntityManager),
      );

      stripeCustomers.customers.create.mockResolvedValueOnce({
        id: 'cus_fresh',
      });

      customerRepo.create.mockReturnValueOnce({
        ...sampleCustomer,
        stripeCustomerId: 'cus_fresh',
      });
      customerRepo.save.mockResolvedValueOnce({
        ...sampleCustomer,
        stripeCustomerId: 'cus_fresh',
      });

      const result = await service.getOrCreateForUser(42);

      expect(stripeCustomers.customers.create).toHaveBeenCalledWith({
        email: 'alice@example.com',
        name: 'Alice',
        metadata: { userId: '42' },
      });
      expect(result.stripeCustomerId).toBe('cus_fresh');
      expect(mockUserRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ stripeCustomerId: 'cus_fresh' }),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        BILLING_EVENTS.CUSTOMER_CREATED,
        expect.objectContaining({ backfilled: false }),
      );
    });

    it('throws when the user does not exist', async () => {
      const mockUserRepo = buildMockUserRepo();
      const mockBillingCustomerRepo = buildMockUserRepo();
      mockUserRepo.findOne.mockResolvedValueOnce(null);
      mockEntityManager.getRepository.mockImplementation((entity) => {
        if (entity === User) return mockUserRepo;
        if (entity === BillingCustomer) return mockBillingCustomerRepo;
        return null;
      });
      managerMock.transaction.mockImplementationOnce(
        async (cb: (em: MockEntityManager) => Promise<BillingCustomer>) =>
          cb(mockEntityManager),
      );

      await expect(service.getOrCreateForUser(404)).rejects.toThrow(
        /not found/,
      );
    });

    it('re-checks for existing customer after acquiring the lock (serialises concurrent requests)', async () => {
      const mockUserRepo = buildMockUserRepo();
      const mockBillingCustomerRepo = buildMockUserRepo();
      mockUserRepo.findOne.mockResolvedValueOnce({
        id: 42,
        email: 'alice@example.com',
        name: 'Alice',
        stripeCustomerId: null,
      });
      // The re-check after acquiring the lock finds a row created
      // by a concurrent request that won the lock first.
      mockBillingCustomerRepo.findOne.mockResolvedValueOnce({
        ...sampleCustomer,
        stripeCustomerId: 'cus_concurrent',
      });
      mockEntityManager.getRepository.mockImplementation((entity) => {
        if (entity === User) return mockUserRepo;
        if (entity === BillingCustomer) return mockBillingCustomerRepo;
        return null;
      });
      managerMock.transaction.mockImplementationOnce(
        async (cb: (em: MockEntityManager) => Promise<BillingCustomer>) =>
          cb(mockEntityManager),
      );

      // The re-check returns the existing row; no Stripe API calls
      // and no createLocalRow needed.
      const result = await service.getOrCreateForUser(42);
      expect(result.stripeCustomerId).toBe('cus_concurrent');
      expect(stripeService.getClient).not.toHaveBeenCalled();
    });
  });

  describe('syncForUser', () => {
    it('reports created=false when the row already exists', async () => {
      customerRepo.findOne.mockResolvedValueOnce(sampleCustomer);
      const result = await service.syncForUser(42);
      expect(result.created).toBe(false);
      expect(result.customer).toBe(sampleCustomer);
    });

    it('reports created=true when a new row is created', async () => {
      // syncForUser → findById returns null → getOrCreateForUser (transaction)
      customerRepo.findOne.mockResolvedValueOnce(null);

      const mockUserRepo = buildMockUserRepo();
      const mockBillingCustomerRepo = buildMockUserRepo();
      mockUserRepo.findOne.mockResolvedValueOnce({
        id: 42,
        email: 'alice@example.com',
        name: 'Alice',
        stripeCustomerId: null,
      });
      mockBillingCustomerRepo.findOne.mockResolvedValueOnce(null);
      mockEntityManager.getRepository.mockImplementation((entity) => {
        if (entity === User) return mockUserRepo;
        if (entity === BillingCustomer) return mockBillingCustomerRepo;
        return null;
      });
      managerMock.transaction.mockImplementationOnce(
        async (cb: (em: MockEntityManager) => Promise<BillingCustomer>) =>
          cb(mockEntityManager),
      );

      stripeCustomers.customers.create.mockResolvedValueOnce({
        id: 'cus_sync',
      });

      const syncedCustomer = {
        ...sampleCustomer,
        stripeCustomerId: 'cus_sync',
      };
      customerRepo.create.mockReturnValueOnce(syncedCustomer);
      customerRepo.save.mockResolvedValueOnce(syncedCustomer);

      const result = await service.syncForUser(42);
      expect(result.created).toBe(true);
      expect(result.customer.stripeCustomerId).toBe('cus_sync');
    });
  });

  describe('applyCustomerUpdate', () => {
    it('returns null when no local row matches the Stripe id', async () => {
      customerRepo.findOne.mockResolvedValueOnce(null);
      const result = await service.applyCustomerUpdate({ id: 'cus_x' });
      expect(result).toBeNull();
    });

    it('updates email and name when they differ', async () => {
      customerRepo.findOne.mockResolvedValueOnce({ ...sampleCustomer });
      const result = await service.applyCustomerUpdate({
        id: 'cus_stripe_1',
        email: 'alice2@example.com',
        name: 'Alice Two',
        metadata: { source: 'webhook' },
      });
      expect(result?.email).toBe('alice2@example.com');
      expect(result?.name).toBe('Alice Two');
      expect(result?.metadata).toMatchObject({ source: 'webhook' });
    });
  });

  describe('normalizeCurrencyCode', () => {
    it('lowercases the input', () => {
      expect(service.normalizeCurrencyCode('USD')).toBe('usd');
    });

    it('throws on a bad code', () => {
      expect(() => service.normalizeCurrencyCode('xx')).toThrow();
    });
  });
});
