/**
 * Sync Local Plans & Prices to Stripe Products & Prices
 *
 * Reads all BillingPlans and BillingPrices from the local database
 * where `stripePriceId` is a placeholder (starts with `seed_`) and
 * creates real Stripe Products and Prices in the connected Stripe
 * account. Updates the local DB records with the real Stripe IDs.
 *
 * This script only creates resources that don't already have real
 * Stripe IDs — it is safe to re-run.
 *
 * Usage:
 *   npx tsx src/database/seeds/sync-stripe-products.ts
 *
 * Prerequisites:
 *   - .env file with DATABASE_URL and STRIPE_SECRET_KEY (or
 *     STRIPE_RESTRICTED_KEY with Product/Price write permissions)
 *   - Database must already have plans and prices seeded
 *     (run `pnpm run seed:run` first)
 */

import 'reflect-metadata';
import { config } from 'dotenv';
config({ path: '.env' });

import { DataSource } from 'typeorm';
import Stripe from 'stripe';

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

interface PlanRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  features: string[];
  metadata: Record<string, unknown>;
}

interface PriceRow {
  id: string;
  plan_id: string;
  stripe_price_id: string;
  stripe_product_id: string | null;
  currency: string;
  unit_amount: number;
  interval: string | null;
  trial_period_days: number | null;
  active: boolean;
}

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

/** Check whether a StripePriceId is a seed placeholder. */
function isPlaceholder(pid: string): boolean {
  return pid.startsWith('seed_');
}

/** Convert a local code to a Stripe-product-safe ID prefix. */
function slugify(code: string): string {
  return code.replace(/_/g, '-').toLowerCase();
}

