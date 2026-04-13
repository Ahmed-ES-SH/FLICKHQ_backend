import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WatchlistModule } from './watchlist/watchlist.module';
import { WatchedModule } from './watched/watched.module';
import { FavoritesModule } from './favorites/favorites.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([]),
    WatchlistModule,
    WatchedModule,
    FavoritesModule,
  ],
  exports: [WatchlistModule, WatchedModule, FavoritesModule],
})
export class ListsModule {}
