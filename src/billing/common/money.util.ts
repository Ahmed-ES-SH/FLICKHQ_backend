/**
 * Money and currency helpers for the Billing module.
 *
 * All money is stored as integer minor units (e.g. cents for USD) to
 * avoid floating-point error. Stripe also uses minor units, which is
 * why this convention is used end-to-end.
 *
 * Currency codes are lowercase ISO-4217 3-letter codes (e.g. `usd`,
 * `eur`) to match Stripe's representation.
 */

/**
 * Lower-cases a currency code and validates it is a 3-letter string.
 *
 * Throws if the input is missing or not a 3-letter A-Z code.
 */
export function normalizeCurrency(input: string | undefined | null): string {
  if (typeof input !== 'string' || input.length !== 3) {
    throw new Error(
      `Invalid currency code: expected a 3-letter ISO-4217 code, got ${String(
        input,
      )}`,
    );
  }

  const upper = input.toUpperCase();
  if (!/^[A-Z]{3}$/.test(upper)) {
    throw new Error(`Invalid currency code: ${input}`);
  }

  return upper.toLowerCase();
}

/**
 * True when the value is a positive integer suitable for a money
 * amount in minor units. Zero is allowed for free items / trials.
 *
 * NaN, Infinity, decimals, and negative values all return false.
 */
export function isValidMinorAmount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0
  );
}

/**
 * Asserts that the value is a valid minor amount and returns it.
 * Throws with a clear message otherwise.
 */
export function assertValidMinorAmount(
  value: unknown,
  field = 'amount',
): number {
  if (!isValidMinorAmount(value)) {
    throw new Error(
      `Invalid ${field}: expected a non-negative integer minor-unit value, got ${String(
        value,
      )}`,
    );
  }
  return value;
}

/**
 * Asserts a strict positive (non-zero) minor amount.
 */
export function assertPositiveMinorAmount(
  value: unknown,
  field = 'amount',
): number {
  assertValidMinorAmount(value, field);
  if (value === 0) {
    throw new Error(`Invalid ${field}: must be greater than zero`);
  }
  return value as number;
}

/**
 * Stripe-style fraction digits per currency. Defaults to 2 for any
 * currency not in the table (which matches the vast majority of
 * ISO-4217 codes).
 *
 * This is informational only — the billing module always uses minor
 * units internally, so this is useful for display formatting and
 * for sanity-checking Stripe Price metadata.
 */
const CURRENCY_FRACTION_DIGITS: Record<string, number> = {
  bif: 0,
  clp: 0,
  djf: 0,
  gnf: 0,
  jpy: 0,
  kmf: 0,
  krw: 0,
  mga: 0,
  pyg: 0,
  rwf: 0,
  ugx: 0,
  vnd: 0,
  vuv: 0,
  xaf: 0,
  xof: 0,
  xpf: 0,
};

/**
 * Returns the number of fraction digits Stripe expects for a given
 * currency code (lowercase ISO-4217).
 */
export function getFractionDigits(currency: string): number {
  return CURRENCY_FRACTION_DIGITS[currency.toLowerCase()] ?? 2;
}

/**
 * Format a minor-unit amount as a human-readable string for the
 * given currency. Uses Intl.NumberFormat under the hood.
 */
export function formatMinorAmount(
  amount: number,
  currency: string,
  locale = 'en-US',
): string {
  assertValidMinorAmount(amount, 'amount');
  const code = normalizeCurrency(currency);
  const fractionDigits = getFractionDigits(code);
  const major = amount / Math.pow(10, fractionDigits);

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: code.toUpperCase(),
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(major);
}
