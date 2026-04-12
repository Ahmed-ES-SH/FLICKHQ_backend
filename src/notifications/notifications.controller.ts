import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
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
import { CreateNotificationDto } from './dto/create-notification.dto';
import { BroadcastNotificationDto } from './dto/broadcast-notification.dto';
import { Roles } from '../auth/decorators/Roles.decorator';
import { UserRoleEnum } from '../auth/types/UserRoleEnum';
import { RolesGuard } from '../auth/guards/roles.guard';

@ApiTags('Admin - Notifications')
@ApiBearerAuth()
@Controller('admin/notifications')
@UseGuards(RolesGuard)
@Roles(UserRoleEnum.ADMIN)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('send')
  @ApiOperation({ summary: 'Send notification to a specific user' })
  @ApiResponse({ status: 201, description: 'Notification sent' })
  async sendToUser(@Body() dto: CreateNotificationDto) {
    return this.notificationsService.adminSendToUser(dto);
  }

  @Post('broadcast')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Broadcast notification to all or specific users' })
  @ApiResponse({ status: 200, description: 'Broadcast completed' })
  async broadcast(@Body() dto: BroadcastNotificationDto) {
    await this.notificationsService.adminBroadcast(
      dto.title,
      dto.message,
      dto.data,
      dto.targetUserIds,
    );
    return { success: true };
  }

  @Get()
  @ApiOperation({ summary: 'Get all notifications (paginated)' })
  @ApiResponse({ status: 200, description: 'Returns paginated notifications' })
  async findAll(@Query() pagination: PaginationQueryDto) {
    return this.notificationsService.adminFindAll(pagination);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Hard delete a notification' })
  @ApiResponse({ status: 204, description: 'Notification deleted' })
  async hardDelete(@Param('id', ParseUUIDPipe) id: string) {
    await this.notificationsService.adminHardDelete(id);
  }
}
