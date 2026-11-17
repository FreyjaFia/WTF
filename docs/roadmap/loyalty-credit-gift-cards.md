## Loyalty Points, Store Credit and Gift Cards [Planned, 17 Nov 2026]

Three ways a customer holds **value** with the shop: **points** they earn by buying, **store credit** the shop owes them
(a refund kept as credit, a deposit, a goodwill gift) and a **gift card** anyone can buy and anyone can spend. They look
alike on a screen, but they are different things for the law, the books and fraud, so they share one foundation (a ledger
and a tender line) and keep their own rules.

| Phase | Name                                               | Size | Status    |
| ----- | -------------------------------------------------- | ---- | --------- |
| 0     | Decisions and accountant check                     | -    | [Planned] |
| 1     | Foundation: ledgers, tender lines, settings, gating | L    | [Planned] |
| 2     | Points: earn, balance, adjust (replaces the bare number) | M | [Planned] |
| 3     | Points: spend at checkout, refunds, expiry         | M    | [Planned] |
| 4     | Store credit                                       | M    | [Planned] |
| 5     | Gift cards                                         | L    | [Planned] |
| 6     | Reports, Daily Close and liability                 | M    | [Planned] |
| 7     | Later: rewards catalog, customer link, offline spend | L  | [Idea]    |

Recommended order: 1, 2, 3, 6 (the points part), 4, 5, 6 (the rest). Points first because the number already exists and
nothing earns it; gift cards last because they carry the most money risk and need the tender work proven first.

### What exists today (checked in the code, 17 Nov 2026)

- **Points are a bare number that nothing writes.** `LoyaltyPoints` has one row per customer (`CustomerId`, `Points`,
  `TenantId`). No order earns or spends points. The API only reads it (`GET /api/loyalty/{customerId}` returns the first
  row, the Customers report sums the rows) and there is an anonymous short link (`/api/loyalty/redirect/{token}`) that
  resolves a customer id for a loyalty page. So the balance is editable only by SQL, which is exactly what the plan removes.
- **Payment is one label on the order.** `Orders.PaymentMethodId` is Cash (1) or GCash (2), plus `AmountReceived`,
  `ChangeAmount`, `Tips`. There is no tender line, so a split payment cannot be recorded. `WTF.Calculations/Sales/CashPayment.cs`
  holds the cash rule (amount due = total + tip).
- **The Cashless Payments plan already proposes `OrderPayments`** (order, method, amount, tip, status). This plan reuses that
  table instead of inventing another; the build order below says who creates it first.
- **Discounts run in a fixed order** in `WTF.Calculations/Orders`: line prices, promotions (`PromotionPricing`, `BundleRules`,
  `DiscountBudget`), then the Senior/PWD discount (`SeniorPwdRules`), then the total. The API recomputes and is the authority;
  the POS only previews.
- **Order states** are Pending, Completed, Cancelled, Refunded, PendingApproval, PendingReview. `OrderStatuses.Unconfirmed`
  (approval and review) is the one list of "not a sale yet". A void goes through `VoidOrderHandler` (stock question, audit,
  notifications); a held offline sale is not a sale until an Admin approves it.
- **Offline sync** keys every queued order with `OfflineLocalId` (unique index) so a repeat sync returns the saved order.
  Offline Phase 7 (planned) judges sales at sale time and adds an `OfflineSyncPolicy`.
- **Multi-tenancy is on:** `TenantId` on every shop table, EF global filters, per-tenant order numbers. Multiple branches
  is being built in parallel: customers, catalog and promotions are shared by the whole shop; orders, stock, cash and the
  Daily Close are per branch.
