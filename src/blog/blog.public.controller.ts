import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { BlogService } from './blog.service';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { FilterArticlesQueryDto } from './dto/filter-articles-query.dto';

@Public()
@Controller('blog')
@ApiTags('Blog (Public)')
export class BlogPublicController {
  constructor(private readonly blogService: BlogService) {}

  @Get()
  @ApiOperation({ summary: 'List published articles with pagination and tag filtering' })
  @ApiResponse({ status: 200, description: 'Paginated list of published articles' })
  findPublished(
    @Query() pagination: PaginationQueryDto,
    @Query() filters: FilterArticlesQueryDto,
  ) {
    return this.blogService.findPublished(pagination, filters);
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Get a single published article by slug' })
  @ApiResponse({ status: 200, description: 'Article details' })
  @ApiResponse({ status: 404, description: 'Published article not found' })
  @ApiParam({ name: 'slug', description: 'Article slug' })
  findBySlug(@Param('slug') slug: string) {
    return this.blogService.findBySlug(slug);
  }
}
