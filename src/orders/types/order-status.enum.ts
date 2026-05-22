export enum OrderStatus {
  AWAITING_CHECKOUT_SESSION = 'awaiting_checkout_session',
  PENDING_PAYMENT = 'pending_payment',
  PAID = 'paid',
  FAILED = 'failed',
  CANCELED = 'canceled',
  REFUNDED = 'refunded',
  PARTIALLY_REFUNDED = 'partially_refunded',
  EXPIRED = 'expired',
}

export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.AWAITING_CHECKOUT_SESSION]: [
    OrderStatus.PENDING_PAYMENT,
    OrderStatus.FAILED,
  ],
  [OrderStatus.PENDING_PAYMENT]: [
    OrderStatus.PAID,
    OrderStatus.FAILED,
    OrderStatus.EXPIRED,
    OrderStatus.CANCELED,
  ],
  [OrderStatus.PAID]: [OrderStatus.REFUNDED, OrderStatus.PARTIALLY_REFUNDED],
  [OrderStatus.FAILED]: [],
  [OrderStatus.CANCELED]: [],
  [OrderStatus.REFUNDED]: [],
  [OrderStatus.PARTIALLY_REFUNDED]: [OrderStatus.REFUNDED],
  [OrderStatus.EXPIRED]: [],
};

export function isValidOrderTransition(
  from: OrderStatus,
  to: OrderStatus,
): boolean {
  const allowedTransitions = ORDER_STATUS_TRANSITIONS[from];
  return allowedTransitions.includes(to);
}
