import { DataSource } from 'typeorm';
import { databaseConfig } from '../../config/database.config';
import { seedCategories } from './seed-categories';
import { seedArticles } from './seed-articles';

async function resetCategoriesTable(dataSource: DataSource): Promise<void> {
  console.log('📦 Dropping categories table...');

  try {
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

    await resetCategoriesTable(dataSource);
    console.log('');

    await recreateTables(dataSource);
    console.log('');

    const slugToIdMap = await seedCategories(dataSource);

    const articleStats = await seedArticles(dataSource, slugToIdMap);

    await dataSource.destroy();

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('🎉 Database seeding completed successfully!');
    console.log(
      `   Categories: ${Object.keys(slugToIdMap).length > 0 ? slugToIdMap.size : 'see above'}`,
    );
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
