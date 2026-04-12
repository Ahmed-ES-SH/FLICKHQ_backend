import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Category } from './schema/category.schema';
import { CategoriesService } from './categories.service';
import { CategoriesController } from './categories.controller';
import { CategoriesPublicController } from './categories.public.controller';
import { AuthModule } from 'src/auth/auth.module';
import { AuthGuard } from 'src/auth/guards/auth.guard';

@Module({
  imports: [TypeOrmModule.forFeature([Category]), AuthModule],
  controllers: [CategoriesController, CategoriesPublicController],
  providers: [CategoriesService, AuthGuard],
  exports: [CategoriesService],
})
export class CategoriesModule {}
