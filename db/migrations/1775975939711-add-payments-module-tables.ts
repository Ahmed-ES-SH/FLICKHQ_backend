import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPaymentsModuleTables1775975939711
  implements MigrationInterface
{
  name = 'AddPaymentsModuleTables1775975939711';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "products" ADD "reserved_quantity" integer NOT NULL DEFAULT '0'`,
    );

    await queryRunner.query(
      `ALTER TABLE "products" ADD CONSTRAINT "chk_stock_non_negative" CHECK (stock >= 0)`,
    );

    await queryRunner.query(
      `ALTER TABLE "products" ADD CONSTRAINT "chk_reserved_quantity_non_negative" CHECK (reserved_quantity >= 0)`,
    );

    await queryRunner.query(
      `ALTER TABLE "products" ADD CONSTRAINT "chk_available_stock_non_negative" CHECK (stock - reserved_quantity >= 0)`,
    );

    await queryRunner.query(`
      CREATE TYPE "public"."checkout_session_states_status_enum" AS ENUM(
        'active',
        'expired',
        'completed',
        'failed'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "checkout_session_states" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "cart_hash" character varying(255) NOT NULL,
        "stripe_session_id" character varying(255),
        "status" "public"."checkout_session_states_status_enum" NOT NULL DEFAULT 'active',
        "expires_at" TIMESTAMP NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_checkout_session_states_user_id" UNIQUE ("user_id"),
        CONSTRAINT "UQ_checkout_session_states_stripe_session_id" UNIQUE ("stripe_session_id"),
        CONSTRAINT "PK_checkout_session_states_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "idx_checkout_session_user_id" ON "checkout_session_states" ("user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_checkout_session_stripe_id" ON "checkout_session_states" ("stripe_session_id")`,
    );

    await queryRunner.query(`
      CREATE TYPE "public"."outbox_events_status_enum" AS ENUM(
        'pending',
        'processing',
        'completed',
        'failed'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "outbox_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "event_type" character varying(100) NOT NULL,
        "aggregate_id" uuid NOT NULL,
        "payload" jsonb NOT NULL,
        "status" "public"."outbox_events_status_enum" NOT NULL DEFAULT 'pending',
        "retry_count" integer NOT NULL DEFAULT '0',
        "error_message" text,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "processed_at" TIMESTAMP,
        CONSTRAINT "PK_outbox_events_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "idx_outbox_events_status" ON "outbox_events" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_outbox_events_created_at" ON "outbox_events" ("created_at")`,
    );

    await queryRunner.query(`
      CREATE TYPE "public"."refunds_status_enum" AS ENUM(
        'pending',
        'succeeded',
        'failed'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "refunds" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "order_id" uuid NOT NULL,
        "payment_id" uuid NOT NULL,
        "order_item_id" uuid,
        "amount" integer NOT NULL,
        "currency" character varying(3) NOT NULL DEFAULT 'usd',
        "reason" character varying(500),
        "stripe_refund_id" character varying(255) NOT NULL,
        "status" "public"."refunds_status_enum" NOT NULL DEFAULT 'pending',
        "metadata" jsonb NOT NULL DEFAULT '{}',
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_refunds_stripe_refund_id" UNIQUE ("stripe_refund_id"),
        CONSTRAINT "PK_refunds_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "idx_refunds_order_id" ON "refunds" ("order_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_refunds_payment_id" ON "refunds" ("payment_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_refunds_stripe_refund_id" ON "refunds" ("stripe_refund_id")`,
    );

    await queryRunner.query(
      `ALTER TABLE "refunds" ADD CONSTRAINT "FK_refunds_payment_id" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );

    await queryRunner.query(`
      CREATE TYPE "public"."webhook_events_status_enum" AS ENUM(
        'pending',
        'processing',
        'completed',
        'failed'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "webhook_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "stripe_event_id" character varying(255) NOT NULL,
        "event_type" character varying(100) NOT NULL,
        "status" "public"."webhook_events_status_enum" NOT NULL DEFAULT 'pending',
        "processing_attempts" integer NOT NULL DEFAULT '0',
        "processed_at" TIMESTAMP,
        "payload_snapshot" jsonb NOT NULL,
        "error_message" text,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_webhook_events_stripe_event_id" UNIQUE ("stripe_event_id"),
        CONSTRAINT "PK_webhook_events_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "idx_webhook_events_stripe_event_id" ON "webhook_events" ("stripe_event_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_webhook_events_status" ON "webhook_events" ("status")`,
    );

    await queryRunner.query(
      `ALTER TABLE "payments" ADD "stripe_checkout_session_id" character varying(255)`,
    );

    await queryRunner.query(
      `ALTER TABLE "payments" ADD "line_items_snapshot" jsonb`,
    );

    await queryRunner.query(`
      CREATE TYPE "public"."payments_payment_type_enum" AS ENUM(
        'ecommerce',
        'subscription'
      )
    `);

    await queryRunner.query(
      `ALTER TABLE "payments" ADD "payment_type" "public"."payments_payment_type_enum" NOT NULL DEFAULT 'ecommerce'`,
    );

    await queryRunner.query(
      `CREATE INDEX "idx_payments_stripe_session" ON "payments" ("stripe_checkout_session_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "idx_payments_stripe_session"`,
    );

    await queryRunner.query(
      `ALTER TABLE "payments" DROP COLUMN "payment_type"`,
    );

    await queryRunner.query(
      `DROP TYPE "public"."payments_payment_type_enum"`,
    );

    await queryRunner.query(
      `ALTER TABLE "payments" DROP COLUMN "line_items_snapshot"`,
    );

    await queryRunner.query(
      `ALTER TABLE "payments" DROP COLUMN "stripe_checkout_session_id"`,
    );

    await queryRunner.query(
      `DROP INDEX "idx_webhook_events_status"`,
    );
    await queryRunner.query(
      `DROP INDEX "idx_webhook_events_stripe_event_id"`,
    );

    await queryRunner.query(`DROP TABLE "webhook_events"`);
    await queryRunner.query(`DROP TYPE "public"."webhook_events_status_enum"`);

    await queryRunner.query(
      `ALTER TABLE "refunds" DROP CONSTRAINT "FK_refunds_payment_id"`,
    );

    await queryRunner.query(
      `DROP INDEX "idx_refunds_stripe_refund_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "idx_refunds_payment_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "idx_refunds_order_id"`,
    );

    await queryRunner.query(`DROP TABLE "refunds"`);
    await queryRunner.query(`DROP TYPE "public"."refunds_status_enum"`);

    await queryRunner.query(
      `DROP INDEX "idx_outbox_events_created_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "idx_outbox_events_status"`,
    );

    await queryRunner.query(`DROP TABLE "outbox_events"`);
    await queryRunner.query(`DROP TYPE "public"."outbox_events_status_enum"`);

    await queryRunner.query(
      `DROP INDEX "idx_checkout_session_stripe_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "idx_checkout_session_user_id"`,
    );

    await queryRunner.query(`DROP TABLE "checkout_session_states"`);
    await queryRunner.query(
      `DROP TYPE "public"."checkout_session_states_status_enum"`,
    );

    await queryRunner.query(
      `ALTER TABLE "products" DROP CONSTRAINT "chk_available_stock_non_negative"`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" DROP CONSTRAINT "chk_reserved_quantity_non_negative"`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" DROP CONSTRAINT "chk_stock_non_negative"`,
    );

    await queryRunner.query(
      `ALTER TABLE "products" DROP COLUMN "reserved_quantity"`,
    );
  }
}
