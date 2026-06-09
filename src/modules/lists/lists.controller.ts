import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Request,
  ParseUUIDPipe,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { CreateListDto } from './dto/create-list.dto.js';
import { UpdateListDto } from './dto/update-list.dto.js';
import { AddItemDto } from './dto/add-item.dto.js';
import { FilterListsDto } from './dto/filter-lists.dto.js';
import { FilterListItemsDto } from './dto/filter-list-items.dto.js';
import { MediaType } from './enums/media-type.enum.js';
import { ListsService } from './lists.service.js';
import type { RequestWithUser } from '../../auth/types/request.interface.js';

@ApiTags('User Lists')
@ApiBearerAuth()
@Controller('lists')
export class ListsController {
  constructor(private readonly listsService: ListsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new custom list' })
  @ApiResponse({ status: 201, description: 'List created successfully' })
  @ApiResponse({ status: 409, description: 'List name/slug already exists' })
  create(@Request() req: RequestWithUser, @Body() dto: CreateListDto) {
    return this.listsService.create(req.user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all lists for the current user' })
  @ApiResponse({ status: 200, description: 'Paginated lists' })
  findAll(@Request() req: RequestWithUser, @Query() filters: FilterListsDto) {
    return this.listsService.findAllForUser(req.user.id, filters);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single list with its items' })
  @ApiParam({ name: 'id', description: 'List UUID' })
  @ApiResponse({ status: 200, description: 'List with paginated items' })
  @ApiResponse({ status: 404, description: 'List not found' })
  findOne(
    @Request() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() filters: FilterListItemsDto,
  ) {
    return this.listsService.findOneForUser(req.user.id, id, filters);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename a custom list' })
  @ApiParam({ name: 'id', description: 'List UUID' })
  @ApiResponse({ status: 200, description: 'List updated successfully' })
  @ApiResponse({ status: 403, description: 'Cannot modify system lists' })
  @ApiResponse({ status: 404, description: 'List not found' })
  update(
    @Request() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateListDto,
  ) {
    return this.listsService.update(req.user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a custom list' })
  @ApiParam({ name: 'id', description: 'List UUID' })
  @ApiResponse({ status: 200, description: 'List deleted' })
  @ApiResponse({ status: 403, description: 'Cannot delete system lists' })
  @ApiResponse({ status: 404, description: 'List not found' })
  remove(
    @Request() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.listsService.remove(req.user.id, id);
  }

  @Post(':id/items')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add an item to a list' })
  @ApiParam({ name: 'id', description: 'List UUID' })
  @ApiResponse({ status: 201, description: 'Item added successfully' })
  @ApiResponse({ status: 404, description: 'List not found' })
  @ApiResponse({ status: 409, description: 'Item already in list' })
  addItem(
    @Request() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddItemDto,
  ) {
    return this.listsService.addItem(req.user.id, id, dto);
  }

  @Delete(':id/items/:mediaType/:tmdbId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove an item from a list' })
  @ApiParam({ name: 'id', description: 'List UUID' })
  @ApiParam({ name: 'mediaType', enum: MediaType, description: 'Media type' })
  @ApiParam({ name: 'tmdbId', description: 'TMDB ID' })
  @ApiResponse({ status: 200, description: 'Item removed' })
  @ApiResponse({ status: 404, description: 'Item not found in list' })
  removeItem(
    @Request() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('mediaType') mediaType: MediaType,
    @Param('tmdbId', ParseIntPipe) tmdbId: number,
  ) {
    return this.listsService.removeItem(req.user.id, id, mediaType, tmdbId);
  }
}
