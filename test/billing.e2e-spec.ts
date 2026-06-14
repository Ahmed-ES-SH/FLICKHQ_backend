import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { Request } from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { BillingController } from '../src/billing/billing.controller';
import { WebhookController } from '../src/billing/webhook.controller';
import { BillingService } from '../src/billing/billing.service';
import {
  UserSubscription,
  SubscriptionStatus,
} from '../src/billing/user-subscription.entity';
import { User } from '../src/user/schema/user.entity';
import { Price } from '../src/subscriptions/entities/price.entity';
import { Plan } from '../src/subscriptions/entities/plan.entity';
import {
  PlanStatus,
  PriceType,
  RecurringInterval,
} from '../src/subscriptions/common/subscription.enums';
import { AuthGuard } from '../src/auth/guards/auth.guard';
import { getRepositoryToken } from '@nestjs/typeorm';

// ---------------------------------------------------------------------------
// Test Auth Guard — mirrors real guard behaviour (throws on missing token)
// ---------------------------------------------------------------------------
class TestAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: unknown }>();
    const token = req.cookies?.['test_token'] as string | undefined;
    if (!token) throw new UnauthorizedException('No token');
    req.user = {
      id: 1,
      email: 'test@example.com',
      role: 'user',
      stripeCustomerId: 'cus_123',
    };
    return true;
  }
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 1,
    email: 'test@example.com',
    name: 'Test User',
    stripeCustomerId: 'cus_123',
    role: 'user' as any,
    status: 'active' as any,
    createdAt: new Date(),
    updatedAt: new Date(),
    isEmailVerified: true,
    ...overrides,
  } as User;
}

