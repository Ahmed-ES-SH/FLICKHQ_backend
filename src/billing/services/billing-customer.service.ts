/**
 * BillingCustomerService
 *
 * Owns the lifecycle of a `BillingCustomer` row, which links an
 * application `User` to a Stripe Customer. All Stripe Customer API
 * calls for the v1 module go through this service.
 *
 * Responsibilities:
 *
 * - Get-or-create the `BillingCustomer` row for a user, creating
 *   the Stripe customer lazily on first reference.
 * - Backfill from `users.stripe_customer_id` when present, so that
 *   users created before this module existed don't lose their
 *   Stripe customer reference.
 * - Surface the active Stripe customer id to other billing
 *   services (checkout, subscription, portal).
 * - Emit `billing.customer.created` via `@nestjs/event-emitter`
 *   the first time a customer is persisted in this process.
 *
 * Design rules (enforced by review, not by code):
 *
 * - We never accept a customer id from a client. The only caller
 *   is the authenticated user context, identified by JWT `id`.
 * - We never delete a Stripe customer — Stripe owns the lifecycle
 *   and we mirror it.
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, QueryFailedError } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { BillingCustomer } from '../entities/billing-customer.entity';
import { BillingStripeService } from './billing-stripe.service';
import { User } from '../../user/schema/user.entity';
import { BILLING_EVENTS } from '../common/billing.constants';
import { normalizeCurrency } from '../common/money.util';

export interface CreateStripeCustomerInput {
  userId: number;
  email: string;
  name?: string | null;
}

/**
 * Subset of `Stripe.Customer` that `applyCustomerUpdate` accepts.
 *
 * Defined as a structural type so we don't depend on the Stripe
 * SDK's internal type names (the SDK exposes the Customer type
 * through `Stripe.Customers.Customer` historically, but the type
 * tree varies across versions; this duck-typed shape is the
 * minimum we need to update a local row).
 */
export interface StripeCustomerSnapshot {
  id: string;
  email?: string | null;
  name?: string | null;
  metadata?: Record<string, string | null> | null;
}

