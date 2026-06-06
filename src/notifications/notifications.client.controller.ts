import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Query,
  Request,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { PaginationQueryDto } from './dto/paginate-notifications.dto';
import { CursorPaginationDto } from './dto/cursor-pagination.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsClientController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'Get notifications for the current user (cursor-based pagination)',
    description:
      'Use cursor param for infinite scroll. Omit cursor for first page.',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns paginated notifications with cursor',
  })
  async findAll(
    @Request() req: { user: { id: string } },
    @Query() cursorPagination: CursorPaginationDto,
  ) {
    return this.notificationsService.findAllForUserCursor(
      req.user.id,
      cursorPagination,
    );
  }

  /**
   * @deprecated Use cursor-based /notifications endpoint instead
   */
  @Get('paginated')
  @ApiOperation({
    summary: 'Get paginated notifications (offset-based - deprecated)',
    description:
      'This endpoint is deprecated. Use /notifications with cursor param instead.',
  })
  @ApiResponse({ status: 200, description: 'Returns paginated notifications' })
  async findAllLegacy(
    @Request() req: { user: { id: string } },
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.notificationsService.findAllForUser(req.user.id, pagination);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get unread notification count' })
  @ApiResponse({ status: 200, description: 'Returns unread count' })
  async getUnreadCount(@Request() req: { user: { id: string } }) {
    const count = await this.notificationsService.countUnread(req.user.id);
    return { unreadCount: count };
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a notification as read' })
  @ApiResponse({ status: 200, description: 'Notification marked as read' })
  async markAsRead(
    @Request() req: { user: { id: string } },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notificationsService.markAsRead(id, req.user.id);
  }

  @Patch('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark all notifications as read' })
  @ApiResponse({ status: 200, description: 'All notifications marked as read' })
  async markAllAsRead(@Request() req: { user: { id: string } }) {
    await this.notificationsService.markAllAsRead(req.user.id);
    return { success: true };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft delete a notification' })
  @ApiResponse({ status: 204, description: 'Notification deleted' })
  async softDelete(
    @Request() req: { user: { id: string } },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.notificationsService.softDelete(id, req.user.id);
  }

  @Get('preferences')
  @ApiOperation({ summary: 'Get notification preferences' })
  @ApiResponse({ status: 200, description: 'Returns notification preferences' })
  async getPreferences(@Request() req: { user: { id: string } }) {
    return this.notificationsService.getPreferences(req.user.id);
  }

  @Patch('preferences')
  @ApiOperation({ summary: 'Update notification preferences' })
  @ApiResponse({ status: 200, description: 'Preferences updated' })
  async updatePreferences(
    @Request() req: { user: { id: string } },
    @Query() updates: UpdatePreferencesDto,
  ) {
    return this.notificationsService.updatePreferences(req.user.id, updates);
  }
}
