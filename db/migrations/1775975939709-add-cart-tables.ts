import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCartTables1775975939709 implements MigrationInterface {
  name = 'AddCartTables1775975939709';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "carts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_carts" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_carts_user_id" ON "carts" ("user_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "cart_items" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "cart_id" uuid NOT NULL,
        "product_id" uuid NOT NULL,
        "quantity" integer NOT NULL DEFAULT '1',
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_cart_items" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_cart_items_cart_id" ON "cart_items" ("cart_id")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_cart_items_unique" ON "cart_items" ("cart_id", "product_id")
    `);

    await queryRunner.query(`
      ALTER TABLE "cart_items"
        ADD CONSTRAINT "FK_cart_items_cart"
        FOREIGN KEY ("cart_id") REFERENCES "carts"("id")
        ON DELETE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE "cart_items"
        ADD CONSTRAINT "FK_cart_items_product"
        FOREIGN KEY ("product_id") REFERENCES "products"("id")
        ON DELETE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "cart_items" DROP CONSTRAINT "FK_cart_items_product"
    `);

    await queryRunner.query(`
      ALTER TABLE "cart_items" DROP CONSTRAINT "FK_cart_items_cart"
    `);

    await queryRunner.query(`DROP INDEX "idx_cart_items_unique"`);
    await queryRunner.query(`DROP INDEX "idx_cart_items_cart_id"`);
    await queryRunner.query(`DROP TABLE "cart_items"`);
    await queryRunner.query(`DROP INDEX "idx_carts_user_id"`);
    await queryRunner.query(`DROP TABLE "carts"`);
  }
}
