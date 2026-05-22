import { Injectable } from '@nestjs/common';
import { DataSource, QueryRunner, Repository, LessThan } from 'typeorm';
import { Payment } from './schema/payment.schema';
import { PaymentStatus } from './schema/payment-status.enum';

export interface PaginatedPaymentResult {
  data: Payment[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

@Injectable()
export class PaymentsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Get the correct repository — transactional when a QueryRunner is provided,
   * default (non-transactional) otherwise.
   */
  private getRepo(qr?: QueryRunner): Repository<Payment> {
    return qr
      ? qr.manager.getRepository(Payment)
      : this.dataSource.manager.getRepository(Payment);
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<Payment | null> {
    return this.getRepo().findOne({
      where: { idempotencyKey },
    });
  }

  async findByStripePaymentIntent(
    stripePaymentIntent: string,
  ): Promise<Payment | null> {
    return this.getRepo().findOne({
      where: { stripePaymentIntent },
    });
  }

  async findByUser(
    userId: string,
    skip: number,
    take: number,
  ): Promise<[Payment[], number]> {
    return this.getRepo().findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      skip,
      take,
    });
  }

  async create(
    payment: Partial<Payment>,
    queryRunner?: QueryRunner,
  ): Promise<Payment> {
    const entity = this.getRepo(queryRunner).create(payment);
    return this.getRepo(queryRunner).save(entity);
  }

  async updateStatus(
    id: string,
    status: PaymentStatus,
    extra?: Partial<Payment>,
    queryRunner?: QueryRunner,
  ): Promise<Payment> {
    const updateData: Record<string, unknown> = { status };
    if (extra) {
      Object.assign(updateData, extra);
    }
    await this.getRepo(queryRunner).update(id, updateData);
    const updated = await this.getRepo(queryRunner).findOne({ where: { id } });
    if (!updated) {
      throw new Error(`Payment with id ${id} not found`);
    }
    return updated;
  }

  async findStalePendingPayments(): Promise<Payment[]> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    return this.getRepo().find({
      where: {
        status: PaymentStatus.PENDING,
        createdAt: LessThan(oneHourAgo),
      },
    });
  }
}
