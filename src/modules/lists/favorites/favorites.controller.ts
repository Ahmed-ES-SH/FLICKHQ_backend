import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FavoritesService } from './favorites.service';
import { AddToListDto } from '../common/dto/add-to-list.dto';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { GetUser } from '../../../auth/decorators/current-user.decorator';
import { User } from '../../../user/schema/user.schema';

@Controller('api/v1/favorites')
@UseGuards(AuthGuard('jwt'))
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  /**
   * GET /api/v1/favorites
   * Get user's favorites list with pagination
   */
  @Get()
  async getFavorites(
    @GetUser() user: User,
    @Query() pagination: PaginationDto,
  ) {
    const page = pagination.page || 1;
    const limit = pagination.limit || 20;

    const result = await this.favoritesService.getAll(
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
   * POST /api/v1/favorites
   * Add movie to favorites
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async addToFavorites(@GetUser() user: User, @Body() dto: AddToListDto) {
    const result = await this.favoritesService.add(user.id.toString(), dto);
    return result;
  }

  /**
   * DELETE /api/v1/favorites/:movieId
   * Remove movie from favorites
   */
  @Delete(':movieId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeFromFavorites(
    @GetUser() user: User,
    @Param('movieId') movieId: string,
  ) {
    await this.favoritesService.remove(user.id.toString(), movieId);
  }

  /**
   * GET /api/v1/favorites/check/:tmdbId
   * Check if movie is in favorites
   */
  @Get('check/:tmdbId')
  async checkInFavorites(
    @GetUser() user: User,
    @Param('tmdbId', ParseIntPipe) tmdbId: number,
  ) {
    const isInFavorites = await this.favoritesService.isInFavorites(
      user.id.toString(),
      tmdbId,
    );
    return { isInFavorites };
  }
}
