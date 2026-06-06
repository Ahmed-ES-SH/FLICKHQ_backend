/**
 * Admin billing controller.
 *
 * Write paths for plan + price catalog management. All routes are
 * admin-only and require the `ADMIN` role.
 *
 * Phase 3 implements:
 *
 * - `POST  /api/billing/admin/plans`
 * - `GET   /api/billing/admin/plans`
 * - `PATCH /api/billing/admin/plans/:id`
 * - `POST  /api/billing/admin/plans/:id/archive`
 * - `POST  /api/billing/admin/plans/:id/prices`
 *
 * Phase 7 adds:
 *
 * - `GET   /api/billing/admin/overview` — operational snapshot
 * - `GET   /api/billing/admin/webhooks/failed` — failed webhook listing
 * - `POST  /api/billing/admin/webhooks/:id/replay` — replay failed event
 * - `POST  /api/billing/admin/payments/:id/refund` — admin refund
 *
 * The admin paths are namespaced under `/admin/...` to match the
 * project convention (see `categories.controller.ts`).
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { AuthGuard } from '../../auth/guards/auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/Roles.decorator';
import { UserRoleEnum } from '../../auth/types/UserRoleEnum';

import { BillingCatalogService } from '../services/billing-catalog.service';
import { BillingAdminService } from '../services/billing-admin.service';
import {
  AddBillingPriceDto,
  BillingPlanMutationResultDto,
  BillingPlanResponseDto,
  CreateBillingPlanDto,
  ListBillingPlansQueryDto,
  UpdateBillingPlanDto,
} from '../dto/billing-plan.dto';
import {
  BillingAdminOverviewResponseDto,
  BillingAdminListFailedWebhooksResponseDto,
  BillingAdminRefundRequestDto,
  BillingAdminRefundResponseDto,
} from '../dto/billing-admin.dto';
import { BillingAdminWebhookReplayResponseDto } from '../dto/billing-webhook.dto';
import {
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKey,
} from '../common/idempotency-key.decorator';

@ApiTags('Billing - Admin')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRoleEnum.ADMIN)
@Controller('billing/admin')
export class BillingAdminController {
  constructor(
    private readonly catalog: BillingCatalogService,
    private readonly admin: BillingAdminService,
  ) {}

  // ─────────────────────────────────────────────
  // Phase 3 — Plan management
  // ─────────────────────────────────────────────

  @Post('plans')
  @ApiOperation({ summary: 'Create a billing plan (admin).' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Plan created successfully.',
    type: BillingPlanMutationResultDto,
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'A plan with the same code already exists.',
  })
  async createPlan(
    @Body() dto: CreateBillingPlanDto,
  ): Promise<BillingPlanMutationResultDto> {
    const plan = await this.catalog.createPlan(dto);
    const detail = await this.catalog.getPlanWithPrices(plan.id);
    return { plan: this.toResponse(detail.plan, detail.prices) };
  }

  @Get('plans')
  @ApiOperation({ summary: 'List all billing plans (admin).' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'All plans matching the filter.',
    type: [BillingPlanResponseDto],
  })
  async listPlans(
    @Query() query: ListBillingPlansQueryDto,
  ): Promise<BillingPlanResponseDto[]> {
    return this.catalog.listAllPlans(query.status);
  }

  @Patch('plans/:id')
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOperation({ summary: 'Update a billing plan (admin).' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Plan updated successfully.',
    type: BillingPlanMutationResultDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Plan not found.',
  })
  async updatePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBillingPlanDto,
  ): Promise<BillingPlanMutationResultDto> {
    const plan = await this.catalog.updatePlan(id, dto);
    const detail = await this.catalog.getPlanWithPrices(plan.id);
    return { plan: this.toResponse(detail.plan, detail.prices) };
  }

  @Post('plans/:id/archive')
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOperation({ summary: 'Archive a billing plan (admin).' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Plan archived successfully.',
    type: BillingPlanMutationResultDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Plan not found.',
  })
  async archivePlan(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BillingPlanMutationResultDto> {
    const plan = await this.catalog.archivePlan(id);
    const detail = await this.catalog.getPlanWithPrices(plan.id);
    return { plan: this.toResponse(detail.plan, detail.prices) };
  }

  @Post('plans/:id/prices')
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOperation({ summary: 'Add a Stripe price to a billing plan (admin).' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Price added successfully.',
    type: BillingPlanMutationResultDto,
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description:
      'A price with the same Stripe id already exists, or the input shape is invalid.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Plan not found.',
  })
  async addPrice(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddBillingPriceDto,
  ): Promise<BillingPlanMutationResultDto> {
    await this.catalog.addPrice(id, dto);
    const detail = await this.catalog.getPlanWithPrices(id);
    return { plan: this.toResponse(detail.plan, detail.prices) };
  }

  // ─────────────────────────────────────────────
  // Phase 7 — Operational overview
  // ─────────────────────────────────────────────

  @Get('overview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Return an operational snapshot of the billing system.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Billing system overview.',
    type: BillingAdminOverviewResponseDto,
  })
  async getOverview(): Promise<BillingAdminOverviewResponseDto> {
    return this.admin.getOverview();
  }

  // ─────────────────────────────────────────────
  // Phase 7 — Failed webhooks
  // ─────────────────────────────────────────────

  @Get('webhooks/failed')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List failed webhook events for troubleshooting.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Failed webhook events.',
    type: BillingAdminListFailedWebhooksResponseDto,
  })
  async listFailedWebhooks(): Promise<BillingAdminListFailedWebhooksResponseDto> {
    return this.admin.listFailedWebhooks();
  }

  @Post('webhooks/:id/replay')
  @HttpCode(HttpStatus.OK)
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
    description: 'Local billing_webhook_events.id to replay.',
  })
  @ApiOperation({
    summary: 'Re-dispatch a previously-failed webhook event.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Replay result.',
    type: BillingAdminWebhookReplayResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Webhook event not found.',
  })
  async replayWebhook(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BillingAdminWebhookReplayResponseDto> {
    const result = await this.admin.replayWebhook(id);
    if (!result) {
      // The service returns null for not-found.
      return {
        result: {
          kind: 'failed',
          stripeEventId: 'unknown',
          eventType: 'unknown',
          reason: `Webhook event ${id} not found.`,
        },
      };
    }
    return {
      result: {
        kind: result.kind,
        stripeEventId: result.stripeEventId,
        eventType: result.eventType,
        reason:
          'reason' in result
            ? result.reason
            : 'errorMessage' in result
              ? result.errorMessage
              : null,
      },
    };
  }

  // ─────────────────────────────────────────────
  // Phase 7 — Refund
  // ─────────────────────────────────────────────

  @Post('payments/:id/refund')
  @HttpCode(HttpStatus.OK)
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
    description: 'Local BillingPayment id to refund.',
  })
  @ApiHeader({
    name: IDEMPOTENCY_KEY_HEADER,
    required: true,
    description:
      'Caller-supplied idempotency key. Prevents duplicate Stripe refunds on retry.',
  })
  @ApiBody({ type: BillingAdminRefundRequestDto })
  @ApiOperation({
    summary:
      'Issue a refund for a local payment. Calls Stripe and records a BillingTransaction.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Refund processed successfully.',
    type: BillingAdminRefundResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Payment not found.',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description:
      'Payment is not refundable, already fully refunded, or has no Stripe PaymentIntent.',
  })
  async refundPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @IdempotencyKey() idempotencyKey: string,
    @Body() dto: BillingAdminRefundRequestDto,
  ): Promise<BillingAdminRefundResponseDto> {
    return this.admin.refundPayment(id, idempotencyKey, dto.amount);
  }

  private toResponse(
    plan: Awaited<
      ReturnType<BillingCatalogService['getPlanWithPrices']>
    >['plan'],
    prices: Awaited<
      ReturnType<BillingCatalogService['getPlanWithPrices']>
    >['prices'],
  ): BillingPlanResponseDto {
    return {
      id: plan.id,
      code: plan.code,
      name: plan.name,
      description: plan.description,
      status: plan.status,
      features: plan.features,
      prices: prices.map((price) => ({
        id: price.id,
        planId: price.planId,
        stripePriceId: price.stripePriceId,
        stripeProductId: price.stripeProductId,
        currency: price.currency,
        unitAmount: price.unitAmount,
        type: price.type,
        interval: price.interval,
        trialPeriodDays: price.trialPeriodDays,
        active: price.active,
        createdAt: price.createdAt,
        updatedAt: price.updatedAt,
      })),
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
    };
  }
}
