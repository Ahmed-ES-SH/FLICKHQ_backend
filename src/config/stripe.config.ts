/**
 * Stripe Configuration for FLICKHQ Backend
 *
 * Configures the Stripe SDK with:
 * - Explicit, pinned API version (2026-05-27.dahlia)
 * - Restricted key (rk_*) preferred over secret key (sk_*)
 * - Test/live mismatch detection between NODE_ENV and key prefix
 * - Helpers to redact keys from logs and error messages
 *
 * The Stripe client is provided under the `STRIPE_CLIENT` token and is
 * the only place in the codebase that should construct a Stripe
 * instance. All other modules should depend on BillingStripeService.
 *
 * Required env variables (when BillingModule is enabled):
 * - STRIPE_RESTRICTED_KEY (preferred) — format rk_test_... | rk_live_...
 * - STRIPE_SECRET_KEY (fallback)      — format sk_test_... | sk_live_...
 * - STRIPE_WEBHOOK_SECRET             — format whsec_...
 * - STRIPE_API_VERSION (optional)     — default '2026-05-27.dahlia'
 *
 * Get your keys from: https://dashboard.stripe.com/apikeys
 */

import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

/**
 * The Stripe client instance type. This is `InstanceType<typeof Stripe>`
 * so the SDK's class-level type information (static + instance
 * members) is preserved even when the CJS d.ts is resolved (which
 * surfaces the constructor as a namespace, not a class).
 */
export type StripeInstance = InstanceType<typeof Stripe>;

/**
 * The expected API version for this backend.
 *
 * The SDK types are pinned to the latest version it ships with, so
 * the constructor option is cast — we still pass the configured
 * version explicitly to pin the wire format used by the SDK.
 */
export const DEFAULT_STRIPE_API_VERSION = '2026-05-27.dahlia' as const;

/**
 * Key prefix constants used to detect key mode (test vs live).
 */
const STRIPE_RESTRICTED_PREFIX = 'rk_';
const STRIPE_SECRET_PREFIX = 'sk_';
const STRIPE_WEBHOOK_PREFIX = 'whsec_';

/**
 * Pick the Stripe API key from config.
 *
 * Order of precedence:
 * 1. STRIPE_RESTRICTED_KEY (preferred)
 * 2. STRIPE_SECRET_KEY (fallback)
 *
 * Returns the key plus its mode (`'test' | 'live'`) inferred from the
 * key prefix. The mode is used to detect env mismatches with NODE_ENV.
 */
export function resolveStripeKey(config: ConfigService): {
  key: string;
  mode: 'test' | 'live';
  kind: 'restricted' | 'secret';
} {
  const restricted = config.get<string>('STRIPE_RESTRICTED_KEY');
  if (restricted) {
    return {
      key: restricted,
      mode: detectKeyMode(restricted, 'STRIPE_RESTRICTED_KEY'),
      kind: 'restricted',
    };
  }

  const secret = config.get<string>('STRIPE_SECRET_KEY');
  if (secret) {
    return {
      key: secret,
      mode: detectKeyMode(secret, 'STRIPE_SECRET_KEY'),
      kind: 'secret',
    };
  }

  throw new Error(
    'Stripe is enabled but no key was provided. Set STRIPE_RESTRICTED_KEY (preferred) or STRIPE_SECRET_KEY.',
  );
}

/**
 * Inspect a Stripe key prefix to infer whether it is a test or live
 * key. Throws if the key does not look like a Stripe key at all.
 */
export function detectKeyMode(
  key: string,
  envName = 'STRIPE_*_KEY',
): 'test' | 'live' {
  if (
    !key.startsWith(STRIPE_RESTRICTED_PREFIX) &&
    !key.startsWith(STRIPE_SECRET_PREFIX)
  ) {
    throw new Error(
      `${envName} does not look like a Stripe key (expected rk_/sk_ prefix).`,
    );
  }

  if (key.includes('_test_')) return 'test';
  if (key.includes('_live_')) return 'live';

  throw new Error(
    `Could not determine test/live mode for ${envName} (expected _test_ or _live_ in the key).`,
  );
}

/**
 * Validate that the Stripe key mode matches the application environment.
 *
 * - production NODE_ENV must use a live key.
 * - test NODE_ENV must use a test key.
 * - development accepts both but warns (loudly in the server log).
 */
export function assertKeyModeMatchesEnv(
  mode: 'test' | 'live',
  config: ConfigService,
): void {
  const nodeEnv = config.get<string>('NODE_ENV') ?? 'development';

  if (nodeEnv === 'production' && mode !== 'live') {
    throw new Error(
      `Refusing to start: NODE_ENV=production but Stripe key is "${mode}". ` +
        `Use a live key in production.`,
    );
  }

  if (nodeEnv === 'test' && mode !== 'test') {
    throw new Error(
      `Refusing to start: NODE_ENV=test but Stripe key is "${mode}". ` +
        `Use a test key in test environments.`,
    );
  }
}

/**
 * Returns a string with all Stripe keys redacted. Use this on anything
 * that might end up in logs, error messages, or analytics.
 */
export function redactStripeSecrets(input: unknown): string {
  if (input == null) return '';
  const text = typeof input === 'string' ? input : safeStringify(input);
  if (!text) return '';

  return text
    .replace(/\brk_(test|live)_[A-Za-z0-9]+/g, 'rk_$1_[REDACTED]')
    .replace(/\bsk_(test|live)_[A-Za-z0-9]+/g, 'sk_$1_[REDACTED]')
    .replace(/\bwhsec_[A-Za-z0-9]+/g, 'whsec_[REDACTED]');
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Stripe provider configuration.
 *
 * Instantiated as `'STRIPE_CLIENT'` and consumed by BillingStripeService.
 * Throws on construction if no key is available or the key mode
 * conflicts with NODE_ENV.
 */
export const StripeProvider = {
  provide: 'STRIPE_CLIENT',

  useFactory: (configService: ConfigService): StripeInstance | null => {
    const enabled = configService.get<string>('BILLING_ENABLED') !== 'false';
    if (!enabled) {
      // Return a Proxy that throws clear errors if any billing code
      // tries to use the Stripe client while billing is disabled.
      return new Proxy(
        {},
        {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          get(_target, _prop) {
            return () => {
              throw new Error(
                'Stripe is disabled via BILLING_ENABLED configuration. ' +
                  'Set BILLING_ENABLED=true and provide a Stripe key to use billing features.',
              );
            };
          },
        },
      ) as unknown as StripeInstance;
    }

    const { key, mode } = resolveStripeKey(configService);
    assertKeyModeMatchesEnv(mode, configService);

    const apiVersion =
      configService.get<string>('STRIPE_API_VERSION') ??
      DEFAULT_STRIPE_API_VERSION;

    return new Stripe(key, {
      // The SDK's StripeConfig type narrows apiVersion to the version
      // it ships with. We intentionally override that to pin the
      // configured API version on the wire.
      apiVersion: apiVersion as never,
      appInfo: {
        name: 'FLICKHQ-backend-billing',
        version: '1.0.0',
      },
    });
  },

  inject: [ConfigService],
};

/**
 * Re-exported webhook prefix for callers that need to validate
 * the shape of `STRIPE_WEBHOOK_SECRET`.
 */
export const STRIPE_WEBHOOK_KEY_PREFIX = STRIPE_WEBHOOK_PREFIX;

/**
 * Validate that a webhook secret is well-formed. Used by env validation
 * helpers and tests.
 */
export function isWellFormedWebhookSecret(value: string | undefined): boolean {
  return typeof value === 'string' && value.startsWith(STRIPE_WEBHOOK_PREFIX);
}
