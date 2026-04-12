import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Article } from './schema/article.schema';
import { BlogService } from './blog.service';
import { BlogController } from './blog.controller';
import { BlogPublicController } from './blog.public.controller';
import { CategoriesModule } from '../categories/categories.module';

@Module({
  imports: [TypeOrmModule.forFeature([Article]), CategoriesModule],
  controllers: [BlogController, BlogPublicController],
  providers: [BlogService],
  exports: [BlogService],
})
export class BlogModule {}
