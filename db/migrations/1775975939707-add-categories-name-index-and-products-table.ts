import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCategoriesNameIndexAndProductsTable1775975939707
  implements MigrationInterface
{
  name = 'AddCategoriesNameIndexAndProductsTable1775975939707';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1. Create products table first ──────────────────────────
    await queryRunner.query(`
      CREATE TABLE "products" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "title" character varying(300) NOT NULL,
        "slug" character varying(350) NOT NULL,
        "description" text NOT NULL,
        "shortDescription" text,
        "price" numeric(10,2) NOT NULL,
        "discount_percentage" numeric(5,2) NOT NULL DEFAULT '0',
        "discounted_price" numeric(10,2) NOT NULL DEFAULT '0',
        "stock" integer NOT NULL DEFAULT '0',
        "sku" character varying(50) NOT NULL,
        "minimum_order_quantity" integer NOT NULL DEFAULT '1',
        "availability_status" character varying(50) NOT NULL DEFAULT 'In Stock',
        "category_id" uuid,
        "tags" text array NOT NULL DEFAULT '{}',
        "brand" character varying(100),
        "weight" numeric(8,2),
        "dimensions" jsonb,
        "images" text array NOT NULL DEFAULT '{}',
        "thumbnail" character varying,
        "warranty_information" text,
        "shipping_information" text,
        "return_policy" text,
        "reviews" jsonb NOT NULL DEFAULT '[]',
        "rating" numeric(3,2) NOT NULL DEFAULT '0',
        "barcode" character varying,
        "qr_code" character varying,
        "is_published" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_products_id" PRIMARY KEY ("id")
      )
    `);

    // ── 2. Add unique index on categories.name ──────────────────
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_categories_name_unique" ON "categories" ("name")`,
    );

    // ── 3. Indexes ─────────────────────────────────────────────
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_products_slug" ON "products" ("slug")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_products_sku" ON "products" ("sku")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_products_category_id" ON "products" ("category_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_products_is_published" ON "products" ("is_published")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_products_price" ON "products" ("price")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_products_rating" ON "products" ("rating")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_products_title_description_search" ON "products" ("title", "description")`,
    );

    // ── 4. Foreign key (SET NULL on delete) ────────────────────
    await queryRunner.query(`
      ALTER TABLE "products"
      ADD CONSTRAINT "FK_products_category_id"
      FOREIGN KEY ("category_id")
      REFERENCES "categories"("id")
      ON DELETE SET NULL
      ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // ── Reverse FK ─────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE "products" DROP CONSTRAINT "FK_products_category_id"`,
    );

    // ── Drop indexes ───────────────────────────────────────────
    await queryRunner.query(
      `DROP INDEX "idx_products_title_description_search"`,
    );
    await queryRunner.query(`DROP INDEX "idx_products_rating"`);
    await queryRunner.query(`DROP INDEX "idx_products_price"`);
    await queryRunner.query(`DROP INDEX "idx_products_is_published"`);
    await queryRunner.query(`DROP INDEX "idx_products_category_id"`);
    await queryRunner.query(`DROP INDEX "idx_products_sku"`);
    await queryRunner.query(`DROP INDEX "idx_products_slug"`);

    // ── Drop table ─────────────────────────────────────────────
    await queryRunner.query(`DROP TABLE "products"`);

    // ── Drop categories name unique index ──────────────────────
    await queryRunner.query(`DROP INDEX "idx_categories_name_unique"`);
  }
}
