import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { UserList } from './schema/user-list.entity';
import { UserListItem } from './schema/user-list-item.entity';
import { TmdbService } from './tmdb/tmdb.service';
import { ListsService } from './lists.service';
import { ListsController } from './lists.controller';

@Module({
  imports: [TypeOrmModule.forFeature([UserList, UserListItem]), HttpModule],
  controllers: [ListsController],
  providers: [TmdbService, ListsService],
  exports: [ListsService],
})
export class ListsModule {}