function makePrice(overrides: Partial<Price> = {}): Price {
  return {
    id: '550e8400-e29b-41d4-a716-446655440001',
    planId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
    currency: 'usd',
    unitAmount: 999,
    type: PriceType.RECURRING,
    interval: RecurringInterval.MONTH,
    trialPeriodDays: 7,
    active: true,
    stripePriceId: 'price_stripe_123',
    stripeProductId: 'prod_123',
    plan: {
      id: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      code: 'pro',
      name: 'Pro Plan',
      description: null,
      status: PlanStatus.ACTIVE,
      features: ['feature-a'],
      displayOrder: 1,
      icon: null,
      highlight: false,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Plan,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Price;
}

function makeSub(
  overrides: Partial<UserSubscription> = {},
): UserSubscription {
  return {
    id: '6ba7b810-9dad-11d1-80b4-00c04fd430c9',
    userId: 1,
    stripeSubscriptionId: 'sub_stripe_123',
    stripeCustomerId: 'cus_123',
    status: SubscriptionStatus.ACTIVE,
    planCode: 'pro',
    stripePriceId: 'price_stripe_123',
    cancelAtPeriodEnd: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as UserSubscription;
}

// ---------------------------------------------------------------------------
// Mock Repos
// ---------------------------------------------------------------------------

function makeRepoMock<T extends Record<string, any>>(seedData: T[] = []) {
  const data = [...seedData];
  return {
    find: jest.fn().mockResolvedValue([...data]),
    findOne: jest.fn().mockImplementation((opts?: any) => {
      if (opts?.where?.id) {
        return Promise.resolve(
          data.find((d) => d.id === opts.where.id) ?? null,
        );
      }
      if (opts?.where?.stripeSubscriptionId) {
        return Promise.resolve(
          data.find(
            (d) =>
              d.stripeSubscriptionId === opts.where.stripeSubscriptionId,
          ) ?? null,
        );
      }
      if (opts?.where?.userId) {
        return Promise.resolve(
          data.find((d) => d.userId === opts.where.userId) ?? null,
        );
      }
      return Promise.resolve(data[0] ?? null);
    }),
    create: jest.fn().mockImplementation((entity: any) => entity),
    save: jest.fn().mockImplementation((entity: any) => Promise.resolve(entity)),
    update: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Billing (e2e)', () => {
  let app: INestApplication<App>;

  const stripeMock = {
    customers: {
      create: jest
        .fn()
        .mockResolvedValue({ id: 'cus_new_123', email: 'test@example.com' }),
    },
    subscriptions: {
      create: jest.fn().mockResolvedValue({
        id: 'sub_stripe_new',
        latest_invoice: {
          id: 'inv_1',
          payment_intent: { id: 'pi_1', client_secret: 'pi_secret_xyz' },
        },
      }),
      retrieve: jest.fn().mockResolvedValue({
        id: 'sub_stripe_123',
        items: {
          data: [{ id: 'si_1', price: { id: 'price_stripe_123' } }],
        },
      }),
      update: jest.fn().mockResolvedValue({ status: 'active' }),
    },
    invoices: {
      list: jest.fn().mockResolvedValue({ data: [] }),
    },
    webhooks: {
      constructEvent: jest.fn(),
    },
  };

  let userRepo: ReturnType<typeof makeRepoMock>;
  let subRepo: ReturnType<typeof makeRepoMock>;
  let priceRepo: ReturnType<typeof makeRepoMock>;

  beforeAll(async () => {
    userRepo = makeRepoMock<User>([makeUser()]);
    subRepo = makeRepoMock<UserSubscription>();
    priceRepo = makeRepoMock<Price>([makePrice()]);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        EventEmitterModule.forRoot(),
      ],
      controllers: [BillingController, WebhookController],
      providers: [
        BillingService,
        { provide: 'STRIPE_CLIENT', useValue: stripeMock },
        {
          provide: getRepositoryToken(UserSubscription),
          useValue: subRepo,
        },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(Price), useValue: priceRepo },
      ],
    })
      .overrideGuard(AuthGuard)
      .useClass(TestAuthGuard)
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  afterEach(() => jest.clearAllMocks());

  // ─── GET /billing/customer ──────────────────────────────

  describe('GET /billing/customer', () => {
    it('returns customerId for authenticated user (existing customer)', async () => {
      // Guard provides user with stripeCustomerId: 'cus_123'
      const res = await request(app.getHttpServer())
        .get('/billing/customer')
        .set('Cookie', ['test_token=valid'])
        .expect(200);

      expect(res.body).toHaveProperty('customerId', 'cus_123');
      expect(res.body).toHaveProperty('email', 'test@example.com');
      // Should NOT create a new customer since stripeCustomerId exists
      expect(stripeMock.customers.create).not.toHaveBeenCalled();
    });

    it('returns 401 without auth cookie', async () => {
      await request(app.getHttpServer())
        .get('/billing/customer')
        .expect(401);
    });
  });

  // ─── POST /billing/checkout/embedded-elements ──────────

  describe('POST /billing/checkout/embedded-elements', () => {
    it('creates checkout session and returns clientSecret + subscriptionId', async () => {
      const res = await request(app.getHttpServer())
        .post('/billing/checkout/embedded-elements')
        .set('Cookie', ['test_token=valid'])
        .send({ priceId: '550e8400-e29b-41d4-a716-446655440001' })
        .expect(201);

      expect(res.body).toHaveProperty('clientSecret', 'pi_secret_xyz');
      expect(res.body).toHaveProperty('subscriptionId', 'sub_stripe_new');
    });

    it('returns 400 with invalid UUID priceId', async () => {
      await request(app.getHttpServer())
        .post('/billing/checkout/embedded-elements')
        .set('Cookie', ['test_token=valid'])
        .send({ priceId: 'not-a-uuid' })
        .expect(400);
    });

    it('returns 400 when priceId is missing', async () => {
      await request(app.getHttpServer())
        .post('/billing/checkout/embedded-elements')
        .set('Cookie', ['test_token=valid'])
        .send({})
        .expect(400);
    });

    it('returns 401 without auth', async () => {
      await request(app.getHttpServer())
        .post('/billing/checkout/embedded-elements')
        .send({ priceId: '550e8400-e29b-41d4-a716-446655440001' })
        .expect(401);
    });

    it('passes idempotency-key header to service', async () => {
      await request(app.getHttpServer())
        .post('/billing/checkout/embedded-elements')
        .set('Cookie', ['test_token=valid'])
        .set('idempotency-key', 'my-key-123')
        .send({ priceId: '550e8400-e29b-41d4-a716-446655440001' })
        .expect(201);

      expect(stripeMock.subscriptions.create).toHaveBeenCalledWith(
        expect.anything(),
        { idempotencyKey: 'my-key-123' },
      );
    });
  });

  // ─── GET /subscriptions/current ─────────────────────────

  describe('GET /subscriptions/current', () => {
    it('returns current active subscription', async () => {
      subRepo.findOne.mockResolvedValueOnce(makeSub());

      const res = await request(app.getHttpServer())
        .get('/subscriptions/current')
        .set('Cookie', ['test_token=valid'])
        .expect(200);

      expect(res.body).toHaveProperty('planCode', 'pro');
      expect(res.body).toHaveProperty('status', 'active');
    });

    it('returns null when no active subscription', async () => {
      subRepo.findOne.mockResolvedValueOnce(null);

      const res = await request(app.getHttpServer())
        .get('/subscriptions/current')
        .set('Cookie', ['test_token=valid'])
        .expect(200);

      // NestJS may return null or {} depending on interceptor/serialization
      expect(!res.body || Object.keys(res.body).length === 0).toBe(true);
    });
  });

  // ─── GET /subscriptions/history ─────────────────────────

  describe('GET /subscriptions/history', () => {
    it('returns subscription history array', async () => {
      subRepo.find.mockResolvedValueOnce([
        makeSub({ id: '6ba7b810-9dad-11d1-80b4-00c04fd43010' }),
        makeSub({ id: '6ba7b810-9dad-11d1-80b4-00c04fd43011', status: SubscriptionStatus.CANCELED }),
      ]);

      const res = await request(app.getHttpServer())
        .get('/subscriptions/history')
        .set('Cookie', ['test_token=valid'])
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(2);
    });
  });

  // ─── GET /payments/history ──────────────────────────────

  describe('GET /payments/history', () => {
    it('returns payment history array', async () => {
      stripeMock.invoices.list.mockResolvedValueOnce({
        data: [
          {
            id: 'inv_1',
            amount_paid: 999,
            currency: 'usd',
            status: 'paid',
            description: 'Pro Plan',
            created: 1700000000,
            invoice_pdf: 'https://invoice.stripe.com/inv_1',
          },
        ],
      });

      const res = await request(app.getHttpServer())
        .get('/payments/history')
        .set('Cookie', ['test_token=valid'])
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toHaveProperty('id', 'inv_1');
      expect(res.body[0]).toHaveProperty('amount', 999);
    });

    it('returns empty array when user has no stripeCustomerId', async () => {
      userRepo.findOne.mockResolvedValueOnce(
        makeUser({ stripeCustomerId: null }),
      );

      const res = await request(app.getHttpServer())
        .get('/payments/history')
        .set('Cookie', ['test_token=valid'])
        .expect(200);

      expect(res.body).toEqual([]);
    });
  });

  // ─── POST /subscriptions/cancel ─────────────────────────

  describe('POST /subscriptions/cancel', () => {
    it('schedules cancellation and returns updated subscription', async () => {
      const sub = makeSub({ cancelAtPeriodEnd: false });
      subRepo.findOne.mockResolvedValueOnce(sub);

      const res = await request(app.getHttpServer())
        .post('/subscriptions/cancel')
        .set('Cookie', ['test_token=valid'])
        .expect(201);

      expect(res.body).toHaveProperty('cancelAtPeriodEnd', true);
      expect(stripeMock.subscriptions.update).toHaveBeenCalledWith(
        'sub_stripe_123',
        { cancel_at_period_end: true },
        { idempotencyKey: 'cancel-sub_stripe_123' },
      );
    });

    it('returns 404 when no active subscription', async () => {
      subRepo.findOne.mockResolvedValueOnce(null);

      await request(app.getHttpServer())
        .post('/subscriptions/cancel')
        .set('Cookie', ['test_token=valid'])
        .expect(404);
    });
  });

  // ─── POST /subscriptions/change-plan ────────────────────

  describe('POST /subscriptions/change-plan', () => {
    it('changes plan and returns updated subscription', async () => {
      const current = makeSub({ planCode: 'starter' });
      const newPrice = makePrice({
        id: '550e8400-e29b-41d4-a716-446655440002',
        stripePriceId: 'price_stripe_456',
        plan: {
          id: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
          code: 'enterprise',
          name: 'Enterprise',
          description: null,
          status: PlanStatus.ACTIVE,
          features: [],
          displayOrder: 2,
          icon: null,
          highlight: false,
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        } as Plan,
      });

      subRepo.findOne.mockResolvedValueOnce(current);
      priceRepo.findOne.mockResolvedValueOnce(newPrice);

      const res = await request(app.getHttpServer())
        .post('/subscriptions/change-plan')
        .set('Cookie', ['test_token=valid'])
        .send({ priceId: '550e8400-e29b-41d4-a716-446655440002' })
        .expect(201);

      expect(res.body).toHaveProperty('planCode', 'enterprise');
    });

    it('returns 400 with invalid UUID', async () => {
      await request(app.getHttpServer())
        .post('/subscriptions/change-plan')
        .set('Cookie', ['test_token=valid'])
        .send({ priceId: 'invalid' })
        .expect(400);
    });

    it('returns 404 when no active subscription', async () => {
      subRepo.findOne.mockResolvedValueOnce(null);

      await request(app.getHttpServer())
        .post('/subscriptions/change-plan')
        .set('Cookie', ['test_token=valid'])
        .send({ priceId: '550e8400-e29b-41d4-a716-446655440002' })
        .expect(404);
    });
  });

  // ─── POST /webhook/stripe ──────────────────────────────

  describe('POST /webhook/stripe', () => {
    it('processes invoice.paid event and returns { received: true }', async () => {
      const existing = makeSub({ status: SubscriptionStatus.INCOMPLETE });
      subRepo.findOne.mockResolvedValueOnce(existing);

      stripeMock.webhooks.constructEvent.mockReturnValueOnce({
        id: 'evt_1',
        type: 'invoice.paid',
        data: {
          object: {
            id: 'inv_1',
            customer: 'cus_123',
            subscription: 'sub_stripe_123',
            status: 'paid',
            amount_paid: 999,
            metadata: {},
          },
        },
      });

      const res = await request(app.getHttpServer())
        .post('/webhook/stripe')
        .set('stripe-signature', 'valid_sig')
        .set('Content-Type', 'application/json')
        .send({})
        .expect(200);

      expect(res.body).toEqual({ received: true });
      expect(existing.status).toBe(SubscriptionStatus.ACTIVE);
    });

    it('processes customer.subscription.created event', async () => {
      subRepo.findOne.mockResolvedValueOnce(null);
      userRepo.findOne.mockResolvedValueOnce(makeUser());

      stripeMock.webhooks.constructEvent.mockReturnValueOnce({
        id: 'evt_2',
        type: 'customer.subscription.created',
        data: {
          object: {
            id: 'sub_new',
            customer: 'cus_123',
            status: 'active',
            metadata: { userId: '1', planCode: 'pro' },
            cancel_at_period_end: false,
            items: {
              data: [
                {
                  id: 'si_1',
                  price: { id: 'price_stripe_123', unit_amount: 999 },
                },
              ],
            },
          },
        },
      });

      const res = await request(app.getHttpServer())
        .post('/webhook/stripe')
        .set('stripe-signature', 'valid_sig')
        .set('Content-Type', 'application/json')
        .send({})
        .expect(200);

      expect(res.body).toEqual({ received: true });
    });

    it('returns 400 with invalid stripe-signature', async () => {
      stripeMock.webhooks.constructEvent.mockImplementationOnce(() => {
        throw new Error('No signatures found');
      });

      await request(app.getHttpServer())
        .post('/webhook/stripe')
        .set('stripe-signature', 'invalid')
        .set('Content-Type', 'application/json')
        .send({})
        .expect(400);
    });

    it('returns 400 when stripe-signature header is missing', async () => {
      await request(app.getHttpServer())
        .post('/webhook/stripe')
        .set('Content-Type', 'application/json')
        .send({})
        .expect(400);
    });
  });
});
