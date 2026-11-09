---
name: telegram-payments
description: Use when selling digital goods with Telegram Stars, handling pre-checkout and successful payment updates, refunds, subscriptions, or paid media.
---

# Telegram Stars payments

Digital goods and services inside Telegram are sold in **Telegram Stars** (currency
`XTR`). Do not route them through a card provider or a crypto checkout. Physical
goods use a provider connected in BotFather.

## Flow

1. Create the invoice with `sendInvoice` in a chat, or `createInvoiceLink` for a
   link or Mini App.
2. Telegram sends `pre_checkout_query`. Validate and answer with
   `answerPreCheckoutQuery` within **10 seconds**.
3. Telegram sends a message containing `successful_payment`.
4. Grant only after that update, and store
   `telegram_payment_charge_id` with the grant.

```ts
bot.on("pre_checkout_query", async (ctx) => {
  const q = ctx.preCheckoutQuery;
  const valid = await invoiceIsStillValid(q.invoice_payload);
  await ctx.answerPreCheckoutQuery(
    valid,
    valid
      ? undefined
      : {
          error_message: "This offer is no longer available.",
        },
  );
});
```

`answerPreCheckoutQuery` is `ok: true` with no error, or `ok: false` with a short
human-readable `error_message`. Never leave the query unanswered; a timeout cancels
the payment.

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

## Invoice rules

- Currency is `XTR`.
- Stars invoices omit the provider token, or pass an empty string where the
  framework requires the field. Check the installed framework type.
- `prices` is a list of `{ label, amount }`. Stars `amount` is the whole number of
  Stars, not minor units.
- `payload` is your opaque key, 1–128 bytes. Store what it refers to server-side;
  do not trust a client-provided price.
- `provider_token` is for physical goods and third-party providers only.
- Use `protect_content` when the paid content can be forwarded.
- `is_flexible` is for physical goods; digital Stars invoices are fixed.

## Idempotency and ledger

- The `successful_payment` update can be delivered more than once. Claim the charge
  id with a unique constraint before granting.
- Keep your own purchases and entitlements ledger. Telegram's transaction list is
  for reconciliation, not the source of truth.
- If granting fails after payment, record a pending grant and retry. Do not tell the
  user they were not charged.
- Refund with `refundStarPayment` and revoke the grant in one transaction keyed by
  charge id. Refund losses come from the bot balance.
- A page or Mini App claiming "paid" is not proof. Only the bot's
  `successful_payment`, or the transaction list, is.

## Subscriptions and paid media

- Subscription invoice links create recurring charges. Handle renewal, cancellation,
  expiry, and failed renewal as explicit state transitions.
- Paid media uses its own methods and update fields. Read the current method page
  before implementing.
- Private-chat topics can add a non-refundable fee to Stars purchases. Check the
  current developer terms and tell the owner before enabling them.

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
- Do not grant on `pre_checkout_query`, on a client callback, or on a redirect.
- Rate-limit invoice creation per user.

## Testing

Test in Telegram's test environment with a separate test bot and chat. Cover:

- pre-checkout rejected with an error message;
- pre-checkout answered after 10 seconds (fake clock);
- duplicate `successful_payment` grants once;
- grant failure after payment leaves a retryable record;
- refund revokes the entitlement;
- a forged `successful_payment` fixture with an unknown charge id is rejected;
- an amount mismatch is rejected.

Fixtures: `pre_checkout.json` and `successful_payment.json`. Never put a real token
or charge id in a fixture.

## Checklist

- [ ] `XTR` only for digital goods.
- [ ] Pre-checkout answered within 10 seconds.
- [ ] Grant only on `successful_payment`.
- [ ] Charge id unique.
- [ ] Amount and currency checked against stored invoice.
- [ ] Refund path revokes the grant.
- [ ] `/paysupport` and terms exist.
- [ ] No payment data in logs.

## Sources

Adapted from `nyxandro/telegram-bot-development-skill` (MIT),
`nzhulikov/telegram-bot-skills` (Apache-2.0), and Telegram Bot API and Stars
documentation. See `THIRD_PARTY_NOTICES.md`.
