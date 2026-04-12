import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CategoriesService } from './categories.service';
import { Category } from './schema/category.schema';
import { Public } from '../auth/decorators/public.decorator';

@ApiTags('Categories')
@Public()
@Controller('categories')
export class CategoriesPublicController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  @ApiOperation({ summary: 'Get all categories (public)' })
  @ApiResponse({
    status: 200,
    description: 'List of all categories',
    type: [Category],
  })
  async findAll(): Promise<Category[]> {
    return this.categoriesService.getAllPublic();
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Get a category by slug (public)' })
  @ApiResponse({ status: 200, description: 'Category found', type: Category })
  @ApiResponse({ status: 404, description: 'Category not found' })
  async findOne(@Param('slug') slug: string): Promise<Category> {
    return this.categoriesService.getBySlugPublic(slug);
  }
}
