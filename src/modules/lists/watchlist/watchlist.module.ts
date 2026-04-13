import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WatchlistService } from './watchlist.service';
import { WatchlistController } from './watchlist.controller';
import { WatchlistRepository } from './watchlist.repository';
import { Movie } from '../../movies/schema/movie.schema';
import { UserList } from '../schema/user-list.schema';
import { NotificationsModule } from '../../../notifications/notifications.module';

@Module({
  imports: [TypeOrmModule.forFeature([UserList, Movie]), NotificationsModule],
  controllers: [WatchlistController],
  providers: [WatchlistService, WatchlistRepository],
  exports: [WatchlistService],
})
export class WatchlistModule {}
