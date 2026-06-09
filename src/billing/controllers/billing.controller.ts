/**
 * Authenticated user billing controller.
 *
 * Phase 3 implements:
 *
 * - `GET  /api/billing/customer`        — return the current user's
 *   local customer row (creating it lazily if absent).
 * - `POST /api/billing/customer/sync`   — same as GET, but always
 *   resolves through Stripe (used by support / "force re-link").
 * - `POST /api/billing/portal/session`  — create a Customer Portal
 *   session and return the URL. (Phase 4: now idempotent.)
 *
 * Phase 4 adds:
 *
 * - `POST /api/billing/checkout/one-time`      — server-resolved
 *   one-time Stripe Checkout Session.
 * - `POST /api/billing/checkout/subscription`  — server-resolved
 *   subscription Stripe Checkout Session.
 *
 * Phase 6 adds:
 *
 * - `GET  /api/billing/entitlements`   — list the active
 *   `BillingEntitlement` rows for the current user. Application
 *   modules are encouraged to call `BillingEntitlementsService`
 *   or use `FeatureAccessGuard` + `@RequiresFeature` instead of
 *   calling this endpoint internally.
 *
 * All routes use the global `AuthGuard` (no `@Public()`).
 * `payment_method_types` is intentionally never sent to Stripe —
 * dynamic payment methods are the default in API
 * 2026-05-27.dahlia.
 */

