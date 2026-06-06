/**
 * FeatureAccessGuard
 *
 * Nest guard that enforces `@RequiresFeature` metadata on
 * controllers. Used together with the global `AuthGuard` — by
 * the time this guard runs, `request.user` has been populated
 * with the JWT-decoded payload.
 *
 * Behavior:
 *
 * - Reads the metadata via `Reflector.getAllAndOverride` from
 *   method + class levels. Empty / missing metadata → the guard
 *   is a no-op (returns `true`).
 * - For each required feature key, calls
 *   `BillingEntitlementsService.canAccess(userId, key)`.
 * - If any key is missing, throws `ForbiddenException` listing
 *   the missing keys.
 * - If `request.user` is missing (theoretically impossible
 *   after the global `AuthGuard` has populated it, but we
 *   defend anyway), throws `UnauthorizedException` with a
 *   pointer to the upstream guard.
 *
 * Usage:
 *
 *   @UseGuards(FeatureAccessGuard)
 *   @RequiresFeature('premium_reports')
 *   @Get('reports')
 *   getReports() { ... }
 *
 * Application modules that need to gate features import this
 * guard from `@/billing/guards/feature-access.guard` and the
 * decorator from `@/billing/decorators/requires-feature.decorator`.
 * The billing module does not export a sample guarded route
 * itself — the guard is a building block.
 */

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';

import { REQUIRES_FEATURE_METADATA } from '../common/billing.constants';
import { BillingEntitlementsService } from '../services/billing-entitlements.service';

interface RequestWithUser extends Request {
  user?: { id?: number };
}

@Injectable()
export class FeatureAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlements: BillingEntitlementsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(
      REQUIRES_FEATURE_METADATA,
      [context.getHandler(), context.getClass()],
    );

    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    const userId = user?.id;

    if (
      typeof userId !== 'number' ||
      !Number.isInteger(userId) ||
      userId <= 0
    ) {
      throw new UnauthorizedException(
        'FeatureAccessGuard requires an authenticated user context (set by the global AuthGuard).',
      );
    }

    const missing: string[] = [];
    for (const key of required) {
      // canAccess also validates userId/featureKey, but we have
      // already guarded userId above. Defensive `if` to short-
      // circuit on a bad key without leaking a 500.
      if (typeof key !== 'string' || key.length === 0) {
        missing.push(String(key));
        continue;
      }
      const allowed = await this.entitlements.canAccess(userId, key);
      if (!allowed) {
        missing.push(key);
      }
    }

    if (missing.length > 0) {
      throw new ForbiddenException(
        `Missing required billing feature key(s): ${missing.join(', ')}.`,
      );
    }

    return true;
  }
}
