import { DataSource } from 'typeorm';
import { databaseConfig } from '../../config/database.config';
import { Category } from '../../categories/schema/category.schema';

async function verify() {
  const dataSource = new DataSource(databaseConfig);
  await dataSource.initialize();

  const categoryRepo = dataSource.getRepository(Category);

  const categoryCount = await categoryRepo.count();

  console.log(`\n📊 Database Verification:`);
  console.log(`   Categories: ${categoryCount}`);

  const categories = await categoryRepo.find({
    select: ['id', 'name', 'slug'],
    order: { name: 'ASC' },
  });

  console.log(`\n📂 Categories:`);
  for (const cat of categories) {
    console.log(`   - ${cat.name} (${cat.slug})`);
  }

  await dataSource.destroy();
}

verify().catch(console.error);
