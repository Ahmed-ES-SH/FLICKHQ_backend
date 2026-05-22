import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  ParseUUIDPipe,
  UseGuards,
  UseInterceptors,
  ClassSerializerInterceptor,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { FilterProductsQueryDto } from './dto/filter-products-query.dto';
import { ProductResponseDto } from './dto/product-response.dto';
import { Roles } from '../auth/decorators/Roles.decorator';
import { UserRoleEnum } from '../auth/types/UserRoleEnum';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

@ApiTags('Admin - Products')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRoleEnum.ADMIN)
@UseInterceptors(ClassSerializerInterceptor)
@Controller('admin/products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new product' })
  @ApiResponse({
    status: 201,
    description: 'Product created successfully',
    type: ProductResponseDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Product SKU or slug already exists',
  })
  async create(
    @Body() createProductDto: CreateProductDto,
  ): Promise<ProductResponseDto> {
    return this.productsService.create(createProductDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all products with pagination and filters' })
  @ApiResponse({ status: 200, description: 'List of products' })
  async findAll(@Query() filters: FilterProductsQueryDto): Promise<{
    data: ProductResponseDto[];
    total: number;
    totalPages: number;
    page: number;
    limit: number;
  }> {
    return this.productsService.getAll(filters);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a product by ID' })
  @ApiResponse({
    status: 200,
    description: 'Product found',
    type: ProductResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Product not found' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ProductResponseDto> {
    return this.productsService.getById(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a product' })
  @ApiResponse({
    status: 200,
    description: 'Product updated successfully',
    type: ProductResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Product not found' })
  @ApiResponse({
    status: 409,
    description: 'Product SKU or slug already exists',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateProductDto: UpdateProductDto,
  ): Promise<ProductResponseDto> {
    return this.productsService.update(id, updateProductDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a product' })
  @ApiResponse({ status: 200, description: 'Product deleted successfully' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ message: string }> {
    return this.productsService.delete(id);
  }

  @Patch(':id/toggle-publish')
  @ApiOperation({ summary: 'Toggle product publish status' })
  @ApiResponse({ status: 200, description: 'Publish status toggled' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  async togglePublish(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ id: string; isPublished: boolean; message: string }> {
    return this.productsService.togglePublish(id);
  }
}
