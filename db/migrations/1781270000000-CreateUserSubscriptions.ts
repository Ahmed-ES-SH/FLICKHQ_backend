import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUserSubscriptions1781270000000 implements MigrationInterface {
  name = 'CreateUserSubscriptions1781270000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "public"."user_subscriptions_status_enum" AS ENUM(
        'incomplete', 'trialing', 'active', 'past_due',
        'canceled', 'unpaid', 'incomplete_expired'
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "user_subscriptions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" integer NOT NULL,
        "stripe_subscription_id" character varying(255) NOT NULL,
        "stripe_customer_id" character varying(255) NOT NULL,
        "status" "public"."user_subscriptions_status_enum" NOT NULL DEFAULT 'incomplete',
        "plan_code" character varying(100) NOT NULL,
        "stripe_price_id" character varying(255) NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_subscriptions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_user_subscriptions_user_id" UNIQUE ("user_id"),
        CONSTRAINT "UQ_user_subscriptions_stripe_sub" UNIQUE ("stripe_subscription_id"),
        CONSTRAINT "FK_user_subscriptions_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_user_subscriptions_status"
        ON "user_subscriptions" ("status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "user_subscriptions"`);
    await queryRunner.query(`DROP TYPE "public"."user_subscriptions_status_enum"`);
  }
}
