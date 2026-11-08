## Cashless Payments (verified e-wallet and QR) [Planned, needs research]

Today GCash is only a **label**. The cashier or the customer says "GCash", the order records it, and nobody (not the app,
not the API) checks that the money arrived. For a customer-link order the customer picks GCash and the shop trusts it.
"True cashless" means the app **knows** a payment succeeded, from the payment provider, before an order counts as paid.

| Phase | Name                                      | Status    |
| ----- | ----------------------------------------- | --------- |
| 1     | Payment records and reconciliation        | [Planned] |
| 2     | Dynamic QR at the POS (confirmed by webhook) | [Planned] |
| 3     | Online payment on the customer link       | [Planned] |
| 4     | Refunds, tips and multi-tenant payouts    | [Planned] |

### Decision: use a licensed payment provider, never handle money or card data ourselves

- Pick an aggregator that offers GCash, Maya, QR Ph and cards through one API, with hosted checkout pages and webhooks.
  Candidates to compare (verify current availability, fees, settlement time, onboarding rules and refund support before
  choosing): PayMongo, Xendit, Maya Business, and a direct GCash for Business account. Do not assume any of these
  details from this document.
- Card numbers, e-wallet credentials and bank details never touch our servers or logs: the customer pays on the provider's
  page or their own app, and we receive a signed notification. This keeps us out of the heaviest compliance scope.
- Keep a `IPaymentProvider` interface (create payment, get status, refund, verify webhook) with one implementation, so the
  provider can be changed or a second one added without touching order code.

### Phase 1 - Payment records and reconciliation [Planned]

- New `OrderPayments` table (`OrderId`, `Method`, `Provider`, `ProviderReference`, `Amount`, `Tip`, `Status`
  [Pending, Succeeded, Failed, Expired, Refunded, PartiallyRefunded], `CreatedAt`, `PaidAt`, `RawEventId`). An order has
  one or more payments (split payment is a later option). `Orders.PaymentMethodId` stays for old data and for cash.
- **Money rule:** an order paid by e-wallet counts as a sale only when a payment is `Succeeded`. Add this to
  `WTF.Calculations` (`SalesRules`/a new `PaymentRules`) with shared Angular cases, not in a handler. Cash behaves as today.
- **Reconciliation report** (Reports > Operations): per day and per method, sales recorded vs payments confirmed by the
  provider, with the unmatched ones listed (recorded as GCash but never confirmed, confirmed but no order). This is useful
  even before the full integration, to catch honest mistakes and theft with manually recorded GCash.
- **Manual GCash stays as a fallback** (internet down, provider down) marked "unverified"; those payments show in the
  reconciliation list until someone confirms them against the statement, and the confirmation is audited (`PaymentConfirmed`).
- **Calculations:** amount due = total + tip (already decided for cash). Fees charged by the provider are stored per payment
  (`ProviderFee`) so net takings can be reported; the arithmetic goes in `WTF.Calculations`.
- Tests: status transitions, a sale not counted until `Succeeded`, duplicates ignored, the report totals.

### Phase 2 - Dynamic QR at the POS [Planned]

- At checkout, choosing GCash/Maya/QR Ph asks the provider for a **dynamic QR for the exact amount** (total + tip) and shows
  it full screen for the customer to scan. The payment starts `Pending`.
- **The webhook is the proof.** `POST /api/payments/webhook/{provider}` (anonymous route, so it goes in the route snapshot
  tests): verify the provider's signature on the raw body, reject old timestamps, store the event id and ignore a repeat
  (idempotent), then mark the payment `Succeeded` and complete the order in one transaction (through the shared order path,
  so stock, promotion usage and audit behave as for any sale). Never trust the browser or the app saying "paid".
- The POS screen updates by SignalR (and a polling fallback) when the webhook arrives; the cashier sees "Paid" and the order
  completes. A QR expires after a few minutes; the cashier can regenerate it or switch to cash.
