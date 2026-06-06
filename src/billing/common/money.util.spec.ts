import {
  assertPositiveMinorAmount,
  assertValidMinorAmount,
  formatMinorAmount,
  getFractionDigits,
  isValidMinorAmount,
  normalizeCurrency,
} from './money.util';

describe('money.util', () => {
  describe('normalizeCurrency', () => {
    it('lowercases valid 3-letter codes', () => {
      expect(normalizeCurrency('USD')).toBe('usd');
      expect(normalizeCurrency('Eur')).toBe('eur');
      expect(normalizeCurrency('gbp')).toBe('gbp');
    });

    it('throws on non-string input', () => {
      expect(() => normalizeCurrency(undefined)).toThrow(/3-letter/);
      expect(() => normalizeCurrency(null)).toThrow(/3-letter/);
      // @ts-expect-error testing runtime guard
      expect(() => normalizeCurrency(123)).toThrow(/3-letter/);
    });

    it('throws on wrong length', () => {
      expect(() => normalizeCurrency('us')).toThrow(/3-letter/);
      expect(() => normalizeCurrency('usdd')).toThrow(/3-letter/);
    });

    it('throws on non-letter characters', () => {
      expect(() => normalizeCurrency('u1d')).toThrow(/Invalid currency/);
      expect(() => normalizeCurrency('US-')).toThrow(/Invalid currency/);
    });
  });

  describe('isValidMinorAmount', () => {
    it('accepts non-negative integers', () => {
      expect(isValidMinorAmount(0)).toBe(true);
      expect(isValidMinorAmount(1)).toBe(true);
      expect(isValidMinorAmount(99999999)).toBe(true);
    });

    it('rejects negatives, decimals, NaN, Infinity, non-numbers', () => {
      expect(isValidMinorAmount(-1)).toBe(false);
      expect(isValidMinorAmount(1.5)).toBe(false);
      expect(isValidMinorAmount(Number.NaN)).toBe(false);
      expect(isValidMinorAmount(Number.POSITIVE_INFINITY)).toBe(false);
      expect(isValidMinorAmount('1')).toBe(false);
      expect(isValidMinorAmount(null)).toBe(false);
      expect(isValidMinorAmount(undefined)).toBe(false);
      expect(isValidMinorAmount({})).toBe(false);
    });
  });

  describe('assertValidMinorAmount', () => {
    it('returns the value when valid', () => {
      expect(assertValidMinorAmount(0)).toBe(0);
      expect(assertValidMinorAmount(2599, 'amount')).toBe(2599);
    });

    it('throws on invalid values with field name in message', () => {
      expect(() => assertValidMinorAmount(-1, 'unit_amount')).toThrow(
        /unit_amount/,
      );
      expect(() => assertValidMinorAmount(1.5, 'unit_amount')).toThrow(
        /unit_amount/,
      );
    });
  });

  describe('assertPositiveMinorAmount', () => {
    it('accepts values greater than zero', () => {
      expect(assertPositiveMinorAmount(1)).toBe(1);
      expect(assertPositiveMinorAmount(99_999)).toBe(99_999);
    });

    it('rejects zero with a clear message', () => {
      expect(() => assertPositiveMinorAmount(0)).toThrow(/greater than zero/);
    });

    it('rejects negatives, decimals, NaN', () => {
      expect(() => assertPositiveMinorAmount(-1)).toThrow();
      expect(() => assertPositiveMinorAmount(2.5)).toThrow();
      expect(() => assertPositiveMinorAmount(Number.NaN)).toThrow();
    });
  });

  describe('getFractionDigits', () => {
    it('returns 0 for the 14 known zero-decimal ISO-4217 currencies', () => {
      const zeroDecimal = [
        'bif',
        'clp',
        'djf',
        'gnf',
        'jpy',
        'kmf',
        'krw',
        'mga',
        'pyg',
        'rwf',
        'ugx',
        'vnd',
        'vuv',
        'xaf',
        'xof',
        'xpf',
      ];
      for (const c of zeroDecimal) {
        expect(getFractionDigits(c)).toBe(0);
      }
    });

    it('returns 2 for two-decimal currencies (default)', () => {
      expect(getFractionDigits('usd')).toBe(2);
      expect(getFractionDigits('eur')).toBe(2);
      expect(getFractionDigits('gbp')).toBe(2);
    });

    it('is case-insensitive', () => {
      expect(getFractionDigits('JPY')).toBe(0);
      expect(getFractionDigits('USD')).toBe(2);
    });
  });

  describe('formatMinorAmount', () => {
    it('formats two-decimal currencies as a string', () => {
      const result = formatMinorAmount(2599, 'usd');
      expect(typeof result).toBe('string');
      expect(result).toContain('25.99');
      expect(result).toMatch(/\$/);
    });

    it('formats zero-decimal currencies without decimals', () => {
      const result = formatMinorAmount(1500, 'jpy');
      expect(result).toContain('1,500');
      expect(result).not.toContain('.');
    });

    it('respects the locale option', () => {
      const deResult = formatMinorAmount(2599, 'eur', 'de-DE');
      // German formatting for EUR uses comma as decimal separator.
      expect(deResult).toMatch(/25,99/);
    });

    it('rejects invalid amounts and currencies', () => {
      expect(() => formatMinorAmount(-1, 'usd')).toThrow(/Invalid amount/);
      expect(() => formatMinorAmount(100, 'xx')).toThrow(/Invalid currency/);
    });
  });
});