const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class BillingCustomerService {
  private readonly logger = new Logger(BillingCustomerService.name);

  constructor(
    @InjectRepository(BillingCustomer)
    private readonly customerRepository: Repository<BillingCustomer>,
    private readonly stripeService: BillingStripeService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Find a local customer row by `userId`. Returns null if no row
   * exists; callers that need a Stripe customer id should use
   * `getOrCreateForUser` instead.
   */
  async findByUserId(userId: number): Promise<BillingCustomer | null> {
    return this.customerRepository.findOne({ where: { userId } });
  }

  /**
   * Get-or-create the `BillingCustomer` for a user.
   *
   * Flow:
   *
   * 1. Look up the local row by `userId`.
   * 2. If absent, look at `users.stripe_customer_id` (the
   *    pre-billing-module backfill column) and create a local row
   *    pointing at that id.
   * 3. If that is also absent, look up the user to read email/name,
   *    call `stripe.customers.create`, and persist a new local row.
   * 4. Emit `billing.customer.created` on first creation.
   */
  async getOrCreateForUser(userId: number): Promise<BillingCustomer> {
    // Wrap the check-and-create in a pessimistic write lock on the
    // User row to serialize concurrent requests from the same user.
    // This prevents the race where two parallel checkout calls both
    // see no local customer row and each creates a separate Stripe
    // Customer, leaking orphans.
    return this.customerRepository.manager.transaction(async (manager) => {
      // 1. Acquire a write lock on the User row.
      const user = await manager.getRepository(User).findOne({
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user) {
        throw new Error(
          `User ${userId} not found while creating billing customer`,
        );
      }

      // 2. Re-check for a local customer row (concurrent request
      //    may have created one while we were waiting for the lock).
      const existing = await manager.getRepository(BillingCustomer).findOne({
        where: { userId },
      });
      if (existing) {
        return existing;
      }

      // 3. Backfill from users.stripe_customer_id if present.
      const backfilledId =
        user.stripeCustomerId && user.stripeCustomerId.length > 0
          ? user.stripeCustomerId
          : null;

      if (backfilledId) {
        const created = await this.createLocalRow({
          userId: user.id,
          email: user.email,
          name: user.name ?? null,
          stripeCustomerId: backfilledId,
          emitEvent: true,
          backfilled: true,
        });
        return created;
      }

      // 4. Create Stripe Customer and local row.
      const stripeCustomer = await this.stripeService.safeCall(() =>
        this.stripeService.getClient().customers.create({
          email: user.email,
          name: user.name ?? undefined,
          metadata: { userId: String(user.id) },
        }),
      );

      const created = await this.createLocalRow({
        userId: user.id,
        email: user.email,
        name: user.name ?? null,
        stripeCustomerId: stripeCustomer.id,
        emitEvent: true,
        backfilled: false,
      });

      // 5. Mirror the new id onto the user row for compatibility.
      if (user.stripeCustomerId !== stripeCustomer.id) {
        user.stripeCustomerId = stripeCustomer.id;
        await manager.getRepository(User).save(user);
      }

      return created;
    });
  }

  /**
   * Re-read the user, create the Stripe customer, and persist the
   * local row in one step. This is the v1 admin/repair helper:
   *
   * - If a local row already exists, the call is a no-op and the
   *   existing row is returned.
   * - If a Stripe customer id exists on the user but no local row,
   *   the local row is created against the existing Stripe id.
   * - Otherwise, a fresh Stripe customer is created.
   */
  async syncForUser(
    userId: number,
  ): Promise<{ customer: BillingCustomer; created: boolean }> {
    const existing = await this.findByUserId(userId);
    if (existing) {
      return { customer: existing, created: false };
    }
    const created = await this.getOrCreateForUser(userId);
    return { customer: created, created: true };
  }

  /**
   * Apply a Stripe webhook event to a local customer. Used by the
   * webhook pipeline (Phase 5) to keep name/email in sync.
   *
   * Returns the updated row, or null if no local row exists for the
   * Stripe customer id. Webhooks should treat null as "this event
   * doesn't apply to us" rather than an error.
   */
  async applyCustomerUpdate(
    stripeCustomer: StripeCustomerSnapshot,
  ): Promise<BillingCustomer | null> {
    const local = await this.customerRepository.findOne({
      where: { stripeCustomerId: stripeCustomer.id },
    });
    if (!local) return null;

    if (
      typeof stripeCustomer.email === 'string' &&
      stripeCustomer.email.length > 0 &&
      stripeCustomer.email !== local.email
    ) {
      local.email = stripeCustomer.email;
    }
    if (stripeCustomer.name !== undefined) {
      local.name = stripeCustomer.name ?? null;
    }
    if (
      stripeCustomer.metadata &&
      typeof stripeCustomer.metadata === 'object'
    ) {
      local.metadata = {
        ...(local.metadata ?? {}),
        ...stripeCustomer.metadata,
      };
    }

    return this.customerRepository.save(local);
  }

  /**
   * Create a new local `BillingCustomer` row, handling the unique-
   * violation race that happens when two parallel calls race to
   * create the same `user_id`. In that case we re-read the winning
   * row and return it.
   */
  private async createLocalRow(input: {
    userId: number;
    email: string;
    name: string | null;
    stripeCustomerId: string;
    emitEvent: boolean;
    backfilled: boolean;
  }): Promise<BillingCustomer> {
    const row = this.customerRepository.create({
      userId: input.userId,
      email: input.email,
      name: input.name,
      stripeCustomerId: input.stripeCustomerId,
      metadata: input.backfilled
        ? { backfilledFrom: 'users.stripe_customer_id' }
        : {},
    });

    try {
      const saved = await this.customerRepository.save(row);
      if (input.emitEvent) {
        this.eventEmitter.emit(BILLING_EVENTS.CUSTOMER_CREATED, {
          userId: saved.userId,
          billingCustomerId: saved.id,
          stripeCustomerId: saved.stripeCustomerId,
          backfilled: input.backfilled,
        });
        this.logger.log(
          `Billing customer created for user ${saved.userId} ` +
            `(stripe ${saved.stripeCustomerId}, backfilled=${input.backfilled})`,
        );
      }
      return saved;
    } catch (err) {
      if (
        err instanceof QueryFailedError &&
        (err as QueryFailedError & { code: string }).code ===
          PG_UNIQUE_VIOLATION
      ) {
        // Another request beat us to it. Re-read and return.
        const winner = await this.findByUserId(input.userId);
        if (winner) return winner;
      }
      throw err;
    }
  }

  /**
   * Normalize a currency code through the shared money helper. The
   * helper throws on bad input, so this is also the canonical place
   * to validate a currency at the service boundary.
   */
  normalizeCurrencyCode(currency: string): string {
    return normalizeCurrency(currency);
  }
}
