import { Injectable } from '@nestjs/common';
import { DataSource, Repository, LessThan } from 'typeorm';
import { Payment, PaymentStatus } from './schema/payment.schema';

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

  private get repository(): Repository<Payment> {
    return this.dataSource.manager.getRepository(Payment);
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<Payment | null> {
    return this.repository.findOne({
      where: { idempotencyKey },
    });
  }

  async findByStripePaymentIntent(
    stripePaymentIntent: string,
  ): Promise<Payment | null> {
    return this.repository.findOne({
      where: { stripePaymentIntent },
    });
  }

  async findByUser(
    userId: string,
    skip: number,
    take: number,
  ): Promise<[Payment[], number]> {
    return this.repository.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      skip,
      take,
    });
  }

  async create(payment: Partial<Payment>): Promise<Payment> {
    const entity = this.repository.create(payment);
    return this.repository.save(entity);
  }

  async updateStatus(
    id: string,
    status: PaymentStatus,
    extra?: Partial<Payment>,
  ): Promise<Payment> {
    const updateData: any = { status };
    if (extra) {
      Object.assign(updateData, extra);
    }
    await this.repository.update(id, updateData);
    const updated = await this.repository.findOne({ where: { id } });
    if (!updated) {
      throw new Error(`Payment with id ${id} not found`);
    }
    return updated;
  }

  async findStalePendingPayments(): Promise<Payment[]> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    return this.repository.find({
      where: {
        status: PaymentStatus.PENDING,
        createdAt: LessThan(oneHourAgo),
      },
    });
  }
}
