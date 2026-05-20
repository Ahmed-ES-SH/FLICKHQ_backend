import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Category } from './schema/category.schema';
import { Product } from '../products/schema/product.schema';
import { Article } from '../blog/schema/article.schema';
import { CategoriesService } from './categories.service';
import { CategoriesController } from './categories.controller';
import { CategoriesPublicController } from './categories.public.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([Category, Product, Article]), AuthModule],
  controllers: [CategoriesController, CategoriesPublicController],
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
