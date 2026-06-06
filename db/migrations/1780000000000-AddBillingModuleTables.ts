import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBillingModuleTables1780000000000 implements MigrationInterface {
  name = 'AddBillingModuleTables1780000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ============================================================
    // Enums
    // ============================================================

    await queryRunner.query(`
      CREATE TYPE "public"."billing_plans_status_enum" AS ENUM (
        'draft',
        'active',
        'archived'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "public"."billing_prices_type_enum" AS ENUM (
        'one_time',
        'recurring'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "public"."billing_prices_interval_enum" AS ENUM (
        'day',
        'week',
        'month',
        'year'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "public"."billing_subscriptions_status_enum" AS ENUM (
        'incomplete',
        'trialing',
        'active',
        'past_due',
        'canceled',
        'unpaid',
        'paused',
        'incomplete_expired'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "public"."billing_payments_status_enum" AS ENUM (
        'checkout_created',
        'pending',
        'succeeded',
        'failed',
        'canceled',
        'refunded',
        'partially_refunded'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "public"."billing_invoices_status_enum" AS ENUM (
        'draft',
        'open',
        'paid',
        'void',
        'uncollectible'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "public"."billing_transactions_type_enum" AS ENUM (
        'charge',
        'refund'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "public"."billing_transactions_status_enum" AS ENUM (
        'pending',
        'succeeded',
        'failed'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "public"."billing_webhook_events_status_enum" AS ENUM (
        'received',
        'processed',
        'failed',
        'ignored'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "public"."billing_idempotency_keys_status_enum" AS ENUM (
        'in_progress',
        'completed',
        'failed',
        'expired'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "public"."billing_entitlements_source_type_enum" AS ENUM (
        'subscription',
        'one_time_payment',
        'manual'
      )
    `);

    // ============================================================
    // Tables (created in dependency order)
    // ============================================================

    // billing_customers — no FKs, sits at the root.
    await queryRunner.query(`
      CREATE TABLE "billing_customers" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" integer NOT NULL,
        "stripe_customer_id" character varying(255) NOT NULL,
        "email" character varying(255) NOT NULL,
        "name" character varying(255),
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_billing_customers_user_id" UNIQUE ("user_id"),
        CONSTRAINT "UQ_billing_customers_stripe_customer_id" UNIQUE ("stripe_customer_id"),
        CONSTRAINT "PK_billing_customers_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_billing_customers_stripe_customer_id"
        ON "billing_customers" ("stripe_customer_id")
    `);

    await queryRunner.query(`
      ALTER TABLE "billing_customers"
        ADD CONSTRAINT "FK_billing_customers_user_id"
        FOREIGN KEY ("user_id") REFERENCES "users"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
    `);

    // billing_plans — independent catalog table.
    await queryRunner.query(`
      CREATE TABLE "billing_plans" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "code" character varying(100) NOT NULL,
        "name" character varying(255) NOT NULL,
        "description" text,
        "status" "public"."billing_plans_status_enum" NOT NULL DEFAULT 'draft',
        "features" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_billing_plans_code" UNIQUE ("code"),
        CONSTRAINT "PK_billing_plans_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_billing_plans_status" ON "billing_plans" ("status")
    `);

    // billing_prices — references billing_plans.
    await queryRunner.query(`
      CREATE TABLE "billing_prices" (
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
        CONSTRAINT "UQ_billing_prices_stripe_price_id" UNIQUE ("stripe_price_id"),
        CONSTRAINT "PK_billing_prices_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_billing_prices_unit_amount_non_negative"
          CHECK ("unit_amount" >= 0),
        CONSTRAINT "CHK_billing_prices_trial_period_days_non_negative"
          CHECK ("trial_period_days" IS NULL OR "trial_period_days" >= 0)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_billing_prices_plan_id" ON "billing_prices" ("plan_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_billing_prices_active" ON "billing_prices" ("active")
    `);

    await queryRunner.query(`
      ALTER TABLE "billing_prices"
        ADD CONSTRAINT "FK_billing_prices_plan_id"
        FOREIGN KEY ("plan_id") REFERENCES "billing_plans"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
    `);

    // billing_subscriptions — references billing_customers, billing_plans, billing_prices.
    await queryRunner.query(`
      CREATE TABLE "billing_subscriptions" (
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
        CONSTRAINT "UQ_billing_subscriptions_stripe_subscription_id" UNIQUE ("stripe_subscription_id"),
        CONSTRAINT "UQ_billing_subscriptions_stripe_checkout_session_id"
          UNIQUE ("stripe_checkout_session_id"),
        CONSTRAINT "PK_billing_subscriptions_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_billing_subscriptions_user_id"
        ON "billing_subscriptions" ("user_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_billing_subscriptions_status"
        ON "billing_subscriptions" ("status")
    `);

    await queryRunner.query(`
      ALTER TABLE "billing_subscriptions"
        ADD CONSTRAINT "FK_billing_subscriptions_billing_customer_id"
        FOREIGN KEY ("billing_customer_id") REFERENCES "billing_customers"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_subscriptions"
        ADD CONSTRAINT "FK_billing_subscriptions_plan_id"
        FOREIGN KEY ("plan_id") REFERENCES "billing_plans"("id")
        ON DELETE SET NULL ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_subscriptions"
        ADD CONSTRAINT "FK_billing_subscriptions_price_id"
        FOREIGN KEY ("price_id") REFERENCES "billing_prices"("id")
        ON DELETE SET NULL ON UPDATE NO ACTION
    `);

    // billing_payments — references billing_customers, billing_prices.
    await queryRunner.query(`
      CREATE TABLE "billing_payments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" integer NOT NULL,
        "billing_customer_id" uuid NOT NULL,
        "price_id" uuid,
        "stripe_checkout_session_id" character varying(255),
        "stripe_payment_intent_id" character varying(255),
        "amount" integer NOT NULL,
        "amount_refunded" integer NOT NULL DEFAULT 0,
        "currency" character varying(3) NOT NULL,
        "status" "public"."billing_payments_status_enum" NOT NULL DEFAULT 'checkout_created',
        "description" text,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_billing_payments_stripe_checkout_session_id"
          UNIQUE ("stripe_checkout_session_id"),
        CONSTRAINT "UQ_billing_payments_stripe_payment_intent_id"
          UNIQUE ("stripe_payment_intent_id"),
        CONSTRAINT "PK_billing_payments_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_billing_payments_amount_non_negative"
          CHECK ("amount" >= 0),
        CONSTRAINT "CHK_billing_payments_amount_refunded_non_negative"
          CHECK ("amount_refunded" >= 0),
        CONSTRAINT "CHK_billing_payments_refunded_le_amount"
          CHECK ("amount_refunded" <= "amount")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_billing_payments_user_id" ON "billing_payments" ("user_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_billing_payments_status" ON "billing_payments" ("status")
    `);

    await queryRunner.query(`
      ALTER TABLE "billing_payments"
        ADD CONSTRAINT "FK_billing_payments_billing_customer_id"
        FOREIGN KEY ("billing_customer_id") REFERENCES "billing_customers"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_payments"
        ADD CONSTRAINT "FK_billing_payments_price_id"
        FOREIGN KEY ("price_id") REFERENCES "billing_prices"("id")
        ON DELETE SET NULL ON UPDATE NO ACTION
    `);

    // billing_invoices — references billing_subscriptions.
    await queryRunner.query(`
      CREATE TABLE "billing_invoices" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" integer NOT NULL,
        "subscription_id" uuid,
        "stripe_invoice_id" character varying(255) NOT NULL,
        "stripe_payment_intent_id" character varying(255),
        "number" character varying(100),
        "status" "public"."billing_invoices_status_enum" NOT NULL DEFAULT 'draft',
        "currency" character varying(3) NOT NULL,
        "subtotal" integer NOT NULL DEFAULT 0,
        "total" integer NOT NULL DEFAULT 0,
        "amount_paid" integer NOT NULL DEFAULT 0,
        "amount_due" integer NOT NULL DEFAULT 0,
        "hosted_invoice_url" text,
        "invoice_pdf" text,
        "period_start" TIMESTAMP,
        "period_end" TIMESTAMP,
        "paid_at" TIMESTAMP,
        "stripe_snapshot" jsonb,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_billing_invoices_stripe_invoice_id" UNIQUE ("stripe_invoice_id"),
        CONSTRAINT "PK_billing_invoices_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_billing_invoices_amounts_non_negative"
          CHECK (
            "subtotal" >= 0
            AND "total" >= 0
            AND "amount_paid" >= 0
            AND "amount_due" >= 0
          )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_billing_invoices_user_id" ON "billing_invoices" ("user_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_billing_invoices_status" ON "billing_invoices" ("status")
    `);

    await queryRunner.query(`
      ALTER TABLE "billing_invoices"
        ADD CONSTRAINT "FK_billing_invoices_subscription_id"
        FOREIGN KEY ("subscription_id") REFERENCES "billing_subscriptions"("id")
        ON DELETE SET NULL ON UPDATE NO ACTION
    `);

    // billing_transactions — references billing_payments, billing_invoices, billing_subscriptions.
    await queryRunner.query(`
      CREATE TABLE "billing_transactions" (
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
        CONSTRAINT "PK_billing_transactions_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_billing_transactions_amount_non_negative"
          CHECK ("amount" >= 0)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_billing_transactions_user_id"
        ON "billing_transactions" ("user_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_billing_transactions_type"
        ON "billing_transactions" ("type")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_billing_transactions_status"
        ON "billing_transactions" ("status")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_billing_transactions_stripe_charge_id"
        ON "billing_transactions" ("stripe_charge_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_billing_transactions_stripe_refund_id"
        ON "billing_transactions" ("stripe_refund_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_billing_transactions_stripe_payment_intent_id"
        ON "billing_transactions" ("stripe_payment_intent_id")
    `);

    await queryRunner.query(`
      ALTER TABLE "billing_transactions"
        ADD CONSTRAINT "FK_billing_transactions_payment_id"
        FOREIGN KEY ("payment_id") REFERENCES "billing_payments"("id")
        ON DELETE SET NULL ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_transactions"
        ADD CONSTRAINT "FK_billing_transactions_invoice_id"
        FOREIGN KEY ("invoice_id") REFERENCES "billing_invoices"("id")
        ON DELETE SET NULL ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_transactions"
        ADD CONSTRAINT "FK_billing_transactions_subscription_id"
        FOREIGN KEY ("subscription_id") REFERENCES "billing_subscriptions"("id")
        ON DELETE SET NULL ON UPDATE NO ACTION
    `);

    // billing_webhook_events — no FKs to billing tables (events reference Stripe, not local rows).
    await queryRunner.query(`
      CREATE TABLE "billing_webhook_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "stripe_event_id" character varying(255) NOT NULL,
        "event_type" character varying(150) NOT NULL,
        "api_version" character varying(50),
        "livemode" boolean NOT NULL DEFAULT false,
        "status" "public"."billing_webhook_events_status_enum" NOT NULL DEFAULT 'received',
        "processing_attempts" integer NOT NULL DEFAULT 0,
        "payload" jsonb NOT NULL,
        "error_message" text,
        "received_at" TIMESTAMP NOT NULL,
        "processed_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_billing_webhook_events_stripe_event_id"
          UNIQUE ("stripe_event_id"),
        CONSTRAINT "PK_billing_webhook_events_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_billing_webhook_events_processing_attempts_non_negative"
          CHECK ("processing_attempts" >= 0)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_billing_webhook_events_stripe_event_id"
        ON "billing_webhook_events" ("stripe_event_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_billing_webhook_events_event_type"
        ON "billing_webhook_events" ("event_type")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_billing_webhook_events_status"
        ON "billing_webhook_events" ("status")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_billing_webhook_events_received_at"
        ON "billing_webhook_events" ("received_at")
    `);

    // billing_idempotency_keys — no FKs (key+scope is the unit, not a row reference).
    await queryRunner.query(`
      CREATE TABLE "billing_idempotency_keys" (
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
        CONSTRAINT "UQ_billing_idempotency_keys_key" UNIQUE ("key"),
        CONSTRAINT "PK_billing_idempotency_keys_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_billing_idempotency_keys_scope"
        ON "billing_idempotency_keys" ("scope")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_billing_idempotency_keys_user_id"
        ON "billing_idempotency_keys" ("user_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_billing_idempotency_keys_expires_at"
        ON "billing_idempotency_keys" ("expires_at")
    `);

    // billing_entitlements — references users (no billing-table FKs; source_id is opaque).
    await queryRunner.query(`
      CREATE TABLE "billing_entitlements" (
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
        CONSTRAINT "PK_billing_entitlements_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_billing_entitlements_user_id"
        ON "billing_entitlements" ("user_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_billing_entitlements_feature_key"
        ON "billing_entitlements" ("feature_key")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_billing_entitlements_user_feature_source_active"
        ON "billing_entitlements" ("user_id", "feature_key", "source_type", "active")
    `);

    // ============================================================
    // Backfill: copy users.stripe_customer_id into billing_customers.
    // ============================================================
    await queryRunner.query(`
      INSERT INTO "billing_customers" (
        "user_id",
        "stripe_customer_id",
        "email",
        "name",
        "metadata",
        "created_at",
        "updated_at"
      )
      SELECT
        u."id",
        u."stripe_customer_id",
        u."email",
        u."name",
        jsonb_build_object('backfilledFrom', 'users.stripe_customer_id'),
        u."createdAt",
        u."updatedAt"
      FROM "users" u
      WHERE u."stripe_customer_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop in reverse FK order.

    await queryRunner.query(`DROP TABLE "billing_entitlements"`);

    await queryRunner.query(
      `DROP INDEX "public"."IDX_billing_idempotency_keys_expires_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_billing_idempotency_keys_user_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_billing_idempotency_keys_scope"`,
    );
    await queryRunner.query(`DROP TABLE "billing_idempotency_keys"`);
    await queryRunner.query(
      `DROP TYPE "public"."billing_idempotency_keys_status_enum"`,
    );

    await queryRunner.query(
      `DROP INDEX "public"."IDX_billing_webhook_events_received_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_billing_webhook_events_status"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_billing_webhook_events_event_type"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_billing_webhook_events_stripe_event_id"`,
    );
    await queryRunner.query(`DROP TABLE "billing_webhook_events"`);
    await queryRunner.query(
      `DROP TYPE "public"."billing_webhook_events_status_enum"`,
    );

    await queryRunner.query(
      `ALTER TABLE "billing_transactions" DROP CONSTRAINT "FK_billing_transactions_subscription_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "billing_transactions" DROP CONSTRAINT "FK_billing_transactions_invoice_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "billing_transactions" DROP CONSTRAINT "FK_billing_transactions_payment_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_billing_transactions_stripe_payment_intent_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_billing_transactions_stripe_refund_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_billing_transactions_stripe_charge_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_billing_transactions_status"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_billing_transactions_type"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_billing_transactions_user_id"`,
    );
    await queryRunner.query(`DROP TABLE "billing_transactions"`);
    await queryRunner.query(
      `DROP TYPE "public"."billing_transactions_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."billing_transactions_type_enum"`,
    );

    await queryRunner.query(
      `ALTER TABLE "billing_invoices" DROP CONSTRAINT "FK_billing_invoices_subscription_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_billing_invoices_status"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_billing_invoices_user_id"`,
    );
    await queryRunner.query(`DROP TABLE "billing_invoices"`);
    await queryRunner.query(
      `DROP TYPE "public"."billing_invoices_status_enum"`,
    );

    await queryRunner.query(
      `ALTER TABLE "billing_payments" DROP CONSTRAINT "FK_billing_payments_price_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "billing_payments" DROP CONSTRAINT "FK_billing_payments_billing_customer_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_billing_payments_status"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_billing_payments_user_id"`,
    );
    await queryRunner.query(`DROP TABLE "billing_payments"`);
    await queryRunner.query(
      `DROP TYPE "public"."billing_payments_status_enum"`,
    );

    await queryRunner.query(
      `ALTER TABLE "billing_subscriptions" DROP CONSTRAINT "FK_billing_subscriptions_price_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "billing_subscriptions" DROP CONSTRAINT "FK_billing_subscriptions_plan_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "billing_subscriptions" DROP CONSTRAINT "FK_billing_subscriptions_billing_customer_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_billing_subscriptions_status"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_billing_subscriptions_user_id"`,
    );
    await queryRunner.query(`DROP TABLE "billing_subscriptions"`);
    await queryRunner.query(
      `DROP TYPE "public"."billing_subscriptions_status_enum"`,
    );

    await queryRunner.query(
      `ALTER TABLE "billing_prices" DROP CONSTRAINT "FK_billing_prices_plan_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_billing_prices_active"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_billing_prices_plan_id"`,
    );
    await queryRunner.query(`DROP TABLE "billing_prices"`);
    await queryRunner.query(
      `DROP TYPE "public"."billing_prices_interval_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."billing_prices_type_enum"`,
    );

    await queryRunner.query(
      `DROP INDEX "public"."IDX_billing_plans_status"`,
    );
    await queryRunner.query(`DROP TABLE "billing_plans"`);
    await queryRunner.query(`DROP TYPE "public"."billing_plans_status_enum"`);

    await queryRunner.query(
      `ALTER TABLE "billing_customers" DROP CONSTRAINT "FK_billing_customers_user_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_billing_customers_stripe_customer_id"`,
    );
    await queryRunner.query(`DROP TABLE "billing_customers"`);
    await queryRunner.query(
      `DROP TYPE "public"."billing_entitlements_source_type_enum"`,
    );
  }
}
