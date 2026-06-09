import { Test, TestingModule } from '@nestjs/testing';
import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { FeatureAccessGuard } from './feature-access.guard';
import { BillingEntitlementsService } from '../services/billing-entitlements.service';
import { REQUIRES_FEATURE_METADATA } from '../common/billing.constants';

interface EntitlementsServiceMock {
  canAccess: jest.Mock;
}

interface MockContextOptions {
  metadata?: string[];
  user?: { id?: number } | null;
  handler?: unknown;
  cls?: unknown;
}

function makeContext(opts: MockContextOptions = {}): ExecutionContext {
  const request = {
    user: opts.user === null ? undefined : opts.user,
  };
  // Stable handler / class references so test assertions can
  // compare against the same functions that were captured
  // during `canActivate`.
  const handler = opts.handler ?? (() => undefined);
  const cls = opts.cls ?? (() => undefined);
  return {
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
  } as unknown as ExecutionContext;
}

/* eslint-disable @typescript-eslint/unbound-method */
describe('FeatureAccessGuard', () => {
  let guard: FeatureAccessGuard;
  let reflector: jest.Mocked<Reflector>;
  let entitlements: EntitlementsServiceMock;

  beforeEach(async () => {
    entitlements = {
      canAccess: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeatureAccessGuard,
        {
          provide: Reflector,
          useValue: {
            getAllAndOverride: jest.fn(),
          },
        },
        {
          provide: BillingEntitlementsService,
          useValue: entitlements,
        },
      ],
    }).compile();

    guard = module.get(FeatureAccessGuard);
    reflector = module.get(Reflector);
  });

  describe('metadata handling', () => {
    it('returns true when no metadata is set', async () => {
      reflector.getAllAndOverride.mockReturnValueOnce(undefined);
      const ctx = makeContext({ user: { id: 1 } });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(entitlements.canAccess).not.toHaveBeenCalled();
    });

    it('returns true when the metadata array is empty', async () => {
      reflector.getAllAndOverride.mockReturnValueOnce([]);
      const ctx = makeContext({ user: { id: 1 } });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(entitlements.canAccess).not.toHaveBeenCalled();
    });

    it('reads metadata from the handler first, then the class', async () => {
      reflector.getAllAndOverride.mockReturnValueOnce(['premium_reports']);
      entitlements.canAccess.mockResolvedValueOnce(true);
      const ctx = makeContext({ user: { id: 1 } });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
        REQUIRES_FEATURE_METADATA,
        [ctx.getHandler(), ctx.getClass()],
      );
    });
  });

  describe('authentication context', () => {
    it('throws UnauthorizedException when user is missing', async () => {
      reflector.getAllAndOverride.mockReturnValueOnce(['premium_reports']);
      const ctx = makeContext({ user: null });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(entitlements.canAccess).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when userId is not a positive integer', async () => {
      reflector.getAllAndOverride.mockReturnValueOnce(['premium_reports']);
      const ctx = makeContext({ user: { id: 0 } });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('entitlement checks', () => {
    it('returns true when the user has every required feature', async () => {
      reflector.getAllAndOverride.mockReturnValueOnce([
        'premium_reports',
        'team_export',
      ]);
      entitlements.canAccess
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true);
      const ctx = makeContext({ user: { id: 42 } });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(entitlements.canAccess).toHaveBeenCalledTimes(2);
      expect(entitlements.canAccess).toHaveBeenNthCalledWith(
        1,
        42,
        'premium_reports',
      );
      expect(entitlements.canAccess).toHaveBeenNthCalledWith(
        2,
        42,
        'team_export',
      );
    });

    it('throws ForbiddenException listing the missing key when one is absent', async () => {
      reflector.getAllAndOverride.mockReturnValueOnce(['premium_reports']);
      entitlements.canAccess.mockResolvedValueOnce(false);
      const ctx = makeContext({ user: { id: 42 } });
      const promise = guard.canActivate(ctx);
      await expect(promise).rejects.toBeInstanceOf(ForbiddenException);
      await expect(promise).rejects.toThrow(/premium_reports/);
    });

    it('throws ForbiddenException listing all missing keys when multiple are absent', async () => {
      reflector.getAllAndOverride.mockReturnValueOnce(['a', 'b', 'c']);
      entitlements.canAccess
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      const ctx = makeContext({ user: { id: 42 } });
      const promise = guard.canActivate(ctx);
      await expect(promise).rejects.toBeInstanceOf(ForbiddenException);
      await expect(promise).rejects.toThrow(/a/);
      await expect(promise).rejects.toThrow(/c/);
    });

    it('short-circuits on an empty / invalid feature key', async () => {
      reflector.getAllAndOverride.mockReturnValueOnce(['']);
      const ctx = makeContext({ user: { id: 42 } });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      // The empty key never reached the entitlements service.
      expect(entitlements.canAccess).not.toHaveBeenCalled();
    });
  });
});
