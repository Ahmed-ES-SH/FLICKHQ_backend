import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMissingColumns1779459851950 implements MigrationInterface {
  name = 'AddMissingColumns1779459851950';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "stripe_customer_id" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "is_premium" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "black_list_tokens" ADD "expiresAt" TIMESTAMP NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_black_list_tokens_expiresAt" ON "black_list_tokens" ("expiresAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_black_list_tokens_expiresAt"`);
    await queryRunner.query(
      `ALTER TABLE "black_list_tokens" DROP COLUMN "expiresAt"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "is_premium"`);
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "stripe_customer_id"`,
    );
  }
}
