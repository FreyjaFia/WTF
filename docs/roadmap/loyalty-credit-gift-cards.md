## Gift Cards and Store Credit [Planned, 17 Nov 2026]

**Scope (Pogi, 18 Nov 2026): gift cards and store credit only.** Loyalty points and stamp cards ("buy 10, get one free") are
parked; see "Parked" at the end. The file keeps its first name so links keep working.

Two ways a customer holds **value** the shop owes them: a **gift card** anyone can buy and anyone can spend, and **store
credit** that belongs to a named customer (a refund kept as credit, a top-up, a goodwill gift). They look alike on a
screen but differ for the law, the books and fraud, so they share one foundation (a ledger and a tender line) and keep their
own rules.

| Phase | Name                                         | Size | Status    |
| ----- | -------------------------------------------- | ---- | --------- |
| 0     | Decisions and accountant check               | -    | [Planned] |
| 1     | Foundation: ledgers, tender lines, settings, gating | L | [Planned] |
| 2     | Store credit                                 | M    | [Planned] |
| 3     | Gift cards                                   | L    | [Planned] |
| 4     | Reports, Daily Close and liability           | M    | [Planned] |
| 5     | Later: online sale, offline spend, printed batches | L | [Idea]  |

Recommended order: 1, 2, 3, 4. Credit first because it is simpler (a named customer, no codes) and proves the tender work;
gift cards carry the most money risk.

### What exists today (checked in the code, 17 Nov 2026)

- **Payment is one label on the order.** `Orders.PaymentMethodId` is Cash (1) or GCash (2), plus `AmountReceived`,
  `ChangeAmount`, `Tips`. There is no tender line, so a split payment cannot be recorded. `WTF.Calculations/Sales/CashPayment.cs`
  holds the cash rule (amount due = total + tip).
- **The Cashless Payments plan already proposes `OrderPayments`** (order, method, amount, tip, status). This plan reuses that
  table; the build order says who creates it first.
- **Discounts run in a fixed order** in `WTF.Calculations/Orders`: line prices, promotions, then the Senior/PWD discount, then
  the total. The API recomputes and is the authority; the POS only previews.
- **Order states:** Pending, Completed, Cancelled, Refunded, PendingApproval, PendingReview. `OrderStatuses.Unconfirmed` is
  the one list of "not a sale yet". A void goes through `VoidOrderHandler`; a held offline sale is not a sale until approved.
- **Offline sync** keys every queued order with `OfflineLocalId` (unique) so a repeat sync returns the saved order.
- **Multi-tenancy is on** (`TenantId` + global filters). **Multiple branches** is built in parallel: customers and catalog are
  shared by the shop; orders, stock, cash and the Daily Close are per branch.
