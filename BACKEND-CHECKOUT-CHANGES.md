# Backend Change: Add Embedded Checkout Support

## Endpoint
`POST /api/billing/checkout/subscription`

## Summary
Add optional `uiMode` field to the request body. When `uiMode: 'embedded'`, create the Stripe Checkout Session with `ui_mode: 'embedded'` and return `clientSecret` instead of `url`. This allows the frontend to render the Stripe payment form inside the app (iframe) instead of redirecting to `checkout.stripe.com`.

---

## Request Body (updated)

| Field                | Type    | Required | Default   | Constraints                                |
|----------------------|---------|----------|-----------|--------------------------------------------|
| `priceId`            | UUID    | ✅ Yes   | —         | Local recurring `BillingPrice` UUID        |
| `quantity`           | integer | —        | `1`       | 1–100                                      |
| `clientReferenceId`  | string  | —        | —         | Max 100 chars                              |
| `trialDays`          | integer | —        | —         | 1–730                                      |
| `allowPromotionCodes`| boolean | —        | `true`    | —                                          |
| **`uiMode`**         | string  | —        | `hosted`  | `'hosted'` or `'embedded'`                 |

### Example Request (embedded)
```http
POST /api/billing/checkout/subscription HTTP/1.1
Authorization: Bearer <access_token>
Idempotency-Key: a1b2c3d4-e5f6-7890-abcd-ef1234567890
Content-Type: application/json

{
  "priceId": "1d2b6c91-9b9b-4d1d-9c08-2f2a3b4c5d6e",
  "uiMode": "embedded",
  "quantity": 1,
  "allowPromotionCodes": true
}
```

### Example Request (hosted — unchanged)
```http
POST /api/billing/checkout/subscription HTTP/1.1
... (same headers)

{
  "priceId": "1d2b6c91-9b9b-4d1d-9c08-2f2a3b4c5d6e",
  "quantity": 1,
  "allowPromotionCodes": true
  // uiMode omitted → defaults to 'hosted'
}
```

---

## Response Shape

### When `uiMode: 'embedded'` (NEW)
```json
{
  "sessionId": "cs_test_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
  "clientSecret": "cs_test_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6_secret_xxx"
}
```

### When `uiMode: 'hosted'` or omitted (unchanged)
```json
{
  "sessionId": "cs_test_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
  "url": "https://checkout.stripe.com/c/pay/cs_test_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6#fidkdWxOYHwnPyd1blpxYHZxWjA0TjE0PWF..."
}
```

---

## Backend Logic Change

In your checkout service where you create the Stripe session:

```typescript
const sessionParams: Stripe.Checkout.SessionCreateParams = {
  mode: 'subscription',
  line_items: [{ price: stripePriceId, quantity }],
  customer: stripeCustomerId,
  allow_promotion_codes: allowPromotionCodes ?? true,
  metadata: { priceId: localPriceId /* ... */ },
};

if (uiMode === 'embedded') {
  // ── Embedded Checkout mode ──
  sessionParams.ui_mode = 'embedded';
  sessionParams.return_url = `${successUrl}?session_id={CHECKOUT_SESSION_ID}`;
  // NOTE: use return_url, NOT success_url/cancel_url

  // Optional: match the app's dark theme
  sessionParams.embedded_checkout = {
    appearance: { theme: 'night' },
  };
} else {
  // ── Hosted Checkout mode (existing, unchanged) ──
  sessionParams.success_url = `${successUrl}?session_id={CHECKOUT_SESSION_ID}`;
  sessionParams.cancel_url = cancelUrl;
}
```

Then in your response mapping:
```typescript
if (uiMode === 'embedded') {
  return {
    sessionId: session.id,
    clientSecret: session.client_secret,  // ← new field
  };
}
return {
  sessionId: session.id,
  url: session.url,  // ← existing field
};
```

---

## Important Notes

1. **`return_url` vs `success_url`:** For embedded mode, Stripe requires `return_url` instead of `success_url`/`cancel_url`. The frontend handles the return via the embedded component's `onComplete` callback. Set `return_url` to: `https://yourdomain.com/checkout/success?session_id={CHECKOUT_SESSION_ID}`

2. **Stripe API version:** `ui_mode: 'embedded'` requires API version 2023-10-16+. Your current version `2026-05-27.dahlia` fully supports it.

3. **Dark theme appearance:** Use `embedded_checkout.appearance.theme: 'night'` so the embedded form matches the app's dark UI.

4. **No `payment_method_types`:** Continue omitting this parameter (let Stripe dynamically show eligible payment methods per best practices).

5. **Idempotency-Key:** Continue requiring it as before. No change.

6. **Validation unchanged:** All existing validations still apply (price active, plan not archived, no duplicate subscription, etc.).

7. **Error responses:** All existing error codes remain the same (400, 401, 404, 409).

8. **Backward compatible:** When `uiMode` is omitted or set to `'hosted'`, behavior is identical to before.

---

## Files likely affected (backend)

| File | Change |
|------|--------|
| `src/billing/dto/billing-subscription-checkout-request.dto.ts` | Add `uiMode?: 'hosted' \| 'embedded'` field |
| `src/billing/services/billing-checkout.service.ts` | Branch on `uiMode` when creating Stripe session |
| `src/billing/controllers/billing.controller.ts` | Possibly no change (handled by DTO + service) |
| `src/billing/dto/checkout-response.dto.ts` (if exists) | Add `clientSecret` field to response |

---

## Testing Checklist

| Scenario | uiMode | Expected |
|----------|--------|----------|
| Subscription checkout (embedded) | `'embedded'` | `{ sessionId, clientSecret }` |
| Subscription checkout (hosted) | `'hosted'` | `{ sessionId, url }` |
| Subscription checkout (default) | omitted | `{ sessionId, url }` (backward compat) |
| Missing `priceId` | either | `400` |
| One-time price on subscription endpoint | either | `409` |
| Price not found | either | `404` |
| User has active subscription | either | `409` |
