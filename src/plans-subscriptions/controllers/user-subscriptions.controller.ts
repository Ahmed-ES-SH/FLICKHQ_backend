import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { GetUser } from '../../auth/decorators/current-user.decorator';
import { UserBillingHistoryService } from '../services/user-billing-history.service';
import { SubscriptionHistoryService } from '../services/subscription-history.service';
import { PaginationQueryDto } from '../dto/pagination-query.dto';
import { UserSubscriptionHistoryItemDto } from '../dto/user-subscription-history.dto';
import { SubscriptionHistoryResponseDto } from '../dto/subscription-history-response.dto';

@ApiTags('Plans & Subscriptions - User')
@ApiBearerAuth()
@Controller('subscriptions')
export class UserSubscriptionsController {
  constructor(
    private readonly userBillingHistory: UserBillingHistoryService,
    private readonly subscriptionHistory: SubscriptionHistoryService,
  ) {}

  @Get('current')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get current active subscription for the user.' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Current subscription or null.',
    type: UserSubscriptionHistoryItemDto,
  })
  async getCurrentSubscription(
    @GetUser('id') userId: number,
  ): Promise<UserSubscriptionHistoryItemDto | null> {
    return this.userBillingHistory.getCurrentSubscription(userId);
  }

  @Get('history')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get paginated subscription history for the user.' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Paginated subscription history.',
  })
  async getSubscriptionHistory(
    @GetUser('id') userId: number,
    @Query() pagination: PaginationQueryDto,
  ): Promise<{
    items: UserSubscriptionHistoryItemDto[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    return this.userBillingHistory.getUserSubscriptionHistory(
      userId,
      pagination,
    );
  }

  @Get('history/:subscriptionId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get detailed timeline for one subscription.' })
  @ApiParam({ name: 'subscriptionId', type: String, format: 'uuid' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Status change timeline.',
    type: [SubscriptionHistoryResponseDto],
  })
  async getSubscriptionTimeline(
    @Param('subscriptionId', ParseUUIDPipe) subscriptionId: string,
  ): Promise<SubscriptionHistoryResponseDto[]> {
    return this.subscriptionHistory.getHistoryForSubscription(subscriptionId);
  }
}
