import { DataSource } from 'typeorm';
import { databaseConfig } from '../../config/database.config';
import { seedCategories } from './seed-categories';
import { seedProducts } from './seed-products';
import { seedArticles } from './seed-articles';

async function resetTables(dataSource: DataSource): Promise<void> {
  console.log('📦 Dropping products and categories tables...');

  try {
    await dataSource.query('DROP TABLE IF EXISTS products CASCADE');
    await dataSource.query('DROP TABLE IF EXISTS categories CASCADE');
    console.log('✅ Tables dropped successfully');
  } catch (error) {
    console.error('❌ Failed to drop tables:', error);
    throw error;
  }
}

async function recreateTables(dataSource: DataSource): Promise<void> {
  console.log('🔄 Recreating tables from migrations...');

  try {
    await dataSource.query(`
      CREATE TABLE "categories" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying(100) NOT NULL,
        "slug" character varying(120) NOT NULL,
        "description" text,
        "color" character varying(7),
        "icon" character varying(50),
        "order" integer NOT NULL DEFAULT '0',
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_categories_id" PRIMARY KEY ("id")
      )
    `);

    await dataSource.query(
      `CREATE UNIQUE INDEX "idx_categories_slug_unique" ON "categories" ("slug")`,
    );
    await dataSource.query(
      `CREATE UNIQUE INDEX "idx_categories_name_unique" ON "categories" ("name")`,
    );
    await dataSource.query(
      `CREATE INDEX "idx_categories_order" ON "categories" ("order")`,
    );

    await dataSource.query(`
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
        "deleted_at" TIMESTAMP DEFAULT NULL,
        CONSTRAINT "PK_products_id" PRIMARY KEY ("id")
      )
    `);

    await dataSource.query(
      `CREATE UNIQUE INDEX "idx_products_slug" ON "products" ("slug")`,
    );
    await dataSource.query(
      `CREATE UNIQUE INDEX "idx_products_sku" ON "products" ("sku")`,
    );
    await dataSource.query(
      `CREATE INDEX "idx_products_category_id" ON "products" ("category_id")`,
    );
    await dataSource.query(
      `CREATE INDEX "idx_products_is_published" ON "products" ("is_published")`,
    );
    await dataSource.query(
      `CREATE INDEX "idx_products_price" ON "products" ("price")`,
    );
    await dataSource.query(
      `CREATE INDEX "idx_products_rating" ON "products" ("rating")`,
    );
    await dataSource.query(
      `CREATE INDEX "idx_products_title_description_search" ON "products" ("title", "description")`,
    );

    await dataSource.query(`
      ALTER TABLE "products"
      ADD CONSTRAINT "FK_products_category_id"
      FOREIGN KEY ("category_id")
      REFERENCES "categories"("id")
      ON DELETE SET NULL
      ON UPDATE NO ACTION
    `);

    console.log('✅ Tables recreated successfully');
  } catch (error) {
    console.error('❌ Failed to recreate tables:', error);
    throw error;
  }
}

async function main() {
  console.log('🌱 Starting database seed...\n');
  const startTime = Date.now();

  let dataSource: DataSource | null = null;

  try {
    console.log('🔗 Connecting to database...');
    dataSource = new DataSource(databaseConfig);
    await dataSource.initialize();
    console.log('✅ Database connected\n');

    await resetTables(dataSource);
    console.log('');

    await recreateTables(dataSource);
    console.log('');

    const slugToIdMap = await seedCategories(dataSource);

    const productStats = await seedProducts(dataSource, slugToIdMap);

    const articleStats = await seedArticles(dataSource, slugToIdMap);

    await dataSource.destroy();

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('🎉 Database seeding completed successfully!');
    console.log(
      `   Categories: ${Object.keys(slugToIdMap).length > 0 ? slugToIdMap.size : 'see above'}`,
    );
    console.log(`   Products inserted: ${productStats.inserted}`);
    console.log(`   Products skipped: ${productStats.skipped}`);
    console.log(`   Products invalid: ${productStats.invalid}`);
    console.log(`   Articles inserted: ${articleStats.inserted}`);
    console.log(`   Articles skipped: ${articleStats.skipped}`);
    console.log(`   Articles invalid: ${articleStats.invalid}`);
    console.log(`   Total time: ${duration}s\n`);

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Seed failed:', error);

    if (dataSource) {
      try {
        await dataSource.destroy();
      } catch {
        // Ignore cleanup errors
      }
    }

    process.exit(1);
  }
}

main().catch((error) => {
  console.error('\n❌ Unhandled seed error:', error);
  process.exit(1);
});
