import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { BlogService } from './blog.service';
import { FindPublishedArticlesQueryDto } from './dto/find-published-articles-query.dto';

@Public()
@Controller('blog')
@ApiTags('Blog (Public)')
export class BlogPublicController {
  constructor(private readonly blogService: BlogService) {}

  @Get()
  @ApiOperation({
    summary: 'List published articles with pagination and tag filtering',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of published articles',
  })
  findPublished(@Query() query: FindPublishedArticlesQueryDto) {
    return this.blogService.findPublished(query);
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
