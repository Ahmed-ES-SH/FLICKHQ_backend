import { DataSource } from 'typeorm';
import { databaseConfig } from '../../config/database.config';
import { Category } from '../../categories/schema/category.schema';
import { Product } from '../../products/schema/product.schema';

async function verify() {
  const dataSource = new DataSource(databaseConfig);
  await dataSource.initialize();

  const categoryRepo = dataSource.getRepository(Category);
  const productRepo = dataSource.getRepository(Product);

  const categoryCount = await categoryRepo.count();
  const productCount = await productRepo.count();

  console.log(`\n📊 Database Verification:`);
  console.log(`   Categories: ${categoryCount}`);
  console.log(`   Products: ${productCount}`);

  const categories = await categoryRepo.find({
    select: ['id', 'name', 'slug'],
    order: { name: 'ASC' },
  });

  console.log(`\n📂 Categories:`);
  for (const cat of categories) {
    const productCount = await productRepo.count({
      where: { categoryId: cat.id },
    });
    console.log(`   - ${cat.name} (${cat.slug}): ${productCount} products`);
  }

  const sampleProducts = await productRepo.find({
    select: ['id', 'title', 'slug', 'sku', 'price', 'categoryId'],
    take: 5,
    order: { title: 'ASC' },
  });

  console.log(`\n📦 Sample Products:`);
  for (const product of sampleProducts) {
    console.log(`   - ${product.title} (${product.sku}): $${product.price}`);
  }

  await dataSource.destroy();
}

verify().catch(console.error);