- **Offline:** a dynamic QR cannot be created offline. Cashless is unavailable offline except the manual "unverified GCash"
  fallback described above (which the offline sync review flags). Show clearly in the checkout when cashless is unavailable.
- A static store QR (one code, customer types the amount) is **not** verifiable per order; do not treat it as cashless.
- Race cases to test: webhook arrives before the app polls, twice, late after the order was cancelled (auto-refund or hold for
  review), the amount differs from the order total (hold, never auto-complete), and expired QR paid anyway.
- Staff roles: cashiers can take payments; confirming an unverified payment and refunds need Admin (`PaymentsManage` policy,
  add to `PolicyMatrixTests`).

### Phase 3 - Online payment on the customer link [Planned]

- At checkout, the customer pays inside the flow (hosted payment page or e-wallet redirect). The order is created as
  `PendingApproval` as today, with a `Pending` payment; the shop approves, and a payment confirmed before approval is held.
  Decide: charge at order time (refund if rejected) or at acceptance (authorize and capture); the first is simpler, the second
  avoids refunds. Confirm what the provider supports before deciding.
- Rejecting a paid order **refunds automatically** (Phase 4); the customer's My orders shows "Payment received / refunded".
- Public routes get the same hardening as the rest of the public page: link check, rate limits, 404 for invalid state, no
  provider secrets or other customers' payments in any response. The server recomputes the amount; the client never sends it.
- Cash and "pay at pickup" remain options per branch.

### Phase 4 - Refunds, tips and multi-tenant payouts [Planned]

- **Refunds.** Voiding or rejecting a paid order starts a provider refund (full or partial), recorded on `OrderPayments`,
  audited, and shown on the order and in the Voids and Refunds report. If the provider refund fails, the order stays in a
  "refund pending" state for staff to resolve. Note the provider may not support refunds for every method.
- **Tips.** Resolves the open "GCash tips" item (Sales Reporting Phase 3): the tip is part of the amount sent, paid with the
  order, and the Payments report splits tips by method so they reconcile against the provider payout.
- **Settlement report.** Provider payouts arrive net of fees, days later, in batches. Import the provider's settlement list
  (or fetch it by API) and match payouts to payments, so the owner sees money expected vs money received.
- **Multi-tenant money (decide before selling cashless to other stores).** Two models:
  1. **Each store has its own provider account** (their business, their verification, money goes straight to them). We store
     only their API keys, encrypted, per tenant (key vault or encrypted column, never in logs or plain settings). Least risk
     for us; the store does the paperwork.
  2. **We collect for all stores** (sub-merchants or a marketplace account), then pay them out. Smoother for the store but
     it can make us a regulated payments intermediary; needs legal advice and the provider's platform product. Do not start
     here.
  Recommended: model 1. Webhooks then need a per-tenant endpoint or secret (`/api/payments/webhook/{provider}/{tenantKey}`)
  so the tenant comes from the verified route, not the payload.
- **Per branch:** each branch may have its own QR/terminal reference so settlement can be reported per branch.

### Risks and rules

- Never mark an order paid from client input; only a verified webhook (or an audited manual confirmation) does.
- Store provider secrets encrypted and per tenant; rotate on staff or owner change; never return them to the browser.
- Log payment events without personal or card data; keep the raw webhook body for a limited time for disputes.
- Provider downtime must not stop the shop: cash and the unverified fallback stay available, and an outage banner explains.
- Check the legal side: receipts for e-wallet sales, provider terms for refunds and chargebacks, and the Data Privacy Act for
  stored payer details (store only what the provider gives and the shop needs).
- Real tests need the provider's sandbox: a separate `Sandbox` configuration used by the throwaway-database checks, with the
  provider's published test numbers only (never real accounts).

### Open questions

- Which provider (fees, settlement time, onboarding, support for dynamic QR and refunds), and does the owner already have a
  GCash for Business or bank account to start from?
- Charge the provider fee to the shop (assumed) or add a convenience fee for the customer?
- Is cashless at the POS or on the customer link the first priority? (Recommended order above: record and reconcile, then
  POS QR, then the customer link.)

---

