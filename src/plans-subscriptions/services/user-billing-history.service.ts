import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { BillingSubscription } from '../../billing/entities/billing-subscription.entity';
import { BillingPayment } from '../../billing/entities/billing-payment.entity';
import { BillingInvoice } from '../../billing/entities/billing-invoice.entity';
import { BillingTransaction } from '../../billing/entities/billing-transaction.entity';
import { BillingSubscriptionStatus } from '../../billing/common/billing.enums';
import { PaginationQueryDto } from '../dto/pagination-query.dto';
import { UserSubscriptionHistoryItemDto } from '../dto/user-subscription-history.dto';
import { UserPaymentHistoryItemDto } from '../dto/user-payment-history.dto';

@Injectable()
export class UserBillingHistoryService {
  constructor(
    @InjectRepository(BillingSubscription)
    private readonly subscriptionRepository: Repository<BillingSubscription>,
    @InjectRepository(BillingPayment)
    private readonly paymentRepository: Repository<BillingPayment>,
    @InjectRepository(BillingInvoice)
    private readonly invoiceRepository: Repository<BillingInvoice>,
    @InjectRepository(BillingTransaction)
    private readonly transactionRepository: Repository<BillingTransaction>,
  ) {}

  /**
   * Get the current active subscription for a user.
   * A user may only have one active subscription at a time.
   * Active = trialing, active, past_due
   */
  async getCurrentSubscription(
    userId: number,
  ): Promise<UserSubscriptionHistoryItemDto | null> {
    const subscription = await this.subscriptionRepository.findOne({
      where: [
        { userId, status: BillingSubscriptionStatus.ACTIVE },
        { userId, status: BillingSubscriptionStatus.TRIALING },
        { userId, status: BillingSubscriptionStatus.PAST_DUE },
      ],
      relations: ['plan', 'price'],
      order: { createdAt: 'DESC' },
    });

    if (!subscription) return null;

    return this.toSubscriptionItem(subscription);
  }

  /**
   * Get paginated subscription history for a user.
   */
  async getUserSubscriptionHistory(
    userId: number,
    pagination: PaginationQueryDto,
  ): Promise<{
    items: UserSubscriptionHistoryItemDto[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const { page, limit } = pagination;
    const skip = (page - 1) * limit;

    const [items, total] = await this.subscriptionRepository.findAndCount({
      where: { userId },
      relations: ['plan', 'price'],
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });

    return {
      items: items.map((sub) => this.toSubscriptionItem(sub)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get paginated payment history for a user.
   */
  async getUserPaymentHistory(
    userId: number,
    pagination: PaginationQueryDto,
  ): Promise<{
    items: UserPaymentHistoryItemDto[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const { page, limit } = pagination;
    const skip = (page - 1) * limit;

    const [payments, total] = await this.paymentRepository.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });

    const paymentIds = payments.map((p) => p.id);
    const paymentIntentIds = payments
      .map((p) => p.stripePaymentIntentId)
      .filter((id): id is string => id !== null);

    // Batch-fetch related transactions and invoices
    const [transactions, invoices] = await Promise.all([
      this.transactionRepository.find({
        where: { paymentId: In(paymentIds) },
      }),
      paymentIntentIds.length > 0
        ? this.invoiceRepository.find({
            where: { stripePaymentIntentId: In(paymentIntentIds) },
          })
        : Promise.resolve([] as BillingInvoice[]),
    ]);

    const invoiceByPaymentIntent = new Map<string, BillingInvoice>();
    for (const inv of invoices) {
      if (inv.stripePaymentIntentId) {
        invoiceByPaymentIntent.set(inv.stripePaymentIntentId, inv);
      }
    }

    const txByPaymentId = new Map<string, BillingTransaction[]>();
    for (const tx of transactions) {
      if (!tx.paymentId) continue;
      const list = txByPaymentId.get(tx.paymentId) ?? [];
      list.push(tx);
      txByPaymentId.set(tx.paymentId, list);
    }

    const items: UserPaymentHistoryItemDto[] = payments.map((payment) => {
      const paymentTx = txByPaymentId.get(payment.id) ?? [];
      const chargeTx = paymentTx.find((t) => t.type === 'charge');
      const refundTx = paymentTx.find((t) => t.type === 'refund');
      const invoice = payment.stripePaymentIntentId
        ? invoiceByPaymentIntent.get(payment.stripePaymentIntentId)
        : undefined;

      return {
        id: payment.id,
        amount: payment.amount,
        amountRefunded: payment.amountRefunded,
        currency: payment.currency,
        status: payment.status,
        description: payment.description,
        subscriptionId: invoice?.subscriptionId ?? null,
        invoiceNumber: invoice?.number ?? null,
        transactionType: refundTx ? 'refund' : chargeTx ? 'charge' : 'charge',
        createdAt: payment.createdAt,
      };
    });

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get a single payment with full detail.
   */
  async getPaymentDetail(
    paymentId: string,
    userId: number,
  ): Promise<UserPaymentHistoryItemDto | null> {
    const payment = await this.paymentRepository.findOne({
      where: { id: paymentId, userId },
    });
    if (!payment) return null;

    const [transactions, invoice] = await Promise.all([
      this.transactionRepository.find({
        where: { paymentId: payment.id },
      }),
      payment.stripePaymentIntentId
        ? this.invoiceRepository.findOne({
            where: { stripePaymentIntentId: payment.stripePaymentIntentId },
          })
        : Promise.resolve(null),
    ]);

    const chargeTx = transactions.find((t) => t.type === 'charge');
    const refundTx = transactions.find((t) => t.type === 'refund');

    return {
      id: payment.id,
      amount: payment.amount,
      amountRefunded: payment.amountRefunded,
      currency: payment.currency,
      status: payment.status,
      description: payment.description,
      subscriptionId: invoice?.subscriptionId ?? null,
      invoiceNumber: invoice?.number ?? null,
      transactionType: refundTx ? 'refund' : chargeTx ? 'charge' : 'charge',
      createdAt: payment.createdAt,
    };
  }

  private toSubscriptionItem(
    sub: BillingSubscription,
  ): UserSubscriptionHistoryItemDto {
    return {
      id: sub.id,
      status: sub.status,
      planName: sub.plan?.name ?? null,
      priceCurrency: sub.price?.currency ?? null,
      priceUnitAmount: sub.price?.unitAmount ?? null,
      priceInterval: sub.price?.interval ?? null,
      currentPeriodStart: sub.currentPeriodStart,
      currentPeriodEnd: sub.currentPeriodEnd,
      trialEnd: sub.trialEnd,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      canceledAt: sub.canceledAt,
      createdAt: sub.createdAt,
    };
  }
}
