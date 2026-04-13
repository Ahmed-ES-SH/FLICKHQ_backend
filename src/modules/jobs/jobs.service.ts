import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Clean old read notifications - keep last 100 per user
   * Runs daily at midnight
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanOldNotifications(): Promise<void> {
    this.logger.log('Starting cleanup of old read notifications...');

    try {
      const result = await this.dataSource.query(`
        DELETE FROM notifications
        WHERE id NOT IN (
          SELECT id FROM notifications n2
          WHERE n2.user_id = notifications.user_id
          ORDER BY created_at DESC
          LIMIT 100
        )
        AND is_read = true
        AND is_deleted = true
      `);

      this.logger.log(`Cleaned up old notifications`);
    } catch (error) {
      this.logger.error('Failed to clean old notifications', error);
    }
  }

  /**
   * Reconcile pending payments - check Stripe for status updates
   * Runs every hour
   */
  @Cron('0 * * * *')
  async reconcilePendingPayments(): Promise<void> {
    this.logger.log('Starting reconciliation of pending payments...');

    try {
      // Get stripe instance from config
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

      const pendingPayments = await this.dataSource.query(`
        SELECT id, "stripePaymentIntent"
        FROM payments
        WHERE status = 'pending'
        AND "createdAt" < NOW() - INTERVAL '1 hour'
      `);

      for (const payment of pendingPayments) {
        try {
          const intent = await stripe.paymentIntents.retrieve(
            payment.stripePaymentIntent,
          );

          if (intent.status === 'succeeded') {
            await this.dataSource.query(
              `UPDATE payments SET status = 'succeeded', "updatedAt" = NOW() WHERE id = $1`,
              [payment.id],
            );
            this.logger.log(`Payment ${payment.id} marked as succeeded`);
          } else if (
            intent.status === 'canceled' ||
            intent.status === 'abandoned'
          ) {
            await this.dataSource.query(
              `UPDATE payments SET status = 'failed', "updatedAt" = NOW() WHERE id = $1`,
              [payment.id],
            );
            this.logger.log(`Payment ${payment.id} marked as failed`);
          }
        } catch (stripeError) {
          this.logger.warn(
            `Failed to check status for payment ${payment.id}:`,
            stripeError.message,
          );
        }
      }

      this.logger.log(`Reconciled ${pendingPayments.length} pending payments`);
    } catch (error) {
      this.logger.error('Failed to reconcile pending payments', error);
    }
  }

  /**
   * Keep-alive - prevent database connection timeout on free tier
   * Runs every 10 minutes
   */
  @Cron('*/10 * * * *')
  async keepAlive(): Promise<void> {
    try {
      await this.dataSource.query('SELECT 1');
      this.logger.debug('Database keep-alive ping successful');
    } catch (error) {
      this.logger.error('Database keep-alive ping failed', error);
    }
  }

  /**
   * Prune orphan movies - remove movies not in any user list
   * Runs weekly on Sunday at 1 AM
   */
  @Cron('0 1 * * 0')
  async pruneOrphanMovies(): Promise<void> {
    this.logger.log('Starting pruning of orphan movies...');

    try {
      const result = await this.dataSource.query(`
        DELETE FROM movies
        WHERE id NOT IN (
          SELECT DISTINCT movie_id FROM user_lists
        )
        AND id NOT IN (
          SELECT DISTINCT id FROM movies WHERE id IN (
            SELECT movie_id FROM user_lists
          )
        )
      `);

      this.logger.log(`Pruned orphan movies`);
    } catch (error) {
      this.logger.error('Failed to prune orphan movies', error);
    }
  }
}
