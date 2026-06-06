/**
 * Environment Validation Schema
 *
 * This file defines the validation rules for all environment variables.
 * Uses Joi for schema validation with clear error messages.
 *
 * Required variables (application will not start without):
 * - NODE_ENV: Application environment
 * - PORT: Server port
 * - FRONTEND_URL: Frontend URL for CORS
 * - DATABASE_URL: PostgreSQL connection string
 * - JWT_SECRET: JWT signing key
 * - JWT_EXPIRES_IN: Token expiration time
 *
 * Optional variables:
 * - STRIPE_SECRET_KEY: Stripe payment processing
 * - STRIPE_WEBHOOK_SECRET: Stripe webhook verification
 * - GOOGLE_CLIENT_ID: Google OAuth
 * - GOOGLE_CLIENT_SECRET: Google OAuth
 * - GOOGLE_CALLBACK_URL: Google OAuth callback
 * - MAIL_*: Email/SMTP configuration
 * - DB_SSL_CERT: Database SSL certificate
 */

import * as Joi from 'joi';

/**
 * Validation schema for all environment variables
 * - All required variables must be present
 * - Optional variables have default values or are optional
 */
export const validationSchema = Joi.object({
  // ===================
  // APPLICATION
  // ===================

  /**
   * Application environment
   * - development: Local development
   * - production: Production deployment
   * - test: Unit/Integration tests
   */
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),

  /**
   * Server port number
   * Default: 3000
   */
  PORT: Joi.number().default(3000),

  /**
   * Frontend URL for CORS configuration
   * Required for production
   * Example: http://localhost:3001 or https://your-app.vercel.app
   */
  FRONTEND_URL: Joi.string().required(),

  // ===================
  // DATABASE
  // ===================

  /**
   * PostgreSQL connection string
   * Format: postgresql://user:password@host:port/database?options
   * Required - application cannot start without database connection
   */
  DATABASE_URL: Joi.string().required(),

  /**
   * Database SSL certificate (optional)
   * Required for some hosting providers like Neon
   * Content of the .pem certificate file
   */
  DB_SSL_CERT: Joi.string().optional(),

  // ===================
  // JWT AUTHENTICATION
  // ===================

  /**
   * JWT secret key for signing tokens
   * Required - should be a strong random string (min 32 characters)
   * Generate with: openssl rand -base64 32
   */
  JWT_SECRET: Joi.string().required(),

  /**
   * JWT token expiration time
   * Default: 7d (7 days)
   * Examples: 7d, 24h, 60m
   */
  JWT_EXPIRES_IN: Joi.string().default('7d'),

  // ===================
  // TMDB API
  // ===================

  // ===================
  // STRIPE (Billing module)
  // ===================

  /**
   * Stripe restricted API key (preferred for production).
   * Get from: https://dashboard.stripe.com/apikeys
   * Format: rk_test_... or rk_live_...
   * If both this and STRIPE_SECRET_KEY are set, the restricted key wins.
   */
  STRIPE_RESTRICTED_KEY: Joi.string().optional(),

  /**
   * Stripe secret key for payment processing
   * Get from: https://dashboard.stripe.com/apikeys
   * Use test key (sk_test_...) for development
   * Only used if STRIPE_RESTRICTED_KEY is not set.
   */
  STRIPE_SECRET_KEY: Joi.string().optional(),

  /**
   * Stripe webhook signing secret
   * Get from: https://dashboard.stripe.com/webhooks
   * Format: whsec_...
   * Required when the BillingModule is enabled (non-test environments).
   */
  STRIPE_WEBHOOK_SECRET: Joi.string().optional(),

  /**
   * Stripe API version pinned for this backend.
   * The SDK default is 2026-04-22.dahlia; this project targets 2026-05-27.dahlia.
   */
  STRIPE_API_VERSION: Joi.string().default('2026-05-27.dahlia'),

  /**
   * Default currency used for Checkout, invoices, and prices that
   * have no explicit currency. ISO-4217 lowercase 3-letter code.
   */
  BILLING_DEFAULT_CURRENCY: Joi.string().lowercase().length(3).default('usd'),

  /**
   * Toggle to disable the billing module entirely. When false, the
   * BillingModule is not registered and Stripe env vars are not
   * required. Defaults to true.
   */
  BILLING_ENABLED: Joi.boolean().default(true),

  /**
   * URL the user is sent to after a successful Stripe Checkout
   * session. Required when the BillingModule is enabled.
   */
  STRIPE_SUCCESS_URL: Joi.string().uri().optional(),

  /**
   * URL the user is sent to after canceling Stripe Checkout.
   * Required when the BillingModule is enabled.
   */
  STRIPE_CANCEL_URL: Joi.string().uri().optional(),

  /**
   * URL Stripe Customer Portal redirects the user to when they
   * press "Back to app". Required when the BillingModule is enabled.
   */
  STRIPE_PORTAL_RETURN_URL: Joi.string().uri().optional(),

  // ===================
  // GOOGLE OAuth (Optional)
  // ===================

  /**
   * Google OAuth 2.0 Client ID
   * Get from: https://console.cloud.google.com/apis/credentials
   */
  GOOGLE_CLIENT_ID: Joi.string().optional(),

  /**
   * Google OAuth 2.0 Client Secret
   * Get from: https://console.cloud.google.com/apis/credentials
   */
  GOOGLE_CLIENT_SECRET: Joi.string().optional(),

  /**
   * Google OAuth callback URL
   * Must match the callback URL in Google Console
   */
  GOOGLE_CALLBACK_URL: Joi.string().optional(),

  // ===================
  // EMAIL/SMTP (Optional)
  // ===================

  /**
   * SMTP server hostname
   * Example: smtp.gmail.com, smtp.sendgrid.net
   */
  MAIL_HOST: Joi.string().optional(),

  /**
   * SMTP server port
   * Common ports: 587 (TLS), 465 (SSL), 25
   */
  MAIL_PORT: Joi.number().optional(),

  /**
   * SMTP username/email
   */
  MAIL_USER: Joi.string().optional(),

  /**
   * SMTP password or app password
   * For Gmail, use App Password (not regular password)
   */
  MAIL_PASS: Joi.string().optional(),

  /**
   * From email address for outgoing emails
   * Format: "Name" <email@example.com>
   */
  MAIL_FROM: Joi.string().optional(),

  // ===================
  // PUSHER (Required for real-time notifications)
  // ===================

  PUSHER_APP_ID: Joi.string().required(),

  PUSHER_KEY: Joi.string().required(),

  PUSHER_SECRET: Joi.string().required(),

  PUSHER_CLUSTER: Joi.string()
    .valid('us2', 'eu', 'ap1', 'ap2', 'ap3', 'mt1')
    .required(),
}).custom((value, helpers) => {
  // Cross-field validation for the BillingModule. When BILLING_ENABLED
  // is true we require a Stripe key, the webhook secret (non-test),
  // and the success/cancel/portal URLs. When BILLING_ENABLED is false
  // we let the module simply not be registered at runtime.
  const enabled = value.BILLING_ENABLED !== false;
  if (!enabled) {
    return value;
  }

  const nodeEnv = (value.NODE_ENV as string | undefined) ?? 'development';
  const isTest = nodeEnv === 'test';
  const errors: string[] = [];

  if (!value.STRIPE_RESTRICTED_KEY && !value.STRIPE_SECRET_KEY) {
    errors.push(
      'STRIPE_RESTRICTED_KEY (preferred) or STRIPE_SECRET_KEY is required when BILLING_ENABLED is true.',
    );
  }

  if (!value.STRIPE_WEBHOOK_SECRET && !isTest) {
    errors.push(
      'STRIPE_WEBHOOK_SECRET is required when BILLING_ENABLED is true (test environments may omit it).',
    );
  }

  if (
    value.STRIPE_WEBHOOK_SECRET &&
    !String(value.STRIPE_WEBHOOK_SECRET).startsWith('whsec_')
  ) {
    errors.push('STRIPE_WEBHOOK_SECRET must start with "whsec_".');
  }

  for (const key of [
    'STRIPE_SUCCESS_URL',
    'STRIPE_CANCEL_URL',
    'STRIPE_PORTAL_RETURN_URL',
  ] as const) {
    if (!value[key]) {
      errors.push(`${key} is required when BILLING_ENABLED is true.`);
    }
  }

  if (errors.length > 0) {
    return helpers.error('any.invalid', { message: errors.join(' ') });
  }

  return value;
});
