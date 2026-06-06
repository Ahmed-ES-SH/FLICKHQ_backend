/**
 * Database Configuration for CYPHER Backend
 *
 * This file configures the PostgreSQL connection using TypeORM.
 * All configuration is loaded from environment variables.
 *
 * Required env variables:
 * - DATABASE_URL: PostgreSQL connection string
 * - NODE_ENV: development | production | test
 * - DB_SSL_CERT: (optional) SSL certificate for production
 */

import { User } from '../user/schema/user.entity';
import { DataSourceOptions, DataSource } from 'typeorm';
import { config } from 'dotenv';
import { BlackList } from '../auth/schema/blacklist-tokens.schema';
import { ContactMessage } from '../contact/schema/contact-message.schema';
import { Article } from '../blog/schema/article.schema';
import { Category } from '../categories/schema/category.schema';
import { Notification } from '../notifications/schema/notification.schema';
import { NotificationPreferences } from '../notifications/schema/notification-preferences.schema';
import { BillingCustomer } from '../billing/entities/billing-customer.entity';
import { BillingPlan } from '../billing/entities/billing-plan.entity';
import { BillingPrice } from '../billing/entities/billing-price.entity';
import { BillingSubscription } from '../billing/entities/billing-subscription.entity';
import { BillingPayment } from '../billing/entities/billing-payment.entity';
import { BillingInvoice } from '../billing/entities/billing-invoice.entity';
import { BillingTransaction } from '../billing/entities/billing-transaction.entity';
import { BillingWebhookEvent } from '../billing/entities/billing-webhook-event.entity';
import { BillingIdempotencyKey } from '../billing/entities/billing-idempotency-key.entity';
import { BillingEntitlement } from '../billing/entities/billing-entitlement.entity';

// Load environment variables from .env file
config({ path: '.env' });

/**
 * Database configuration object
 * - Uses PostgreSQL as the database type
 * - SSL is enabled for production environments
 * - Connection pool is limited to 5 connections for free tier hosting
 */
export const databaseConfig: DataSourceOptions = {
  // Database type
  type: 'postgres',

  // Connection string from DATABASE_URL env variable
  url: process.env.DATABASE_URL,

  // SSL configuration for production
  // In production, requires either DB_SSL_CERT or proper SSL setup
  ssl:
    process.env.NODE_ENV === 'production'
      ? {
          rejectUnauthorized: true,
          // CA certificate for database connection (optional, from DB_SSL_CERT)
          ca: process.env.DB_SSL_CERT,
        }
      : false,

  // TypeORM entities - maps to database tables
  entities: [
    User,
    BlackList,
    ContactMessage,
    Article,
    Category,
    Notification,
    NotificationPreferences,
    BillingCustomer,
    BillingPlan,
    BillingPrice,
    BillingSubscription,
    BillingPayment,
    BillingInvoice,
    BillingTransaction,
    BillingWebhookEvent,
    BillingIdempotencyKey,
    BillingEntitlement,
  ],

  // ⚠️ IMPORTANT: Always false in production!
  // Use migrations for schema changes: npm run migration:run
  synchronize: false,

  // SQL query logging (disable in production for performance)
  logging: false,

  // Migration files location (compiled JavaScript)
  migrations: ['dist/db/migrations/*.js'],

  // Connection pool settings optimized for free tier
  extra: {
    // Maximum connections in pool (keep low for free hosting)
    max: 5,
    // Close idle connections after 30 seconds
    idleTimeoutMillis: 30000,
    // Connection timeout after 5 seconds
    connectionTimeoutMillis: 5000,
    // Query timeout after 10 seconds
    statement_timeout: 10000,
    // Transaction timeout after 30 seconds
    idle_in_transaction_session_timeout: 30000,
  },
};

// Create and export the DataSource instance
const dataSource = new DataSource(databaseConfig);

export default dataSource;
