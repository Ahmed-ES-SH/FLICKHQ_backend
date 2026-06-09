import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { UserList } from './schema/user-list.entity.js';
import { UserListItem } from './schema/user-list-item.entity.js';
import { TmdbService } from './tmdb/tmdb.service.js';
import { MediaType } from './enums/media-type.enum.js';
import { SystemListKey } from './enums/list-key.enum.js';
import { CreateListDto } from './dto/create-list.dto.js';
import { UpdateListDto } from './dto/update-list.dto.js';
import { AddItemDto } from './dto/add-item.dto.js';
import { FilterListsDto } from './dto/filter-lists.dto.js';
import { FilterListItemsDto } from './dto/filter-list-items.dto.js';
import { ListResponseDto } from './dto/list-response.dto.js';
import { ListItemResponseDto } from './dto/list-item-response.dto.js';
import { generateUniqueListSlug } from './helpers/slug.helper.js';
import { paginate, PaginatedResult } from '../../helpers/paginate.helper.js';

@Injectable()
export class ListsService {
  private readonly logger = new Logger(ListsService.name);

  private static readonly SYSTEM_LISTS: Array<{
    name: string;
    slug: string;
    listKey: SystemListKey;
  }> = [
    { name: 'Favorites', slug: 'favorites', listKey: SystemListKey.FAVORITES },
    { name: 'Watchlist', slug: 'watchlist', listKey: SystemListKey.WATCHLIST },
    { name: 'Watched', slug: 'watched', listKey: SystemListKey.WATCHED },
  ];

  private static readonly RESERVED_SLUGS: string[] =
    ListsService.SYSTEM_LISTS.map((s) => s.slug);

  private static readonly SORT_FIELD_MAP: Record<string, keyof UserListItem> = {
    addedAt: 'addedAt',
    title: 'title',
    releaseDate: 'releaseDate',
    voteAverage: 'voteAverage',
  };

  constructor(
    @InjectRepository(UserList)
    private readonly listRepo: Repository<UserList>,
    @InjectRepository(UserListItem)
    private readonly itemRepo: Repository<UserListItem>,
    private readonly tmdbService: TmdbService,
  ) {}

  // ─── 3.1 ensureSystemLists ──────────────────────────────────────

  async ensureSystemLists(userId: number): Promise<UserList[]> {
    const systemKeys = ListsService.SYSTEM_LISTS.map((s) => s.listKey);

    const existing = await this.listRepo.findBy({
      userId,
      listKey: In(systemKeys),
    });

    const existingMap = new Map(existing.map((l) => [l.listKey, l]));

    const toCreate = ListsService.SYSTEM_LISTS.filter(
      (sys) => !existingMap.has(sys.listKey),
    ).map((sys) =>
      this.listRepo.create({
        userId,
        name: sys.name,
        slug: sys.slug,
        listKey: sys.listKey,
        isSystem: true,
      }),
    );

    if (toCreate.length > 0) {
      await this.listRepo.save(toCreate);
    }

    return ListsService.SYSTEM_LISTS.map(
      (sys) =>
        existingMap.get(sys.listKey) ??
        toCreate.find((c) => c.listKey === (sys.listKey as string))!,
    );
  }

  // ─── 3.2 create ─────────────────────────────────────────────────

  async create(userId: number, dto: CreateListDto): Promise<ListResponseDto> {
    const slug = dto.slug
      ? dto.slug
      : await generateUniqueListSlug(dto.name, this.listRepo, {
          excludeId: undefined,
        });

    if (ListsService.RESERVED_SLUGS.includes(slug)) {
      throw new ConflictException('This slug is reserved for system lists');
    }

    const list = this.listRepo.create({
      userId,
      name: dto.name,
      slug,
      listKey: `custom:${crypto.randomUUID()}`,
      isSystem: false,
    });

    try {
      const saved = await this.listRepo.save(list);
      return this.toListResponse(saved, 0);
    } catch (err) {
      if (ListsService.isUniqueViolation(err)) {
        throw new ConflictException('A list with this slug already exists');
      }
      throw err;
    }
  }

  // ─── 3.3 findAllForUser ─────────────────────────────────────────

  async findAllForUser(
    userId: number,
    filters: FilterListsDto,
  ): Promise<PaginatedResult<ListResponseDto>> {
    const result = await paginate<UserList>(
      this.listRepo,
      filters.page,
      filters.perPage,
      {
        where: { userId },
        order: { isSystem: 'DESC', createdAt: 'DESC' },
      },
    );

    const listIds = result.data.map((l) => l.id);

    let itemCounts: Array<{ listId: string; count: string }> = [];
    if (listIds.length > 0) {
      itemCounts = await this.itemRepo
        .createQueryBuilder('item')
        .select('item.list_id', 'listId')
        .addSelect('COUNT(*)', 'count')
        .where('item.list_id IN (:...listIds)', { listIds })
        .groupBy('item.list_id')
        .getRawMany();
    }

    const countMap = new Map(
      itemCounts.map((r) => [r.listId, parseInt(r.count, 10)]),
    );

    const data = result.data.map((list) =>
      this.toListResponse(list, countMap.get(list.id) ?? 0),
    );

    return { ...result, data };
  }

  // ─── 3.4 findOneForUser ─────────────────────────────────────────

