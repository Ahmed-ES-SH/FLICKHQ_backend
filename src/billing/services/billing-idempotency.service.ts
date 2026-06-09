/**
 * BillingIdempotencyService
 *
 * The v1 implementation of the `Idempotency-Key` requirement for
 * sensitive billing operations. The plan (line 666) calls out
 * checkout, subscription changes, portal, and refund commands as
 * endpoints that must require an idempotency key.
 *
 * Design:
 *
 * - Clients send an `Idempotency-Key` header. We hash the request
 *   body and persist (key, scope, userId, requestHash, status,
 *   responseSnapshot, expiresAt) in `billing_idempotency_keys`.
 * - On the next request with the same key:
 *     - same hash + status=completed → return the cached response.
 *     - same hash + status=in_progress → reject (Stripe's behavior).
 *     - different hash → 409 (caller reused the key for a
 *       different request, which is a client bug).
 *     - status=failed → caller is allowed to retry; we replace
 *       the row with a fresh in_progress entry.
 *     - expired → allowed to start over.
 * - Stale `in_progress` rows from a crashed worker are tolerated
 *   by the caller regenerating a new key. We do not auto-reap
 *   in v1 — a background sweeper is post-MVP.
 *
 * The service is intentionally small and dependency-light. It is
 * consumed by `BillingCheckoutService` (Phase 4) and can be reused
 * by the portal flow, refund command, and webhook-replay endpoint
 * in later phases.
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { createHash } from 'crypto';

import { BillingIdempotencyKey } from '../entities/billing-idempotency-key.entity';
import { BillingIdempotencyStatus } from '../common/billing.enums';
import {
  BillingIdempotencyConflictError,
  BillingIdempotencyInFlightError,
} from '../common/billing.errors';
import { DEFAULT_IDEMPOTENCY_TTL_MS } from '../common/billing.constants';

export interface IdempotencyContext {
  /** Raw value of the `Idempotency-Key` header. */
  key: string;
  /** Operation scope, e.g. `checkout.subscription`. */
  scope: string;
  /** Authenticated user id (or null for system callers). */
  userId: number | null;
  /**
   * JSON-serializable request body. The service hashes it; the
   * caller is responsible for the serialization format.
   */
  request: unknown;
}

export interface IdempotencyReservation {
  /** True when the caller is the first to use this key. */
  fresh: boolean;
  /**
   * Set when `fresh` is false and the existing row is in a
   * terminal state. The caller should return this as the response
   * verbatim (or throw the cached error, depending on `cachedError`).
   */
  cachedResponse: Record<string, unknown> | null;
  /**
   * Set when the existing row is `failed` or `expired`. The
   * service has flipped it back to `in_progress` and the caller
   * should re-run the operation, then call `recordSuccess` or
   * `recordFailure`.
   */
  retriable: boolean;
}

@Injectable()
export class BillingIdempotencyService {
  private readonly logger = new Logger(BillingIdempotencyService.name);

  constructor(
    @InjectRepository(BillingIdempotencyKey)
    private readonly idempotencyRepository: Repository<BillingIdempotencyKey>,
  ) {}

  /**
   * Normalize the header value. Trims whitespace, rejects empty
   * strings. Returns the canonical key to be stored.
   */
  normalizeKey(rawHeader: string | null | undefined): string {
    if (typeof rawHeader !== 'string') {
      throw new Error('Idempotency-Key header is required for this request.');
    }
    const trimmed = rawHeader.trim();
    if (trimmed.length === 0) {
      throw new Error('Idempotency-Key header cannot be empty.');
    }
    if (trimmed.length > 255) {
      throw new Error('Idempotency-Key header is too long (max 255 chars).');
    }
    return trimmed;
  }

  /**
   * Hash the request body deterministically. We use SHA-256 over
   * a stable JSON serialization. Keys, not values, are sorted
   * recursively so `{a:1,b:2}` and `{b:2,a:1}` hash the same.
   */
  hashRequest(request: unknown): string {
    return createHash('sha256').update(stableStringify(request)).digest('hex');
  }

  /**
   * Reserve the (key, scope) tuple. Returns a reservation that
   * tells the caller what to do next:
   *
   * - `fresh=true` → caller is the first to use the key. Run the
   *   operation, then call `recordSuccess` or `recordFailure`.
   * - `fresh=false, cachedResponse=...` → caller should return the
   *   cached response without doing any work.
   * - `fresh=false, retriable=true` → caller is retrying after a
   *   previous failure. Run the operation, then call
   *   `recordSuccess` or `recordFailure` (the existing row has
   *   already been flipped back to in_progress).
   * - otherwise the caller is replaying an in-flight request
   *   → 409.
   */
  async reserve(
    context: IdempotencyContext,
    options: { ttlMs?: number } = {},
  ): Promise<IdempotencyReservation> {
    const ttl = options.ttlMs ?? DEFAULT_IDEMPOTENCY_TTL_MS;
    const requestHash = this.hashRequest(context.request);
    const expiresAt = new Date(Date.now() + ttl);

    const existing = await this.idempotencyRepository.findOne({
      where: { key: context.key },
    });

    if (!existing) {
      const row = this.idempotencyRepository.create({
        key: context.key,
        scope: context.scope,
        userId: context.userId,
        requestHash,
        status: BillingIdempotencyStatus.IN_PROGRESS,
        expiresAt,
        responseSnapshot: null,
      });
      try {
        await this.idempotencyRepository.save(row);
        this.logger.log(
          `Idempotency reservation created: key=${context.key} scope=${context.scope} user=${context.userId ?? 'system'}`,
        );
        return { fresh: true, cachedResponse: null, retriable: false };
      } catch (err) {
        // Unique-constraint race: another worker reserved the
        // key first. Re-read and route as if we had found a row.
        const winner = await this.idempotencyRepository.findOne({
          where: { key: context.key },
        });
        if (winner) {
          return this.classifyExisting(winner, requestHash, expiresAt);
        }
        throw err;
      }
    }

    return this.classifyExisting(existing, requestHash, expiresAt);
  }

