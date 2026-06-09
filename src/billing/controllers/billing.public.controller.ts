/**
 * Public billing controller.
 *
 * Exposes pricing/plan data to unauthenticated callers. The
 * pricing page typically renders this data on the marketing site.
 *
 * Phase 3 implements:
 *
 * - `GET /api/billing/plans/public` — active plans + active prices
 *   (optionally filtered by currency)
 *
 * No authentication is required for this route. The endpoint is
 * marked `@Public()` so the global `AuthGuard` skips it.
 */

import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Public } from '../../auth/decorators/public.decorator';
import { BillingCatalogService } from '../services/billing-catalog.service';
import {
  BillingPublicPlanResponseDto,
  ListBillingPublicPlansQueryDto,
} from '../dto/billing-plan.dto';

@ApiTags('Billing - Public')
@Controller('billing')
export class BillingPublicController {
  constructor(private readonly catalog: BillingCatalogService) {}

  @Public()
  @Get('plans/public')
  @ApiOperation({
    summary: 'List active plans and active prices for the public pricing page.',
  })
  @ApiResponse({
    status: 200,
    description: 'Active plans with their active prices.',
    type: [BillingPublicPlanResponseDto],
  })
  async listPublicPlans(
    @Query() query: ListBillingPublicPlansQueryDto,
  ): Promise<BillingPublicPlanResponseDto[]> {
    return this.catalog.listPublicPlans(query);
  }
}
