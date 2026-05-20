import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDeletedAtToProducts1775975939708 implements MigrationInterface {
  name = 'AddDeletedAtToProducts1775975939708';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "products" ADD "deleted_at" TIMESTAMP DEFAULT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "products" DROP COLUMN "deleted_at"`,
    );
  }
}