  /**
   * Mark a reservation as completed and persist the response
   * snapshot. Subsequent calls with the same key + hash will
   * return this snapshot.
   */
  async recordSuccess(
    key: string,
    response: Record<string, unknown>,
  ): Promise<void> {
    // We use save() rather than update() because TypeORM's deep
    // partial type is too strict for `Record<string, unknown>`
    // jsonb columns — update() refuses to accept a plain
    // Record value where the entity column allows null.
    const existing = await this.idempotencyRepository.findOne({
      where: { key },
    });
    if (!existing) {
      this.logger.warn(
        `recordSuccess called for unknown idempotency key ${key}`,
      );
      return;
    }
    existing.status = BillingIdempotencyStatus.COMPLETED;
    existing.responseSnapshot = response;
    await this.idempotencyRepository.save(existing);
  }

  /**
   * Mark a reservation as failed. The reservation row is kept
   * (so we don't accidentally re-create a row that we already
   * used) but `responseSnapshot` stays null, meaning the next
   * caller with the same hash will be allowed to retry.
   */
  async recordFailure(key: string): Promise<void> {
    const existing = await this.idempotencyRepository.findOne({
      where: { key },
    });
    if (!existing) {
      this.logger.warn(
        `recordFailure called for unknown idempotency key ${key}`,
      );
      return;
    }
    existing.status = BillingIdempotencyStatus.FAILED;
    existing.responseSnapshot = null;
    await this.idempotencyRepository.save(existing);
  }

  /**
   * Drop a reservation. Used when the operation itself throws
   * before it can be classified as success or failure (e.g. a
   * 400 validation error from upstream). After this call the
   * key is freed and the next caller can start over.
   */
  async release(key: string): Promise<void> {
    await this.idempotencyRepository.delete({ key });
  }

  private async classifyExisting(
    existing: BillingIdempotencyKey,
    requestHash: string,
    newExpiresAt: Date,
  ): Promise<IdempotencyReservation> {
    if (existing.requestHash !== requestHash) {
      throw new BillingIdempotencyConflictError(existing.key);
    }

    if (existing.expiresAt.getTime() <= Date.now()) {
      // Key has expired. If status is COMPLETED, return the cached
      // response even though the row is idle — the operation
      // succeeded and we can serve the result. For FAILED / EXPIRED
      // (or IN_PROGRESS from a crashed worker), try a conditional
      // update to claim the slot.
      switch (existing.status) {
        case BillingIdempotencyStatus.COMPLETED:
          return {
            fresh: false,
            cachedResponse: existing.responseSnapshot ?? {},
            retriable: false,
          };

        case BillingIdempotencyStatus.FAILED:
        case BillingIdempotencyStatus.EXPIRED: {
          const updateResult = await this.idempotencyRepository.update(
            {
              key: existing.key,
              status: In([
                BillingIdempotencyStatus.FAILED,
                BillingIdempotencyStatus.EXPIRED,
              ]),
            },
            {
              status: BillingIdempotencyStatus.IN_PROGRESS,
              responseSnapshot: null,
              expiresAt: newExpiresAt,
            },
          );

          if ((updateResult.affected ?? 0) === 0) {
            // Another concurrent request beat us to flipping it
            // to IN_PROGRESS.
            throw new BillingIdempotencyInFlightError(existing.key);
          }

          this.logger.log(
            `Idempotency key ${existing.key} expired; flipped back to in_progress.`,
          );
          return { fresh: false, cachedResponse: null, retriable: true };
        }

        case BillingIdempotencyStatus.IN_PROGRESS:
        default:
          throw new BillingIdempotencyInFlightError(existing.key);
      }
    }

    switch (existing.status) {
      case BillingIdempotencyStatus.COMPLETED:
        return {
          fresh: false,
          cachedResponse: existing.responseSnapshot ?? {},
          retriable: false,
        };
      case BillingIdempotencyStatus.FAILED: {
        const updateResult = await this.idempotencyRepository.update(
          {
            key: existing.key,
            status: BillingIdempotencyStatus.FAILED,
          },
          {
            status: BillingIdempotencyStatus.IN_PROGRESS,
            responseSnapshot: null,
            expiresAt: newExpiresAt,
          },
        );

        if ((updateResult.affected ?? 0) === 0) {
          // Another concurrent request beat us to flipping it
          // to IN_PROGRESS.
          throw new BillingIdempotencyInFlightError(existing.key);
        }
        return { fresh: false, cachedResponse: null, retriable: true };
      }

      case BillingIdempotencyStatus.IN_PROGRESS:
      case BillingIdempotencyStatus.EXPIRED:
      default:
        throw new BillingIdempotencyInFlightError(existing.key);
    }
  }
}

/**
 * Stable JSON stringification with sorted keys. Used by the
 * idempotency service so the request hash is independent of
 * property ordering.
 */
function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => sortKeys(v));
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) {
      sorted[k] = sortKeys(obj[k]);
    }
    return sorted;
  }
  return value;
}
