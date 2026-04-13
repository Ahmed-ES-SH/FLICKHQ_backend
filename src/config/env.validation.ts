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
 * - TMDB_API_KEY: The Movie Database API key
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

  /**
   * The Movie Database API key
   * Required for movie data fetching
   * Get from: https://www.themoviedb.org/settings/api
   */
  TMDB_API_KEY: Joi.string().required(),

  // ===================
  // STRIPE (Optional)
  // ===================

  /**
   * Stripe secret key for payment processing
   * Get from: https://dashboard.stripe.com/apikeys
   * Use test key (sk_test_...) for development
   */
  STRIPE_SECRET_KEY: Joi.string().optional(),

  /**
   * Stripe webhook signing secret
   * Get from: https://dashboard.stripe.com/webhooks
   * Format: whsec_...
   */
  STRIPE_WEBHOOK_SECRET: Joi.string().optional(),

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
});
