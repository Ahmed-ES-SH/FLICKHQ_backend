import { Controller, Get, Param, Query, NotFoundException } from '@nestjs/common';
import { MoviesService } from './movies.service';
import { MovieQueryDto } from './dto/movie-query.dto';

@Controller('api/v1/movies')
export class MoviesController {
  constructor(private readonly moviesService: MoviesService) {}

  /**
   * GET /api/v1/movies
   * Browse/search movies
   */
  @Get()
  async searchMovies(@Query() query: MovieQueryDto) {
    return this.moviesService.searchMovies(query.query, query.page, query.limit);
  }

  /**
   * GET /api/v1/movies/:id
   * Movie detail by internal ID
   */
  @Get(':id')
  async getMovieDetail(@Param('id') id: string) {
    const movieId = parseInt(id, 10);
    if (isNaN(movieId)) {
      throw new NotFoundException('Invalid movie ID');
    }
    return this.moviesService.findOne(movieId);
  }
}
