/**
 * Plans & Pricing Seed
 *
 * Seeds 4 subscription tiers into `billing_plans` and `billing_prices`.
 *
 * Run via: pnpm run seed:run  (which executes seed-runner.ts)
 *
 * Design decisions:
 * - All plans created with status=ACTIVE so they appear on the public pricing page.
 * - Pro plan is flagged as `highlight: true` (recommended badge).
 * - Each plan gets one monthly recurring price.
 * - Codes are stable identifiers — do not rename after seeding.
 */

import { DataSource, In } from 'typeorm';
import { BillingPlan } from '../../billing/entities/billing-plan.entity';
import { BillingPrice } from '../../billing/entities/billing-price.entity';
import {
  BillingPlanStatus,
  BillingPriceType,
  BillingRecurringInterval,
} from '../../billing/common/billing.enums';

// ────────────────────────────────────────────────────────────────
// Plan Definitions
// ────────────────────────────────────────────────────────────────

interface PlanSeed {
  code: string;
  name: string;
  description: string;
  displayOrder: number;
  icon: string;
  highlight: boolean;
  features: string[];
  metadata: Record<string, unknown>;
  prices: Array<{
    currency: string;
    unitAmount: number; // in cents (e.g. 999 = $9.99)
    interval: BillingRecurringInterval;
    trialPeriodDays: number | null;
  }>;
}

const PLANS: PlanSeed[] = [
  {
    code: 'free',
    name: 'Free',
    description:
      'Get started with basic access. Browse the catalog, build a watchlist, and enjoy ad-supported streaming in standard definition.',
    displayOrder: 10,
    icon: '🎬',
    highlight: false,
    features: [
      'browse_catalog',
      'search_limited',
      'streaming_sd',
      'ads_supported',
      'watchlist_1',
      'no_offline_downloads',
    ],
    metadata: {
      tagline: 'Start watching for free',
      popular: false,
    },
    prices: [
      {
        currency: 'usd',
        unitAmount: 0,
        interval: BillingRecurringInterval.MONTH,
        trialPeriodDays: null,
      },
    ],
  },
  {
    code: 'starter_monthly',
    name: 'Starter',
    description:
      'Upgrade to HD streaming with no ads. Enjoy unlimited browsing, personalized recommendations, and watch on one device at a time.',
    displayOrder: 20,
    icon: '⭐',
    highlight: false,
    features: [
      'browse_catalog',
      'search_unlimited',
      'streaming_hd',
      'no_ads',
      'watchlist_5',
      'recommendations_basic',
      'stream_1_device',
      'no_offline_downloads',
      'email_support',
    ],
    metadata: {
      tagline: 'HD, no ads, one device',
      popular: false,
    },
    prices: [
      {
        currency: 'usd',
        unitAmount: 699,
        interval: BillingRecurringInterval.MONTH,
        trialPeriodDays: 7,
      },
    ],
  },
  {
    code: 'pro_monthly',
    name: 'Pro',
    description:
      'The ultimate personal experience. Stream in 4K UHD on up to 3 devices, download up to 30 titles for offline viewing, get early access to new releases, and priority customer support.',
    displayOrder: 30,
    icon: '🔥',
    highlight: true,
    features: [
      'browse_catalog',
      'search_unlimited',
      'streaming_4k',
      'streaming_hdr',
      'no_ads',
      'watchlist_unlimited',
      'recommendations_advanced',
      'stream_3_devices',
      'offline_downloads_30',
      'early_access',
      'priority_support',
    ],
    metadata: {
      tagline: '4K UHD, 3 devices, offline',
      popular: true,
    },
    prices: [
      {
        currency: 'usd',
        unitAmount: 1299,
        interval: BillingRecurringInterval.MONTH,
        trialPeriodDays: 7,
      },
    ],
  },
  {
    code: 'enterprise_monthly',
    name: 'Enterprise',
    description:
      'Designed for families and power users. Enjoy everything in Pro plus unlimited offline downloads, 5 simultaneous streams, up to 5 family accounts, exclusive behind-the-scenes content, and a dedicated account manager.',
    displayOrder: 40,
    icon: '👑',
    highlight: false,
    features: [
      'browse_catalog',
      'search_unlimited',
      'streaming_4k',
      'streaming_hdr',
      'streaming_imax_enhanced',
      'no_ads',
      'watchlist_unlimited',
      'recommendations_ai',
      'stream_5_devices',
      'offline_downloads_unlimited',
      'early_access',
      'exclusive_content',
      'family_sharing_5',
      'dedicated_account_manager',
      'priority_support',
    ],
    metadata: {
      tagline: 'Everything plus family sharing',
      popular: false,
    },
    prices: [
      {
        currency: 'usd',
        unitAmount: 2499,
        interval: BillingRecurringInterval.MONTH,
        trialPeriodDays: 7,
      },
    ],
  },
];

