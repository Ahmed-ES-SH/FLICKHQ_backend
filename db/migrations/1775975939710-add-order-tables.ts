import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderTables1775975939710 implements MigrationInterface {
  name = 'AddOrderTables1775975939710';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "public"."orders_status_enum" AS ENUM(
        'awaiting_checkout_session',
        'pending_payment',
        'paid',
        'failed',
        'canceled',
        'refunded',
        'partially_refunded',
        'expired'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "orders" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "status" "public"."orders_status_enum" NOT NULL DEFAULT 'awaiting_checkout_session',
        "subtotal" integer NOT NULL,
        "tax_amount" integer NOT NULL DEFAULT '0',
        "discount_amount" integer NOT NULL DEFAULT '0',
        "total_amount" integer NOT NULL,
        "currency" character varying(3) NOT NULL DEFAULT 'usd',
        "payment_id" uuid,
        "stripe_checkout_session_id" character varying(255),
        "stripe_payment_intent_id" character varying(255),
        "reservation_expires_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_orders_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "idx_orders_user_id" ON "orders" ("user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_orders_stripe_session" ON "orders" ("stripe_checkout_session_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_orders_status" ON "orders" ("status")`,
    );

    await queryRunner.query(`
      CREATE TABLE "order_items" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "order_id" uuid NOT NULL,
        "product_id" uuid NOT NULL,
        "product_title_snapshot" character varying(300) NOT NULL,
        "product_thumbnail_snapshot" character varying,
        "unit_price" integer NOT NULL,
        "quantity" integer NOT NULL,
        "subtotal" integer NOT NULL,
        "currency" character varying(3) NOT NULL DEFAULT 'usd',
        "metadata_snapshot" jsonb NOT NULL DEFAULT '{}',
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_order_items_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "idx_order_items_order_id" ON "order_items" ("order_id")`,
    );

    await queryRunner.query(
      `ALTER TABLE "order_items" ADD CONSTRAINT "FK_order_items_order_id" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE`,
    );

    await queryRunner.query(
      `ALTER TABLE "orders" ADD CONSTRAINT "FK_orders_payment_id" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `ALTER TABLE "payments" ADD "order_id" uuid`,
    );

    await queryRunner.query(
      `ALTER TABLE "payments" ADD CONSTRAINT "UQ_payments_order_id" UNIQUE ("order_id")`,
    );

    await queryRunner.query(
      `ALTER TABLE "payments" ADD CONSTRAINT "FK_payments_order_id" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT "FK_payments_order_id"`,
    );

    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT "UQ_payments_order_id"`,
    );

    await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "order_id"`);

    await queryRunner.query(
      `ALTER TABLE "orders" DROP CONSTRAINT "FK_orders_payment_id"`,
    );

    await queryRunner.query(
      `ALTER TABLE "order_items" DROP CONSTRAINT "FK_order_items_order_id"`,
    );

    await queryRunner.query(`DROP INDEX "idx_order_items_order_id"`);

    await queryRunner.query(`DROP TABLE "order_items"`);

    await queryRunner.query(`DROP INDEX "idx_orders_status"`);
    await queryRunner.query(`DROP INDEX "idx_orders_stripe_session"`);
    await queryRunner.query(`DROP INDEX "idx_orders_user_id"`);

    await queryRunner.query(`DROP TABLE "orders"`);

    await queryRunner.query(`DROP TYPE "public"."orders_status_enum"`);
  }
}
