import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { ListsService } from '../lists.service';
import { UserList } from '../schema/user-list.entity';
import { UserListItem } from '../schema/user-list-item.entity';
import { TmdbService } from '../tmdb/tmdb.service';
import { MediaType } from '../enums/media-type.enum';
import { SystemListKey } from '../enums/list-key.enum';
import { CreateListDto } from '../dto/create-list.dto';
import { UpdateListDto } from '../dto/update-list.dto';
import { AddItemDto } from '../dto/add-item.dto';
import { FilterListsDto } from '../dto/filter-lists.dto';
import { FilterListItemsDto } from '../dto/filter-list-items.dto';
import { TmdbSnapshot } from '../tmdb/tmdb.types';

describe('ListsService', () => {
  let service: ListsService;
  let listRepo: jest.Mocked<Repository<UserList>>;
  let itemRepo: jest.Mocked<Repository<UserListItem>>;
  let tmdbService: jest.Mocked<TmdbService>;

  const mockUserId = 1;
  const mockListId = 'list-uuid-001';
  const mockCustomListId = 'list-uuid-002';
  const mockItemId = 'item-uuid-001';

  const mockSystemList: UserList = {
    id: mockListId,
    userId: mockUserId,
    name: 'Favorites',
    slug: 'favorites',
    listKey: SystemListKey.FAVORITES,
    isSystem: true,
    items: [],
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  const mockCustomList: UserList = {
    id: 'list-uuid-002',
    userId: mockUserId,
    name: 'My Movies',
    slug: 'my-movies',
    listKey: 'custom:abc-123',
    isSystem: false,
    items: [],
    createdAt: new Date('2024-01-02'),
    updatedAt: new Date('2024-01-02'),
  };

  const mockListItem: UserListItem = {
    id: mockItemId,
    listId: mockListId,
    userId: mockUserId,
    mediaType: MediaType.MOVIE,
    tmdbId: 550,
    title: 'Fight Club',
    posterPath: '/poster.jpg',
    releaseDate: '1999-10-15',
    voteAverage: 8.4,
    addedAt: new Date('2024-01-01'),
    list: undefined as unknown as UserList,
  };

  const mockTmdbSnapshot: TmdbSnapshot = {
    title: 'Fight Club',
    posterPath: '/poster.jpg',
    releaseDate: '1999-10-15',
    voteAverage: 8.4,
  };

  const mockQueryBuilder = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue([]),
  };

  beforeEach(async () => {
    const mockManager = {
      transaction: jest
        .fn()
        .mockImplementation(
          (cb: (m: { delete: jest.Mock; remove: jest.Mock }) => unknown) => {
            return cb({
              delete: jest.fn().mockResolvedValue({ affected: 3 }),
              remove: jest.fn().mockResolvedValue(mockCustomList),
            });
          },
        ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ListsService,
        {
          provide: getRepositoryToken(UserList),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
            findBy: jest.fn().mockResolvedValue([]),
            remove: jest.fn(),
            manager: mockManager,
            createQueryBuilder: jest.fn(() => ({
              ...mockQueryBuilder,
              select: jest.fn().mockReturnThis(),
              addSelect: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              groupBy: jest.fn().mockReturnThis(),
              getRawMany: jest.fn().mockResolvedValue([]),
            })),
          },
        },
        {
          provide: getRepositoryToken(UserListItem),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
            delete: jest.fn(),
            count: jest.fn(),
            findAndCount: jest.fn(),
            createQueryBuilder: jest.fn(() => ({
              select: jest.fn().mockReturnThis(),
              addSelect: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              groupBy: jest.fn().mockReturnThis(),
              getRawMany: jest.fn().mockResolvedValue([]),
            })),
          },
        },
        {
          provide: TmdbService,
          useValue: {
            getMedia: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ListsService>(ListsService);
    listRepo = module.get(getRepositoryToken(UserList));
    itemRepo = module.get(getRepositoryToken(UserListItem));
    tmdbService = module.get(TmdbService);

    jest.clearAllMocks();
  });

  // ─── 3.1 ensureSystemLists ──────────────────────────────────────

  describe('ensureSystemLists', () => {
    it('should create 3 system lists for a new user', async () => {
      listRepo.findBy.mockResolvedValue([]);
      listRepo.create.mockImplementation((dto) => dto as any);
      (listRepo.save as jest.Mock).mockImplementation(async (entity) =>
        Array.isArray(entity)
          ? entity.map((e: any, i: number) => ({ ...e, id: `id-${i}` }))
          : { ...entity, id: mockListId },
      );

      const result = await service.ensureSystemLists(mockUserId);

      expect(result).toHaveLength(3);
      expect(listRepo.findBy).toHaveBeenCalledTimes(1);
      expect(listRepo.save).toHaveBeenCalledTimes(1);
      expect(listRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Favorites', isSystem: true }),
      );
      expect(listRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Watchlist', isSystem: true }),
      );
      expect(listRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Watched', isSystem: true }),
      );
    });

    it('should return existing system lists without creating duplicates', async () => {
      listRepo.findBy.mockResolvedValue([
        { ...mockSystemList, listKey: SystemListKey.FAVORITES },
        { ...mockSystemList, listKey: SystemListKey.WATCHLIST, id: 'id-2' },
        { ...mockSystemList, listKey: SystemListKey.WATCHED, id: 'id-3' },
      ]);

      const result = await service.ensureSystemLists(mockUserId);

      expect(result).toHaveLength(3);
      expect(listRepo.save).not.toHaveBeenCalled();
    });

    it('should create missing system lists and return existing ones', async () => {
      listRepo.findBy.mockResolvedValue([
        { ...mockSystemList, listKey: SystemListKey.FAVORITES },
      ]);
      listRepo.create.mockImplementation((dto) => dto as any);
      (listRepo.save as jest.Mock).mockImplementation(async (entity) =>
        Array.isArray(entity)
          ? entity.map((e: any, i: number) => ({ ...e, id: `id-${i}` }))
          : { ...entity, id: mockListId },
      );

      const result = await service.ensureSystemLists(mockUserId);

      expect(result).toHaveLength(3);
      expect(listRepo.save).toHaveBeenCalledTimes(1);
    });
  });

  // ─── 3.2 create ─────────────────────────────────────────────────

  describe('create', () => {
    it('should create a custom list with auto-generated slug', async () => {
      listRepo.create.mockImplementation((dto) => dto as any);
      listRepo.save.mockImplementation(
        async (entity) =>
          ({
            ...entity,
            id: mockListId,
          }) as any,
      );

      const dto: CreateListDto = { name: 'My Movies' };
      const result = await service.create(mockUserId, dto);

      expect(listRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: mockUserId,
          name: 'My Movies',
          isSystem: false,
          listKey: expect.stringMatching(/^custom:/),
        }),
      );
      expect(result.name).toBe('My Movies');
    });

    it('should create a custom list with provided slug', async () => {
      listRepo.create.mockImplementation((dto) => dto as any);
      listRepo.save.mockImplementation(
        async (entity) =>
          ({
            ...entity,
            id: mockListId,
          }) as any,
      );

      const dto: CreateListDto = { name: 'My Movies', slug: 'custom-slug' };
      const result = await service.create(mockUserId, dto);

      expect(listRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ slug: 'custom-slug' }),
      );
      expect(result.slug).toBe('custom-slug');
    });

    it('should throw ConflictException on reserved slug', async () => {
      const dto: CreateListDto = { name: 'Favorites', slug: 'favorites' };

      await expect(service.create(mockUserId, dto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw ConflictException on DB unique constraint violation', async () => {
      listRepo.create.mockImplementation((dto) => dto as any);
      const dbError = new Error('duplicate key') as any;
      dbError.code = '23505';
      listRepo.save.mockRejectedValue(dbError);

      const dto: CreateListDto = { name: 'My Movies', slug: 'taken-slug' };

      await expect(service.create(mockUserId, dto)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ─── 3.3 findAllForUser ─────────────────────────────────────────

  describe('findAllForUser', () => {
    it('should return paginated lists with item counts', async () => {
      const mockRepo = listRepo as any;
      mockRepo.findAndCount = jest
        .fn()
        .mockResolvedValue([[mockSystemList, mockCustomList], 2]);
      mockRepo.createQueryBuilder = jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest
          .fn()
          .mockResolvedValue([{ listId: mockListId, count: '5' }]),
      }));

      const filters: FilterListsDto = { page: 1, perPage: 20 };
      const result = await service.findAllForUser(mockUserId, filters);

      expect(result.data).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('should return empty list for user with no lists', async () => {
      const mockRepo = listRepo as any;
      mockRepo.findAndCount = jest.fn().mockResolvedValue([[], 0]);

      const filters: FilterListsDto = { page: 1, perPage: 20 };
      const result = await service.findAllForUser(mockUserId, filters);

      expect(result.data).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  // ─── 3.4 findOneForUser ─────────────────────────────────────────

  describe('findOneForUser', () => {
    it('should return list with paginated items', async () => {
      listRepo.findOne.mockResolvedValue(mockSystemList);
      const mockItemRepo = itemRepo as any;
      mockItemRepo.findAndCount = jest
        .fn()
        .mockResolvedValue([[mockListItem], 1]);

      const filters: FilterListItemsDto = { page: 1, perPage: 20 };
      const result = await service.findOneForUser(
        mockUserId,
        mockListId,
        filters,
      );

      expect(result.list.id).toBe(mockListId);
      expect(result.items.data).toHaveLength(1);
    });

    it('should throw NotFoundException if list not found', async () => {
      listRepo.findOne.mockResolvedValue(null);

      const filters: FilterListItemsDto = { page: 1, perPage: 20 };

      await expect(
        service.findOneForUser(mockUserId, 'nonexistent', filters),
      ).rejects.toThrow(NotFoundException);
    });

    it('should filter items by mediaType when provided', async () => {
      listRepo.findOne.mockResolvedValue(mockSystemList);
      const mockItemRepo = itemRepo as any;
      mockItemRepo.findAndCount = jest
        .fn()
        .mockResolvedValue([[mockListItem], 1]);

      const filters: FilterListItemsDto = {
        page: 1,
        perPage: 20,
        mediaType: MediaType.MOVIE,
      };
      const result = await service.findOneForUser(
        mockUserId,
        mockListId,
        filters,
      );

      expect(result.items.data).toHaveLength(1);
    });
  });

  // ─── 3.5 addItem ────────────────────────────────────────────────

  describe('addItem', () => {
    it('should add a new item to a list', async () => {
      listRepo.findOne.mockResolvedValue(mockSystemList);
      itemRepo.findOne.mockResolvedValue(null);
      tmdbService.getMedia.mockResolvedValue(mockTmdbSnapshot);
      itemRepo.create.mockImplementation((dto) => dto as any);
      itemRepo.save.mockImplementation(
        async (entity) =>
          ({
            ...entity,
            id: mockItemId,
            addedAt: new Date(),
          }) as any,
      );

      const dto: AddItemDto = { mediaType: MediaType.MOVIE, tmdbId: 550 };
      const result = await service.addItem(mockUserId, mockListId, dto);

      expect(tmdbService.getMedia).toHaveBeenCalledWith(MediaType.MOVIE, 550);
      expect(itemRepo.save).toHaveBeenCalled();
      expect(result.title).toBe('Fight Club');
    });

    it('should return existing item if already in list (idempotent)', async () => {
      listRepo.findOne.mockResolvedValue(mockSystemList);
      itemRepo.findOne.mockResolvedValue(mockListItem);

      const dto: AddItemDto = { mediaType: MediaType.MOVIE, tmdbId: 550 };
      const result = await service.addItem(mockUserId, mockListId, dto);

      expect(tmdbService.getMedia).not.toHaveBeenCalled();
      expect(result.id).toBe(mockItemId);
    });

    it('should throw NotFoundException if list not found', async () => {
      listRepo.findOne.mockResolvedValue(null);

      const dto: AddItemDto = { mediaType: MediaType.MOVIE, tmdbId: 550 };

      await expect(
        service.addItem(mockUserId, 'nonexistent', dto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if TMDB returns no title', async () => {
      listRepo.findOne.mockResolvedValue(mockSystemList);
      itemRepo.findOne.mockResolvedValue(null);
      tmdbService.getMedia.mockResolvedValue({
        title: '',
        posterPath: null,
        releaseDate: null,
        voteAverage: null,
      });

      const dto: AddItemDto = { mediaType: MediaType.MOVIE, tmdbId: 999 };

      await expect(
        service.addItem(mockUserId, mockListId, dto),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── 3.6 removeItem ─────────────────────────────────────────────

  describe('removeItem', () => {
    it('should remove an item from a list', async () => {
      listRepo.findOne.mockResolvedValue(mockSystemList);
      itemRepo.delete.mockResolvedValue({ affected: 1 } as any);

      await service.removeItem(mockUserId, mockListId, MediaType.MOVIE, 550);

      expect(itemRepo.delete).toHaveBeenCalledWith({
        listId: mockListId,
        mediaType: MediaType.MOVIE,
        tmdbId: 550,
      });
    });

    it('should throw NotFoundException if list not found', async () => {
      listRepo.findOne.mockResolvedValue(null);

      await expect(
        service.removeItem(mockUserId, 'nonexistent', MediaType.MOVIE, 550),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if item not found in list', async () => {
      listRepo.findOne.mockResolvedValue(mockSystemList);
      itemRepo.delete.mockResolvedValue({ affected: 0 } as any);

      await expect(
        service.removeItem(mockUserId, mockListId, MediaType.MOVIE, 999),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── 3.7 update ─────────────────────────────────────────────────

  describe('update', () => {
    it('should rename a custom list', async () => {
      listRepo.findOne.mockResolvedValue(mockCustomList);
      listRepo.save.mockImplementation(
        async (entity) =>
          ({
            ...entity,
            name: 'Renamed List',
          }) as any,
      );
      itemRepo.count.mockResolvedValue(0);

      const dto: UpdateListDto = { name: 'Renamed List' };
      const result = await service.update(mockUserId, mockListId, dto);

      expect(result.name).toBe('Renamed List');
    });

    it('should throw ForbiddenException when updating a system list', async () => {
      listRepo.findOne.mockResolvedValueOnce(mockSystemList);

      const dto: UpdateListDto = { name: 'Hacked' };

      await expect(service.update(mockUserId, mockListId, dto)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw NotFoundException if list not found', async () => {
      listRepo.findOne.mockResolvedValueOnce(null);

      const dto: UpdateListDto = { name: 'Test' };

      await expect(
        service.update(mockUserId, 'nonexistent', dto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException on reserved slug', async () => {
      listRepo.findOne.mockResolvedValue(mockCustomList);

      const dto: UpdateListDto = { slug: 'favorites' };

      await expect(service.update(mockUserId, mockListId, dto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw ConflictException on DB unique constraint violation', async () => {
      listRepo.findOne.mockResolvedValue(mockCustomList);
      const dbError = new Error('duplicate key') as any;
      dbError.code = '23505';
      listRepo.save.mockRejectedValue(dbError);

      const dto: UpdateListDto = { slug: 'taken-slug' };

      await expect(service.update(mockUserId, mockListId, dto)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ─── 3.8 remove ─────────────────────────────────────────────────

  describe('remove', () => {
    it('should delete a custom list and its items in a transaction', async () => {
      listRepo.findOne.mockResolvedValue(mockCustomList);
      const mockManager = {
        delete: jest.fn().mockResolvedValue({ affected: 3 }),
        remove: jest.fn().mockResolvedValue(mockCustomList),
      };
      (listRepo as any).manager = {
        transaction: jest
          .fn()
          .mockImplementation(async (cb: any) => cb(mockManager)),
      };

      await service.remove(mockUserId, mockCustomListId);

      expect(listRepo.manager.transaction).toHaveBeenCalled();
      expect(mockManager.delete).toHaveBeenCalledWith(UserListItem, {
        listId: mockCustomListId,
      });
      expect(mockManager.remove).toHaveBeenCalledWith(mockCustomList);
    });

    it('should throw ForbiddenException when deleting a system list', async () => {
      listRepo.findOne.mockResolvedValue(mockSystemList);

      await expect(service.remove(mockUserId, mockListId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw NotFoundException if list not found', async () => {
      listRepo.findOne.mockResolvedValue(null);

      await expect(service.remove(mockUserId, 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