- **Plan gating** is `PlanFeatures` (catalog of keys, `Needs` links) plus roles that narrow what a feature allows.
- **Promotions plan** (`promotion-types-plan`, `docs/roadmap/promotions.md`) already decided: loyalty rewards (#7) are their
  own feature on top of promotions, with a points ledger and a refund that returns the points; gift cards (#15) are "a
  payment method with a balance" needing a ledger, refunds and fraud checks, after Cashless; coupon codes (#6) are a
  requirement on a promotion. This plan is the ledger and payment part; the Rewards tab stays with the promotions plan.

### Decisions this plan makes (change them if Pogi disagrees)

1. **A balance is never an editable number.** Every change is one append-only ledger row (who, when, why, amount, the order or
   card it belongs to). The balance is the sum of the rows. A cached balance row exists for speed and for locking, and a
   nightly check recomputes it from the ledger and raises a notification on any difference. Corrections are new rows.
2. **Points, store credit and gift cards are three separate things** with separate settings, separate permissions and
   separate plan switches. They share the ledger shape and the checkout tender line.
3. **Spending value is a tender, not a discount.** The order total is worked out first (promotions, Senior/PWD, tip rules);
   then the customer pays it with one or more tender lines: cash, GCash, points, store credit, gift card. So spending points
   or a gift card never changes the sale amount, the discount reports, the VAT-exempt amount or a promotion limit. The
   accountant must confirm this for points (see Phase 0); if they want points treated as a discount the same ledger works and
   only the order of operations changes.
4. **Selling a gift card or topping up credit is not a sale.** It is a liability: the shop owes the customer goods later. It
   is recorded in its own table, never as an order, so product, category and sales reports do not move. Revenue is recognized
   when the value is spent on an order. Cash taken for a card shows in the Daily Close as its own line.
5. **Online only to start.** Spending points, credit or a gift card needs a connection. Earning works offline (the server
   works it out when the sale syncs). The reasons are in "Offline and double-spend".
6. **The API is the authority** for every balance and every earn or spend amount. The POS shows a preview from the cached
   balance and the shared calculation, but the server locks the account and checks the balance when the order is saved.

### Rules that live in `WTF.Calculations` (and `shared/calculations`, same sample cases)

New classes, whole cents like `money.ts`, tested in `WTF.Tests` against `calculation-cases.json` on both sides:

- `LoyaltyRules`: points earned for an order (rate, base amount, rounding, minimum), peso value of points, points needed for a
  peso amount, the largest redeemable amount for an order (cap), expiry date of an earn row, first-in-first-out use of
  unexpired earn rows, reversal of earn on a void (proportional to a partial return, if partial returns ever exist).
- `StoredValueRules`: split of an order total into tender lines (order of use, remainder to cash or GCash), what a tender can
  cover (no tips from points, see below), refund routing (back to the same instrument), gift card and credit expiry dates.
- `SalesRules` / `PaymentRules` (shared with the Cashless plan): "what counts as paid" now means the sum of tender lines
  equals total + tip, and the report split by method reads the tender lines.

Order of operations for one order, so POS and API agree: line prices, add-ons, promotions, Senior/PWD, total, tip, then tenders.

### Data model (script under `tools/sql`, idempotent; run on `.\SQLEXPRESS`, then `tools\dbsync.bat`)

All tables carry `TenantId` and the EF global filter, are added to `20261108`-style tenant lists, to the export and delete
lists of the platform page, and to `WTFDbContext.Tenancy.cs`. All amounts are `decimal(18,2)`; points are `int`. After
branches land, rows that belong to a place of sale also carry `BranchId` (copied from the order or the sale, never from the body).

| Table | Purpose and key columns |
| ----- | ----------------------- |
| `LoyaltyLedger` | One row per change: `CustomerId`, `Kind` (Earn, Redeem, ReverseEarn, ReturnRedeem, Expire, Adjust, Opening), `Points` (signed), `OrderId?`, `ExpiresAt?` (Earn rows), `RemainingPoints?` (Earn rows, for first-in-first-out), `Reason`, `CreatedAt`, `CreatedBy`, `BranchId?`, `IdempotencyKey` (unique per tenant). The old `LoyaltyPoints.Points` becomes one `Opening` row per customer (script), no expiry. |
| `LoyaltyBalances` | Cached `CustomerId` -> `Points`, `RowVersion`. Written in the same transaction as the ledger row. Replaces the meaning of `LoyaltyPoints` (the old table is kept one release, then dropped by a later script). |
| `CreditLedger` | Store credit per customer: `CustomerId`, `Kind` (TopUp, RefundToCredit, Spend, ReturnSpend, Adjust, Expire), `Amount` (signed), `OrderId?`, `StoredValueSaleId?`, `Reason`, audit columns, `IdempotencyKey`. |
| `CreditBalances` | Cached balance with `RowVersion` and a check constraint `Balance >= 0`. |
| `GiftCards` | `Id`, `CodeHash` (HMAC-SHA256 of the code with a server secret), `CodeLast4`, `InitialAmount`, `Status` (Inactive for pre-printed, Active, Void, Expired, Used), `ExpiresAt?`, `IssuedAt`, `IssuedBy`, `SoldBranchId?`, `OwnerCustomerId?` (optional, only for a named gift), `Note`. The code itself is shown once and never stored in plain text. |
| `GiftCardLedger` | `GiftCardId`, `Kind` (Issue, Spend, ReturnSpend, Adjust, Void, Expire), `Amount` (signed), `OrderId?`, `BranchId?`, `Reason`, audit columns, `IdempotencyKey`. Balance = sum; cached on the card row with `RowVersion` and a check `Balance >= 0`. |
| `StoredValueSales` | One row per gift card sale or credit top-up: `Kind`, `Amount`, `CustomerId?`, `GiftCardId?`, tender used to pay for it (cash, GCash only; never another stored value), `BranchId?`, `CreatedBy`, `OfflineLocalId?`. This is what the Daily Close and the liability report read. A gift card or credit can **never be bought with** points, credit or another gift card. |
| `OrderPayments` | Shared with Cashless Phase 1: `OrderId`, `Method` (Cash, GCash, Points, StoreCredit, GiftCard), `Amount`, `Tip`, `GiftCardId?`, `Reference`, `Status`, `CreatedAt`. `Orders.PaymentMethodId` stays for old rows and is set to the largest tender for new ones. New `PaymentMethods` rows (3 Points, 4 StoreCredit, 5 GiftCard) are fixed setup and go in the staging reset keep list. |
| `LoyaltySettings` (or columns on `TenantSettings`) | Per shop: earn on/off, points per peso, base (net of discounts, excluding tips and stored-value purchases), rounding (round down), minimum order, peso value per point, redeem cap (percent of the order, default 50), expiry mode and months, expiry reminder days, allow earn on Senior/PWD sales (default yes, on the amount paid). |
| `StoredValueSettings` | Per shop: gift card expiry months (default none, see Phase 0), card amount presets and min/max, credit expiry (default none), who may take credit refunds, daily cap on manual adjustments per user. |

Why two small cached balance tables and not a column on `Customers`: the lock and the check constraint sit on a row that
exists only for this, so a handler can `UPDLOCK` it, and the customer table stays free of money.

### Checkout: how a tender line works

1. The cashier finishes the cart. The POS shows the total (promotions and Senior/PWD already applied) and a **Pay** panel.
2. The panel lists what the customer can use: cash/GCash always; **Points** and **Store credit** when a customer is chosen
   and has a balance; **Gift card** after typing or scanning a code. Each shows its balance and the amount it will cover
   (default: as much as allowed, editable down). The rest goes to cash or GCash, with the existing change and tip rules.
3. **Tips are paid in cash or GCash only.** A gift card or credit may not be used for the tip, so the tip rule in
   `CashPayment` is not disturbed, and gift-card balances are not leaked into the tip float. (Open question: allow tips on a
   gift card? Default no.)
4. `POST /api/orders` carries the tender lines and a client-generated key. The handler, in **one transaction**: recomputes
   the total, locks every balance row it needs in a fixed order (customer points, customer credit, then gift cards by id, to
   avoid deadlocks), checks each balance covers its line, writes the order, the `OrderPayments` rows and the ledger rows, then
   commits. If a balance is short (a second register spent it a moment ago) the whole order is refused with a message that
   names the instrument and the new balance, and nothing is half written.
5. Earn rows are written when the order becomes **Completed** (not while Pending, PendingApproval or PendingReview), in the
   same transaction as the completion. A held offline order earns when an Admin approves it.
6. A customer-link order cannot spend points, credit or a gift card in the first version (no way to prove who is typing).
   A staff member can add the tender when they approve and complete the order at the counter, through the same panel.

### Phase 0 - Decisions and accountant check [Planned]

Nothing below is verified; written from memory of general practice and the Philippine rules, **to be checked with the
accountant and, for gift cards, the shop's lawyer or the DTI/BIR before launch**:

- Are gift cards and store credit treated as a liability until used, with the sale recognized and taxed at redemption? Does
  the shop issue an official receipt when the card is sold, when it is used, or both?
- Is there a legal minimum validity period or a ban on expiry for gift cards, and is store credit under the same rule?
  Until answered, **default to no expiry for gift cards and credit** and a configurable expiry for points.
- Are points a discount (reduces the VAT base and gross sales) or a tender (does not)? Does a Senior/PWD sale earn or spend
  points? Does the discount interact with a loyalty program (it is statutory; the shop must not make it worse for them)?
- Data Privacy: points history is personal data tied to a name and a phone number; keep it with the customer record and the
  retention rules, never show full phone numbers in lists (use the existing customer masking), and delete or anonymize with
  the customer.
- Unclaimed balances: what happens to credit and cards that nobody uses for years (escheat rules do not apply in the same
  way everywhere). Default: the balance stays on the books and shows in the liability report; nothing is written off
  automatically.

### Phase 1 - Foundation [Planned]

- Script for `LoyaltyLedger`, `LoyaltyBalances`, `CreditLedger`, `CreditBalances`, `GiftCards`, `GiftCardLedger`,
  `StoredValueSales`, `OrderPayments` (skip if Cashless Phase 1 already created it; the two plans must agree on one shape),
  `PaymentMethods` rows, settings, and the opening-balance copy of the old points. Safe to run twice; never overwrites data.
- `WTF.Calculations`: `LoyaltyRules`, `StoredValueRules`, tender split, with Angular copies and shared cases.
- Services: `ILedgerService` (append a row and move the cached balance in one transaction, with an idempotency key; refuses a
  negative balance), `ITenderService` (validates and applies tender lines inside the order transaction). Handlers never touch
  a balance table directly. A test fails the build if any code outside these services writes a balance table.
- Plan gating: two new keys in `PlanFeatures`: `loyalty` (points) and `storedvalue` (store credit and gift cards), neither
  needing the other. Suggested: Pro has both, Starter neither (graceful "Not in your plan" page and hidden menu items, like
  the other gated features). A shop that downgrades keeps its balances; the screens hide, earning stops, and spending of
  existing credit and gift cards **stays allowed** until used up (customers paid for them), with a banner for the owner.
- Permissions (hard-coded keys, added to the roles plan and `PolicyMatrixTests`): `loyalty.view`, `loyalty.adjust`
  (Admin up), `loyalty.manage` (settings, Owner and Admin), `storedvalue.sell` (Cashier up), `storedvalue.view`,
  `storedvalue.adjust` (Admin up), `storedvalue.void` (Admin up), `storedvalue.manage` (settings, Owner). Cashier can earn,
  spend, sell cards and look up balances; only Admins adjust, void or change rules. AdminViewer reads only.
- Audit: new actions `LoyaltyAdjusted`, `LoyaltySettingsChanged`, `CreditToppedUp`, `CreditAdjusted`, `GiftCardSold`,
  `GiftCardVoided`, `GiftCardAdjusted`, `GiftCardLookupFailed` (rate-limit hits), `BalanceMismatchFound`. Every ledger row also
  stands as its own record, so the audit entry is about the human action and the ledger is about the value.
- Routes go in `RouteTableTests`. No new route is anonymous.
- Staging: the seed gets a few customers with points and history, one with store credit, two gift cards (one partly spent),
  orders paid with a split tender, and the settings switched on, all through `WTF.Calculations` and the ledger service.
  Reset keep list gets the new `PaymentMethods` rows.

### Phase 2 - Points: earn, balance, adjust [Planned]

- **Earn.** On Completed: `points = floor(base / pesosPerPoint)` with the base chosen in settings. Default base: the amount
  the customer paid with cash, GCash and gift card **after** promotions and Senior/PWD, excluding tips, excluding the part
  paid with points or credit (credit and points were already earned on once). No customer, no points: a walk-in order earns
  nothing; the checkout offers "Add customer" (the quick customer dialog by name and phone) when points are on.
- **No earn on** stored-value sales, voided or refunded orders, and any order under the minimum.
- **See the balance.** Customer details page: balance, a history table (date, kind, points, order link, who) with the shared
  sort header and filters drawer, and the line under the customer in the order editor and the customer picker ("120 pts").
  Customers list gets a Points column (sortable). The existing Customers report keeps its column, now from the cache.
- **Adjust** (`loyalty.adjust`): a dialog with a signed amount and a **required reason**; limited per day per user; audited;
  the Admin's own name on the ledger row. Fixing a mistake is another adjustment, never an edit.
- **Migration of the loyalty link:** `/api/loyalty/{customerId}` reads the new balance; the anonymous redirect keeps its
  token rules, and a later customer page can show the balance and recent earns (Phase 7).
- Tests: rate and rounding cases (shared file); a walk-in earns nothing; a Pending order earns nothing until completed;
  the same order completed twice earns once (idempotency key); balance equals the sum of the ledger; opening rows equal the old
  numbers; a user without `loyalty.adjust` is refused; AdminViewer cannot adjust.

### Phase 3 - Points: spend, refunds, expiry [Planned]

- **Spend.** In the Pay panel, "Use points": a stepper in whole points up to the lesser of the balance, the order-level cap
  (default 50% of the total) and what the tender can cover. Value per point comes from settings. The ledger row is `Redeem`
  with a negative amount and the order id.
- **Void or refund of an order.** `VoidOrderHandler` also (a) returns points spent (`ReturnRedeem`), (b) takes back points
  earned (`ReverseEarn`). If the customer already spent those points, the balance may go **negative**; a negative balance
  blocks spending until earned back, and the Admin can write it off with an adjustment. A void of a gift-card or credit order
  returns the money to the same instrument (see Phases 4 and 5), never to cash, unless an Admin chooses "refund to cash" with
  a reason (a closed gift card, a deleted customer).
- **Order override** (Admin edit of a completed order): blocked when the order has a points, credit or gift-card tender and
  the change would alter the total or the tender; the Admin must void and re-enter, so the ledger never has to be rewritten.
  Notes-only edits stay allowed.
- **Expiry.** Default: points expire **12 months after they were earned** (setting: off, N months after earning, or N months
  without any activity). The nightly job (same pattern as the other daily schedulers, one loop over active tenants) writes
  `Expire` rows for earn rows past their date, using what is left of each earn row (first-in-first-out, so spending uses the
  oldest points first). A reminder notification to the customer is **not** sent (no customer messaging channel); the customer
  details page shows "120 points expire on 10 Dec", and the receipt shows the next expiry.
- **Edge cases:** spending exactly zero is refused; a cap that leaves a few pesos is allowed; an order paid fully with points
  still needs a tender line and earns nothing; a tender that covers the total leaves no cash fields (change is 0).
- Tests: spend limited by balance, cap and total; void restores spend and takes back earn; negative balance blocks spending;
  expiry uses oldest first and never goes below zero; a repeat of the same save does not double spend (idempotency); two
  concurrent orders for the same customer cannot overspend (real SQL test, in the existing real-SQL suite).

### Phase 4 - Store credit [Planned]

- **How credit arises:** (a) **refund as store credit** instead of cash when a paid order is voided (a choice in the void
  dialog, only when the order has a customer); (b) **top-up** at the counter (the customer pays cash or GCash and gets
  credit, recorded in `StoredValueSales`); (c) an **Admin gift** (adjustment with reason); (d) later, deposits for catering.
  Credit always belongs to a named customer; a walk-in cannot hold credit.
- **Spend:** a tender line like points, whole peso amounts or cents. No cap needed. Credit may cover everything but the tip.
- **Refund of an order paid with credit** returns to credit (`ReturnSpend`), never to cash.
- **Expiry:** off by default (see Phase 0); a setting can add N months from the last activity. When expiry is on, the same
  nightly job writes `Expire` rows, and a notification tells the Admin how much will lapse next week.
- **Customer screen:** balance, history, a "Add credit" button (`storedvalue.sell`) and an Admin-only "Adjust" button.
- **Accounting:** credit is a liability. The liability report shows total credit outstanding, the top balances, and the age
  of balances. Top-ups appear in the Daily Close under "Credit sold", spends under payment methods.
- Tests: refund-as-credit then spend equals the original; walk-in cannot receive credit; a top-up is not in any sales report;
  void of a credit order returns the exact credit; concurrent spend cannot go negative; Cashier cannot adjust.

### Phase 5 - Gift cards [Planned]

- **Selling.** "Sell gift card" on the POS (also reachable from the cart): pick a preset or type an amount within the limits,
  take cash or GCash, and the server issues the card: a random code, 16 characters from an alphabet without look-alikes
  (no 0/O, 1/I/L), at least 80 bits of randomness, shown **once** on screen and printed on the receipt with a QR code, the
  card value and the expiry (if any). Only the hash and the last four are stored. A card is `Active` from the moment the
  payment is recorded. The customer is optional (a named gift links to a customer for support).
- **Pre-printed physical cards (later in the phase or Phase 7):** a batch is generated by an Owner as `Inactive` cards with
  codes printed once; a card becomes `Active` only when the cashier sells and "activates" it, so a stolen blank is worthless.
- **Using a card.** In the Pay panel, "Gift card": type the code or scan its QR/barcode with the camera (the inventory plan
  already wants barcode scanning; build it once as a shared component). The lookup shows the **last four and the balance**
  only after the code matches; a wrong code returns one generic answer.
- **Guessing is blocked:** lookup is rate limited per user and per tenant (reuse the `loyalty-policy` style limiter, a
  stricter one: 5 tries per minute per user), repeated misses lock lookups for that user for 15 minutes and raise a
  notification to Owner and Admin, and every miss is audited without the typed text beyond its length.
- **Partial use** is normal: the card stays `Active` with the remainder; at zero it becomes `Used`. A card has no change-giving:
  the unused part stays on the card; **no cash back** for the balance.
- **Refund of an order paid with a card** returns to the same card (`ReturnSpend`), even if it has expired meanwhile (the
  money was the customer's); a lost card is **voided and reissued** by an Admin with a reason: the old card is voided, a new
  card is issued for the balance (one ledger transaction, two audit entries). The customer must supply the card's last four or
  the sale receipt number to prove it.
- **Refunding a gift card that was sold** (customer changes their mind): allowed only while unused, by an Admin
  (`storedvalue.void`), returning the cash or GCash of the sale. A used card cannot be refunded; the remaining balance can be
  moved to store credit if the shop chooses (an Admin action with a reason).
- **Expiry:** off by default; when on, a card expires at the end of the day N months after issue (shop day, Asia/Manila),
  and the expired balance moves to a "breakage" line in the liability report only if the accountant agrees.
- **Branches:** a card is redeemable at **any branch of the same shop** by default. The sale branch and the redeeming branch
  are stored on the ledger so the branch reports can show "gift cards sold" and "gift card tender" per branch, and the
  owner sees the cross-branch difference (cash was taken at one place, goods given at another) in the liability report. A
  setting "this card works only at the selling branch" is a later option.
- **Multi-tenancy:** a card is never valid across shops: lookup runs through the tenant filter, so a code from another shop
  answers exactly like a wrong code.
- **Customer-link sale and spend:** not in this phase (needs the payment provider and fraud handling from Cashless Phases 2
  and 3). Digital cards sold online are Phase 7.
- Tests: code randomness and the generic miss answer; hash only in the database; partial use then remainder; refund returns
  to the same card; two registers redeeming the same card at once (one wins, the other refused); an expired card refuses a new
  spend but accepts a refund return; a voided card refuses everything; rate limit and lock; cross-tenant lookup fails;
  Cashier cannot void or adjust; the sale never appears in sales reports.

### Reports, Daily Close and liability (Phase 6) [Planned]

All new tables of numbers use the shared report definitions (`report-definitions.ts`, one generic table, Excel/PDF/CSV, the
total row equal to the sum of the rows) and the monthly workbook gets matching sheets.

- **Stored-value liability** (Reports > Operations): as of a date, gift cards outstanding (count and money), store credit
  outstanding, points outstanding with their peso value (points are a cost provision, not a debt; show separately); movement
  for a period (issued, spent, expired, adjusted, voided) so opening + movement = closing; by branch.
- **Daily Close** gets lines: gift cards sold, credit topped up, tender by method (cash, GCash, points, credit, gift card),
  points earned and redeemed, and cash expected in the drawer (cash and GCash taken for card sales **added**, change given
  and cash refunds subtracted). A shift's drawer must reconcile with stored-value sales included.
- **Payments report** splits tips and amounts by tender line, not by `Orders.PaymentMethodId`; the percent of sales paid by
  stored value is shown.
- **Loyalty report:** top earners, points issued vs redeemed vs expired by month, redemption rate, customers near expiry, cost
  of rewards (peso value redeemed). **Gift cards report:** list with last four (never the full code), status, sold on,
  balance, last used; filters drawer and sortable columns.
- **Dashboard insight tile** "Stored value outstanding" linking to the liability report (hidden when the features are off).
- **Ledger tools:** the nightly integrity job recomputes every cached balance from the ledger and compares; any mismatch is a
  notification and an audit entry `BalanceMismatchFound`, never a silent fix.
- **Sales identity:** sales reports stay gross - discount - refunded = net. Tender by points, credit or a gift card is a
  payment method, not a discount, so none of these amounts reduce net sales; they show only in tender and liability reports.

### Offline and double-spend

- **Earning offline is fine.** A queued order carries the customer id; the sync handler earns points on the server from the
  saved order, once, keyed by the order. A held offline order earns when approved.
- **Spending offline is not allowed in the first version.** A balance held on a phone cannot be seen by the other register; two
  tablets could each spend the same ₱500 card. The checkout shows "Needs connection" on the points, credit and gift card
  options when offline, with a short reason, and the cashier takes cash or GCash.
- **Online but flaky.** The request is idempotent: the order key and each ledger row's `IdempotencyKey` make a retried save
  return the saved result. Nothing is reserved separately, so there is no "stuck reservation" to clean up: the lock lives
  only inside one database transaction.
- **A possible later version (Phase 7):** allow offline spending of **points and credit only up to a safe cap** per customer
  (for example the balance cached at login minus what this device already spent), and treat a card as online-only always.
  An offline spend that the server finds uncovered at sync is **honored** (the goods are gone), saved with a note and an
  "over-spent" ledger row, and sent to the Offline Phase 7 review as a reason (`StoredValueShortfall`) with a policy
  (note or hold), the same philosophy as the promotion limit rule: never undo a sale that already happened. This needs the
  Phase 7 policy engine first, so it waits.
- **Race between registers** (online): the account row lock plus `RowVersion` and the check constraint stop an overspend even
  if a handler bug skips the check; the second order gets a clear refusal.

### Multi-tenancy, branches and security

- Every table is tenant-owned with the global filter; ids from the body are never trusted for tenant, branch or customer
  scope (the handler reads them from the token and the loaded order).
- A customer's points and credit are **shared by all branches** (customers are shared). Where value is earned or spent is
  recorded per row (`BranchId`) for reports, not for balances.
- A branch manager sees the stored-value activity of their branch only; Owner and Admin see all; the liability report has
  an "All branches" total. Staff without access to a branch cannot spend a card there.
- Never log codes, full phone numbers or balances in server logs; masked in the audit text (last four of a card, id of a
  customer). The gift card code is shown once at issue and re-printed only by an Admin who proves the last four (a reprint is
  a new code on the same card, the old one invalid, audited).
- Platform admin tools: the tenant export includes ledgers (no codes, hashes only); tenant delete removes every new table in
  dependency order; "sign in as" (read-only) can view balances but cannot adjust.
- Fraud signals to watch (later, as a notification): many cards sold and spent within minutes, repeated adjustments by one
  user, refunds to credit followed by immediate spends at another branch, a customer with many lost-card reissues.

### UI plan (375 / 820 / 1440, 200ms ease-out, shared components and POS classes)

- **Pay panel** in checkout: a bottom sheet on 375, a right panel from 820. Rows for each tender with a balance chip, a stepper
  for the amount, and a running "Still to pay" line; the existing cash/GCash and change fields stay below. Offline: rows
  disabled with "Needs connection".
- **Customer details** gets a "Rewards and credit" card: points and credit balance, history tab (sortable table with column
  headers, filters drawer, the cards view under 1280 like the reports), buttons "Add credit", "Adjust" (Admin). Customer picker
  rows show a small "120 pts" and "₱250 credit".
- **Gift cards page** (Management > Gift cards, `storedvalue.view`): list with last four, status, balance, sold date, sold
  branch; filters drawer; row opens details with the ledger; actions "Sell", "Void", "Reissue" with dialogs and the standard
  confirm component. Sell dialog: amount presets, payment, customer (optional), then a one-time "Card issued" screen with the
  code, QR and Print.
- **Settings** pages under Management > Loyalty and Management > Gift cards and credit, using the shop-settings layout; edit
  pages ask "Discard Changes?" on back.
- **Receipts and summary image** show: tender lines, gift card last four and remaining balance, points earned, points
  balance, next expiry. Receipt and Kitchen Printing plan gets these blocks (coordinate so they are not added twice).
- Not in your plan page and hidden menu items follow the plan-gating pattern; the mobile bottom bar adds no new tab.
- Browser checks at all three widths, with the default and cafe styles, as for the other features.

### Tests (summary; each phase lists its own)

- Shared calculation cases for earn, spend cap, tender split, expiry, first-in-first-out, refund routing; both runs must pass.
- Real-SQL tests for locks and concurrency (two orders racing for one card, one customer's points, one customer's credit);
  idempotent retry; balance recomputed from the ledger equals the cache after a long random sequence of operations.
- Policy matrix and route snapshot for every new route and permission; plan gating on and off; downgrade keeps spending of
  existing balances.
- Void and override paths: each tender returns to its own instrument; override blocked on stored-value orders.
- Playwright (separate tag, ports and stop file per thread; throwaway database; no flaky, no skipped): sell a card, spend part,
  void the order, see the remainder; earn on a completed order, spend points, void; credit refund and spend; offline
  checkout shows "Needs connection" on the three options; screens at 375/820/1440.

### Build order and size (rough, one developer-thread each)

1. Phase 0 questions answered (no code).
2. Phase 1 foundation: large (two or three threads: data and services; calculations and shared cases; settings, gating,
   permissions, audit). Needs the Cashless plan's `OrderPayments` shape agreed first; if Cashless is not started, build the
   minimal table here and let Cashless extend it.
3. Phase 2 points earn and view: medium.
4. Phase 3 points spend, refunds, expiry: medium.
5. Phase 6, points part (Daily Close lines, loyalty report): small.
6. Phase 4 store credit: medium.
7. Phase 5 gift cards: large (selling, scanning, fraud limits, reissue).
8. Phase 6, remaining reports and liability: medium.
9. Phase 7 on demand.

**Interplay with the parallel work:** build on top of multiple branches (so `BranchId` is stamped from day one rather than
added later) and after Offline Phase 7 lands (its review policy is where the later offline spending cap plugs in). If
this starts before branches merge, leave `BranchId` nullable and fill it with a follow-up script. SQL script dates must not
collide with the branches, Offline Phase 7 and kitchen scripts. Any thread with schema changes runs `tools\dbsync.bat` on
the database it uses and says which; the real rescaffold runs on the laptop against `.\SQLEXPRESS`.

### Phase 7 - Later ideas [Idea]

- **Rewards catalog** (the promotions plan's #7): "100 points = free small drink", stamp cards (buy 9, 10th free), birthday
  treat; redeeming attaches a hidden promotion line so totals come from existing pricing code, and the redeem ledger row
  stores the reward id. Tab in the Promotions area, rules under Management > Loyalty.
- **Customer link:** show the balance and history on the loyalty page; allow spending points on the customer link order with
  a one-time confirmation sent to the number on file (needs a messaging channel). Gift cards sold online (needs Cashless
  Phases 2 and 3), emailed or shown as a QR.
- **Offline spending cap** for points and credit (above).
- **Tiers** (silver/gold by yearly spend), **points multipliers** by day or product, **referral** rewards (needs coupon codes).
- **Pre-printed card batches** with activation at the register, reload (top up an existing card), card-to-card transfer.
- **Employee or staff price** is a customer-type promotion, not a stored value.

### Open questions for Pogi

1. Which first: do you want points live before gift cards (recommended), or are gift cards the real need this season?
2. Points rate and value: how many points per peso (1 point per ₱10? per ₱1?) and what is a point worth when spent (₱1 per 10
   points?). Is the redeem cap of 50% of an order fine, or should points be able to pay the full order?
3. Should points expire (12 months after earning is the suggestion), and should a customer be told before they do?
4. Should a Senior/PWD sale earn points, and may the customer spend points on it? (Accountant.)
5. Gift cards: physical cards you print and hand over, or only a code on the receipt/QR for now? Preset amounts (₱200, ₱500,
   ₱1,000)? Any minimum or maximum? Expiry (check the law first), and may a card be used at every branch?
6. Store credit: do you want "refund as store credit" in the void dialog (most useful use) and top-ups at the counter, or only
   the refund route?
7. Who may sell, adjust and void: is "Cashier sells and spends; Admin adjusts, voids and reissues" right?
8. Tips: pay tips only with cash or GCash (the default), or also from a gift card or credit?
9. Offline: is "spend needs a connection" acceptable for a coffee shop with shaky internet, or do you want the capped offline
   spend of Phase 7 sooner?
10. Plan gating: points on Pro only, and gift cards and credit on Pro only? Or should points be on Starter so small shops get
    a loyalty program?
11. The accountant questions in Phase 0 (liability, official receipts, points as discount or tender, breakage): who asks them
    and when?
