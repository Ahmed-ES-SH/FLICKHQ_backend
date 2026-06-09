/**
 * Standalone Plans & Pricing Seed
 *
 * Seeds 4 subscription tiers into `billing_plans` and `billing_prices`.
 *
 * Uses a minimal DataSource with ONLY the required entities to
 * avoid pre-existing decorator issues in other entities.
 *
 * Usage:
 *   npx tsx src/database/seeds/seed-plans-standalone.ts
 *
 * Or after build:
 *   node dist/src/database/seeds/seed-plans-standalone.js
 */

import 'reflect-metadata';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';

// Load .env file so DATABASE_URL is available
config({ path: '.env' });
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

interface PriceSeed {
  currency: string;
  unitAmount: number;
  interval: BillingRecurringInterval;
  trialPeriodDays: number | null;
}

interface PlanSeed {
  code: string;
  name: string;
  description: string;
  displayOrder: number;
  icon: string;
  highlight: boolean;
  features: string[];
  metadata: Record<string, unknown>;
  prices: PriceSeed[];
}

const PLANS: PlanSeed[] = [
  /**
   * 1. Free Plan — $0/mo
   * Basic browsing, SD streaming with ads, 1 watchlist.
   */
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
    metadata: { tagline: 'Start watching for free', popular: false },
    prices: [
      {
        currency: 'usd',
        unitAmount: 0,
        interval: BillingRecurringInterval.MONTH,
        trialPeriodDays: null,
      },
    ],
  },

  /**
   * 2. Starter Plan — $6.99/mo
   * HD streaming, no ads, unlimited browsing, 5 watchlists.
   */
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
    metadata: { tagline: 'HD, no ads, one device', popular: false },
    prices: [
      {
        currency: 'usd',
        unitAmount: 699,
        interval: BillingRecurringInterval.MONTH,
        trialPeriodDays: 7,
      },
    ],
  },

  /**
   * 3. Pro Plan (HIGHLIGHTED) — $12.99/mo
   * 4K UHD, 3 devices, offline downloads, early access.
   */
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
    metadata: { tagline: '4K UHD, 3 devices, offline', popular: true },
    prices: [
      {
        currency: 'usd',
        unitAmount: 1299,
        interval: BillingRecurringInterval.MONTH,
        trialPeriodDays: 7,
      },
    ],
  },

  /**
   * 4. Enterprise Plan — $24.99/mo
   * Family sharing (5 accounts), unlimited offline, exclusive content.
   */
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
    metadata: { tagline: 'Everything plus family sharing', popular: false },
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
// Main
// ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('🌱 Starting plans & pricing seed...\n');
  const startTime = Date.now();

  // Load DATABASE_URL from process.env (loaded via dotenv by tsx/node)
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error(
      '❌ DATABASE_URL environment variable is required.\n' +
        '   Create a .env file or set it before running.',
    );
    process.exit(1);
  }

  // Create a minimal DataSource with only the entities we need
  const dataSource = new DataSource({
    type: 'postgres',
    url: databaseUrl,
    ssl:
      process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: true, ca: process.env.DB_SSL_CERT }
        : false,
    entities: [BillingPlan, BillingPrice],
    synchronize: false,
    logging: false,
  });

  try {
    console.log('🔗 Connecting to database...');
    await dataSource.initialize();
    console.log('✅ Database connected\n');

    const planRepo = dataSource.getRepository(BillingPlan);
    const priceRepo = dataSource.getRepository(BillingPrice);

    let plansInserted = 0;
    let plansSkipped = 0;
    let pricesInserted = 0;

    for (const planSeed of PLANS) {
      // Check if plan already exists by code
      const existing = await planRepo.findOne({
        where: { code: planSeed.code },
      });

      if (existing) {
        plansSkipped++;
        console.log(`  → Plan "${planSeed.code}" already exists (id=${existing.id}). Checking prices...`);

        // Ensure prices exist for this plan
        const existingPrices = await priceRepo.find({
          where: { planId: existing.id },
        });

        if (existingPrices.length === 0) {
          for (const priceSeed of planSeed.prices) {
            const price = priceRepo.create({
              planId: existing.id,
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
          console.log(`    → Added ${planSeed.prices.length} price(s) to existing plan.`);
        } else {
          console.log(`    → ${existingPrices.length} price(s) already exist. Skipping.`);
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

      // Create prices
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

    await dataSource.destroy();

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('\n───────────────────────────────────────');
    console.log('🎉 Plans & Pricing seed completed!');
    console.log(`   Plans inserted:  ${plansInserted}`);
    console.log(`   Plans skipped:   ${plansSkipped}`);
    console.log(`   Prices inserted: ${pricesInserted}`);
    console.log(`   Total time:      ${duration}s`);
    console.log('───────────────────────────────────────\n');

    // Summary table
    console.log('📊 Plan Summary:');
    console.log('┌─────────────────────┬──────────┬───────┬──────────────┐');
    console.log('│ Plan                │ Code     │ Price │ Highlight    │');
    console.log('├─────────────────────┼──────────┼───────┼──────────────┤');
    for (const p of PLANS) {
      const priceStr = `$${(p.prices[0]?.unitAmount ?? 0) / 100}/mo`;
      const namePad = p.name.padEnd(19);
      const codePad = p.code.padEnd(8);
      const pricePad = priceStr.padEnd(7);
      const hl = p.highlight ? '⭐ Yes' : '   No';
      console.log(`│ ${namePad}│ ${codePad}│ ${pricePad}│ ${hl.padEnd(12)}│`);
    }
    console.log('└─────────────────────┴──────────┴───────┴──────────────┘');
    console.log(
      '\n⚠️  Note: stripePriceId values are placeholders (seed_*).\n' +
        '   Replace with real Stripe Price IDs when creating products in Stripe.\n',
    );

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Seed failed:', error);
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('\n❌ Unhandled seed error:', error);
  process.exit(1);
});
