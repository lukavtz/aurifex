# Payments: Stars invoice to fulfilment

**Goal.** Take Stars for a digital product and grant the entitlement exactly once.

**Read this when.** The spec asks for a paid feature, a subscription, paid media,
or a product catalog sold for Stars.

Policy, refunds, subscriptions, and provider payments are owned by
`../../telegram-payments/SKILL.md`. This file covers the three handler steps and
the data rule that makes them safe.

## The flow

```
order row (pending) -> invoice -> pre_checkout_query (<=10 s, fail closed)
                    -> successful_payment -> payment row + entitlement (one tx)
```

## Steps

1. **Price on the server.** The amount, currency, and product come from your
   database. `payload` is an opaque order id of 1–128 bytes: no price, no user id,
   no JSON that grants anything.
2. **Send the invoice.** `sendInvoice` into the chat or `createInvoiceLink` when
   the link must be reused (Mini App, button, broadcast). Stars use
   `currency="XTR"`, empty `provider_token`, and exactly one element in `prices`.
3. **Answer `pre_checkout_query` within 10 seconds.** Validate payload, amount,
   currency, product availability, and buyer eligibility. On failure reply with
   `ok: false` and a human `error_message`. Never grant anything here; this is a
   question, not a payment.
4. **Grant on `successful_payment` only.** The payer is `from.id` of that message.
   Insert a payment row with a unique constraint on `telegram_payment_charge_id`,
   move the order to `paid`, create the entitlement, and write the outbox message
   in one transaction.
5. **Make every step idempotent.** A repeated `successful_payment` with the same
   charge id returns the existing result. Two forwarded copies of one invoice can
   produce two different charge ids for two different payers; each is a separate
   payment.
6. **Refuse unknown payloads.** A payload that matches no pending order is refused
   in pre-checkout with a neutral message.

## grammY / TypeScript

```ts
bot.on("pre_checkout_query", async (ctx) => {
  const query = ctx.preCheckoutQuery;
  const order = await orders.findByPayload(query.invoice_payload);
  const valid =
    order !== null &&
    order.status === "pending" &&
    order.amount === query.total_amount &&
    query.currency === "XTR" &&
    (await products.isAvailable(order.productId));

  await ctx.answerPreCheckoutQuery(
    valid,
    valid ? undefined : "Заказ недоступен. Создайте новый счёт.",
  );
});

bot.on("message:successful_payment", async (ctx) => {
  const payment = ctx.message.successful_payment;
  const result = await billing.settle({
    chargeId: payment.telegram_payment_charge_id,
    providerChargeId: payment.provider_payment_charge_id,
    payload: payment.invoice_payload,
    amount: payment.total_amount,
    currency: payment.currency,
    payerId: ctx.from.id,
  });
  // settle: unique(charge_id) insert + order paid + entitlement + outbox in one tx.
  await ctx.reply(result.alreadySettled ? "Платёж уже учтён." : "Оплачено. Доступ открыт.");
});
```

Creating the invoice from an order row:

```ts
await ctx.api.sendInvoice(
  ctx.chat.id,
  "Доступ на 30 дней",
  "Оплата в Stars",
  order.payload,
  "XTR",
  [{ label: "Доступ", amount: order.amount }],
);
```

## aiogram / Python

```python
from aiogram.types import Message, PreCheckoutQuery

@router.pre_checkout_query()
async def pre_checkout(query: PreCheckoutQuery, orders: OrdersRepo, products: Products) -> None:
    order = await orders.find_by_payload(query.invoice_payload)
    valid = (
        order is not None
        and order.status == "pending"
        and order.amount == query.total_amount
        and query.currency == "XTR"
        and await products.is_available(order.product_id)
    )
    await query.answer(ok=valid, error_message=None if valid else "Заказ недоступен.")
```

```python
@router.message(F.successful_payment)
async def paid(message: Message, billing: Billing) -> None:
    payment = message.successful_payment
    result = await billing.settle(
        charge_id=payment.telegram_payment_charge_id,
        provider_charge_id=payment.provider_payment_charge_id,
        payload=payment.invoice_payload,
        amount=payment.total_amount,
        currency=payment.currency,
        payer_id=message.from_user.id,
    )
    await message.answer("Платёж уже учтён." if result.already_settled else "Оплачено. Доступ открыт.")
```

Invoice as a link, for a Mini App or a button:

```python
link = await bot.create_invoice_link(
    title="Доступ на 30 дней",
    description="Оплата в Stars",
    payload=order.payload,
    currency="XTR",
    prices=[LabeledPrice(label="Доступ", amount=order.amount)],
)
```

## Schema

```sql
CREATE TABLE payments (
  id bigserial PRIMARY KEY,
  telegram_payment_charge_id text NOT NULL UNIQUE,
  provider_payment_charge_id text,
  payer_user_id bigint NOT NULL,
  order_id uuid NOT NULL REFERENCES orders(id),
  amount integer NOT NULL CHECK (amount > 0),
  currency text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE entitlements (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL,
  feature text NOT NULL,
  source_payment_id bigint NOT NULL REFERENCES payments(id),
  valid_until timestamptz,
  revoked_at timestamptz,
  UNIQUE (source_payment_id, feature)
);
```

The unique constraint is the idempotency mechanism. Application code that checks
"already settled?" without the constraint still races under two concurrent
deliveries.

## Failure handling

- Pre-checkout slower than 10 seconds: the transaction is cancelled. Do the
  validation with a single indexed read, no external calls.
- Payment arrives for a cancelled or refunded order: record it, refuse the
  entitlement, alert the operator. Do not silently drop money.
- Notification fails: the entitlement is already committed; retry through the
  outbox, never re-run `settle`.
- User paid twice for one product: keep both payments, keep one entitlement, offer
  a refund per the payments skill.

## Checks

- A pre-checkout for a stale payload is refused within the window.
- Amount mismatch is refused; currency other than `XTR` is refused.
- `successful_payment` delivered twice creates one payment and one entitlement.
- Two concurrent deliveries with the same charge id produce one row and no error.
- An unknown charge's payload leaves no entitlement.
- The reply after payment is produced from the committed state, not from the
  invoice payload.
