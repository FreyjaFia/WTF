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
| 5     | Customer link: redeem a code, check a balance | M  | [Planned] |
| 6     | Later: online sale, offline spend, printed batches | L | [Idea]  |

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
| `GiftCards` | `Id`, `CodeHash` (HMAC-SHA256 with a server secret), `CodeLast4`, `InitialAmount`, `Balance` (cached) with `RowVersion` and check `Balance >= 0`, `Status` (Inactive, Active, Void, Expired, Used), `ExpiresAt?`, `IssuedAt`, `IssuedBy`, `SoldBranchId?`, `OwnerCustomerId?`, `Note`, `Source` (Sold, Promo), `CampaignName?`. The code is shown once and never stored in plain text. |
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
5. A customer-link order cannot spend credit or a card in the first version in Phases 2 and 3. Staff can add the tender when they approve the order; Phase 5 lets the customer enter a gift card code on the link themselves, with a hold until approval.

### Phase 0 - Decisions and accountant check [Planned]

**Pogi, 18 Nov 2026: skip the accountant and legal checks for now.** The defaults below stand and each check becomes a settings switch if needed later.

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
- Plan gating: one new key `storedvalue` in `PlanFeatures` (Pro only (decided by Pogi, 18 Nov 2026); hidden menu items and the graceful "Not in
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
- **Cancelling a completed order is the existing "Refund Order" button** (same `VoidOrderHandler` as "Cancel Order" on a pending order: a Completed order becomes Refunded and needs a note; the whole order, no partial). In the app there is no separate "void"; this plan says "refund" for a completed order and "cancel" for a pending one. Everything below hangs on that action.
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

- **Code only, no physical card (decided 18 Nov 2026).** The customer gets the code as a receipt print (with QR) and the cashier can also show it on screen for the customer to photograph or write down; there is nothing to hand over. Printed cards stay a later idea.
- **Selling.** "Sell gift card" on the POS: pick a preset (₱200, ₱500, ₱1,000, editable by the Owner in settings) or type a custom amount within the minimum and maximum, take cash or GCash, and the server
  issues the card. The code is random, 16 characters from an alphabet without look-alikes (no 0/O, 1/I/L), at least 80 bits,
  shown **once** and printed on the receipt with a QR, value and expiry (if any). Only the hash and last four are stored. The
  card is `Active` once payment is recorded. A customer is optional (a named gift helps support).
- **Promotional (free) cards, added 18 Nov 2026.** An Admin (`storedvalue.promo`, new permission) can generate a card with no payment: a single card (a giveaway, an apology) or a **batch** (for example 50 cards of ₱100 for a campaign, shown once as a downloadable list of codes). Each has a required reason or campaign name, an optional expiry (promotional cards may expire even when sold cards do not, subject to the Phase 0 check) and a per-user monthly cap set in settings. A promo card is flagged `Source = Promo` (sold cards are `Sold`) and writes a ledger `Issue` row with no `StoredValueSales` row, because no money came in. In the books it is a marketing cost recognized when spent, not a liability backed by cash; the liability report and Daily Close show **sold** and **promo** separately, and a "Promo cards" report lists campaign, issued, spent, outstanding, expired. Cashiers cannot issue them. Unspent promo value that expires is not breakage income.
- **Using a card (how the customer redeems it).** The customer tells or shows the code (a photo of the receipt, a screenshot, or the QR). At checkout the cashier opens "Gift card" in the Pay panel and types the code or scans the QR with the camera (build the scanner once
  as a shared component; the inventory plan wants barcode scanning too). Only after a match does the screen show the last four
  and the balance. A wrong code gets one generic answer.
- **Guessing is blocked:** lookups are rate limited per user and per shop (stricter than the `loyalty-policy` limiter, for
  example 5 tries a minute per user); repeated misses lock lookups for that user for 15 minutes and notify Owner and Admin;
  every miss is audited without the typed text.
- **Partial use** is normal: the card stays `Active` with the remainder, at zero it becomes `Used`. **No cash back** for a
  remaining balance.
- **Refund of an order paid with a card** returns to the same card (`ReturnSpend`), even if it expired meanwhile.
- **Why shown once (decided 18 Nov 2026: hash and reissue, not encrypted storage).** Only a hash is kept so nobody with database or screen access can read live codes. The "Card issued" screen stays open until the receipt is printed and has a Reprint button; after that a lost code is fixed by reissue. Looking a card up for support uses the last four, the sale receipt number or the customer name.
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
- **Not in this phase:** selling or spending on the customer link (spending is Phase 5; selling needs the Cashless provider payments).
- Tests: code randomness and the generic miss answer; only the hash in the database; partial use then remainder; refund returns
  to the same card; two registers redeeming one card at once (one wins, the other is refused); expired card refuses spend but
  accepts refund return; voided card refuses everything; rate limit and lock; cross-tenant lookup fails; Cashier cannot void or
  adjust; a card sale never appears in sales reports.

### Phase 4 - Reports, Daily Close and liability [Planned]

**Simple rule (Pogi, 18 Nov 2026):** an order paid with a gift card, credit or a promo card is a normal sale for its full amount, in every sales report. Selling a gift card or topping up credit is not a sale, so it stays out of sales totals; it shows as its own line ("Gift cards sold", "Credit sold") on the Daily Close and the liability report. A report switch **"Include gift card and credit sales in totals"** (default off) adds those lines to the totals for owners who prefer to see cash in. A card spent on an order is never counted twice: the sale counts when the order is made, not when the card was sold. Free promo cards: nothing is counted when they are issued; when one is spent the order is a normal sale and the tender shows as "Promo card", so the Promo cards report can show what the campaign gave away. How to book it is parked with the accountant questions.

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
6. Phase 5 customer link (after Phase 3 and the link hardening), Phase 6 on demand.

**With the parallel work:** build on top of multiple branches so `BranchId` is stamped from day one (otherwise leave it nullable
and fill it with a follow-up script), and after Offline Phase 7 if offline credit spending is wanted. SQL script dates must not
collide with branches, Offline Phase 7 and kitchen. Any thread with schema changes runs `tools\dbsync.bat` on the database it
uses and says which; the real rescaffold runs on the laptop against `.\SQLEXPRESS`.

### Phase 5 - Customer link: redeem a code and check a balance [Planned]

Added 18 Nov 2026 at Pogi's request (no customer app; the existing web ordering link).

- **Redeem on the ordering link.** The checkout has "Have a gift card?": the customer types the code. The server checks it with the same generic answer, rate limits (per link, per address and per card) and lockout as the counter. A valid card shows only the last four and the amount that will be used.
- **Hold, then spend.** The order is saved `PendingApproval` with a **hold** ledger row (`Hold` kind) for the amount, so the card cannot be spent twice meanwhile. Staff approval turns the hold into a `Spend`; rejection, cancellation or an expired approval releases it (`Release`). Holds expire with the order and a nightly job releases strays. The cached balance and the available balance (balance minus holds) are both stored; a second order sees only the available part.
- **The customer cannot overspend**: the server recomputes the amount and the remainder is paid as the order says (cash or GCash at pickup).
- **Store credit on the link** is not offered (it needs proof of who the customer is); staff can apply credit at approval.
- **Check my balance page** (`/shop/:token/gift-card`): the customer types the code and sees the balance, expiry and last uses (date and amount only). Same lockout; nothing shown for a wrong code; no customer data.
- Tests: hold blocks a second order, release on reject, spend on approve, lockout and generic answers, link of another shop cannot read a card, a revoked link refuses.

### Phase 6 - Later ideas [Idea]

- Gift cards **bought online** by the customer on the customer link (needs the Cashless provider payments, Phases 2 and 3), shown as a QR or sent by message.
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

### Detailed build steps per phase (task list for the build threads)

**Phase 1 - Foundation**
1. Script `tools/sql/<date>_add_stored_value.sql`: tables, indexes (unique `IdempotencyKey` per tenant; unique `CodeHash` per tenant;
   index on `GiftCardId` + `CreatedAt`; index on `CustomerId` + `CreatedAt`), check constraints (`Balance >= 0`, `AvailableBalance >= 0`),
   `PaymentMethods` rows 3 to 4 (and 5 Promo card), `TenantId` filters, settings row, tenant lists (backfill and enforce scripts are
   not needed for new tables; add them to the platform export and delete lists). Run twice on a throwaway database.
2. `tools\dbsync.bat` on the database used; say which; remove only true duplicate scaffold classes.
3. `WTF.Calculations/StoredValue/`: `TenderSplit`, `StoredValueRules`, `CardCode` (alphabet and check-digit rules, no randomness
   inside), plus `shared/calculations/stored-value-rules.ts` and cases in `calculation-cases.json`.
4. API services: `ILedgerService`, `ITenderService`, `IGiftCardCodeService` (generate with `RandomNumberGenerator`, HMAC hash with
   `StoredValue:CodeHashKey` from secrets, never in the repo), `IStoredValueLookupGuard` (rate limit and lockout).
5. Settings endpoints, permission keys, `PlanFeatures.StoredValue`, audit enum values, `RouteTableTests` and `PolicyMatrixTests`.
6. Order create and refund paths call `ITenderService`; existing orders without tender lines still work (read `PaymentMethodId`).
7. Staging seed and reset keep list.

**Phase 2 - Store credit**
1. Customer details credit card and history; customer picker chip.
2. Add credit dialog (amount, cash or GCash, optional note), adjust dialog (signed amount, required reason), both audited.
3. Refund dialog gets "Refund as store credit" (only with a customer).
4. Pay panel credit row, preview math from the shared rules, server enforcement.
5. Expiry job (off by default), integrity job for credit.
6. Reports: credit balances, credit movement; Daily Close lines.

**Phase 3 - Gift cards**
1. Sell dialog (presets, custom amount, min and max, payment, optional customer), "Card issued" screen with Print and Reprint.
2. Code lookup endpoint with generic answers, rate limits and lockout; scanner component (camera, manual entry fallback).
3. Pay panel gift card row; multiple cards on one order (up to 3), each a tender line.
4. Refund routing, reissue, void-sold-card, move balance to credit, expiry setting and job.
5. Promo cards: single and batch generation, campaign name, monthly cap, CSV of codes shown once, Promo cards report.
6. Gift cards list and details pages with filters drawer; settings page.

**Phase 4 - Reports**: liability, gift cards, promo cards, credit, Payments split, Daily Close lines, workbook sheets, dashboard tile,
report switch "Include gift card and credit sales in totals".

**Phase 5 - Customer link**: code box, holds, approval and release, balance page, expiry of holds, stray-hold job.

### Test scenarios

Each scenario names its setup (S), action (A) and expected result (E). Amounts are pesos. "Real SQL" means the existing real-SQL test
suite; "Shared" means a case in `calculation-cases.json` that both the C# and Angular runs load; "UI" means a Playwright check at
375, 820 and 1440 on a throwaway database.

**A. Calculations (Shared)**
1. Split, one card covers all: total 180, card 200. E: card 180, cash 0, card left 20.
2. Split, card short: total 180, card 100. E: card 100, cash or GCash 80.
3. Split, credit then card then cash: total 500, credit 120, card 200. E: credit 120, card 200, cash 180 (fixed order: credit, cards by id, then cash).
4. Tip never covered: total 180, tip 20, card 500. E: card 180, tip 20 paid in cash or GCash, card left 320.
5. Two cards: total 300, card A 100, card B 150. E: A 100, B 150, cash 50.
6. Senior/PWD first: item 100, VAT-registered. E: tender is applied to 71.43, not 100.
7. Promotion first: bundle price 199 on a 250 list. E: tender is applied to 199.
8. Rounding: total 89.29 and credit 89.29. E: exactly 0 left, no cent drift.
9. Preset and custom amount limits: 99.99 refused, 100 accepted, 5,000 accepted, 5,000.01 refused, 0 and negative refused.
10. Code alphabet and format: never contains 0, O, 1, I or L; always 16 characters; typed lower case or with spaces or dashes is accepted after normalizing.
11. Expiry date: sold at 23:30 on 31 Jan with 6 months, shop time zone Asia/Manila. E: valid through the end of 31 Jul (Asia/Manila), UTC stored.
12. Zero-balance state: balance reaches exactly 0 gives `Used`; a refund return makes it `Active` again.

**B. Gift card selling**
1. Sell 500 for cash. E: card Active, balance 500, `StoredValueSales` row, ledger Issue 500, audit `GiftCardSold`, Daily Close "Gift cards sold 500", drawer cash expected +500, no order, no change in any sales report.
2. Sell 500 for GCash. E: same, tender GCash; drawer cash unchanged.
3. Sell with a customer attached. E: card shows owner; the customer's details list the card by last four.
4. Min and max. E: 99 and 5,001 refused with a clear message; settings can change limits; a change applies to new sales only.
5. Plan gating: Starter shop. E: menu hidden, route shows "Not in your plan", API 403 `not_in_plan`.
6. Cashier sells; AdminViewer cannot. E: 403 for AdminViewer.
7. Sold offline. E: the Sell button is disabled with "Needs connection"; nothing queued.
8. Double click on Sell. E: one card only (idempotency key).
9. Code shown once: after leaving the Card issued screen, no endpoint returns the code (API test: response never contains the code or hash), the database holds only the hash and last four, logs hold neither.
10. Reprint on the issued screen works until closed; after closing, Reprint is gone.
11. Receipt: contains the code, QR, value, expiry if any, branch and cashier; summary image likewise.

**C. Gift card redemption at the counter**
1. Full use: card 500, order 180. E: card 320, order paid, tender line Gift card 180, order is a normal sale, sales reports show 180 gross.
2. Partial then rest cash: card 100, order 180. E: card 0 and Used, cash or GCash 80, change rules unchanged.
3. Typed with spaces and lower case. E: found.
4. Scanned QR. E: found; scanner denied permission falls back to typing.
5. Wrong code. E: generic "Code not found"; audit `GiftCardLookupFailed`; counter increments.
6. Rate limit and lockout: 5 wrong in a minute by one cashier. E: further lookups by that cashier refused for 15 minutes with "Too many tries"; Owner and Admin get a notification; another cashier is not locked; a correct code is also refused during the lockout.
7. Voided card, Used card, Expired card, Inactive card. E: each refused with its own clear (but non-leaky) message after a valid lookup; the balance is shown only for Active cards.
8. Two cards on one order. E: both applied in id order; each ledger row has the order id.
9. Same card twice on one order. E: refused (one line per card).
10. Tip with a card. E: refused; tip stays cash or GCash.
11. Redeem across branches. E: allowed; the ledger stores sale branch and redeem branch.
12. Another shop's code. E: answers exactly like a wrong code, no leak (cross-tenant test).
13. Offline. E: gift card option disabled with "Needs connection"; the cashier takes cash; an offline order never contains a gift-card tender (the queue rejects it client side, the sync rejects it server side if forced).
14. Connection drops after tapping Pay. E: retry returns the saved order; the card is charged once; if the first request never reached the server, the retry creates the order once.
15. Order with a card tender then order override. E: blocked when total or tender changes; note-only edit allowed.

**D. Double-spend and concurrency (Real SQL)**
1. Two registers spend the same card (balance 100) at the same time with 80 each. E: one succeeds, one refused naming the card and its new balance; balance 20; no partial order exists.
2. 20 parallel spends of 10 on a card with 100. E: exactly 10 succeed, balance 0, ledger sum equals cached balance.
3. A spend and a refund return at the same time. E: both apply, balance correct.
4. Same request sent twice (same idempotency key). E: one order, one ledger row.
5. Deadlock check: order A uses credit then card 1 then card 2; order B uses card 2 then card 1 in the cart. E: both lock in the fixed order; no deadlock exception; one may wait.
6. Check constraint backstop: a test handler that skips the balance check still cannot make the balance negative (the database refuses).
7. Cached balance after a random sequence of 500 operations equals the ledger sum; the integrity job reports no mismatch; a deliberately edited cached balance is reported as `BalanceMismatchFound`, and nothing is silently fixed.
8. Hold race (Phase 5): two link orders each holding 80 of a 100 card. E: the second is refused (available balance 20).

**E. Refunds and cancellations**
1. Refund a completed order paid fully with a card. E: status Refunded, note required, card balance back to what it was, ledger `ReturnSpend`, audit.
2. Refund an order paid with card 100 + cash 80. E: card gets 100 back; the cash part follows the existing cash refund rules.
3. Refund when the card has expired meanwhile. E: allowed; balance returns; the card stays Expired but shows the returned balance and is usable only through an Admin extension or reissue (document the choice: returned money is kept on an expired card and the Admin can reissue it).
4. Refund when the card was voided or reissued meanwhile. E: the return goes to the reissued card.
5. Cancel a pending order that has a card tender (created with a hold, Phase 5, or counter orders not yet completed). E: hold released or spend returned; no balance leak.
6. Refund-as-credit on a cash order. E: credit increases by the order total, ledger `RefundToCredit`, no cash leaves the drawer.
7. Refund an order twice (double click or two admins). E: the second is refused ("already voided").
8. Refund an order paid with credit, customer later deactivated. E: credit returns; the customer record stays readable.
9. "Refund to cash instead" by an Admin with a reason. E: allowed for card and credit; audit includes the reason; Cashier cannot.
10. Refund of the sold card itself (customer changes their mind), unused. E: Admin only, card Void, cash or GCash returned, Daily Close shows a negative "Gift cards sold" correction line; used card refused.
11. Part-used card sold-refund attempt. E: refused with "Card has been used".

**F. Lost card, reissue and support**
1. Admin finds a card by last four, by receipt number, by customer name. E: found; two cards with the same last four show both with sale date and amount.
2. Reissue. E: old card Void, new card Active with the same balance, one transaction, two audit entries, reason required, the new code shown once; the old code now answers "not valid".
3. Reissue by a Cashier. E: 403.
4. Reissue a Used card (balance 0). E: refused.
5. Reissue while an order is mid-checkout using the old card. E: the checkout fails with "Card changed" and nothing is half written.

**G. Store credit**
1. Top-up 300 cash. E: credit 300, `StoredValueSales`, Daily Close "Credit sold 300", not a sale.
2. Walk-in cannot receive credit. E: refund-as-credit option hidden; API refuses without a customer.
3. Spend 120 of 300 on a 120 order. E: credit 180.
4. Spend with a tip. E: tip paid in cash or GCash.
5. Credit and card together. E: order of use credit, card, cash.
6. Adjust by an Admin (+50 with reason; -500 when balance is 300). E: first works and is audited; second refused (cannot go negative).
7. Cashier adjust. E: 403.
8. Daily adjustment cap. E: after the cap, a further adjustment by that Admin is refused until tomorrow (Owner not capped).
9. Credit shared across branches. E: top-up at Makati, spend at Cebu, ledger rows carry both branches.
10. Merge or delete customer. E: a customer with credit cannot be deleted; the dialog says so; merging is out of scope.
11. Offline. E: credit option disabled with "Needs connection".
12. Expiry on (test config): credit untouched for N months. E: nightly job writes `Expire`, Admin notification a week before.

**H. Promo cards**
1. Admin generates one card of 100 with campaign "Opening week". E: card Active, `Source = Promo`, no `StoredValueSales`, Daily Close unchanged, audit.
2. Batch of 50 x 100. E: 50 cards, one-time download of codes, second download impossible, batch audited.
3. Monthly cap of 5,000 per Admin. E: the batch that would exceed is refused with the remaining allowance.
4. Cashier tries to generate. E: 403.
5. Spend a promo card on a 180 order. E: normal sale 180, tender line "Promo card" 100, Promo cards report shows issued, spent, outstanding.
6. Expired promo card. E: refused; the Promo report shows it as expired; no income booked.
7. Reissue and void of a promo card. E: same as a sold card, `Source` stays Promo.

**I. Customer link (Phase 5)**
1. Valid card at link checkout. E: only the last four and the amount to use are shown; the order is PendingApproval with a hold; the available balance drops, the balance does not.
2. Staff approve. E: hold becomes spend; order Pending or Completed as before; receipt shows the card.
3. Staff reject or customer cancels. E: hold released.
4. Shop never answers. E: when the order expires or is auto-cancelled, the hold is released; the stray-hold job releases holds with no live order.
5. Wrong codes on the link. E: generic answer, per-link and per-address and per-card rate limits, lockout, Owner notification.
6. Card of another shop on this shop's link. E: same as wrong.
7. Revoked or expired link. E: 404 as today; no card lookup.
8. Balance page. E: shows balance, expiry and dates and amounts of uses; never names, customers, branches or order numbers.
9. Held card used at the counter in the meantime. E: counter sees only the available balance.
10. Lapsed subscription. E: link answers 503 as today; no lookups.

**J. Reports and Daily Close**
Worked day (use for the hand-worked check): Makati opens with a drawer of 1,000. Sales: 3 orders 180 + 250 + 120 = 550 (180 cash, 250 gift card, 120 GCash). One gift card sold for 500 cash. One credit top-up 300 GCash. The 180 cash order is then refunded in cash.
1. Sales report. E: gross 550, refunded 180, net 370 (the card sale and top-up are not in it); with the switch on, totals show 1,170 (370 + 500 + 300) with the two extra lines labelled.
2. Payments report. E: cash 180 (refunded 180), GCash 120, gift card 250; stored-value tender is 250 of 550 gross, 45.5% (the card sale and the GCash top-up appear only in the stored-value lines).
3. Daily Close. E: gift cards sold 500, credit sold 300, tender lines per method, cash expected = 1,000 + 180 (cash sale) + 500 (card sold for cash) - 180 (cash refund) = 1,500; the GCash top-up and GCash order are not in the drawer. Check by hand against the screen.
4. Liability report. E: opening + issued - spent - expired - voided = closing, per branch and for all; the sum of the card list's balances equals the closing figure.
5. Totals row equals the sum of the rows on screen, Excel, PDF and CSV for every new table.
6. Promo cards report. E: the campaign row equals the batch.
7. Gift cards list never shows or exports a full code; Cashier cannot export; filters drawer and sorting work; columns collapse to cards below 1280.
8. Dashboard tile appears only when the feature is in the plan; links to the liability report.

**K. Security and tenancy**
1. Every new route is in `RouteTableTests` and needs authorization; policy matrix covers Owner, Admin, Cashier, AdminViewer, StockManager, ItemManager and a custom role.
2. A user from shop A cannot read, list or spend shop B's cards, credit or ledgers (ids guessed from the URL).
3. Ids from the request body for tenant, branch or customer are ignored.
4. A branch-restricted user cannot see another branch's stored-value activity in reports.
5. Logs and audit text never contain a full code, a hash, a full phone number or a balance (log scan test with a sample run).
6. "Sign in as" (platform, read-only) can view but not sell, spend or adjust; the attempt is audited.
7. Tenant export contains ledgers with hashes only; tenant delete removes every new table.
8. Downgrade to Starter: balances stay; spending existing cards and credit still works; selling and top-up and promo generation are refused; the banner shows.
9. Suspended or lapsed shop: writes are refused as today (402); offline sync is not affected because it never carries stored-value tenders.
10. Brute force from many IPs against one shop's lookup: the per-shop limit holds even when the per-user limit is not hit.

**L. UI (375, 820, 1440; default and cafe styles; 200 ms ease-out)**
1. Pay panel: bottom sheet on 375, side panel from 820; the amount steppers, balance chips and the "Still to pay" line never overflow; keyboard does not cover the Pay button on 375.
2. Gift card entry: scanner opens, denies gracefully, manual entry works; wrong code message does not move the layout.
3. Sell dialog: presets, custom amount, validation text, issued screen with QR; print preview.
4. Lists: filters drawer, sortable headers, cards under 1280; no horizontal scroll; empty states.
5. Offline banner: stored-value rows disabled with the reason; the rest of checkout works.
6. Edit pages ask "Discard Changes?" on back; settings validate min below max and presets within limits.
7. Not-in-plan page and hidden menu items for a Starter shop.
8. Accessibility: focus visible on all new controls, labels on the code field, announce lockout and errors.

**M. Staging demo data check**
After a staging deploy: the seeded shop shows three customers with credit and history, three cards (untouched, part-spent, used), one promo campaign with a batch, orders paid by card and split tender, a refund returned to a card, and the liability report numbers equal the hand-worked ones. Running the seed twice leaves the same totals.

### Open questions for Pogi

1. Gift cards: code only and presets plus custom amount (decided). Suggested limits, editable in settings: minimum ₱100, maximum ₱5,000 per card; presets ₱200, ₱500, ₱1,000. Change them?
2. May a card be used at every branch (suggested yes)?
3. Expiry: none until the law is checked (suggested). Who checks it?
4. Store credit: do you want "refund as store credit" in the void dialog (the most useful route) and counter top-ups, or only
   the refund route?
5. Who may sell, adjust, void and reissue: is "Cashier sells and spends; Admin adjusts, voids and reissues" right?
6. Tips: only cash or GCash (the default), or also from a card or credit?
7. Offline: is "spending needs a connection" acceptable for a coffee shop with shaky internet?
8. The accountant questions in Phase 0: who asks them and when?