// ────────────────────────────────────────────────────────────────
// Seed Function
// ────────────────────────────────────────────────────────────────

export async function seedPlans(dataSource: DataSource): Promise<{
  plansInserted: number;
  plansSkipped: number;
  pricesInserted: number;
}> {
  console.log('\n📋 Seeding plans and prices...');

  const planRepo = dataSource.getRepository(BillingPlan);
  const priceRepo = dataSource.getRepository(BillingPrice);

  // Find existing plans by code to avoid duplicates
  const existingPlans = await planRepo.find({
    select: ['id', 'code'],
    where: { code: In(PLANS.map((p) => p.code)) },
  });
  const existingCodes = new Map(existingPlans.map((p) => [p.code, p.id]));

  let plansInserted = 0;
  let plansSkipped = 0;
  let pricesInserted = 0;

  for (const planSeed of PLANS) {
    const existingId = existingCodes.get(planSeed.code);

    if (existingId) {
      // Plan already exists — skip to prices
      plansSkipped++;
      console.log(
        `  → Plan "${planSeed.code}" already exists (id=${existingId}). Checking prices...`,
      );

      // Still ensure prices exist
      const existingPrices = await priceRepo.find({
        where: { planId: existingId },
      });

      if (existingPrices.length === 0) {
        // Create prices for the existing plan
        for (const priceSeed of planSeed.prices) {
          const price = priceRepo.create({
            planId: existingId,
            stripePriceId: `seed_${planSeed.code}_${priceSeed.currency}_${priceSeed.unitAmount}_${priceSeed.interval}`,
            stripeProductId: null,
            currency: priceSeed.currency,
            unitAmount: priceSeed.unitAmount,
            type: BillingPriceType.RECURRING,
            interval: priceSeed.interval,
            trialPeriodDays: priceSeed.trialPeriodDays,
            active: true,
          });
          await priceRepo.save(price);
          pricesInserted++;
        }
        console.log(
          `    → Added ${planSeed.prices.length} price(s) to existing plan.`,
        );
      } else {
        console.log(
          `    → ${existingPrices.length} price(s) already exist. Skipping.`,
        );
      }

      continue;
    }

    // Create the plan
    const plan = planRepo.create({
      code: planSeed.code,
      name: planSeed.name,
      description: planSeed.description,
      status: BillingPlanStatus.ACTIVE,
      features: planSeed.features,
      displayOrder: planSeed.displayOrder,
      icon: planSeed.icon,
      highlight: planSeed.highlight,
      metadata: planSeed.metadata,
    });
    const savedPlan = await planRepo.save(plan);
    plansInserted++;
    console.log(`  ✅ Plan created: "${savedPlan.code}" (${savedPlan.id})`);

    // Create prices for the plan
    for (const priceSeed of planSeed.prices) {
      const price = priceRepo.create({
        planId: savedPlan.id,
        stripePriceId: `seed_${planSeed.code}_${priceSeed.currency}_${priceSeed.unitAmount}_${priceSeed.interval}`,
        stripeProductId: null,
        currency: priceSeed.currency,
        unitAmount: priceSeed.unitAmount,
        type: BillingPriceType.RECURRING,
        interval: priceSeed.interval,
        trialPeriodDays: priceSeed.trialPeriodDays ?? null,
        active: true,
      });
      await priceRepo.save(price);
      pricesInserted++;
    }
    console.log(`    → Added ${planSeed.prices.length} price(s).`);
  }

  console.log(
    `\n  ✅ Plans: ${plansInserted} inserted, ${plansSkipped} skipped`,
  );
  console.log(`  ✅ Prices: ${pricesInserted} inserted`);
  console.log('✅ Plans and prices seeded successfully\n');

  return { plansInserted, plansSkipped, pricesInserted };
}
