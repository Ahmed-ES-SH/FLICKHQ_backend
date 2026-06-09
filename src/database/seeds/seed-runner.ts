import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { databaseConfig } from '../../config/database.config';
import { seedPlans } from './seed-plans';

async function main() {
  console.log('🌱 Running seeds...\n');

  const dataSource = new DataSource(databaseConfig);
  await dataSource.initialize();
  console.log('✅ Database connected\n');

  await seedPlans(dataSource);

  await dataSource.destroy();
  console.log('🎉 All seeds completed!\n');
  process.exit(0);
}

main().catch((error) => {
  console.error('\n❌ Seed runner failed:', error);
  process.exit(1);
});