  async findOneForUser(
    userId: number,
    listId: string,
    filters: FilterListItemsDto,
  ): Promise<{
    list: ListResponseDto;
    items: PaginatedResult<ListItemResponseDto>;
  }> {
    const list = await this.listRepo.findOne({
      where: { id: listId, userId },
    });

    if (!list) {
      throw new NotFoundException('List not found');
    }

    const itemWhere: Record<string, unknown> = { listId: list.id };
    if (filters.mediaType) {
      itemWhere.mediaType = filters.mediaType;
    }

    const sortField =
      ListsService.SORT_FIELD_MAP[filters.sortBy ?? 'addedAt'] ?? 'addedAt';

    const items = await paginate<UserListItem>(
      this.itemRepo,
      filters.page,
      filters.perPage,
      {
        where: itemWhere,
        order: { [sortField]: filters.order },
      },
    );

    return {
      list: this.toListResponse(list, items.total),
      items: {
        ...items,
        data: items.data.map((i) => this.toListItemResponse(i)),
      },
    };
  }

  // ─── 3.5 addItem ────────────────────────────────────────────────

  async addItem(
    userId: number,
    listId: string,
    dto: AddItemDto,
  ): Promise<ListItemResponseDto> {
    const list = await this.listRepo.findOne({
      where: { id: listId, userId },
    });

    if (!list) {
      throw new NotFoundException('List not found');
    }

    const existing = await this.itemRepo.findOne({
      where: { listId: list.id, mediaType: dto.mediaType, tmdbId: dto.tmdbId },
    });

    if (existing) {
      return this.toListItemResponse(existing);
    }

    const snapshot = await this.tmdbService.getMedia(dto.mediaType, dto.tmdbId);

    if (!snapshot.title) {
      throw new BadRequestException('Media not found or has no title');
    }

    const item = this.itemRepo.create({
      listId: list.id,
      userId,
      mediaType: dto.mediaType,
      tmdbId: dto.tmdbId,
      title: snapshot.title,
      posterPath: snapshot.posterPath,
      releaseDate: snapshot.releaseDate,
      voteAverage: snapshot.voteAverage,
    });

    const saved = await this.itemRepo.save(item);
    return this.toListItemResponse(saved);
  }

  // ─── 3.6 removeItem ─────────────────────────────────────────────

  async removeItem(
    userId: number,
    listId: string,
    mediaType: MediaType,
    tmdbId: number,
  ): Promise<void> {
    const list = await this.listRepo.findOne({
      where: { id: listId, userId },
    });

    if (!list) {
      throw new NotFoundException('List not found');
    }

    const result = await this.itemRepo.delete({
      listId: list.id,
      mediaType,
      tmdbId,
    });

    if (result.affected === 0) {
      throw new NotFoundException('Item not found in list');
    }
  }

  // ─── 3.7 update ─────────────────────────────────────────────────

  async update(
    userId: number,
    listId: string,
    dto: UpdateListDto,
  ): Promise<ListResponseDto> {
    const list = await this.listRepo.findOne({
      where: { id: listId, userId },
    });

    if (!list) {
      throw new NotFoundException('List not found');
    }

    if (list.isSystem) {
      throw new ForbiddenException('Cannot modify system lists');
    }

    if (dto.name !== undefined) {
      list.name = dto.name;
    }

    if (dto.slug !== undefined) {
      if (ListsService.RESERVED_SLUGS.includes(dto.slug)) {
        throw new ConflictException('This slug is reserved for system lists');
      }

      if (dto.slug !== list.slug) {
        try {
          list.slug = dto.slug;
          await this.listRepo.save(list);
        } catch (err) {
          if (ListsService.isUniqueViolation(err)) {
            throw new ConflictException('A list with this slug already exists');
          }
          throw err;
        }
        const totalItems = await this.itemRepo.count({
          where: { listId: list.id },
        });
        return this.toListResponse(list, totalItems);
      }
    }

    const saved = await this.listRepo.save(list);

    const totalItems = await this.itemRepo.count({
      where: { listId: list.id },
    });
    return this.toListResponse(saved, totalItems);
  }

  // ─── 3.8 remove ─────────────────────────────────────────────────

  async remove(userId: number, listId: string): Promise<void> {
    const list = await this.listRepo.findOne({
      where: { id: listId, userId },
    });

    if (!list) {
      throw new NotFoundException('List not found');
    }

    if (list.isSystem) {
      throw new ForbiddenException('Cannot delete system lists');
    }

    await this.listRepo.manager.transaction(async (manager) => {
      await manager.delete(UserListItem, { listId: list.id });
      await manager.remove(list);
    });
  }

  // ─── Helpers ────────────────────────────────────────────────────

  private static isUniqueViolation(err: unknown): boolean {
    if (err && typeof err === 'object' && 'code' in err) {
      return (err as { code: string }).code === '23505';
    }
    return false;
  }

  // ─── Mappers ────────────────────────────────────────────────────

  private toListResponse(list: UserList, itemCount: number): ListResponseDto {
    return {
      id: list.id,
      name: list.name,
      slug: list.slug,
      listKey: list.listKey,
      isSystem: list.isSystem,
      itemCount,
      createdAt: list.createdAt,
      updatedAt: list.updatedAt,
    };
  }

  private toListItemResponse(item: UserListItem): ListItemResponseDto {
    return {
      id: item.id,
      mediaType: item.mediaType,
      tmdbId: item.tmdbId,
      title: item.title,
      posterPath: item.posterPath,
      releaseDate: item.releaseDate,
      voteAverage: item.voteAverage,
      addedAt: item.addedAt,
    };
  }
}
