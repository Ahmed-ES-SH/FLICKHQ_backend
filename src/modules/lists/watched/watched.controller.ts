import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { WatchedService } from './watched.service';
import { AddToListDto } from '../common/dto/add-to-list.dto';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { GetUser } from '../../../auth/decorators/current-user.decorator';
import { User } from '../../../user/schema/user.entity';

@Controller('api/v1/watched')
@UseGuards(AuthGuard('jwt'))
export class WatchedController {
  constructor(private readonly watchedService: WatchedService) {}

  /**
   * GET /api/v1/watched
   * Get user's watched list with pagination
   */
  @Get()
  async getWatched(@GetUser() user: User, @Query() pagination: PaginationDto) {
    const page = pagination.page || 1;
    const limit = pagination.limit || 20;

    const result = await this.watchedService.getAll(
      user.id.toString(),
      page,
      limit,
    );

    return {
      data: result.data,
      meta: {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      },
    };
  }

  /**
   * POST /api/v1/watched
   * Mark movie as watched (can include rating)
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async addToWatched(@GetUser() user: User, @Body() dto: AddToListDto) {
    const result = await this.watchedService.add(user.id.toString(), dto);
    return result;
  }

  /**
   * PATCH /api/v1/watched/:movieId
   * Update rating for a watched movie
   */
  @Patch(':movieId')
  async updateRating(
    @GetUser() user: User,
    @Param('movieId') movieId: string,
    @Body('rating') rating: number,
  ) {
    const result = await this.watchedService.updateRating(
      user.id.toString(),
      movieId,
      rating,
    );
    return result;
  }

  /**
   * DELETE /api/v1/watched/:movieId
   * Remove movie from watched list
   */
  @Delete(':movieId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeFromWatched(
    @GetUser() user: User,
    @Param('movieId') movieId: string,
  ) {
    await this.watchedService.remove(user.id.toString(), movieId);
  }

  /**
   * GET /api/v1/watched/check/:tmdbId
   * Check if movie is in watched list
   */
  @Get('check/:tmdbId')
  async checkInWatched(
    @GetUser() user: User,
    @Param('tmdbId', ParseIntPipe) tmdbId: number,
  ) {
    const isInWatched = await this.watchedService.isInWatched(
      user.id.toString(),
      tmdbId,
    );
    return { isInWatched };
  }
}

// Need to import ParseIntPipe
import { ParseIntPipe } from '@nestjs/common';
