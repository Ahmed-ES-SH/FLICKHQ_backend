import {
  Controller,
  Get,
  Param,
  Query,
  UseInterceptors,
  ClassSerializerInterceptor,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ProductsService } from './products.service';
import { FilterProductsQueryDto } from './dto/filter-products-query.dto';
import { ProductResponseDto } from './dto/product-response.dto';
import { Public } from '../auth/decorators/public.decorator';

@ApiTags('Products')
@Public()
@UseInterceptors(ClassSerializerInterceptor)
@Controller('products')
export class ProductsPublicController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @ApiOperation({ summary: 'Get public product catalog' })
  @ApiResponse({
    status: 200,
    description: 'List of published products',
    type: [ProductResponseDto],
  })
  async findAll(@Query() filters: FilterProductsQueryDto): Promise<{
    data: ProductResponseDto[];
    total: number;
    totalPages: number;
    page: number;
    limit: number;
  }> {
    return this.productsService.getPublicCatalog(filters);
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Get a product by slug (public)' })
  @ApiResponse({
    status: 200,
    description: 'Product found',
    type: ProductResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Product not found' })
  async findOne(@Param('slug') slug: string): Promise<ProductResponseDto> {
    return this.productsService.getBySlug(slug);
  }

  @Get('category/:categorySlug')
  @ApiOperation({ summary: 'Get products by category slug' })
  @ApiResponse({
    status: 200,
    description: 'List of products in category',
    type: [ProductResponseDto],
  })
  @ApiResponse({ status: 404, description: 'Category not found' })
  async findByCategory(
    @Param('categorySlug') categorySlug: string,
    @Query() filters: FilterProductsQueryDto,
  ): Promise<{
    data: ProductResponseDto[];
    total: number;
    totalPages: number;
    page: number;
    limit: number;
  }> {
    return this.productsService.getByCategorySlug(categorySlug, filters);
  }
}
