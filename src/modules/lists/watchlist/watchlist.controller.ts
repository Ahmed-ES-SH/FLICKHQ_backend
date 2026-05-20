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
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { WatchlistService } from './watchlist.service';
import { AddToListDto } from '../dto/add-to-list.dto';
import { PaginationDto } from '../dto/pagination.dto';
import { GetUser } from '../../../auth/decorators/current-user.decorator';
import { User } from '../../../user/schema/user.entity';

@Controller('api/v1/watchlist')
@UseGuards(AuthGuard('jwt'))
export class WatchlistController {
  constructor(private readonly watchlistService: WatchlistService) {}

  @Get()
  async getWatchlist(
    @GetUser() user: User,
    @Query() pagination: PaginationDto,
  ) {
    const page = pagination.page || 1;
    const limit = pagination.limit || 20;

    const result = await this.watchlistService.getAll(
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

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async addToWatchlist(@GetUser() user: User, @Body() dto: AddToListDto) {
    const result = await this.watchlistService.add(user.id.toString(), dto);
    return result;
  }

  @Delete(':movieId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeFromWatchlist(
    @GetUser() user: User,
    @Param('movieId') movieId: string,
  ) {
    await this.watchlistService.remove(user.id.toString(), movieId);
  }
}
