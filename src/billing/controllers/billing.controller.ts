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
  InternalServerErrorException,
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
import { BillingStripeService } from '../services/billing-stripe.service';
import { BillingCustomerResponseDto } from '../dto/billing-customer.dto';
import { BillingPortalSessionResponseDto } from '../dto/billing-portal.dto';
import { BillingEntitlementResponseDto } from '../dto/billing-entitlement.dto';
import {
  BillingCheckoutSessionResponseDto,
  BillingOneTimeCheckoutRequestDto,
  BillingSubscriptionCheckoutRequestDto,
  CreateSubscriptionFromPaymentDto,
  CreateSubscriptionFromPaymentResponseDto,
  EmbeddedElementsCheckoutResponseDto,
  OneTimeElementsCheckoutResponseDto,
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
    private readonly stripeService: BillingStripeService,
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

  @Post('checkout/embedded-elements')
  @HttpCode(HttpStatus.OK)
  @ApiHeader({
    name: IDEMPOTENCY_KEY_HEADER,
    required: true,
    description:
      'Caller-supplied idempotency key. The same key + same body returns the cached PaymentIntent; a different body with the same key returns 409.',
  })
  @ApiOperation({
    summary:
      'Create a PaymentIntent for a subscription and return the clientSecret for Stripe Elements.',
    description:
      'This endpoint creates a PaymentIntent directly (not a Checkout Session). ' +
      'The frontend uses the returned clientSecret with <Elements> + <PaymentElement>. ' +
      'After stripe.confirmPayment() succeeds, call POST /api/billing/subscriptions/create ' +
      'with the returned paymentIntentId to create the actual subscription.',
  })
  @ApiOkResponse({
    description:
      'PaymentIntent client_secret and ID for Stripe Elements.',
    type: EmbeddedElementsCheckoutResponseDto,
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
  async createEmbeddedElementsCheckout(
    @GetUser() user: AuthenticatedUserShape,
    @IdempotencyKey() idempotencyKey: string,
    @Body() dto: BillingSubscriptionCheckoutRequestDto,
  ): Promise<EmbeddedElementsCheckoutResponseDto> {
    // Creates a PaymentIntent for the subscription's initial payment.
    // The payment is confirmed on the frontend via Elements, then
    // the subscription is created server-side in a separate call.
    const result = await this.checkoutService.createSubscriptionPaymentIntent({
      userId: user.id,
      priceId: dto.priceId,
      quantity: dto.quantity ?? 1,
      clientReferenceId: dto.clientReferenceId ?? null,
      idempotencyKey,
    });

    return {
      paymentIntentId: result.paymentIntentId,
      clientSecret: result.clientSecret,
    };
  }

  @Post('checkout/embedded-elements-one-time')
  @HttpCode(HttpStatus.OK)
  @ApiHeader({
    name: IDEMPOTENCY_KEY_HEADER,
    required: true,
    description:
      'Caller-supplied idempotency key. The same key + same body returns the cached checkout session; a different body with the same key returns 409.',
  })
  @ApiOperation({
    summary:
      'Create a one-time Checkout Session and return the PaymentIntent clientSecret for use with Stripe Elements.',
    description:
      'One-time payments still use a Checkout Session (mode: payment) because ' +
      'payment_intent IS populated immediately for this mode.',
  })
  @ApiOkResponse({
    description:
      'Checkout Session ID and PaymentIntent client_secret for Stripe Elements.',
    type: OneTimeElementsCheckoutResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Billing price not found.',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description:
      'Price is not active, has the wrong type, or the plan is archived.',
  })
  async createEmbeddedElementsOneTimeCheckout(
    @GetUser() user: AuthenticatedUserShape,
    @IdempotencyKey() idempotencyKey: string,
    @Body() dto: BillingOneTimeCheckoutRequestDto,
  ): Promise<OneTimeElementsCheckoutResponseDto> {
    // 1. Create the Checkout Session using the existing service
    const sessionResult = await this.checkoutService.createOneTimeCheckout({
      userId: user.id,
      priceId: dto.priceId,
      quantity: dto.quantity ?? 1,
      allowPromotionCodes: dto.allowPromotionCodes ?? true,
      idempotencyKey,
    });

    // 2. Retrieve the session from Stripe, expanded with payment_intent
    const session = await this.stripeService
      .getClient()
      .checkout.sessions.retrieve(sessionResult.sessionId, {
        expand: ['payment_intent'],
      });

    // 3. Extract the PaymentIntent client_secret
    //    When expanded, payment_intent is the full PaymentIntent object.
    const paymentIntent = session.payment_intent;
    if (!paymentIntent || typeof paymentIntent === 'string' || !paymentIntent.client_secret) {
      throw new InternalServerErrorException(
        'Failed to retrieve PaymentIntent clientSecret',
      );
    }

    // 4. Return both identifiers
    return {
      sessionId: session.id,
      clientSecret: paymentIntent.client_secret,
    };
  }

  @Post('subscriptions/create')
  @HttpCode(HttpStatus.OK)
  @ApiHeader({
    name: IDEMPOTENCY_KEY_HEADER,
    required: true,
    description:
      'Caller-supplied idempotency key. Prevents duplicate subscription creation if the request is retried.',
  })
  @ApiOperation({
    summary:
      'Create a Stripe subscription from a confirmed PaymentIntent.',
    description:
      'Call this after stripe.confirmPayment() succeeds. The backend verifies ' +
      'the PaymentIntent status is "succeeded", then creates the subscription ' +
      'with the confirmed payment method as the default.',
  })
  @ApiOkResponse({
    description:
      'The created Stripe subscription ID and status.',
    type: CreateSubscriptionFromPaymentResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'BillingPayment or BillingPrice not found.',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description:
      'User already has an active subscription (race condition).',
  })
  async createSubscriptionFromPayment(
    @GetUser() user: AuthenticatedUserShape,
    @IdempotencyKey() idempotencyKey: string,
    @Body() dto: CreateSubscriptionFromPaymentDto,
  ): Promise<CreateSubscriptionFromPaymentResponseDto> {
    const result = await this.checkoutService.createSubscriptionFromPayment({
      userId: user.id,
      paymentIntentId: dto.paymentIntentId,
      idempotencyKey,
    });

    return {
      subscriptionId: result.subscriptionId,
      status: result.status,
    };
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
