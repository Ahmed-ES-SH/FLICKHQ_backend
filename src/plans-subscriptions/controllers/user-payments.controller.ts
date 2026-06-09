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
import { PaginationQueryDto } from '../dto/pagination-query.dto';
import { UserPaymentHistoryItemDto } from '../dto/user-payment-history.dto';

@ApiTags('Plans & Subscriptions - User')
@ApiBearerAuth()
@Controller('payments')
export class UserPaymentsController {
  constructor(private readonly userBillingHistory: UserBillingHistoryService) {}

  @Get('history')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get paginated payment history for the user.' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Paginated payment history.',
  })
  async getPaymentHistory(
    @GetUser('id') userId: number,
    @Query() pagination: PaginationQueryDto,
  ): Promise<{
    items: UserPaymentHistoryItemDto[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    return this.userBillingHistory.getUserPaymentHistory(userId, pagination);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get payment detail with transaction timeline.' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Payment detail.',
    type: UserPaymentHistoryItemDto,
  })
  async getPaymentDetail(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') userId: number,
  ): Promise<UserPaymentHistoryItemDto | null> {
    return this.userBillingHistory.getPaymentDetail(id, userId);
  }
}