- **Plan gating** is `PlanFeatures` (keys with `Needs`), narrowed by roles.
- The promotions plan (`promotions.md` #15) already says a gift card is "a payment method with a balance; needs a ledger,
  refunds and fraud checks".
- The existing `LoyaltyPoints` table and loyalty link are left alone by this plan.

### Decisions this plan makes (change them if Pogi disagrees)

1. **A balance is never an editable number.** Every change is one append-only ledger row (who, when, why, amount, order or
   card). The balance is the sum of the rows; a cached balance row exists for speed and locking, and a nightly check
   recomputes it and raises a notification on any difference. Corrections are new rows.
2. **Spending value is a tender, not a discount.** The order total is worked out first (promotions, Senior/PWD, tip rules),
   then paid with one or more tender lines: cash, GCash, store credit, gift card. Spending never changes the sale amount,
   discount reports, VAT-exempt amount or promotion limits.
3. **Selling a gift card or topping up credit is not a sale.** It is a liability. It is recorded in its own table, never as an
   order, so product and sales reports do not move. Revenue is recognized when the value is spent. Cash taken shows in the
   Daily Close as its own line. (Accountant to confirm, Phase 0.)
4. **Stored value cannot buy stored value.** A card or credit is bought with cash or GCash only.
5. **Online only to start.** Spending credit or a card needs a connection (see "Offline and double-spend").
6. **The API is the authority** for every balance. The POS shows a preview from cached data and shared calculations, but the
   server locks the account and checks the balance when the order is saved.

### Rules in `WTF.Calculations` (and `shared/calculations`, same sample cases)

Whole cents like `money.ts`, tested in `WTF.Tests` against `calculation-cases.json` on both sides:

- `StoredValueRules`: split of an order total into tender lines (order of use, remainder to cash or GCash), what each tender
  may cover (no tips), refund routing (back to the same instrument), expiry dates, partial use and zero-balance state.
- `PaymentRules` (shared with the Cashless plan): "paid" means the tender lines add up to total + tip; payment reports split by
  tender line.

Order for one order, so POS and API agree: line prices, add-ons, promotions, Senior/PWD, total, tip, then tenders.

### Data model (script under `tools/sql`, idempotent; run on `.\SQLEXPRESS`, then `tools\dbsync.bat`)

All tables carry `TenantId` and the global filter, join the tenant lists of the platform export and delete, and are
configured in `WTFDbContext.Tenancy.cs`. Amounts are `decimal(18,2)`. After branches land, rows tied to a place also carry
`BranchId` (from the order or sale, never from the body).

| Table | Purpose and key columns |
| ----- | ----------------------- |
| `CreditLedger` | `CustomerId`, `Kind` (TopUp, RefundToCredit, Spend, ReturnSpend, Adjust, Expire), `Amount` (signed), `OrderId?`, `StoredValueSaleId?`, `Reason`, audit columns, `BranchId?`, `IdempotencyKey` (unique per tenant). |
| `CreditBalances` | Cached `CustomerId` -> `Balance`, `RowVersion`, check `Balance >= 0`. Written in the same transaction as the ledger row. |
| `GiftCards` | `Id`, `CodeHash` (HMAC-SHA256 with a server secret), `CodeLast4`, `InitialAmount`, `Balance` (cached) with `RowVersion` and check `Balance >= 0`, `Status` (Inactive, Active, Void, Expired, Used), `ExpiresAt?`, `IssuedAt`, `IssuedBy`, `SoldBranchId?`, `OwnerCustomerId?`, `Note`. The code is shown once and never stored in plain text. |
| `GiftCardLedger` | `GiftCardId`, `Kind` (Issue, Spend, ReturnSpend, Adjust, Void, Expire, Reissue), `Amount` (signed), `OrderId?`, `BranchId?`, `Reason`, audit columns, `IdempotencyKey`. |
| `StoredValueSales` | One row per card sale or credit top-up: `Kind`, `Amount`, `CustomerId?`, `GiftCardId?`, tender (cash or GCash only), `BranchId?`, `CreatedBy`, `OfflineLocalId?`. What the Daily Close and liability report read. |
| `OrderPayments` | Shared with Cashless Phase 1: `OrderId`, `Method` (Cash, GCash, StoreCredit, GiftCard), `Amount`, `Tip`, `GiftCardId?`, `Reference`, `Status`, `CreatedAt`. `Orders.PaymentMethodId` stays for old rows and holds the largest tender for new ones. New `PaymentMethods` rows (3 StoreCredit, 4 GiftCard) are fixed setup and go in the staging reset keep list. |
| `StoredValueSettings` | Per shop: card amount presets and min/max, gift card expiry months (default none), credit expiry (default none), who may refund to credit, daily cap on manual adjustments per user. |

Why cached balance tables and not a column on `Customers`: a lock and a check constraint sit on a row that exists only for
this, and the customer table stays free of money.

### Checkout: how a tender line works

1. The cashier finishes the cart; the POS shows the total (promotions and Senior/PWD applied) and a **Pay** panel.
2. The panel lists cash and GCash always; **Store credit** when a customer is chosen and has a balance; **Gift card** after
   typing or scanning a code. Each shows its balance and the amount it will cover (default: as much as allowed, editable
   down). The rest goes to cash or GCash with the existing change rules.
3. **Tips are paid in cash or GCash only**, so the tip rule in `CashPayment` is untouched and no balance leaks into tips.
4. `POST /api/orders` carries the tender lines and a client key. In **one transaction** the handler recomputes the total,
   locks the balance rows in a fixed order (customer credit, then cards by id, to avoid deadlocks), checks each covers its
   line, writes the order, `OrderPayments` and ledger rows, and commits. If a balance is short (another register spent it) the
   whole order is refused, naming the instrument and its new balance; nothing is half written.
5. A customer-link order cannot spend credit or a card in the first version. Staff can add the tender at the counter when
   they approve and complete it.

### Phase 0 - Decisions and accountant check [Planned]

Nothing below is verified; written from general practice. **Check with the accountant, and for gift cards the shop's lawyer or
DTI/BIR, before launch:**

- Are cards and credit a liability until used, with the sale recognized and taxed at redemption? Is an official receipt issued
  when the card is sold, when used, or both?
- Is there a legal minimum validity or a ban on expiry for gift cards, and does store credit fall under the same rule? Until
  answered, **default to no expiry** for both.
- What happens to balances nobody uses for years? Default: the balance stays on the books and in the liability report; nothing
  is written off automatically. "Breakage" is booked only if the accountant agrees.
- Data privacy: credit history is tied to a name and phone; keep it with the customer record and retention rules, mask phones
  in lists, anonymize with the customer.

### Phase 1 - Foundation [Planned]

- Script for the tables above, `PaymentMethods` rows and settings. Safe to run twice; never overwrites data. If Cashless
  Phase 1 has not created `OrderPayments`, build the minimal table here and let Cashless extend it; the two plans must agree
  on one shape.
- `WTF.Calculations`: `StoredValueRules`, tender split, with Angular copies and shared cases.
- Services: `ILedgerService` (append a row and move the cached balance in one transaction, idempotent, refuses a negative
  balance) and `ITenderService` (validates and applies tender lines inside the order transaction). Handlers never write a
  balance table directly; a test fails the build if code outside these services does.
- Plan gating: one new key `storedvalue` in `PlanFeatures` (suggested Pro only; hidden menu items and the graceful "Not in
  your plan" page). A shop that downgrades keeps its balances; **spending of existing credit and cards stays allowed** until
  used up (customers paid for them); selling new ones stops; the owner sees a banner.
- Permissions (added to the roles plan and `PolicyMatrixTests`): `storedvalue.view`, `storedvalue.sell` (Cashier up),
  `storedvalue.adjust` and `storedvalue.void` (Admin up), `storedvalue.manage` (settings, Owner). Cashier sells, spends and
  looks up balances; AdminViewer reads only.
- Audit actions: `CreditToppedUp`, `CreditAdjusted`, `GiftCardSold`, `GiftCardVoided`, `GiftCardAdjusted`,
  `GiftCardReissued`, `GiftCardLookupFailed`, `BalanceMismatchFound`, `StoredValueSettingsChanged`.
- Routes in `RouteTableTests`; none are anonymous.
- Staging seed (real-looking, through the ledger service and `WTF.Calculations`): a few customers with credit and history,
  a refund kept as credit, three gift cards (one untouched, one partly spent, one used up), orders paid with a split tender,
  settings on. Reset keep list gets the new `PaymentMethods` rows.

### Phase 2 - Store credit [Planned]

- **How credit arises:** (a) **refund as store credit** in the void dialog (only when the order has a customer); (b)
  **top-up** at the counter (customer pays cash or GCash, recorded in `StoredValueSales`); (c) an **Admin gift** (adjustment
  with reason). Credit belongs to a named customer; a walk-in cannot hold credit (the checkout offers the quick customer
  dialog by name and phone).
- **Spend:** a tender line, any amount up to the balance; may cover everything but the tip.
- **Void of an order paid with credit** returns to credit (`ReturnSpend`), never to cash unless an Admin chooses "refund to
  cash" with a reason (for example a deleted customer).
- **Order override** of a completed order is blocked when it would change the total or tender of an order with a credit or card
  tender; the Admin voids and re-enters, so the ledger is never rewritten. Notes-only edits stay allowed.
- **Expiry:** off by default (Phase 0). If switched on: N months after the last activity, with the nightly job writing `Expire`
  rows and a notification to Admins about what lapses next week.
- **Screens:** customer details gets a credit card (balance, history table with the shared sort header and filters drawer,
  "Add credit" for `storedvalue.sell`, "Adjust" for Admins); the customer picker shows a small credit chip. Adjusting needs a
  required reason and is limited per day per user.
- Tests: refund-as-credit then spend equals the original; walk-in cannot hold credit; top-up appears in no sales report; void
  returns exact credit; concurrent spends cannot go negative; Cashier cannot adjust; repeat save does not double spend.

### Phase 3 - Gift cards [Planned]

- **Selling.** "Sell gift card" on the POS: pick a preset or type an amount within limits, take cash or GCash, and the server
  issues the card. The code is random, 16 characters from an alphabet without look-alikes (no 0/O, 1/I/L), at least 80 bits,
  shown **once** and printed on the receipt with a QR, value and expiry (if any). Only the hash and last four are stored. The
  card is `Active` once payment is recorded. A customer is optional (a named gift helps support).
- **Using a card.** In the Pay panel, "Gift card": type the code or scan the QR/barcode with the camera (build the scanner once
  as a shared component; the inventory plan wants barcode scanning too). Only after a match does the screen show the last four
  and the balance. A wrong code gets one generic answer.
- **Guessing is blocked:** lookups are rate limited per user and per shop (stricter than the `loyalty-policy` limiter, for
  example 5 tries a minute per user); repeated misses lock lookups for that user for 15 minutes and notify Owner and Admin;
  every miss is audited without the typed text.
- **Partial use** is normal: the card stays `Active` with the remainder, at zero it becomes `Used`. **No cash back** for a
  remaining balance.
- **Refund of an order paid with a card** returns to the same card (`ReturnSpend`), even if it expired meanwhile.
- **Lost card:** an Admin voids it and **reissues** a new card for the balance in one transaction, two audit entries and a
  reason; the customer must give the last four or the sale receipt number. A reprint of a code is a reissue.
- **Refunding a card that was sold** (customer changes their mind) is allowed only while unused, by an Admin
  (`storedvalue.void`), returning the cash or GCash. A used card cannot be refunded; its balance can be moved to store credit
  by an Admin with a reason, if the shop chooses.
- **Expiry:** off by default; if on, the card expires at the end of the shop day (Asia/Manila) N months after issue. An expired
  card refuses a new spend but still accepts a refund return.
- **Branches:** a card works at **any branch of the same shop**. Sale branch and redeem branch are stored on the ledger so branch
  reports show "cards sold" and "card tender" per branch, and the owner sees the cross-branch gap (cash taken at one place,
  goods given at another). "This card works only at the selling branch" is a later option.
- **Multi-tenancy:** a card is never valid across shops: lookup runs through the tenant filter, so another shop's code answers
  exactly like a wrong code.
- **Not in this phase:** selling or spending on the customer link (needs Cashless provider payments and fraud handling).
- Tests: code randomness and the generic miss answer; only the hash in the database; partial use then remainder; refund returns
  to the same card; two registers redeeming one card at once (one wins, the other is refused); expired card refuses spend but
  accepts refund return; voided card refuses everything; rate limit and lock; cross-tenant lookup fails; Cashier cannot void or
  adjust; a card sale never appears in sales reports.

### Phase 4 - Reports, Daily Close and liability [Planned]

Report tables use the shared report definitions (`report-definitions.ts`, one generic table, Excel/PDF/CSV, total row equal to
the sum of rows) and the monthly workbook gets matching sheets.

- **Stored-value liability** (Reports > Operations): as of a date, gift cards outstanding (count and money) and credit
  outstanding, with movement for a period (issued, spent, expired, adjusted, voided) so opening + movement = closing; by
  branch and for all branches; credit by age band.
- **Daily Close** gets lines: gift cards sold, credit topped up, tender by method (cash, GCash, credit, gift card). The cash
  expected in the drawer **adds** cash taken for card and credit sales and subtracts change and cash refunds, so the drawer
  still reconciles per branch.
- **Payments report** splits amounts and tips by tender line, not by `Orders.PaymentMethodId`, and shows the share of sales paid
  with stored value.
- **Gift cards report:** list with last four (never the full code), status, sold on and where, balance, last used; filters
  drawer and sortable columns. **Credit report:** balances by customer.
- **Dashboard tile** "Stored value outstanding" linking to the liability report (hidden when the feature is off).
- **Integrity job:** nightly, recompute every cached balance from its ledger and compare; a mismatch is a notification and an
  audit entry, never a silent fix.
- **Sales identity** stays gross - discount - refunded = net. Stored-value tender is a payment method, not a discount, so it
  shows only in tender and liability reports.

### Offline and double-spend

- **Spending offline is not allowed in the first version.** A balance on one phone cannot be seen by the other register; two
  tablets could each spend the same ₱500 card. The checkout shows "Needs connection" on the credit and gift card options when
  offline, with a short reason; the cashier takes cash or GCash. Selling a card or top-up offline is also blocked (the code is
  issued by the server).
- **Online but flaky:** the request is idempotent. The order key and each ledger row's `IdempotencyKey` make a retried save
  return the saved result. Nothing is reserved separately, so no "stuck reservation" exists: the lock lives only inside one
  database transaction.
- **Races (online):** the row lock plus `RowVersion` and the check constraint stop an overspend even if a handler bug skips
  the check; the second order gets a clear refusal.
- **Possible later version (Phase 5):** allow offline spending of **credit** up to a safe cap (the balance cached at login
  minus what this device already spent); keep cards online-only. An offline spend the server finds uncovered at sync is
  **honored** (the goods are gone), saved with a note and sent to the Offline Phase 7 review as a reason
  (`StoredValueShortfall`) with a hold-or-note policy, following the rule "never undo a sale that already happened". This waits
  for the Phase 7 policy engine.

### Security, multi-tenancy and branches

- Every table is tenant-owned with the global filter; tenant, branch and customer scope never come from the request body.
- Credit is **shared by all branches** (customers are shared); where it was earned or spent is on each ledger row for reports.
  A branch manager sees stored-value activity of their branch; Owner and Admin see all.
- Never log codes, full phones or balances; the audit text masks (last four of a card, customer id). The code is shown once at
  issue; an Admin can reissue but never reveal it.
- Platform admin: the tenant export includes ledgers (hashes, never codes); tenant delete removes every new table in dependency
  order; "sign in as" is read-only and cannot adjust.
- Fraud signals for later notifications: many cards sold and spent within minutes, repeated adjustments by one user, many
  reissues for one customer, refund-to-credit followed by spending at another branch.

### UI plan (375 / 820 / 1440, 200ms ease-out, shared components and POS classes)

- **Pay panel:** a bottom sheet on 375, a right panel from 820. Rows per tender with a balance chip, an amount stepper and a
  running "Still to pay" line; cash/GCash and change stay below. Offline: rows disabled with "Needs connection".
- **Customer details:** a "Credit" card (balance, history, "Add credit", Admin "Adjust"); the customer picker shows a credit
  chip.
- **Gift cards page** (Management > Gift cards): list (last four, status, balance, sold date and branch), filters drawer,
  sortable headers; details with the ledger; actions Sell, Void, Reissue through the shared confirm dialog. The Sell dialog has
  amount presets, payment, optional customer, then a one-time "Card issued" screen with code, QR and Print.
- **Settings:** Management > Gift cards and credit, shop-settings layout; edit pages ask "Discard Changes?" on back.
- **Receipts and summary image:** tender lines, card last four and remaining balance, credit balance after the sale. Receipt
  and Kitchen Printing plan gets these blocks (do not add twice).
- Gated pages follow the plan-gating pattern. Browser checks at all three widths in the default and cafe styles.

### Tests (summary; each phase lists its own)

- Shared calculation cases for tender split, refund routing and expiry; both runs must pass.
- Real-SQL tests for locks and concurrency (two orders racing for one card, one customer's credit); idempotent retry; cached
  balance equals the ledger sum after a long random sequence.
- Policy matrix and route snapshot for every new route and permission; plan gating on and off; downgrade keeps spending.
- Void and override paths: each tender returns to its own instrument; override blocked on stored-value orders.
- Playwright (own tag, ports and stop file per thread; throwaway database; no flaky, no skipped): sell a card, spend part, void
  the order, see the remainder; credit refund and spend; offline checkout shows "Needs connection"; screens at 375/820/1440.

### Build order and size

1. Phase 0 questions answered (no code).
2. Phase 1 foundation: large (data and services; calculations and shared cases; settings, gating, permissions, audit).
3. Phase 2 store credit: medium.
4. Phase 3 gift cards: large (selling, scanning, fraud limits, reissue).
5. Phase 4 reports and liability: medium.
6. Phase 5 on demand.

**With the parallel work:** build on top of multiple branches so `BranchId` is stamped from day one (otherwise leave it nullable
and fill it with a follow-up script), and after Offline Phase 7 if offline credit spending is wanted. SQL script dates must not
collide with branches, Offline Phase 7 and kitchen. Any thread with schema changes runs `tools\dbsync.bat` on the database it
uses and says which; the real rescaffold runs on the laptop against `.\SQLEXPRESS`.

### Phase 5 - Later ideas [Idea]

- Gift cards sold and spent on the customer link (needs Cashless Phases 2 and 3), shown as a QR or sent by message.
- Offline credit spending with a cap (above).
- Pre-printed card batches generated by an Owner as `Inactive`, activated only at the register so a stolen blank is worthless;
  reload (top up an existing card); card-to-card transfer; card only valid at the selling branch.
- Deposits for catering as credit.

### Parked: loyalty points and stamp cards

Not planned now (Pogi, 18 Nov 2026). Notes for whoever picks it up: today `LoyaltyPoints` is one bare number per customer that
nothing writes (read by `GET /api/loyalty/{customerId}`, the Customers report and an anonymous loyalty short link); it should
become an append-only ledger like the ones above before anything earns or spends it. What Pogi has in mind is probably a
**stamp card** ("buy 10, get one free"), which the promotions plan lists as "loyalty rewards" (#7, its own feature on top of
promotions, with a ledger entry per redemption and a refund that returns the stamp). It can reuse this plan's ledger service
and idempotency rules. Open design points: which products earn a stamp, what the free reward is, and expiry.

### Open questions for Pogi

1. Gift cards: physical cards you print and hand over, or only a code and QR on the receipt for now? Preset amounts (₱200,
   ₱500, ₱1,000)? Any minimum or maximum?
2. May a card be used at every branch (suggested yes)?
3. Expiry: none until the law is checked (suggested). Who checks it?
4. Store credit: do you want "refund as store credit" in the void dialog (the most useful route) and counter top-ups, or only
   the refund route?
5. Who may sell, adjust, void and reissue: is "Cashier sells and spends; Admin adjusts, voids and reissues" right?
6. Tips: only cash or GCash (the default), or also from a card or credit?
7. Offline: is "spending needs a connection" acceptable for a coffee shop with shaky internet?
8. Plan gating: Pro only (suggested), or also on Starter?
9. The accountant questions in Phase 0: who asks them and when?
