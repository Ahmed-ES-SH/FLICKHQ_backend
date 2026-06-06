import {
  assertKeyModeMatchesEnv,
  detectKeyMode,
  isWellFormedWebhookSecret,
  redactStripeSecrets,
  resolveStripeKey,
  StripeProvider,
  DEFAULT_STRIPE_API_VERSION,
} from './stripe.config';
import { ConfigService } from '@nestjs/config';

function makeConfig(values: Record<string, string | undefined>): ConfigService {
  return {
    get: <T = string>(key: string): T | undefined =>
      values[key] as T | undefined,
  } as unknown as ConfigService;
}

describe('stripe.config', () => {
  describe('detectKeyMode', () => {
    it('detects _test_ in restricted keys', () => {
      expect(detectKeyMode('rk_test_abcdef')).toBe('test');
    });

    it('detects _live_ in restricted keys', () => {
      expect(detectKeyMode('rk_live_abcdef')).toBe('live');
    });

    it('detects test/live for secret keys', () => {
      expect(detectKeyMode('sk_test_abcdef')).toBe('test');
      expect(detectKeyMode('sk_live_abcdef')).toBe('live');
    });

    it('throws on unknown prefix', () => {
      expect(() => detectKeyMode('pk_test_abc')).toThrow(/rk_\/sk_/);
    });

    it('throws when test/live cannot be determined', () => {
      expect(() => detectKeyMode('rk_abcdef')).toThrow(/test|live/);
    });
  });

  describe('resolveStripeKey', () => {
    it('prefers STRIPE_RESTRICTED_KEY when both are set', () => {
      const config = makeConfig({
        STRIPE_RESTRICTED_KEY: 'rk_test_abc',
        STRIPE_SECRET_KEY: 'sk_test_def',
      });
      const result = resolveStripeKey(config);
      expect(result.kind).toBe('restricted');
      expect(result.key).toBe('rk_test_abc');
      expect(result.mode).toBe('test');
    });

    it('falls back to STRIPE_SECRET_KEY', () => {
      const config = makeConfig({
        STRIPE_SECRET_KEY: 'sk_live_abc',
      });
      const result = resolveStripeKey(config);
      expect(result.kind).toBe('secret');
      expect(result.key).toBe('sk_live_abc');
      expect(result.mode).toBe('live');
    });

    it('throws when no key is configured', () => {
      const config = makeConfig({});
      expect(() => resolveStripeKey(config)).toThrow(/no key was provided/);
    });
  });

  describe('assertKeyModeMatchesEnv', () => {
    it('throws in production with a test key', () => {
      const config = makeConfig({ NODE_ENV: 'production' });
      expect(() => assertKeyModeMatchesEnv('test', config)).toThrow(
        /Refusing to start/,
      );
    });

    it('throws in test env with a live key', () => {
      const config = makeConfig({ NODE_ENV: 'test' });
      expect(() => assertKeyModeMatchesEnv('live', config)).toThrow(
        /Refusing to start/,
      );
    });

    it('accepts matching production/live pair', () => {
      const config = makeConfig({ NODE_ENV: 'production' });
      expect(() => assertKeyModeMatchesEnv('live', config)).not.toThrow();
    });

    it('accepts matching test/test pair', () => {
      const config = makeConfig({ NODE_ENV: 'test' });
      expect(() => assertKeyModeMatchesEnv('test', config)).not.toThrow();
    });

    it('accepts development with either mode (no throw)', () => {
      const dev = makeConfig({ NODE_ENV: 'development' });
      expect(() => assertKeyModeMatchesEnv('test', dev)).not.toThrow();
      expect(() => assertKeyModeMatchesEnv('live', dev)).not.toThrow();
    });
  });

  describe('redactStripeSecrets', () => {
    it('redacts restricted keys', () => {
      expect(redactStripeSecrets('rk_test_abc123xyz')).toBe(
        'rk_test_[REDACTED]',
      );
      expect(redactStripeSecrets('rk_live_abc123xyz')).toBe(
        'rk_live_[REDACTED]',
      );
    });

    it('redacts secret keys', () => {
      expect(redactStripeSecrets('sk_test_abc123xyz')).toBe(
        'sk_test_[REDACTED]',
      );
      expect(redactStripeSecrets('sk_live_abc123xyz')).toBe(
        'sk_live_[REDACTED]',
      );
    });

    it('redacts webhook secrets', () => {
      expect(redactStripeSecrets('whsec_abc123xyz')).toBe('whsec_[REDACTED]');
    });

    it('redacts multiple keys in a single string', () => {
      const result = redactStripeSecrets(
        'found sk_test_a and rk_live_b and whsec_c in payload',
      );
      expect(result).toBe(
        'found sk_test_[REDACTED] and rk_live_[REDACTED] and whsec_[REDACTED] in payload',
      );
    });

    it('handles objects by JSON-stringifying first', () => {
      const result = redactStripeSecrets({ key: 'sk_test_secret' });
      expect(result).toBe('{"key":"sk_test_[REDACTED]"}');
    });

    it('returns empty string for null / undefined / empty input', () => {
      expect(redactStripeSecrets(null)).toBe('');
      expect(redactStripeSecrets(undefined)).toBe('');
      expect(redactStripeSecrets('')).toBe('');
    });

    it('passes through strings without keys', () => {
      expect(redactStripeSecrets('no secrets here')).toBe('no secrets here');
    });

    it('does not redact random identifiers that look like keys', () => {
      // 'rk' followed by something not matching the expected pattern.
      expect(redactStripeSecrets('user_rk_extra_thing')).toBe(
        'user_rk_extra_thing',
      );
    });
  });

  describe('isWellFormedWebhookSecret', () => {
    it('returns true for whsec_-prefixed values', () => {
      expect(isWellFormedWebhookSecret('whsec_abc123')).toBe(true);
    });

    it('returns false for missing or wrong prefix', () => {
      expect(isWellFormedWebhookSecret(undefined)).toBe(false);
      expect(isWellFormedWebhookSecret('')).toBe(false);
      expect(isWellFormedWebhookSecret('sk_test_abc')).toBe(false);
      expect(isWellFormedWebhookSecret('whsecfake_abc')).toBe(false);
    });
  });

  describe('DEFAULT_STRIPE_API_VERSION', () => {
    it('is the planned version pin', () => {
      expect(DEFAULT_STRIPE_API_VERSION).toBe('2026-05-27.dahlia');
    });
  });

  describe('StripeProvider', () => {
    it('exposes the STRIPE_CLIENT token and uses the configured key', () => {
      expect(StripeProvider.provide).toBe('STRIPE_CLIENT');
      const config = makeConfig({
        STRIPE_RESTRICTED_KEY: 'rk_test_abc',
        STRIPE_API_VERSION: '2026-05-27.dahlia',
        NODE_ENV: 'development',
      });
      const client = StripeProvider.useFactory(config);
      expect(client).toBeDefined();
      // SDK stores the key internally; the instance must exist.
      expect(typeof client).toBe('object');
    });

    it('throws a clear error when no key is configured', () => {
      const config = makeConfig({});
      expect(() => StripeProvider.useFactory(config)).toThrow(
        /no key was provided/,
      );
    });

    it('throws when the key mode conflicts with NODE_ENV', () => {
      const config = makeConfig({
        STRIPE_RESTRICTED_KEY: 'rk_test_abc',
        NODE_ENV: 'production',
      });
      expect(() => StripeProvider.useFactory(config)).toThrow(/Refusing/);
    });
  });
});