// ────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n🔗 Syncing local plans & prices to Stripe...\n');
  const startTime = Date.now();

  // ── 1. Load env ──────────────────────────────────────────────

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('❌ DATABASE_URL is required in .env');
    process.exit(1);
  }

  const stripeKey =
    process.env.STRIPE_RESTRICTED_KEY || process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    console.error(
      '❌ STRIPE_RESTRICTED_KEY or STRIPE_SECRET_KEY is required in .env',
    );
    process.exit(1);
  }

  // ── 2. Connect to DB ─────────────────────────────────────────

  const ds = new DataSource({
    type: 'postgres',
    url: databaseUrl,
    ssl:
      process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: true, ca: process.env.DB_SSL_CERT }
        : false,
    entities: [],
    synchronize: false,
    logging: false,
  });

  await ds.initialize();
  console.log('✅ Database connected\n');

  // ── 3. Init Stripe ───────────────────────────────────────────

  const stripe = new Stripe(stripeKey, {
    apiVersion: (process.env.STRIPE_API_VERSION ??
      '2026-05-27.dahlia') as never,
    appInfo: {
      name: 'FLICKHQ-billing-sync',
      version: '1.0.0',
    },
  });
  console.log('✅ Stripe client initialized (test mode)\n');

  // ── 4. Fetch local plans + prices ────────────────────────────

  const plans = (await ds.query(
    'SELECT id, code, name, description, features, metadata FROM billing_plans ORDER BY display_order',
  )) as PlanRow[];

  const allPrices = (await ds.query(
    'SELECT id, plan_id, stripe_price_id, stripe_product_id, currency, unit_amount, interval, trial_period_days, active FROM billing_prices ORDER BY unit_amount ASC',
  )) as PriceRow[];

  // Filter to prices that still have placeholder stripePriceId
  const placeholderPrices = allPrices.filter((p) =>
    isPlaceholder(p.stripe_price_id),
  );

  if (placeholderPrices.length === 0) {
    console.log(
      '✨ No placeholder prices found — all prices already have real Stripe IDs.\n',
    );
    await ds.destroy();
    return;
  }

  console.log(
    `📦 Found ${placeholderPrices.length} price(s) with placeholder IDs across ${plans.length} plan(s).\n`,
  );

  // ── 5. Create Stripe Products + Prices ───────────────────────

  let productsCreated = 0;
  let pricesCreated = 0;
  let productsSkipped = 0;
  let pricesSkipped = 0;

  for (const plan of plans) {
    const planPrices = placeholderPrices.filter(
      (p) => p.plan_id === plan.id,
    );
    if (planPrices.length === 0) {
      productsSkipped++;
      continue;
    }

    // ── 5a. Create Stripe Product for this plan ────────────────
    const productSlug = `flickhq-${slugify(plan.code)}`;
    let stripeProductId: string;

    // Check if the product already exists in Stripe (by looking up
    // any price that already has a real product ID for this plan)
    const existingRealProduct = allPrices.find(
      (p) =>
        p.plan_id === plan.id &&
        p.stripe_product_id &&
        !isPlaceholder(p.stripe_product_id),
    );

    if (existingRealProduct?.stripe_product_id) {
      stripeProductId = existingRealProduct.stripe_product_id;
      console.log(`  → Product already exists for "${plan.code}": ${stripeProductId}`);
      productsSkipped++;
    } else {
      const product = await stripe.products.create({
        name: plan.name,
        id: productSlug,
        description: plan.description ?? undefined,
        metadata: {
          localPlanId: plan.id,
          planCode: plan.code,
          ...(plan.metadata as Record<string, string>),
        },
        // NOTE: No default_price — we set prices individually below.
      });
      stripeProductId = product.id;
      productsCreated++;
      console.log(`  ✅ Product created for "${plan.code}": ${stripeProductId}`);
    }

    // ── 5b. Create Stripe Prices for this plan ─────────────────
    for (const price of planPrices) {
      const recurring: {
        interval: 'day' | 'week' | 'month' | 'year';
        trial_period_days?: number;
      } | undefined =
        price.interval
          ? {
              interval: price.interval as
                | 'day'
                | 'week'
                | 'month'
                | 'year',
              trial_period_days: price.trial_period_days ?? undefined,
            }
          : undefined;

      const stripePrice = await stripe.prices.create({
        product: stripeProductId,
        currency: price.currency,
        unit_amount: price.unit_amount,
        recurring,
        active: price.active,
        metadata: {
          localPriceId: price.id,
          localPlanId: plan.id,
        },
      });

      // Update the local DB record with the real Stripe IDs
      await ds.query(
        `UPDATE billing_prices
         SET stripe_price_id = $1,
             stripe_product_id = $2
         WHERE id = $3`,
        [stripePrice.id, stripeProductId, price.id],
      );

      pricesCreated++;
      console.log(
        `  ✅ Price created for "${plan.code}" (${price.currency} ${price.unit_amount}):
         Local:  ${price.stripe_price_id}
         Stripe: ${stripePrice.id}`,
      );
    }
  }

  // ── 6. Summary ───────────────────────────────────────────────

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n───────────────────────────────────────');
  console.log('🎉 Stripe sync completed!');
  console.log(`   Products created: ${productsCreated}`);
  console.log(`   Products skipped: ${productsSkipped}`);
  console.log(`   Prices created:   ${pricesCreated}`);
  console.log(`   Prices skipped:   ${pricesSkipped}`);
  console.log(`   Total time:       ${duration}s`);
  console.log('───────────────────────────────────────\n');

  // Verify — show updated prices
  const updatedPrices = (await ds.query(
    'SELECT id, stripe_price_id, stripe_product_id FROM billing_prices ORDER BY unit_amount ASC',
  )) as PriceRow[];
  console.log('📊 Updated price IDs in local DB:');
  for (const p of updatedPrices) {
    console.log(`  ${p.id.slice(0, 8)}…  stripePriceId=${p.stripe_price_id}`);
  }
  console.log('');

  await ds.destroy();
  process.exit(0);
}

main().catch((error) => {
  console.error('\n❌ Sync failed:', error);
  process.exit(1);
});
