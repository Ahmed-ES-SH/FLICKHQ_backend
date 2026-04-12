import {
  Controller,
  Post,
  Patch,
  Delete,
  Get,
  Param,
  Body,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { BlogService } from './blog.service';
import { CreateArticleDto } from './dto/create-article.dto';
import { UpdateArticleDto } from './dto/update-article.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { FilterArticlesQueryDto } from './dto/filter-articles-query.dto';
import { Roles } from '../auth/decorators/Roles.decorator';
import { UserRoleEnum } from '../auth/types/UserRoleEnum';

@Controller('admin/blog')
@Roles(UserRoleEnum.ADMIN)
@ApiTags('Blog')
export class BlogController {
  constructor(private readonly blogService: BlogService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new article' })
  @ApiResponse({ status: 201, description: 'Article created successfully' })
  @ApiResponse({ status: 400, description: 'Bad request - validation error' })
  create(@Body() dto: CreateArticleDto) {
    return this.blogService.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an existing article' })
  @ApiResponse({ status: 200, description: 'Article updated successfully' })
  @ApiResponse({ status: 404, description: 'Article not found' })
  @ApiParam({ name: 'id', format: 'uuid' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateArticleDto,
  ) {
    return this.blogService.update(id, dto);
  }

  @Patch(':id/publish')
  @ApiOperation({ summary: 'Toggle publish status of an article' })
  @ApiResponse({ status: 200, description: 'Publish status toggled' })
  @ApiResponse({
    status: 400,
    description: 'Excerpt required before publishing',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  togglePublish(@Param('id', ParseUUIDPipe) id: string) {
    return this.blogService.togglePublish(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an article' })
  @ApiResponse({ status: 200, description: 'Article deleted successfully' })
  @ApiResponse({ status: 404, description: 'Article not found' })
  @ApiParam({ name: 'id', format: 'uuid' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.blogService.remove(id);
  }

  @Get()
  @ApiOperation({ summary: 'List all articles with pagination and filtering' })
  @ApiResponse({ status: 200, description: 'Paginated list of articles' })
  findAll(
    @Query() query: PaginationQueryDto,
    @Query() filters: FilterArticlesQueryDto,
  ) {
    return this.blogService.findAll(query, filters);
  }
}
