/**
 * Integration test: Webhook → SubscriptionHistoryService flow.
 *
 * Verifies that:
 * 1. Events emitted via EventEmitter2 are received by the
 *    SubscriptionHistoryService @OnEvent handlers.
 * 2. History records are created for subscription.created, .updated, .canceled.
 * 3. Duplicate stripeEventId values are silently skipped (idempotency).
 * 4. Non-unique constraint errors are rethrown.
 *
 * This test creates a full NestApplication so the OnApplicationBootstrap
 * lifecycle hook in EventSubscribersLoader registers the @OnEvent
 * decorator handlers with the EventEmitter2 instance.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { EventEmitterModule, EventEmitter2 } from '@nestjs/event-emitter';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';
import { PlanSubscriptionHistory } from '../entities/plan-subscription-history.entity';
import {
  SubscriptionHistoryService,
  SubscriptionStatusChangeParams,
} from './subscription-history.service';
import { BILLING_EVENTS } from '../../billing/common/billing.constants';
import { BillingSubscriptionStatus } from '../../billing/common/billing.enums';

/**
 * In-memory store that simulates a TypeORM repository for
 * PlanSubscriptionHistory. Enforces UNIQUE(stripe_event_id)
 * by rejecting inserts with a duplicate non-null stripeEventId.
 */
class HistoryStore {
  private rows: PlanSubscriptionHistory[] = [];
  private nextId = 1;

  create(params: Partial<PlanSubscriptionHistory>): PlanSubscriptionHistory {
    return {
      id: `hist-${this.nextId++}`,
      userId: params.userId ?? 0,
      subscriptionId: params.subscriptionId ?? null,
      previousStatus: params.previousStatus ?? null,
      newStatus: params.newStatus ?? BillingSubscriptionStatus.ACTIVE,
      planId: params.planId ?? null,
      priceId: params.priceId ?? null,
      stripeEventId: params.stripeEventId ?? null,
      reason: params.reason ?? null,
      metadata: params.metadata ?? {},
      occurredAt: params.occurredAt ?? new Date(),
      createdAt: new Date(),
    };
  }

  async save(entry: PlanSubscriptionHistory): Promise<PlanSubscriptionHistory> {
    if (entry.stripeEventId) {
      const existing = this.rows.find(
        (r) => r.stripeEventId === entry.stripeEventId,
      );
      if (existing) {
        const err = new QueryFailedError(
          'INSERT INTO plan_subscription_history ...',
          [],
          new Error(
            'duplicate key value violates unique constraint "idx_plan_sub_hist_stripe_event"',
          ),
        );
        (err as QueryFailedError & { code: string }).code = '23505';
        throw err;
      }
    }
    this.rows.push(entry);
    return entry;
  }

  count(): number {
    return this.rows.length;
  }

  getAll(): PlanSubscriptionHistory[] {
    return [...this.rows];
  }

  clear(): void {
    this.rows = [];
    this.nextId = 1;
  }
}

