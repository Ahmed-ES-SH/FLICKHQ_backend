import {
  OrderStatus,
  isValidOrderTransition,
  ORDER_STATUS_TRANSITIONS,
} from './order-status.enum';

describe('Order Status Enum & State Machine', () => {
  describe('isValidOrderTransition', () => {
    it('should allow AWAITING_CHECKOUT_SESSION -> PENDING_PAYMENT', () => {
      expect(
        isValidOrderTransition(
          OrderStatus.AWAITING_CHECKOUT_SESSION,
          OrderStatus.PENDING_PAYMENT,
        ),
      ).toBe(true);
    });

    it('should allow AWAITING_CHECKOUT_SESSION -> FAILED', () => {
      expect(
        isValidOrderTransition(
          OrderStatus.AWAITING_CHECKOUT_SESSION,
          OrderStatus.FAILED,
        ),
      ).toBe(true);
    });

    it('should allow PENDING_PAYMENT -> PAID', () => {
      expect(
        isValidOrderTransition(OrderStatus.PENDING_PAYMENT, OrderStatus.PAID),
      ).toBe(true);
    });

    it('should allow PENDING_PAYMENT -> FAILED', () => {
      expect(
        isValidOrderTransition(OrderStatus.PENDING_PAYMENT, OrderStatus.FAILED),
      ).toBe(true);
    });

    it('should allow PENDING_PAYMENT -> EXPIRED', () => {
      expect(
        isValidOrderTransition(
          OrderStatus.PENDING_PAYMENT,
          OrderStatus.EXPIRED,
        ),
      ).toBe(true);
    });

    it('should allow PENDING_PAYMENT -> CANCELED', () => {
      expect(
        isValidOrderTransition(
          OrderStatus.PENDING_PAYMENT,
          OrderStatus.CANCELED,
        ),
      ).toBe(true);
    });

    it('should allow PAID -> REFUNDED', () => {
      expect(
        isValidOrderTransition(OrderStatus.PAID, OrderStatus.REFUNDED),
      ).toBe(true);
    });

    it('should allow PAID -> PARTIALLY_REFUNDED', () => {
      expect(
        isValidOrderTransition(
          OrderStatus.PAID,
          OrderStatus.PARTIALLY_REFUNDED,
        ),
      ).toBe(true);
    });

    it('should allow PARTIALLY_REFUNDED -> REFUNDED', () => {
      expect(
        isValidOrderTransition(
          OrderStatus.PARTIALLY_REFUNDED,
          OrderStatus.REFUNDED,
        ),
      ).toBe(true);
    });

    it('should NOT allow FAILED -> PAID', () => {
      expect(isValidOrderTransition(OrderStatus.FAILED, OrderStatus.PAID)).toBe(
        false,
      );
    });

    it('should NOT allow EXPIRED -> PAID', () => {
      expect(
        isValidOrderTransition(OrderStatus.EXPIRED, OrderStatus.PAID),
      ).toBe(false);
    });

    it('should NOT allow CANCELED -> PAID', () => {
      expect(
        isValidOrderTransition(OrderStatus.CANCELED, OrderStatus.PAID),
      ).toBe(false);
    });

    it('should NOT allow REFUNDED -> PAID', () => {
      expect(
        isValidOrderTransition(OrderStatus.REFUNDED, OrderStatus.PAID),
      ).toBe(false);
    });

    it('should NOT allow FAILED -> any status', () => {
      const allStatuses = Object.values(OrderStatus);
      for (const status of allStatuses) {
        expect(isValidOrderTransition(OrderStatus.FAILED, status)).toBe(false);
      }
    });

    it('should NOT allow CANCELED -> any status', () => {
      const allStatuses = Object.values(OrderStatus);
      for (const status of allStatuses) {
        expect(isValidOrderTransition(OrderStatus.CANCELED, status)).toBe(
          false,
        );
      }
    });

    it('should NOT allow EXPIRED -> any status', () => {
      const allStatuses = Object.values(OrderStatus);
      for (const status of allStatuses) {
        expect(isValidOrderTransition(OrderStatus.EXPIRED, status)).toBe(false);
      }
    });

    it('should NOT allow REFUNDED -> any status', () => {
      const allStatuses = Object.values(OrderStatus);
      for (const status of allStatuses) {
        expect(isValidOrderTransition(OrderStatus.REFUNDED, status)).toBe(
          false,
        );
      }
    });
  });

  describe('ORDER_STATUS_TRANSITIONS', () => {
    it('should have transitions defined for all statuses', () => {
      const allStatuses = Object.values(OrderStatus);
      for (const status of allStatuses) {
        expect(ORDER_STATUS_TRANSITIONS).toHaveProperty(status);
        expect(Array.isArray(ORDER_STATUS_TRANSITIONS[status])).toBe(true);
      }
    });

    it('should have empty transitions for terminal states', () => {
      expect(ORDER_STATUS_TRANSITIONS[OrderStatus.FAILED]).toEqual([]);
      expect(ORDER_STATUS_TRANSITIONS[OrderStatus.CANCELED]).toEqual([]);
      expect(ORDER_STATUS_TRANSITIONS[OrderStatus.REFUNDED]).toEqual([]);
      expect(ORDER_STATUS_TRANSITIONS[OrderStatus.EXPIRED]).toEqual([]);
    });

    it('should have non-empty transitions for active states', () => {
      expect(
        ORDER_STATUS_TRANSITIONS[OrderStatus.AWAITING_CHECKOUT_SESSION].length,
      ).toBeGreaterThan(0);
      expect(
        ORDER_STATUS_TRANSITIONS[OrderStatus.PENDING_PAYMENT].length,
      ).toBeGreaterThan(0);
      expect(ORDER_STATUS_TRANSITIONS[OrderStatus.PAID].length).toBeGreaterThan(
        0,
      );
      expect(
        ORDER_STATUS_TRANSITIONS[OrderStatus.PARTIALLY_REFUNDED].length,
      ).toBeGreaterThan(0);
    });
  });
});
