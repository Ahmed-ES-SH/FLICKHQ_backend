# Cart Module — Frontend Integration Plan

> **Backend:** NestJS v11 · TypeORM · PostgreSQL
> **Last Updated:** 2026-05-21
> **Audience:** Frontend / Full-Stack Developers

---

## Table of Contents

1. [API Endpoint Map](#1-api-endpoint-map)
2. [TypeScript Types & Interfaces](#2-typescript-types--interfaces)
3. [API Client Setup](#3-api-client-setup)
4. [React Query Hooks](#4-react-query-hooks)
5. [Error Handling & Validation Mapping](#5-error-handling--validation-mapping)
6. [Cart State Management](#6-cart-state-management)
7. [Caching & Invalidation Strategy](#7-caching--invalidation-strategy)
8. [Example Usage (Next.js / React)](#8-example-usage-nextjs--react)
9. [Gotchas & Edge Cases](#9-gotchas--edge-cases)

---

## 1. API Endpoint Map

All cart endpoints require **JWT authentication** (`@ApiBearerAuth()`). The cart is always scoped to the authenticated user — no user ID is passed in the URL or body.

| Method | Path | Description | Auth | Request Body | Success Response | Error Codes |
|--------|------|-------------|------|-------------|------------------|-------------|
| `GET` | `/cart` | Get user's cart | Required | _none_ | [`CartResponse`](#cartresponse) | `401` |
| `POST` | `/cart/items` | Add item to cart | Required | [`AddToCartDto`](#addtocartdto) | [`CartResponse`](#cartresponse) | `400`, `401`, `404` |
| `PATCH` | `/cart/items/:productId` | Update item quantity | Required | [`UpdateCartItemDto`](#updatecartitemdto) | [`CartResponse`](#cartresponse) | `400`, `401`, `404` |
| `DELETE` | `/cart/items/:productId` | Remove item from cart | Required | _none_ | [`CartResponse`](#cartresponse) | `401`, `404` |
| `DELETE` | `/cart` | Clear entire cart | Required | _none_ | [`MessageResponse`](#messageresponse) | `401` |

### 1.1 Rate Limiting

`POST /cart/items` and `PATCH /cart/items/:productId` are rate-limited to **10 requests per 60 seconds** per user. Exceeding this returns `429 Too Many Requests`.

### 1.2 Path Parameters

| Param | Type | Description |
|-------|------|-------------|
| `productId` | `UUID` | The product ID to add/update/remove |

---

## 2. TypeScript Types & Interfaces

### 2.1 Core Response Types

```typescript
// ─── Cart Item in Response ──────────────────────────────────────────────
export interface CartItemResponse {
  id: string;              // Cart item UUID
  productId: string;       // Product UUID
  productTitle: string;    // Product title (denormalized)
  productThumbnail: string | null; // Product thumbnail URL
  unitPrice: number;       // Price in cents (e.g., 2999 = $29.99)
  quantity: number;        // Quantity in cart (1–50 per item)
  subtotal: number;        // unitPrice * quantity (in cents)
  availableStock: number;  // Current stock level for this product
}

// ─── Full Cart Response ─────────────────────────────────────────────────
export interface CartResponse {
  id: string;              // Cart UUID
  userId: string;          // Owner user UUID
  items: CartItemResponse[];
  totalItems: number;      // Sum of all item quantities
  subtotal: number;        // Sum of all item subtotals (in cents)
  currency: string;        // Always "usd"
}

// ─── Message Response (for clear cart) ──────────────────────────────────
export interface MessageResponse {
  message: string;         // "Cart cleared"
}
```

### 2.2 Request DTOs

```typescript
// ─── Add to Cart ────────────────────────────────────────────────────────
export interface AddToCartDto {
  productId: string;       // required, valid UUID
  quantity?: number;       // optional, integer 1–50, default 1
}

// ─── Update Cart Item ───────────────────────────────────────────────────
export interface UpdateCartItemDto {
  quantity: number;        // required, integer 1–50
}
```

### 2.3 Error Response Shape (Global)

```typescript
// ─── Standard Error (from GlobalExceptionFilter) ────────────────────────
export interface ApiError {
  statusCode: number;
  message: string | string[];
  errors?: Array<{ field: string; message: string }>;
  timestamp: string;       // ISO 8601
  path: string;            // request URL
}
```

---

## 3. API Client Setup

### 3.1 Cart API Functions

```typescript
// lib/api/cart.ts
import api from './client';
import type {
  CartResponse,
  AddToCartDto,
  UpdateCartItemDto,
  MessageResponse,
} from '@/types/cart';

export async function getCart(): Promise<CartResponse> {
  const { data } = await api.get<CartResponse>('/cart');
  return data;
}

export async function addToCart(dto: AddToCartDto): Promise<CartResponse> {
  const { data } = await api.post<CartResponse>('/cart/items', dto);
  return data;
}

export async function updateCartItem(
  productId: string,
  dto: UpdateCartItemDto,
): Promise<CartResponse> {
  const { data } = await api.patch<CartResponse>(`/cart/items/${productId}`, dto);
  return data;
}

export async function removeFromCart(productId: string): Promise<CartResponse> {
  const { data } = await api.delete<CartResponse>(`/cart/items/${productId}`);
  return data;
}

export async function clearCart(): Promise<MessageResponse> {
  const { data } = await api.delete<MessageResponse>('/cart');
  return data;
}
```

---

## 4. React Query Hooks

### 4.1 Query Keys Factory

```typescript
// lib/api/cart-keys.ts
export const cartKeys = {
  all: ['cart'] as const,
  detail: () => [...cartKeys.all, 'detail'] as const,
};
```

### 4.2 Cart Hooks

```typescript
// hooks/use-cart.ts
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { cartKeys } from '@/lib/api/cart-keys';
import {
  getCart,
  addToCart,
  updateCartItem,
  removeFromCart,
  clearCart,
} from '@/lib/api/cart';
import type { AddToCartDto, UpdateCartItemDto } from '@/types/cart';

// ─── Query: Get Cart ────────────────────────────────────────────────────
export function useCart() {
  return useQuery({
    queryKey: cartKeys.detail(),
    queryFn: getCart,
    staleTime: 30_000,        // 30 seconds — cart is user-specific, stale quickly
    retry: false,             // Don't retry on 401/404
  });
}

// ─── Mutation: Add to Cart ──────────────────────────────────────────────
export function useAddToCart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: addToCart,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: cartKeys.detail() });
    },
  });
}

// ─── Mutation: Update Cart Item ─────────────────────────────────────────
export function useUpdateCartItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, dto }: { productId: string; dto: UpdateCartItemDto }) =>
      updateCartItem(productId, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: cartKeys.detail() });
    },
  });
}

// ─── Mutation: Remove from Cart ─────────────────────────────────────────
export function useRemoveFromCart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: removeFromCart,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: cartKeys.detail() });
    },
  });
}

// ─── Mutation: Clear Cart ───────────────────────────────────────────────
export function useClearCart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: clearCart,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: cartKeys.detail() });
    },
  });
}
```

### 4.3 Cart Badge Count Hook

```typescript
// hooks/use-cart-count.ts
import { useCart } from './use-cart';

/**
 * Returns just the total item count for the cart badge/icon.
 * Returns 0 when cart is empty, loading, or errored.
 */
export function useCartCount(): number {
  const { data, isLoading, isError } = useCart();
  if (isLoading || isError || !data) return 0;
  return data.totalItems;
}
```

---

## 5. Error Handling & Validation Mapping

### 5.1 HTTP Status Codes & Meanings

| Status | When | Frontend Action |
|--------|------|-----------------|
| `400` | Validation failure, insufficient stock, cart limit exceeded | Show inline error or toast |
| `401` | Missing or expired JWT | Redirect to login |
| `404` | Product not found, cart item not found, cart not found | Show "Not Found" or remove stale item |
| `409` | Concurrent modification (rare) | Refetch cart and retry |
| `429` | Rate limit exceeded | Show "Too many requests, please wait" toast |
| `500` | Server error | Show generic error toast |

### 5.2 Known Backend Error Messages

| Scenario | Error Message Pattern |
|----------|----------------------|
| Product not found (deleted) | `"Product not found"` |
| Product not published | `"Product is not available"` |
| Insufficient stock | `"Insufficient stock"` |
| Cart limit exceeded | `"Cart limit exceeded. Maximum 50 items allowed"` |
| Cart item not found on update | `"Cart item not found"` |
| Cart not found | `"Cart not found"` |
| Validation: invalid UUID | `"productId must be a UUID"` |
| Validation: quantity < 1 | `"quantity must not be less than 1"` |
| Validation: quantity > 50 | `"quantity must not be greater than 50"` |
| Validation: non-integer | `"quantity must be an integer number"` |

### 5.3 Validation Error Parsing

Same pattern as other modules — use the global error parser:

```typescript
// lib/api/error-utils.ts
export function parseValidationErrors(error: ApiError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};

  if (Array.isArray(error.message)) {
    error.message.forEach((msg) => {
      const match = msg.match(/^(\w+)\s/);
      if (match) {
        fieldErrors[match[1]] = msg;
      }
    });
  } else if (typeof error.message === 'string') {
    fieldErrors._global = error.message;
  }

  return fieldErrors;
}
```

---

## 6. Cart State Management

### 6.1 Pricing is in Cents

All price fields (`unitPrice`, `subtotal`, `CartResponse.subtotal`) are returned as **integers in cents**. Convert for display:

```typescript
function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// Examples:
formatPrice(2999);  // "$29.99"
formatPrice(5998);  // "$59.98"
formatPrice(0);     // "$0.00"
```

### 6.2 Cart Limit

The backend enforces a **maximum of 50 total items** (sum of all quantities, not distinct products). If a user tries to add more, the request fails with `400 Bad Request`.

```typescript
// Check before showing "Add to Cart" button
const canAddMore = cart.totalItems < 50;
```

### 6.3 Per-Item Quantity Limit

Each individual cart item has a maximum quantity of **50** (enforced by DTO validation). This matches the 50-item cart total limit.

### 6.4 Stock Validation

- **On add:** Backend checks `product.stock >= requested quantity`. If insufficient, returns `400`.
- **On update:** Backend checks `product.stock >= new quantity`. If insufficient, returns `400`.
- **availableStock** is returned with each cart item for UI display (e.g., "Only 3 left!").

### 6.5 Optimistic Updates (Recommended)

Cart operations are good candidates for optimistic updates since the user expects immediate feedback:

```typescript
export function useAddToCartOptimistic() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: addToCart,
    onMutate: async (newItem: AddToCartDto) => {
      await qc.cancelQueries({ queryKey: cartKeys.detail() });
      const previous = qc.getQueryData(cartKeys.detail());

      // Optimistically add the item (fetch product details for display)
      qc.setQueryData(cartKeys.detail(), (old: CartResponse | undefined) => {
        if (!old) return old;
        // Note: We don't know unitPrice/productTitle here without fetching product.
        // For a true optimistic update, you'd need the product data from the product list cache.
        // Simpler approach: just invalidate and let the refetch handle it.
        return old;
      });

      return { previous };
    },
    onError: (_err, _newItem, context) => {
      qc.setQueryData(cartKeys.detail(), context?.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: cartKeys.detail() });
    },
  });
}
```

> **Note:** Full optimistic updates for cart are tricky because the response includes denormalized product data (title, thumbnail, price) that the frontend may not have cached. The simpler pattern is to show a loading state and invalidate on success.

---

## 7. Caching & Invalidation Strategy

### 7.1 Cache Durations

| Query Type | `staleTime` | Rationale |
|------------|-------------|-----------|
| Cart detail | `30_000` (30 sec) | Cart changes frequently, user expects fresh data |

### 7.2 Invalidation Rules

| Mutation | Invalidates |
|----------|-------------|
| `addToCart` | `cartKeys.detail()` |
| `updateCartItem` | `cartKeys.detail()` |
| `removeFromCart` | `cartKeys.detail()` |
| `clearCart` | `cartKeys.detail()` |

### 7.3 Cross-Module Invalidation

When the user **adds a product to cart**, consider invalidating:
- Product list queries (to update stock display if shown)
- Product detail queries (same reason)

```typescript
// In your useAddToCart onSuccess:
onSuccess: () => {
  qc.invalidateQueries({ queryKey: cartKeys.detail() });
  // Optional: invalidate product queries to refresh stock
  qc.invalidateQueries({ queryKey: productsKeys.lists() });
  qc.invalidateQueries({ queryKey: productsKeys.details() });
},
```

---

## 8. Example Usage (Next.js / React)

### 8.1 Cart Badge in Header

```typescript
// components/Header.tsx
import { useCartCount } from '@/hooks/use-cart-count';
import { ShoppingCart } from 'lucide-react';
import Link from 'next/link';

export function Header() {
  const count = useCartCount();

  return (
    <header>
      <Link href="/cart" className="relative">
        <ShoppingCart />
        {count > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </Link>
    </header>
  );
}
```

### 8.2 Add to Cart Button (Product Page)

```typescript
// components/AddToCartButton.tsx
import { useState } from 'react';
import { useAddToCart } from '@/hooks/use-cart';
import type { Product } from '@/types/products';

interface AddToCartButtonProps {
  product: Product;
  maxQuantity?: number;
}

export function AddToCartButton({ product, maxQuantity }: AddToCartButtonProps) {
  const [quantity, setQuantity] = useState(1);
  const addToCart = useAddToCart();

  const isOutOfStock = product.stock === 0;
  const exceedsStock = quantity > product.stock;
  const exceedsLimit = quantity > (maxQuantity ?? 100);

  const handleAdd = async () => {
    try {
      await addToCart.mutateAsync({
        productId: product.id,
        quantity,
      });
      // Show success toast
    } catch (err: any) {
      // Show error toast from err.message
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setQuantity(Math.max(1, quantity - 1))}
          disabled={quantity <= 1}
        >
          -
        </button>
        <input
          type="number"
          value={quantity}
          onChange={(e) => setQuantity(Number(e.target.value))}
          min={1}
          max={Math.min(product.stock, maxQuantity ?? 100)}
        />
        <button
          onClick={() => setQuantity(quantity + 1)}
          disabled={quantity >= Math.min(product.stock, maxQuantity ?? 100)}
        >
          +
        </button>
      </div>

      <button
        onClick={handleAdd}
        disabled={isOutOfStock || exceedsStock || exceedsLimit || addToCart.isPending}
      >
        {addToCart.isPending ? 'Adding...' : 'Add to Cart'}
      </button>

      {exceedsStock && (
        <p className="text-red-500 text-sm">Only {product.stock} available</p>
      )}
    </div>
  );
}
```

### 8.3 Cart Page

```typescript
// app/cart/page.tsx
'use client';

import { useCart, useUpdateCartItem, useRemoveFromCart, useClearCart } from '@/hooks/use-cart';
import { formatPrice } from '@/lib/utils';
import Link from 'next/link';

export default function CartPage() {
  const { data: cart, isLoading } = useCart();
  const updateItem = useUpdateCartItem();
  const removeItem = useRemoveFromCart();
  const clearCart = useClearCart();

  if (isLoading) return <CartSkeleton />;
  if (!cart || cart.items.length === 0) return <EmptyCart />;

  const handleQuantityChange = async (productId: string, quantity: number) => {
    try {
      await updateItem.mutateAsync({ productId, dto: { quantity } });
    } catch (err: any) {
      // Show error toast
    }
  };

  const handleRemove = async (productId: string) => {
    try {
      await removeItem.mutateAsync(productId);
    } catch (err: any) {
      // Show error toast
    }
  };

  const handleClear = async () => {
    if (!confirm('Clear all items from your cart?')) return;
    try {
      await clearCart.mutateAsync();
    } catch (err: any) {
      // Show error toast
    }
  };

  return (
    <main className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Shopping Cart ({cart.totalItems} items)</h1>

      <div className="space-y-4">
        {cart.items.map((item) => (
          <div key={item.id} className="flex items-center gap-4 p-4 border rounded">
            {item.productThumbnail && (
              <img
                src={item.productThumbnail}
                alt={item.productTitle}
                className="w-20 h-20 object-cover rounded"
              />
            )}

            <div className="flex-1">
              <Link href={`/products/${item.productId}`} className="font-medium hover:underline">
                {item.productTitle}
              </Link>
              <p className="text-sm text-gray-500">{formatPrice(item.unitPrice)} each</p>
              {item.availableStock < item.quantity && (
                <p className="text-sm text-red-500">
                  Only {item.availableStock} available
                </p>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => handleQuantityChange(item.productId, item.quantity - 1)}
                disabled={item.quantity <= 1 || updateItem.isPending}
              >
                -
              </button>
              <span>{item.quantity}</span>
              <button
                onClick={() => handleQuantityChange(item.productId, item.quantity + 1)}
                disabled={item.quantity >= item.availableStock || updateItem.isPending}
              >
                +
              </button>
            </div>

            <p className="font-medium w-24 text-right">
              {formatPrice(item.subtotal)}
            </p>

            <button
              onClick={() => handleRemove(item.productId)}
              disabled={removeItem.isPending}
              className="text-red-500 hover:text-red-700"
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <div className="mt-8 border-t pt-6">
        <div className="flex justify-between items-center mb-4">
          <span className="text-lg font-medium">Subtotal</span>
          <span className="text-xl font-bold">{formatPrice(cart.subtotal)}</span>
        </div>

        <div className="flex gap-4">
          <Link
            href="/checkout"
            className="flex-1 bg-blue-600 text-white py-3 rounded text-center hover:bg-blue-700"
          >
            Proceed to Checkout
          </Link>
          <button
            onClick={handleClear}
            disabled={clearCart.isPending}
            className="px-6 py-3 border rounded hover:bg-gray-50"
          >
            Clear Cart
          </button>
        </div>
      </div>
    </main>
  );
}

function EmptyCart() {
  return (
    <main className="max-w-4xl mx-auto p-6 text-center">
      <h1 className="text-2xl font-bold mb-4">Your cart is empty</h1>
      <Link href="/products" className="text-blue-600 hover:underline">
        Continue Shopping
      </Link>
    </main>
  );
}
```

### 8.4 Cart Sidebar (Drawer)

```typescript
// components/CartDrawer.tsx
import { useCart, useRemoveFromCart } from '@/hooks/use-cart';
import { formatPrice } from '@/lib/utils';
import Link from 'next/link';

interface CartDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function CartDrawer({ open, onClose }: CartDrawerProps) {
  const { data: cart, isLoading } = useCart();
  const removeItem = useRemoveFromCart();

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-96 bg-white shadow-xl p-6 overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold">Cart ({cart?.totalItems ?? 0})</h2>
          <button onClick={onClose}>Close</button>
        </div>

        {isLoading ? (
          <CartDrawerSkeleton />
        ) : !cart?.items.length ? (
          <p className="text-gray-500">Your cart is empty</p>
        ) : (
          <>
            <div className="space-y-4">
              {cart.items.map((item) => (
                <div key={item.id} className="flex gap-3">
                  {item.productThumbnail && (
                    <img
                      src={item.productThumbnail}
                      alt={item.productTitle}
                      className="w-16 h-16 object-cover rounded"
                    />
                  )}
                  <div className="flex-1">
                    <p className="font-medium text-sm">{item.productTitle}</p>
                    <p className="text-xs text-gray-500">
                      {item.quantity} × {formatPrice(item.unitPrice)}
                    </p>
                    <p className="text-sm font-medium">{formatPrice(item.subtotal)}</p>
                  </div>
                  <button
                    onClick={() => removeItem.mutateAsync(item.productId)}
                    className="text-red-500 text-sm"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-6 border-t pt-4">
              <div className="flex justify-between font-bold mb-4">
                <span>Subtotal</span>
                <span>{formatPrice(cart.subtotal)}</span>
              </div>
              <Link
                href="/cart"
                onClick={onClose}
                className="block w-full bg-blue-600 text-white py-3 rounded text-center"
              >
                View Cart
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

---

## 9. Gotchas & Edge Cases

### 9.1 Pricing in Cents — Always Convert

The backend returns `unitPrice` and `subtotal` as **integers in cents** (e.g., `2999` for $29.99). This avoids floating-point issues but requires conversion for display:

```typescript
// ✅ Correct
const displayPrice = `$${(cartItem.unitPrice / 100).toFixed(2)}`;

// ❌ Wrong — will show "2999" instead of "$29.99"
const displayPrice = `$${cartItem.unitPrice}`;
```

### 9.2 Cart Auto-Created on First Access

If a user has never interacted with the cart, `GET /cart` will **auto-create** an empty cart and return it. The frontend does not need to handle a "no cart exists" state — the response is always a valid `CartResponse`.

### 9.3 Cart is Per-User, Not Per-Session

The cart is tied to the authenticated user's ID. There is **no guest cart** or session-based cart. If the user is not logged in, they cannot access cart endpoints (all return `401`).

**Recommendation:** Store cart items in `localStorage` for guest users, then sync to the backend cart after login.

### 9.4 Soft-Deleted Products in Cart

If a product is soft-deleted while in a user's cart:
- The product will still appear in `GET /cart` (via the relation join).
- `validateCartForCheckout` will flag it as an error.
- The frontend should check `availableStock` and product availability before allowing checkout.

### 9.5 Product Price Changes

If a product's price changes while in the cart:
- The cart **always uses the current product price** (fetched live on `GET /cart`).
- The `unitPrice` in the response reflects the **current** price, not the price at time of adding.
- **Frontend:** Show a notice if the price has changed since the user last viewed the cart (requires tracking the price at add-time in local state).

### 9.6 Concurrent Modifications

The backend handles concurrent cart modifications gracefully:
- If two requests try to add the same product simultaneously, the second will increment the existing item's quantity.
- If two requests try to create a cart simultaneously, the second will reuse the existing cart.
- The frontend should **not** need to handle these cases explicitly — just refetch the cart after mutations.

### 9.7 Rate Limiting on Mutations

`POST /cart/items` and `PATCH /cart/items/:productId` are rate-limited to **10 requests per 60 seconds**. If a user rapidly clicks "Add to Cart", they may hit this limit.

**Frontend mitigation:**
- Disable the "Add to Cart" button while the mutation is pending.
- Debounce rapid quantity changes.
- Show a friendly message on `429` responses.

### 9.8 Cart Clear is Idempotent

`DELETE /cart` is **idempotent** — it returns success even if the cart is already empty or doesn't exist. This is intentional: the checkout flow calls `clearCart` after a successful payment, and it should not throw an error if the cart was already cleared. The frontend does not need to check if the cart exists before calling this endpoint.

### 9.9 Checkout Flow Integration

Before proceeding to checkout, the backend validates the cart internally via `validateCartForCheckout` (called by `POST /payments/checkout-session`). The frontend should:
1. Fetch the cart (`GET /cart`).
2. Navigate to checkout.
3. Call `POST /payments/checkout-session` — the backend will validate the cart and return errors if any items are unavailable.
4. On success, redirect to the returned `checkoutUrl` (Stripe-hosted page).
5. After payment, the cart is automatically cleared by the backend.

> **See [Orders Integration Plan](./orders-integration-plan.md) for the full checkout flow and order lifecycle.**

### 9.10 Currency is Hardcoded

The `currency` field in `CartResponse` is always `"usd"`. If the application expands to multi-currency, this will need to be dynamic.

---

## Appendix A: Complete File Structure (Frontend)

```
frontend/
├── types/
│   └── cart.ts                     # All TypeScript interfaces
├── lib/
│   └── api/
│       ├── client.ts               # Axios instance (shared)
│       ├── cart.ts                 # Cart API functions
│       └── cart-keys.ts            # React Query keys
├── hooks/
│   ├── use-cart.ts                 # Cart query + mutation hooks
│   └── use-cart-count.ts           # Cart badge count hook
├── components/
│   ├── cart/
│   │   ├── cart-drawer.tsx         # Slide-out cart sidebar
│   │   ├── cart-item-row.tsx       # Single cart item display
│   │   ├── add-to-cart-button.tsx  # Product page add button
│   │   └── cart-badge.tsx          # Header cart icon with count
│   └── Header.tsx
└── app/
    └── cart/
        └── page.tsx                # Full cart page
```

---

## Appendix B: Quick Reference Card

```
┌─────────────────────────────────────────────────────────────────┐
│  CART MODULE — QUICK REFERENCE                                  │
├─────────────────────────────────────────────────────────────────┤
│  Base URL:    GET/POST/PATCH/DELETE /cart, /cart/items          │
│  Auth:        JWT required (all endpoints)                      │
│  Cart limit:  50 total items (sum of quantities)                │
│  Item limit:  50 per individual item                            │
│  Rate limit:  10 req/min on POST/PATCH /cart/items              │
│  Pricing:     Integers in cents (divide by 100 for display)     │
│  Currency:    Always "usd"                                      │
│  Auto-create: Cart created on first GET if not exists           │
│  Guest cart:  Not supported — requires authentication           │
│  Error shape: { statusCode, message, errors?, timestamp, path } │
│  Cart shape:  { id, userId, items[], totalItems, subtotal,      │
│                currency }                                        │
│  Item shape:  { id, productId, productTitle, productThumbnail,  │
│                unitPrice, quantity, subtotal, availableStock }   │
│  Clear cart:  Idempotent — safe to call even if cart is empty   │
│  Checkout:    POST /payments/checkout-session → Stripe redirect │
│  Concurrency: Handled server-side (upsert on duplicate items)   │
└─────────────────────────────────────────────────────────────────┘
```