import {
  Body,
  ClassSerializerInterceptor,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { GetUser } from '../../auth/decorators/current-user.decorator';
import { BillingCustomerService } from '../services/billing-customer.service';
import { BillingPortalService } from '../services/billing-portal.service';
import { BillingCheckoutService } from '../services/billing-checkout.service';
import { BillingEntitlementsService } from '../services/billing-entitlements.service';
import { BillingCustomerResponseDto } from '../dto/billing-customer.dto';
import { BillingPortalSessionResponseDto } from '../dto/billing-portal.dto';
import { BillingEntitlementResponseDto } from '../dto/billing-entitlement.dto';
import {
  BillingCheckoutSessionResponseDto,
  BillingOneTimeCheckoutRequestDto,
  BillingSubscriptionCheckoutRequestDto,
} from '../dto/billing-checkout.dto';
import {
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKey,
} from '../common/idempotency-key.decorator';

interface AuthenticatedUserShape {
  id: number;
  email: string;
  role: string;
}

@ApiTags('Billing - Customer')
@ApiBearerAuth()
@UseInterceptors(ClassSerializerInterceptor)
@Controller('billing')
export class BillingController {
  constructor(
    private readonly customerService: BillingCustomerService,
    private readonly portalService: BillingPortalService,
    private readonly checkoutService: BillingCheckoutService,
    private readonly entitlementsService: BillingEntitlementsService,
  ) {}

  @Get('customer')
  @ApiOperation({
    summary: 'Get (or lazily create) the current user’s billing customer.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Local billing customer row.',
    type: BillingCustomerResponseDto,
  })
  async getCustomer(
    @GetUser() user: AuthenticatedUserShape,
  ): Promise<BillingCustomerResponseDto> {
    const customer = await this.customerService.getOrCreateForUser(user.id);
    return this.toCustomerDto(customer);
  }

  @Post('customer/sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Re-sync the local billing customer with Stripe. Creates a Stripe customer if one does not exist yet.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Local billing customer row after sync.',
    type: BillingCustomerResponseDto,
  })
  async syncCustomer(
    @GetUser() user: AuthenticatedUserShape,
  ): Promise<BillingCustomerResponseDto> {
    const { customer } = await this.customerService.syncForUser(user.id);
    return this.toCustomerDto(customer);
  }

  @Post('portal/session')
  @HttpCode(HttpStatus.OK)
  @ApiHeader({
    name: IDEMPOTENCY_KEY_HEADER,
    required: true,
    description:
      'Caller-supplied idempotency key. The same key + same body returns the cached session URL; a different body with the same key returns 409.',
  })
  @ApiOperation({
    summary:
      'Create a Stripe Customer Portal session and return its URL. The URL is short-lived and should be redirected to immediately.',
  })
  @ApiOkResponse({
    description: 'Portal session URL.',
    type: BillingPortalSessionResponseDto,
  })
  async createPortalSession(
    @GetUser() user: AuthenticatedUserShape,
    @IdempotencyKey() idempotencyKey: string,
  ): Promise<BillingPortalSessionResponseDto> {
    const { url } = await this.portalService.createSessionForUser(
      user.id,
      idempotencyKey,
    );
    return { url };
  }

  @Post('checkout/one-time')
  @HttpCode(HttpStatus.OK)
  @ApiHeader({
    name: IDEMPOTENCY_KEY_HEADER,
    required: true,
    description:
      'Caller-supplied idempotency key. The same key + same body returns the cached checkout session; a different body with the same key returns 409.',
  })
  @ApiOperation({
    summary:
      'Create a one-time Stripe Checkout Session for a local BillingPrice.',
  })
  @ApiOkResponse({
    description: 'Stripe Checkout Session id and URL.',
    type: BillingCheckoutSessionResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Billing price not found.',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description:
      'Price is not active, has the wrong type, or the user already has an active subscription.',
  })
  async createOneTimeCheckout(
    @GetUser() user: AuthenticatedUserShape,
    @IdempotencyKey() idempotencyKey: string,
    @Body() dto: BillingOneTimeCheckoutRequestDto,
  ): Promise<BillingCheckoutSessionResponseDto> {
    const result = await this.checkoutService.createOneTimeCheckout({
      userId: user.id,
      priceId: dto.priceId,
      quantity: dto.quantity ?? 1,
      allowPromotionCodes: dto.allowPromotionCodes ?? true,
      idempotencyKey,
    });
    return result;
  }

  @Post('checkout/subscription')
  @HttpCode(HttpStatus.OK)
  @ApiHeader({
    name: IDEMPOTENCY_KEY_HEADER,
    required: true,
    description:
      'Caller-supplied idempotency key. The same key + same body returns the cached checkout session; a different body with the same key returns 409.',
  })
  @ApiOperation({
    summary:
      'Create a subscription Stripe Checkout Session for a local recurring BillingPrice.',
  })
  @ApiOkResponse({
    description: 'Stripe Checkout Session id and URL.',
    type: BillingCheckoutSessionResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Billing price or plan not found.',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description:
      'Price is not active, has the wrong type, the plan is archived, or the user already has an active subscription.',
  })
  async createSubscriptionCheckout(
    @GetUser() user: AuthenticatedUserShape,
    @IdempotencyKey() idempotencyKey: string,
    @Body() dto: BillingSubscriptionCheckoutRequestDto,
  ): Promise<BillingCheckoutSessionResponseDto> {
    const result = await this.checkoutService.createSubscriptionCheckout({
      userId: user.id,
      priceId: dto.priceId,
      quantity: dto.quantity ?? 1,
      clientReferenceId: dto.clientReferenceId ?? null,
      trialDays: dto.trialDays ?? null,
      allowPromotionCodes: dto.allowPromotionCodes ?? true,
      uiMode: dto.uiMode,
      idempotencyKey,
    });
    return result;
  }

  @Get('entitlements')
  @ApiOperation({
    summary:
      'List the active billing entitlements (feature keys) for the current user.',
  })
  @ApiOkResponse({
    description: 'Active entitlements for the current user.',
    type: [BillingEntitlementResponseDto],
  })
  async listEntitlements(
    @GetUser() user: AuthenticatedUserShape,
  ): Promise<BillingEntitlementResponseDto[]> {
    const rows = await this.entitlementsService.getUserEntitlements(user.id);
    return rows.map((row) => ({
      featureKey: row.featureKey,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
    }));
  }

  private toCustomerDto(
    customer: Awaited<ReturnType<BillingCustomerService['getOrCreateForUser']>>,
  ): BillingCustomerResponseDto {
    return {
      id: customer.id,
      userId: customer.userId,
      stripeCustomerId: customer.stripeCustomerId,
      email: customer.email,
      name: customer.name,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
    };
  }
}
