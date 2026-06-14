import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixUserSubscriptions1781275000000 implements MigrationInterface {
  name = 'FixUserSubscriptions1781275000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // C2 fix: Drop the UNIQUE constraint on user_id to allow re-subscription.
    // After canceling, a user can subscribe again and get a new row.
    await queryRunner.query(`
      ALTER TABLE "user_subscriptions"
        DROP CONSTRAINT "UQ_user_subscriptions_user_id"
    `);

    // H2 fix: Add cancel_at_period_end column to track pending cancellations.
    // The webhook sets this from Stripe's cancel_at_period_end field.
    await queryRunner.query(`
      ALTER TABLE "user_subscriptions"
        ADD COLUMN "cancel_at_period_end" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert: drop cancel_at_period_end column
    await queryRunner.query(`
      ALTER TABLE "user_subscriptions"
        DROP COLUMN "cancel_at_period_end"
    `);

    // Revert: re-add the unique constraint on user_id
    await queryRunner.query(`
      ALTER TABLE "user_subscriptions"
        ADD CONSTRAINT "UQ_user_subscriptions_user_id" UNIQUE ("user_id")
    `);
  }
}
