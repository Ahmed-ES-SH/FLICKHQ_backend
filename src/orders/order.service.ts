import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';
import { OrderRepository } from './order.repository';
import { OrderStatus, isValidOrderTransition } from './types/order-status.enum';
import { Order } from './schema/order.schema';
import { OrderItem } from './schema/order-item.schema';
import { OrderResponseDto } from './dto/order-response.dto';
import { CartResponseDto } from '../cart/dto/cart-response.dto';

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    private orderRepository: OrderRepository,
    private dataSource: DataSource,
  ) {}

  // ── Transaction helper to eliminate duplicated try/catch/finally ──

  private async withTransaction<T>(
    fn: (qr: QueryRunner) => Promise<T>,
  ): Promise<T> {
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      const result = await fn(qr);
      await qr.commitTransaction();
      return result;
    } catch (error) {
      await qr.rollbackTransaction();
      throw error;
    } finally {
      await qr.release();
    }
  }

  // ── Core order creation ──

  async createOrderFromCart(
    userId: string,
    cart: CartResponseDto,
    queryRunner: QueryRunner,
  ): Promise<Order> {
    const subtotal = cart.subtotal;
    // TODO: Integrate tax calculation service (e.g., Stripe Tax)
    const taxAmount = 0;
    // TODO: Integrate coupon/discount system
    const discountAmount = 0;
    const totalAmount = subtotal - discountAmount + taxAmount;

    const reservationExpiresAt = new Date(Date.now() + 20 * 60 * 1000);

    const orderEntity = queryRunner.manager.create(Order, {
      userId,
      status: OrderStatus.AWAITING_CHECKOUT_SESSION,
      subtotal,
      taxAmount,
      discountAmount,
      totalAmount,
      currency: cart.currency,
      reservationExpiresAt,
    });
    const savedOrder = await queryRunner.manager.save(Order, orderEntity);

    const orderItemEntities = cart.items.map((item) =>
      queryRunner.manager.create(OrderItem, {
        orderId: savedOrder.id,
        productId: item.productId,
        productTitleSnapshot: item.productTitle,
        productThumbnailSnapshot: item.productThumbnail,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        subtotal: item.subtotal,
        currency: cart.currency,
        metadataSnapshot: {},
      }),
    );
    await queryRunner.manager.save(OrderItem, orderItemEntities);

    this.logger.log(
      `Order ${savedOrder.id} created for user ${userId} (AWAITING_CHECKOUT_SESSION)`,
    );

    return savedOrder;
  }

  // ── Status transitions ──

  async markOrderPendingPayment(
    orderId: string,
    stripeSessionId: string,
    queryRunner?: QueryRunner,
  ): Promise<OrderResponseDto> {
    const execute = async (qr: QueryRunner) => {
      await this.orderRepository.updateStatusWithValidation(
        orderId,
        OrderStatus.PENDING_PAYMENT,
        qr,
      );

      await qr.manager.update(Order, orderId, {
        stripeCheckoutSessionId: stripeSessionId,
      });

      this.logger.log(
        `Order ${orderId} marked as PENDING_PAYMENT with session ${stripeSessionId}`,
      );

      const order = await this.orderRepository.findByIdWithItems(orderId);
      if (!order) {
        throw new NotFoundException('Order not found');
      }
      return this.mapToResponseDto(order);
    };

    if (queryRunner) {
      return execute(queryRunner);
    }
    return this.withTransaction(execute);
  }

  async markOrderPaidWithLock(
    orderId: string,
    paymentId: string,
    queryRunner: QueryRunner,
  ): Promise<OrderResponseDto> {
    const order = await this.orderRepository.findByIdForUpdate(
      orderId,
      queryRunner,
    );
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (order.status === OrderStatus.PAID) {
      this.logger.log(`Order ${orderId} already PAID, skipping (idempotent)`);
      return this.mapToResponseDto(order);
    }

    if (!isValidOrderTransition(order.status, OrderStatus.PAID)) {
      throw new Error(
        `Cannot mark order ${orderId} as PAID from status ${order.status}`,
      );
    }

    await queryRunner.manager.update(Order, orderId, {
      status: OrderStatus.PAID,
      paymentId,
    });

    this.logger.log(`Order ${orderId} marked as PAID`);

    const updatedOrder = await this.orderRepository.findByIdWithItems(orderId);
    if (!updatedOrder) {
      throw new NotFoundException('Order not found');
    }

    return this.mapToResponseDto(updatedOrder);
  }

  async markOrderFailed(
    orderId: string,
    reason?: string,
  ): Promise<OrderResponseDto> {
    return this.withTransaction(async (qr) => {
      await this.orderRepository.updateStatusWithValidation(
        orderId,
        OrderStatus.FAILED,
        qr,
      );

      this.logger.log(`Order ${orderId} marked as FAILED: ${reason}`);

      const order = await this.orderRepository.findByIdWithItems(orderId);
      if (!order) {
        throw new NotFoundException('Order not found');
      }
      return this.mapToResponseDto(order);
    });
  }

  async markOrderExpired(orderId: string): Promise<OrderResponseDto> {
    return this.withTransaction(async (qr) => {
      await this.orderRepository.updateStatusWithValidation(
        orderId,
        OrderStatus.EXPIRED,
        qr,
      );

      this.logger.log(`Order ${orderId} marked as EXPIRED`);

      const order = await this.orderRepository.findByIdWithItems(orderId);
      if (!order) {
        throw new NotFoundException('Order not found');
      }
      return this.mapToResponseDto(order);
    });
  }

  async markOrderRefunded(orderId: string): Promise<OrderResponseDto> {
    return this.withTransaction(async (qr) => {
      await this.orderRepository.updateStatusWithValidation(
        orderId,
        OrderStatus.REFUNDED,
        qr,
      );

      this.logger.log(`Order ${orderId} marked as REFUNDED`);

      const order = await this.orderRepository.findByIdWithItems(orderId);
      if (!order) {
        throw new NotFoundException('Order not found');
      }
      return this.mapToResponseDto(order);
    });
  }

  // ── Queries ──

  async getOrderHistory(
    userId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<{
    data: OrderResponseDto[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const skip = (page - 1) * limit;
    const [orders, total] = await this.orderRepository.findByUserId(
      userId,
      skip,
      limit,
    );

    const data = orders.map((order) => this.mapToResponseDto(order));

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getOrderById(
    userId: string,
    orderId: string,
  ): Promise<OrderResponseDto> {
    // Single query with compound where clause — prevents order-existence leakage
    const order = await this.orderRepository.findByIdWithItemsAndUser(
      orderId,
      userId,
    );
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return this.mapToResponseDto(order);
  }

  // ── Mapping ──

  private mapToResponseDto(order: Order): OrderResponseDto {
    return {
      id: order.id,
      userId: order.userId,
      status: order.status,
      subtotal: order.subtotal,
      taxAmount: order.taxAmount,
      discountAmount: order.discountAmount,
      totalAmount: order.totalAmount,
      paymentId: order.paymentId,
      currency: order.currency,
      stripeCheckoutSessionId: order.stripeCheckoutSessionId,
      reservationExpiresAt: order.reservationExpiresAt,
      createdAt: order.createdAt,
      items: order.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        productTitleSnapshot: item.productTitleSnapshot,
        productThumbnailSnapshot: item.productThumbnailSnapshot,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        subtotal: item.subtotal,
        currency: item.currency,
      })),
    };
  }
}