describe('Webhook → SubscriptionHistory Integration', () => {
  let app: INestApplication;
  let service: SubscriptionHistoryService;
  let eventEmitter: EventEmitter2;
  let store: HistoryStore;

  beforeEach(async () => {
    store = new HistoryStore();

    const fakeRepo = {
      findOne: jest.fn(async () => null),
      create: jest.fn((params: Partial<PlanSubscriptionHistory>) =>
        store.create(params),
      ),
      save: jest.fn((entry: PlanSubscriptionHistory) => store.save(entry)),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [
        SubscriptionHistoryService,
        {
          provide: getRepositoryToken(PlanSubscriptionHistory),
          useValue: fakeRepo,
        },
      ],
    }).compile();

    // Create a full NestApplication so OnApplicationBootstrap lifecycle
    // hook runs, which triggers EventSubscribersLoader to register
    // @OnEvent decorator handlers with the EventEmitter2 instance.
    app = moduleFixture.createNestApplication();
    await app.init();

    service = app.get<SubscriptionHistoryService>(SubscriptionHistoryService);
    eventEmitter = app.get<EventEmitter2>(EventEmitter2);
  });

  afterEach(async () => {
    store.clear();
    await app?.close();
  });

  // ─────────────────────────────────────────────
  // Event listener discovery
  // ─────────────────────────────────────────────

  it('should have registered listeners for all subscription events', () => {
    expect(
      eventEmitter.listeners(BILLING_EVENTS.SUBSCRIPTION_CREATED).length,
    ).toBeGreaterThan(0);
    expect(
      eventEmitter.listeners(BILLING_EVENTS.SUBSCRIPTION_UPDATED).length,
    ).toBeGreaterThan(0);
    expect(
      eventEmitter.listeners(BILLING_EVENTS.SUBSCRIPTION_CANCELED).length,
    ).toBeGreaterThan(0);
  });

  // ─────────────────────────────────────────────
  // Event-driven recording
  // ─────────────────────────────────────────────

  it('should record history when SUBSCRIPTION_CREATED event is emitted', async () => {
    const results = await eventEmitter.emitAsync(
      BILLING_EVENTS.SUBSCRIPTION_CREATED,
      {
        userId: 1,
        billingCustomerId: 'bc-1',
        localSubscriptionId: 'sub-1',
        stripeSubscriptionId: 'sub_stripe_1',
        status: BillingSubscriptionStatus.ACTIVE,
      },
    );

    expect(results).toBeDefined();
    expect(store.count()).toBe(1);
    const record = store.getAll()[0]!;
    expect(record.userId).toBe(1);
    expect(record.subscriptionId).toBe('sub-1');
    expect(record.newStatus).toBe(BillingSubscriptionStatus.ACTIVE);
  });

  it('should record history when SUBSCRIPTION_UPDATED event is emitted', async () => {
    await eventEmitter.emitAsync(BILLING_EVENTS.SUBSCRIPTION_UPDATED, {
      userId: 2,
      billingCustomerId: 'bc-2',
      localSubscriptionId: 'sub-2',
      stripeSubscriptionId: 'sub_stripe_2',
      status: BillingSubscriptionStatus.PAST_DUE,
    });

    expect(store.count()).toBe(1);
    const record = store.getAll()[0]!;
    expect(record.userId).toBe(2);
    expect(record.subscriptionId).toBe('sub-2');
    expect(record.newStatus).toBe(BillingSubscriptionStatus.PAST_DUE);
  });

  it('should record CANCELED when SUBSCRIPTION_CANCELED event is emitted', async () => {
    await eventEmitter.emitAsync(BILLING_EVENTS.SUBSCRIPTION_CANCELED, {
      userId: 3,
      billingCustomerId: 'bc-3',
      localSubscriptionId: 'sub-3',
      stripeSubscriptionId: 'sub_stripe_3',
    });

    expect(store.count()).toBe(1);
    const record = store.getAll()[0]!;
    expect(record.userId).toBe(3);
    expect(record.subscriptionId).toBe('sub-3');
    expect(record.newStatus).toBe(BillingSubscriptionStatus.CANCELED);
  });

  // ─────────────────────────────────────────────
  // Idempotency via recordStatusChange
  // ─────────────────────────────────────────────

  it('should silently skip duplicate stripeEventId via recordStatusChange', async () => {
    const params: SubscriptionStatusChangeParams = {
      userId: 10,
      subscriptionId: 'sub-10',
      previousStatus: null,
      newStatus: BillingSubscriptionStatus.ACTIVE,
      planId: null,
      priceId: null,
      stripeEventId: 'evt_uniq_123',
      reason: 'webhook: test',
    };

    // First call succeeds
    await service.recordStatusChange(params);
    expect(store.count()).toBe(1);

    // Second call with same stripeEventId silently skips
    await service.recordStatusChange(params);
    expect(store.count()).toBe(1);
  });

  it('should allow different stripeEventId values', async () => {
    await service.recordStatusChange({
      userId: 20,
      subscriptionId: 'sub-20',
      previousStatus: null,
      newStatus: BillingSubscriptionStatus.TRIALING,
      planId: null,
      priceId: null,
      stripeEventId: 'evt_a',
      reason: 'first',
    });

    await service.recordStatusChange({
      userId: 20,
      subscriptionId: 'sub-20',
      previousStatus: BillingSubscriptionStatus.TRIALING,
      newStatus: BillingSubscriptionStatus.ACTIVE,
      planId: null,
      priceId: null,
      stripeEventId: 'evt_b',
      reason: 'second',
    });

    expect(store.count()).toBe(2);
  });

  it('should handle null stripeEventId (no dedup constraint)', async () => {
    for (let i = 0; i < 3; i++) {
      await service.recordStatusChange({
        userId: 30,
        subscriptionId: 'sub-30',
        previousStatus: i > 0 ? BillingSubscriptionStatus.ACTIVE : null,
        newStatus: BillingSubscriptionStatus.ACTIVE,
        planId: null,
        priceId: null,
        stripeEventId: null,
        reason: 'no-event-id',
      });
    }

    expect(store.count()).toBe(3);
  });

  // ─────────────────────────────────────────────
  // Rich metadata preservation
  // ─────────────────────────────────────────────

  it('should record metadata from the event payload', async () => {
    await service.recordStatusChange({
      userId: 50,
      subscriptionId: 'sub-50',
      previousStatus: null,
      newStatus: BillingSubscriptionStatus.ACTIVE,
      planId: 'plan-xyz',
      priceId: 'price-abc',
      stripeEventId: 'evt_meta',
      reason: 'upgrade',
      metadata: {
        periodStart: '2025-01-01',
        periodEnd: '2025-02-01',
        previousPlanId: 'plan-old',
      },
    });

    const records = store.getAll();
    expect(records).toHaveLength(1);
    expect(records[0]!.planId).toBe('plan-xyz');
    expect(records[0]!.priceId).toBe('price-abc');
    expect(records[0]!.metadata).toEqual({
      periodStart: '2025-01-01',
      periodEnd: '2025-02-01',
      previousPlanId: 'plan-old',
    });
  });

  // ─────────────────────────────────────────────
  // Error handling — rethrow non-23505 errors
  // ─────────────────────────────────────────────

  it('should rethrow non-23505 query errors', async () => {
    const origSave = store.save.bind(store);
    store.save = async () => {
      const err = new QueryFailedError(
        'SELECT 1',
        [],
        new Error('DB deadlock'),
      );
      (err as QueryFailedError & { code: string }).code = '40001';
      throw err;
    };

    await expect(
      service.recordStatusChange({
        userId: 99,
        subscriptionId: null,
        previousStatus: null,
        newStatus: BillingSubscriptionStatus.ACTIVE,
        planId: null,
        priceId: null,
        stripeEventId: null,
        reason: 'non-unique-error-test',
      }),
    ).rejects.toThrow('DB deadlock');

    store.save = origSave;
  });
});
