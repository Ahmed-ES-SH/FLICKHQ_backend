import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from './schema/product.schema';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { ProductsPublicController } from './products.public.controller';
import { AuthModule } from '../auth/auth.module';
import { CategoriesModule } from '../categories/categories.module';

@Module({
  imports: [TypeOrmModule.forFeature([Product]), AuthModule, CategoriesModule],
  controllers: [ProductsController, ProductsPublicController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
