import { Injectable } from '@nestjs/common';
import { DataSource, QueryRunner, Repository } from 'typeorm';
import { Order } from './schema/order.schema';
import { OrderItem } from './schema/order-item.schema';
import { OrderStatus } from './types/order-status.enum';
import { isValidOrderTransition } from './types/order-status.enum';

@Injectable()
export class OrderRepository {
  private orderRepo: Repository<Order>;
  private orderItemRepo: Repository<OrderItem>;

  constructor(private dataSource: DataSource) {
    this.orderRepo = this.dataSource.getRepository(Order);
    this.orderItemRepo = this.dataSource.getRepository(OrderItem);
  }

  async findByUserId(
    userId: string,
    skip: number,
    take: number,
  ): Promise<[Order[], number]> {
    return this.orderRepo.findAndCount({
      where: { userId },
      relations: ['items'],
      order: { createdAt: 'DESC' },
      skip,
      take,
    });
  }

  async findByIdWithItems(orderId: string): Promise<Order | null> {
    return this.orderRepo.findOne({
      where: { id: orderId },
      relations: ['items'],
    });
  }

  async findByIdWithItemsAndUser(
    orderId: string,
    userId: string,
  ): Promise<Order | null> {
    return this.orderRepo.findOne({
      where: { id: orderId, userId },
      relations: ['items'],
    });
  }

  async findByStripeSessionId(sessionId: string): Promise<Order | null> {
    return this.orderRepo.findOne({
      where: { stripeCheckoutSessionId: sessionId },
      relations: ['items', 'payment'],
    });
  }

  async findByIdForUpdate(
    orderId: string,
    queryRunner: QueryRunner,
  ): Promise<Order | null> {
    return queryRunner.manager
      .getRepository(Order)
      .createQueryBuilder('order')
      .setLock('pessimistic_write')
      .where('order.id = :orderId', { orderId })
      .getOne();
  }

  async createOrder(
    order: Partial<Order>,
    queryRunner: QueryRunner,
  ): Promise<Order> {
    const newOrder = queryRunner.manager.create(Order, order);
    return queryRunner.manager.save(Order, newOrder);
  }

  async createOrderItems(
    items: Partial<OrderItem>[],
    queryRunner: QueryRunner,
  ): Promise<OrderItem[]> {
    const newItems = items.map((item) =>
      queryRunner.manager.create(OrderItem, item),
    );
    return queryRunner.manager.save(OrderItem, newItems);
  }

  async updateStatusWithValidation(
    orderId: string,
    newStatus: OrderStatus,
    queryRunner: QueryRunner,
  ): Promise<Order> {
    const order = await this.findByIdForUpdate(orderId, queryRunner);
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    if (!isValidOrderTransition(order.status, newStatus)) {
      throw new Error(
        `Invalid order status transition from ${order.status} to ${newStatus}`,
      );
    }

    await queryRunner.manager.update(Order, orderId, { status: newStatus });
    order.status = newStatus;
    return order;
  }

  async findExpiredReservations(currentTime: Date): Promise<Order[]> {
    return this.orderRepo
      .createQueryBuilder('order')
      .where('order.status = :status', {
        status: OrderStatus.AWAITING_CHECKOUT_SESSION,
      })
      .andWhere('order.reservation_expires_at < :currentTime', { currentTime })
      .getMany();
  }
}
