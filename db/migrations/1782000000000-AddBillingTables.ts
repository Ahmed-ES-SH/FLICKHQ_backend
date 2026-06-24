import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBillingTables1782000000000 implements MigrationInterface {
  name = 'AddBillingTables1782000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---------------------------------------------------------------
    // 1. Create enum types (idempotent via DO $$ ... EXCEPTION)
    // ---------------------------------------------------------------
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."billing_subscriptions_status_enum" AS ENUM(
          'incomplete', 'trialing', 'active', 'past_due',
          'canceled', 'unpaid', 'paused', 'incomplete_expired'
        );
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."billing_plans_status_enum" AS ENUM(
          'draft', 'active', 'archived'
        );
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."billing_prices_type_enum" AS ENUM(
          'one_time', 'recurring'
        );
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."billing_prices_interval_enum" AS ENUM(
          'day', 'week', 'month', 'year'
        );
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."billing_payments_status_enum" AS ENUM(
          'checkout_created', 'pending', 'succeeded', 'failed',
          'canceled', 'refunded', 'partially_refunded'
        );
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."billing_invoices_status_enum" AS ENUM(
          'draft', 'open', 'paid', 'void', 'uncollectible'
        );
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."billing_transactions_type_enum" AS ENUM(
          'charge', 'refund'
        );
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."billing_transactions_status_enum" AS ENUM(
          'pending', 'succeeded', 'failed'
        );
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."billing_webhook_events_status_enum" AS ENUM(
          'received', 'processed', 'failed', 'ignored'
        );
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."billing_idempotency_keys_status_enum" AS ENUM(
          'in_progress', 'completed', 'failed', 'expired'
        );
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."billing_entitlements_source_type_enum" AS ENUM(
          'subscription', 'one_time_payment', 'manual'
        );
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."plan_subscription_history_previous_status_enum" AS ENUM(
          'incomplete', 'trialing', 'active', 'past_due',
          'canceled', 'unpaid', 'paused', 'incomplete_expired'
        );
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."plan_subscription_history_new_status_enum" AS ENUM(
          'incomplete', 'trialing', 'active', 'past_due',
          'canceled', 'unpaid', 'paused', 'incomplete_expired'
        );
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    // ---------------------------------------------------------------
    // 2. Create tables (idempotent via IF NOT EXISTS)
    // ---------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_customers" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" integer NOT NULL,
        "stripe_customer_id" character varying(255) NOT NULL,
        "email" character varying(255) NOT NULL,
        "name" character varying(255),
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_customers" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_plans" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "code" character varying(100) NOT NULL,
        "name" character varying(255) NOT NULL,
        "description" text,
        "status" "public"."billing_plans_status_enum" NOT NULL DEFAULT 'draft',
        "features" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "display_order" integer NOT NULL DEFAULT '0',
        "icon" character varying(255),
        "highlight" boolean NOT NULL DEFAULT false,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_plans" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_billing_plans_code" UNIQUE ("code")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_prices" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "plan_id" uuid NOT NULL,
        "stripe_price_id" character varying(255) NOT NULL,
        "stripe_product_id" character varying(255),
        "currency" character varying(3) NOT NULL,
        "unit_amount" integer NOT NULL,
        "type" "public"."billing_prices_type_enum" NOT NULL,
        "interval" "public"."billing_prices_interval_enum",
        "trial_period_days" integer,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_prices" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_subscriptions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" integer NOT NULL,
        "billing_customer_id" uuid NOT NULL,
        "plan_id" uuid,
        "price_id" uuid,
        "stripe_subscription_id" character varying(255) NOT NULL,
        "stripe_checkout_session_id" character varying(255),
        "status" "public"."billing_subscriptions_status_enum" NOT NULL DEFAULT 'incomplete',
        "current_period_start" TIMESTAMP,
        "current_period_end" TIMESTAMP,
        "trial_end" TIMESTAMP,
        "cancel_at_period_end" boolean NOT NULL DEFAULT false,
        "canceled_at" TIMESTAMP,
        "latest_invoice_id" character varying(255),
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_subscriptions" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_payments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" integer NOT NULL,
        "billing_customer_id" uuid NOT NULL,
        "price_id" uuid,
        "stripe_checkout_session_id" character varying(255),
        "stripe_payment_intent_id" character varying(255),
        "amount" integer NOT NULL,
        "amount_refunded" integer NOT NULL DEFAULT '0',
        "currency" character varying(3) NOT NULL,
        "status" "public"."billing_payments_status_enum" NOT NULL DEFAULT 'checkout_created',
        "description" text,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_payments" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_invoices" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" integer NOT NULL,
        "subscription_id" uuid,
        "stripe_invoice_id" character varying(255) NOT NULL,
        "stripe_payment_intent_id" character varying(255),
        "number" character varying(100),
        "status" "public"."billing_invoices_status_enum" NOT NULL DEFAULT 'draft',
        "currency" character varying(3) NOT NULL,
        "subtotal" integer NOT NULL DEFAULT '0',
        "total" integer NOT NULL DEFAULT '0',
        "amount_paid" integer NOT NULL DEFAULT '0',
        "amount_due" integer NOT NULL DEFAULT '0',
        "hosted_invoice_url" text,
        "invoice_pdf" text,
        "period_start" TIMESTAMP,
        "period_end" TIMESTAMP,
        "paid_at" TIMESTAMP,
        "stripe_snapshot" jsonb,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_invoices" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_transactions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" integer NOT NULL,
        "payment_id" uuid,
        "invoice_id" uuid,
        "subscription_id" uuid,
        "type" "public"."billing_transactions_type_enum" NOT NULL,
        "amount" integer NOT NULL,
        "currency" character varying(3) NOT NULL,
        "status" "public"."billing_transactions_status_enum" NOT NULL DEFAULT 'pending',
        "stripe_payment_intent_id" character varying(255),
        "stripe_charge_id" character varying(255),
        "stripe_refund_id" character varying(255),
        "occurred_at" TIMESTAMP NOT NULL,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_transactions" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_webhook_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "stripe_event_id" character varying(255) NOT NULL,
        "event_type" character varying(150) NOT NULL,
        "api_version" character varying(50),
        "livemode" boolean NOT NULL DEFAULT false,
        "status" "public"."billing_webhook_events_status_enum" NOT NULL DEFAULT 'received',
        "processing_attempts" integer NOT NULL DEFAULT '0',
        "payload" jsonb NOT NULL,
        "error_message" text,
        "received_at" TIMESTAMP NOT NULL,
        "processed_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_webhook_events" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_idempotency_keys" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "key" character varying(255) NOT NULL,
        "scope" character varying(100) NOT NULL,
        "user_id" integer,
        "request_hash" character varying(255) NOT NULL,
        "response_snapshot" jsonb,
        "status" "public"."billing_idempotency_keys_status_enum" NOT NULL DEFAULT 'in_progress',
        "expires_at" TIMESTAMP NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_idempotency_keys" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_entitlements" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" integer NOT NULL,
        "source_type" "public"."billing_entitlements_source_type_enum" NOT NULL,
        "source_id" uuid,
        "feature_key" character varying(100) NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "starts_at" TIMESTAMP,
        "ends_at" TIMESTAMP,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_entitlements" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "plan_subscription_history" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" integer NOT NULL,
        "subscription_id" uuid,
        "previous_status" "public"."plan_subscription_history_previous_status_enum",
        "new_status" "public"."plan_subscription_history_new_status_enum" NOT NULL,
        "plan_id" uuid,
        "price_id" uuid,
        "stripe_event_id" character varying(255),
        "reason" character varying(255),
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "occurred_at" TIMESTAMP NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_plan_subscription_history" PRIMARY KEY ("id")
      )
    `);

    // ---------------------------------------------------------------
    // 3. Create indexes (idempotent via IF NOT EXISTS)
    // ---------------------------------------------------------------
    // billing_customers
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_billing_customers_stripe_customer_id" ON "billing_customers" ("stripe_customer_id")`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_billing_customers_user_id" ON "billing_customers" ("user_id")`);

    // billing_plans
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_billing_plans_display_order" ON "billing_plans" ("display_order")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_billing_plans_status" ON "billing_plans" ("status")`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_billing_plans_code" ON "billing_plans" ("code")`);

    // billing_prices
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_billing_prices_active" ON "billing_prices" ("active")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_billing_prices_plan_id" ON "billing_prices" ("plan_id")`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_billing_prices_stripe_price_id" ON "billing_prices" ("stripe_price_id")`);

    // billing_subscriptions
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_billing_subscriptions_stripe_checkout_session_id" ON "billing_subscriptions" ("stripe_checkout_session_id")`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_billing_subscriptions_stripe_subscription_id" ON "billing_subscriptions" ("stripe_subscription_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_billing_subscriptions_status" ON "billing_subscriptions" ("status")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_billing_subscriptions_user_id" ON "billing_subscriptions" ("user_id")`);

    // billing_payments
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_billing_payments_stripe_payment_intent_id" ON "billing_payments" ("stripe_payment_intent_id")`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_billing_payments_stripe_checkout_session_id" ON "billing_payments" ("stripe_checkout_session_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_billing_payments_status" ON "billing_payments" ("status")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_billing_payments_user_id" ON "billing_payments" ("user_id")`);

    // billing_invoices
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_billing_invoices_stripe_invoice_id" ON "billing_invoices" ("stripe_invoice_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_billing_invoices_status" ON "billing_invoices" ("status")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_billing_invoices_user_id" ON "billing_invoices" ("user_id")`);

    // billing_transactions
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_billing_transactions_stripe_payment_intent_id" ON "billing_transactions" ("stripe_payment_intent_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_billing_transactions_stripe_refund_id" ON "billing_transactions" ("stripe_refund_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_billing_transactions_stripe_charge_id" ON "billing_transactions" ("stripe_charge_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_billing_transactions_status" ON "billing_transactions" ("status")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_billing_transactions_type" ON "billing_transactions" ("type")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_billing_transactions_user_id" ON "billing_transactions" ("user_id")`);

    // billing_webhook_events
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_billing_webhook_events_received_at" ON "billing_webhook_events" ("received_at")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_billing_webhook_events_status" ON "billing_webhook_events" ("status")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_billing_webhook_events_event_type" ON "billing_webhook_events" ("event_type")`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_billing_webhook_events_stripe_event_id" ON "billing_webhook_events" ("stripe_event_id")`);

    // billing_idempotency_keys
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_billing_idempotency_keys_expires_at" ON "billing_idempotency_keys" ("expires_at")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_billing_idempotency_keys_user_id" ON "billing_idempotency_keys" ("user_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_billing_idempotency_keys_scope" ON "billing_idempotency_keys" ("scope")`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_billing_idempotency_keys_key" ON "billing_idempotency_keys" ("key")`);

    // billing_entitlements
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_billing_entitlements_user_feature_source" ON "billing_entitlements" ("user_id", "feature_key", "source_type", "active")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_billing_entitlements_feature_key" ON "billing_entitlements" ("feature_key")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_billing_entitlements_user_id" ON "billing_entitlements" ("user_id")`);

    // plan_subscription_history
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_plan_subscription_history_subscription_id" ON "plan_subscription_history" ("subscription_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_plan_subscription_history_user_occurred" ON "plan_subscription_history" ("user_id", "occurred_at")`);

    // ---------------------------------------------------------------
    // 4. Add FK constraints (idempotent via DO $$ ... EXCEPTION)
    // ---------------------------------------------------------------
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "billing_customers" ADD CONSTRAINT "FK_billing_customers_user_id"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "billing_prices" ADD CONSTRAINT "FK_billing_prices_plan_id"
          FOREIGN KEY ("plan_id") REFERENCES "billing_plans"("id") ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "FK_billing_subscriptions_customer_id"
          FOREIGN KEY ("billing_customer_id") REFERENCES "billing_customers"("id") ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "FK_billing_subscriptions_plan_id"
          FOREIGN KEY ("plan_id") REFERENCES "billing_plans"("id") ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "FK_billing_subscriptions_price_id"
          FOREIGN KEY ("price_id") REFERENCES "billing_prices"("id") ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "billing_payments" ADD CONSTRAINT "FK_billing_payments_customer_id"
          FOREIGN KEY ("billing_customer_id") REFERENCES "billing_customers"("id") ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "billing_payments" ADD CONSTRAINT "FK_billing_payments_price_id"
          FOREIGN KEY ("price_id") REFERENCES "billing_prices"("id") ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "billing_invoices" ADD CONSTRAINT "FK_billing_invoices_subscription_id"
          FOREIGN KEY ("subscription_id") REFERENCES "billing_subscriptions"("id") ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "billing_transactions" ADD CONSTRAINT "FK_billing_transactions_payment_id"
          FOREIGN KEY ("payment_id") REFERENCES "billing_payments"("id") ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "billing_transactions" ADD CONSTRAINT "FK_billing_transactions_invoice_id"
          FOREIGN KEY ("invoice_id") REFERENCES "billing_invoices"("id") ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "billing_transactions" ADD CONSTRAINT "FK_billing_transactions_subscription_id"
          FOREIGN KEY ("subscription_id") REFERENCES "billing_subscriptions"("id") ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop FK constraints
    await queryRunner.query(`ALTER TABLE "billing_transactions" DROP CONSTRAINT IF EXISTS "FK_billing_transactions_subscription_id"`);
    await queryRunner.query(`ALTER TABLE "billing_transactions" DROP CONSTRAINT IF EXISTS "FK_billing_transactions_invoice_id"`);
    await queryRunner.query(`ALTER TABLE "billing_transactions" DROP CONSTRAINT IF EXISTS "FK_billing_transactions_payment_id"`);
    await queryRunner.query(`ALTER TABLE "billing_invoices" DROP CONSTRAINT IF EXISTS "FK_billing_invoices_subscription_id"`);
    await queryRunner.query(`ALTER TABLE "billing_payments" DROP CONSTRAINT IF EXISTS "FK_billing_payments_price_id"`);
    await queryRunner.query(`ALTER TABLE "billing_payments" DROP CONSTRAINT IF EXISTS "FK_billing_payments_customer_id"`);
    await queryRunner.query(`ALTER TABLE "billing_subscriptions" DROP CONSTRAINT IF EXISTS "FK_billing_subscriptions_price_id"`);
    await queryRunner.query(`ALTER TABLE "billing_subscriptions" DROP CONSTRAINT IF EXISTS "FK_billing_subscriptions_plan_id"`);
    await queryRunner.query(`ALTER TABLE "billing_subscriptions" DROP CONSTRAINT IF EXISTS "FK_billing_subscriptions_customer_id"`);
    await queryRunner.query(`ALTER TABLE "billing_prices" DROP CONSTRAINT IF EXISTS "FK_billing_prices_plan_id"`);
    await queryRunner.query(`ALTER TABLE "billing_customers" DROP CONSTRAINT IF EXISTS "FK_billing_customers_user_id"`);

    // Drop tables
    await queryRunner.query(`DROP TABLE IF EXISTS "plan_subscription_history"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_entitlements"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_idempotency_keys"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_webhook_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_transactions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_invoices"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_payments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_subscriptions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_prices"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_plans"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_customers"`);

    // Drop enum types
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."plan_subscription_history_new_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."plan_subscription_history_previous_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."billing_entitlements_source_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."billing_idempotency_keys_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."billing_webhook_events_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."billing_transactions_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."billing_transactions_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."billing_invoices_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."billing_payments_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."billing_prices_interval_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."billing_prices_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."billing_plans_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."billing_subscriptions_status_enum"`);
  }
}
