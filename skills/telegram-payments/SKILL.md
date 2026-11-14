---
name: telegram-payments
description: Use when selling digital goods with Telegram Stars, handling pre-checkout and successful payment updates, refunds, subscriptions, or paid media. Русские триггеры: оплата звёздами, Telegram Stars, платёжный бот, подписка в боте, возврат звёзд.
---

# Telegram Stars payments

Digital goods and services inside Telegram are sold in **Telegram Stars** (currency
`XTR`). Do not route them through a card provider or a crypto checkout. Physical
goods use a provider connected in BotFather.

## Procedure

1. Define the products server-side: id, title, description, whole-star price
   (1–10000), one-time or subscription. An empty product list means no invoice can
   be created; fail the command with a message instead of sending a zero-price one.
2. Create the invoice with `sendInvoice` in a chat, or `createInvoiceLink` for a
   link or a Mini App. Currency is `XTR`, `payload` is 1–128 bytes.
3. Handle `pre_checkout_query`: validate the payload against stored state, then
   answer within **10 seconds**. Fail closed on any doubt.
4. Handle `successful_payment`: claim `telegram_payment_charge_id` in a unique
   constraint, then grant.
5. Store a purchases and entitlements ledger; reconcile against
   `getStarTransactions` (`limit` 1–100) rather than trusting the client.
6. Implement refund (`refundStarPayment`) and revocation keyed by charge id.
7. Answer `/paysupport` and publish terms.

## Pre-checkout

```ts
bot.on("pre_checkout_query", async (ctx) => {
  const q = ctx.preCheckoutQuery;
  const invoice = await loadInvoice(q.invoice_payload);
  const valid =
    invoice !== null &&
    invoice.userId === q.from.id &&
    invoice.amount === q.total_amount &&
    q.currency === "XTR" &&
    !invoice.claimed;
  await ctx.answerPreCheckoutQuery(
    valid,
    valid ? undefined : { error_message: "This offer is no longer available." },
  );
});
```

`answerPreCheckoutQuery` is `ok: true` with no error, or `ok: false` with a short
human-readable `error_message`. Never leave the query unanswered; a timeout cancels
the payment. Fail closed: when the lookup throws, answer `ok: false`, do not swallow
the error and let the query expire.

## Granting

```ts
bot.on("message:successful_payment", async (ctx) => {
  const p = ctx.message.successful_payment;
  await grantOnce({
    chargeId: p.telegram_payment_charge_id,
    payload: p.invoice_payload,
    amount: p.total_amount,
    currency: p.currency,
  });
});
```

`grantOnce` inserts the charge id under a unique constraint and grants in the same
transaction. A duplicate delivery hits the constraint and is a no-op, not a second
grant. Never grant on `pre_checkout_query`, a Mini App callback, or a redirect.

## Invoice rules

- Currency is `XTR`.
- Stars invoices omit the provider token, or pass an empty string where the
  framework requires the field. Check the installed framework type.
- `prices` is a list of `{ label, amount }`. Stars `amount` is the whole number of
  Stars, not minor units, and each product price is at most **10000**.
- `payload` is your opaque key, 1–128 bytes. Store what it refers to server-side; do
  not trust a client-provided price.
- `provider_token` is for physical goods and third-party providers only.
- Use `protect_content` when the paid content can be forwarded.
- `is_flexible` is for physical goods; digital Stars invoices are fixed.
- Paid media uses `createInvoiceLink` with `subscription_period` or the paid-media
  path; read the method page before implementing.

## Subscriptions

- A recurring Stars invoice sets `subscription_period` to **2592000** seconds
  (30 days); Telegram rejects other values.
- Model renewal, cancellation, expiry, and failed renewal as explicit state
  transitions on your side. Telegram charges; it does not manage entitlements.
- Cancel means stop the next charge and decide explicitly whether the current
  period stays active.
- A subscription product still needs its price in whole Stars, ≤10000.

## Idempotency and ledger

- The `successful_payment` update can be delivered more than once. Claim the charge
  id before granting.
- Keep your own purchases and entitlements ledger. Telegram's transaction list is
  for reconciliation, not the source of truth.
- If granting fails after payment, record a pending grant and retry. Do not tell the
  user they were not charged.
- Refund with `refundStarPayment` and revoke the grant in one transaction keyed by
  charge id. Refund losses come from the bot balance.
- A page or Mini App claiming "paid" is not proof. Only the bot's
  `successful_payment`, or the transaction list, is.

## User support

- Answer `/paysupport` with a real support path and the refund policy.
- Provide `/terms` or a link to terms.
- Handle disputes; if you cannot deliver, refund.
- Taxes and consumer-law obligations are yours.

## Security

- Never log payment payloads, charge ids with personal data, or the bot token.
- Verify the invoice payload belongs to the paying user and is still valid at
  pre-checkout and at grant time.
- Reject an amount or currency that differs from your stored invoice.
- Do not grant on a client callback or a redirect.
- Rate-limit invoice creation per user.

## Testing

Test in Telegram's test environment with a separate test bot and chat. Cover:

- pre-checkout rejected with an error message;
- pre-checkout answered after 10 seconds (fake clock);
- duplicate `successful_payment` grants once;
- grant failure after payment leaves a retryable record;
- refund revokes the entitlement;
- a forged `successful_payment` fixture with an unknown charge id is rejected;
- an amount mismatch is rejected;
- an empty product list produces no invoice.

Fixtures: `pre_checkout.json` and `successful_payment.json`. Never put a real token
or charge id in a fixture.

## Gotchas

- Answering pre-checkout with `ok: true` and then failing to grant leaves the user
  charged with nothing delivered. Validate before the answer, and keep the grant
  retryable.
- `total_amount` is in Stars for `XTR`; treating it as minor units under-charges by
  100×.
- The `successful_payment` update can arrive while the pre-checkout handler is still
  running. Both paths must tolerate concurrency.
- Refunds do not revoke access by themselves. Revoke in the same transaction.
- `getStarTransactions` pages; `limit` is 1–100, and offset-based paging can shift.
  Page by the returned transaction id.
- Missing `provider_token` is correct for Stars and wrong for physical goods.

## Checklist

- [ ] `XTR` only for digital goods.
- [ ] Pre-checkout answered within 10 seconds, fail-closed.
- [ ] Grant only on `successful_payment`, keyed by charge id.
- [ ] Amount and currency checked against the stored invoice.
- [ ] Subscription period 2592000 when recurring.
- [ ] Refund path revokes the grant.
- [ ] `/paysupport` and terms exist.
- [ ] No payment data in logs.

## Sources

- https://core.telegram.org/bots/payments-stars
- https://core.telegram.org/bots/api#sendinvoice
- https://core.telegram.org/bots/api#answerprecheckoutquery
- https://core.telegram.org/bots/payments
