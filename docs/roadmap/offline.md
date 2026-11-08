## Offline Feature (Phases 1-6)

Enable the POS app to function without a network connection.

| Phase | Name                          | Status      |
| ----- | ----------------------------- | ----------- |
| 1     | Connectivity & Cart Persistence | [Completed] |
| 2     | Catalog & Image Caching       | [Completed] |
| 3     | Offline Order Queue           | [Completed] |
| 4     | Edit Pending Offline Orders   | [Completed] |
| 5     | Batch Sync & Advanced Offline | [Completed] |
| 6     | Offline orders meet a changed catalog | [Completed] |
| 7     | Offline sync rework: judge at sale time, stock and limits | [Planned] |

### Phase 1 - Connectivity & Cart Persistence [Completed]

- Ping-based connectivity detection (`ConnectivityService`)
- Offline banner in header when disconnected
- Cart persistence via IndexedDB/Dexie.js (`carts` table)

### Phase 2 - Catalog & Image Caching [Completed]

- Batch POS catalog sync endpoint (`GET /api/sync/pos-catalog`)
- `CatalogCacheService` - caches products, categories, subcategories,
  add-on types, and product add-ons in Dexie (`catalog` table)
- `ImageCacheService` - caches images as blobs in Dexie (`images` table),
  serves blob URLs for offline display
- Order editor reads from catalog cache when offline
- Header profile image cached for offline display
- Receipt logo uses `URL.createObjectURL(blob)` (fixes NG0913)

### Phase 3 - Offline Order Queue [Completed]

- `pendingOrders` table in Dexie (v4)
- `OfflineOrderService` - queue, syncAll, auto-sync on reconnect
- Order editor checks connectivity; queues order locally when offline
- Pending offline orders UI in order list (amber banner, status badges,
  Sync Now button)
- Order list hides synced orders table and pull-to-refresh when offline
- Cart cleared from IndexedDB on logout

### Phase 4 - Edit Pending Offline Orders [Completed]

- Tap a pending offline order to reopen it in the order editor
- Navigate via query param: `/orders/editor?offline=OFF-260224-001`
- Same editing flow as online orders (modify items, customer,
  special instructions)
- Save changes back to the pending queue via `OfflineOrderService.update()`
- Completed offline orders open as read-only (Back + Discard only)
- Show current order status badge on pending offline order cards
- Discard pending orders from inside the editor (confirmation modal)
- Save-as-image receipt works for offline orders (shows localId as
  order label, uses offline order status)
- Offline order numbering format: `OFF-YYMMDD-###`

### Phase 5 - Batch Sync & Advanced Offline [Completed]

- **Batch create order endpoint:** `POST /api/orders/batch` accepting an
  array of orders. Implemented via `CreateOrderBatchCommand` +
  `CreateOrderBatchHandler` with a DB transaction for the full batch.
- **Order timestamp preservation:** `CreateOrderCommand` now accepts
  `createdAt`; API uses `request.CreatedAt` (UTC) when provided, otherwise
  falls back to `DateTime.UtcNow`.
- **Frontend batch sync:** `syncAll()` sends pending orders in batches of
  5 to the batch endpoint (`OrderService.createOrdersBatch()`), with
  offline `createdAt` converted to UTC.
- **Retry with exponential backoff** for failed syncs
  (`MAX_SYNC_ATTEMPTS=3`, `INITIAL_BACKOFF_MS=500`, doubled per retry).
- **Sync safety while editing offline orders:** auto/manual sync is paused
  while an offline order is open in the editor, then resumes after leaving
  the editor.
- **Stale catalog detection** - detect when product prices have changed
  since last catalog sync (tracked via `stalePriceItems` and
  `hasStalePrices` in `CatalogCacheService`).
- **Periodic background catalog refresh** when online
  (`CatalogCacheService` runs background refresh every 15 minutes and
  on reconnect when catalog is already loaded).
- **IndexedDB storage management** - clear old cached images
  (`images` table now stores `cachedAt`; cleanup removes stale entries and
  trims cache size by oldest-first policy).

### Phase 6 - Offline orders meet a changed catalog [Completed]

An order sold offline is a sale that already happened, so the server never reprices or rejects it behind the customer's back. When it syncs and the menu moved on, an Admin decides.

- **What is held.** A Completed offline order is held as `PendingReview` (status 6) when, compared with today's catalog: a product or add-on is inactive, a line or add-on price differs from the price the POS quoted (this also catches a changed or ended discount), a bundle is inactive, ended, no longer matches its rules or costs something else, or the customer is inactive (`OfflineOrderReview`). An open (Pending) offline order is never held: it is priced when it completes.
- **What is saved.** The order is saved exactly as quoted: line prices, add-on prices, bundle price, tips and change. The reasons are listed on the order (`ReviewReasons`, one per line) with the quoted total (`QuotedTotal`). A held order is not a sale: the dashboard, the reports and the normal order lists leave it out (`OrderStatuses.Unconfirmed` is the one list of statuses that are not sales yet), it cannot be edited or voided, and nothing is deducted from stock.
- **Admin decision** (SuperAdmin and Admin, the `OrdersOverride` policy). `POST /api/orders/{id}/review/approve` makes it Completed at the quoted prices; `POST /api/orders/{id}/review/reject` (reason required) cancels it and puts the reason in `Note`, so it shows in the Voids and Refunds report. Both are audited (`OrderHeldForReview`, `OrderReviewApproved`, `OrderReviewRejected`). The Orders list has an "Offline orders needing review" banner for Admins, and order details has a "Needs review" box with the same buttons.
- **Sync protocol.** `POST /api/orders/sync` replaces the all-or-nothing batch for the POS: each order is saved in its own transaction and gets its own result (`OfflineSyncResultDto`: saved, held with reasons, or an error), so one bad order no longer fails the other four. The old `POST /api/orders/batch` stays for older apps.
- **No duplicates.** Every queued order is sent with a key of its queue number plus a per-device id (`OfflineLocalId`, unique index `UX_Orders_OfflineLocalId`). A sync that is sent twice (a timeout, then Sync Now) returns the saved order instead of saving it again. The device id is part of the key because queue numbers restart on every device.
- **POS.** An order queued offline carries each line's quoted price, the original price and promo label, each add-on's price and each bundle's price. The discount promotions are now saved with the catalog (`CatalogCacheService.discountedPromotions`), so an offline cart prices discounts like an online one; before, an offline sale got no discount and the server applied it at sync.
- **Checked in the running app** (throwaway database): a Cashier sold a Latte offline at 150 with the API stopped, the price was changed to 160, the API came back, the POS synced by itself, the order was held with "Latte now costs 160.00, quoted 150.00.", the Cashier saw no banner and could not approve (403), the Admin approved it from the banner, and it became Completed at 150.00 (and counted in the daily sales only from then on). Also checked by API: a retried sync returns the same order, a bad order does not stop the next one, reject needs a reason and shows as Cancelled.

### Phase 7 - Offline sync rework: judge at sale time, stock and limits [Planned, added 20 Oct 2026]

Phase 6 holds an offline sale whenever **today's** catalog differs from what the POS quoted. That is safe but too eager, and
it has gaps. Examples it gets wrong or does not cover: a price that changed *after* the sale was made is still held (the
device was right at the time); a promotion that ended or ran out after the sale is held; a promotion that ran out while the
device was offline lets the sale through at the quoted price but, when an Admin approves it later, takes no use; and an item
that ran out of stock is not considered at all. The principle stays: **a sale that already happened is never repriced or
rejected behind the customer's back.** This phase makes the check smarter, so Admins only see the sales that need a decision.

**1. Judge against the catalog as it was when the sale was made**

- The device already sends the time of the sale (`createdAt`). It also sends `catalogSyncedAt`, the time of its last catalog
  update (new field, saved on the order for audit).
- Keep a change log of what moves in the catalog: product and add-on price, active flag, promotion dates and rules, bundle
  price and items, `CatalogChangeLog` (entity, id, field, old value, new value, effective-from, changed by). The existing
  audit rows are not enough (they are not queryable by sale time), so this is a small dedicated table written by the same
  handlers that change those records.
- At sync, a difference only counts if it **took effect before the sale and after the device's last catalog update**: the
  device could not have known about it, and the shop's price was already different when the customer paid. A change made
  *after* the sale is not a conflict (no hold, no note). This removes most false holds: a price edited at 18:00 does not hold
  a 14:00 offline sale.
- Where it cannot tell (no change log yet for old data, or a missing `catalogSyncedAt` from an older app), it falls back to
  today's behavior (compare with the current catalog).

**2. Promotion limits and ended promotions**

- Evaluate a promotion's schedule and end date at the **time of the sale**, not at sync time. A sale made inside the window
  keeps its discount even if the promotion ended before the sync (no hold).
- **Limits used up while offline.** Uses are a shared pool the offline device cannot see. The sale was quoted and charged, so
  it is honored: it takes a use even when the pool is empty, and the promotion shows an **over limit** count (new
  `Promotions.OverLimitUses`, shown on the details page, in the Promotions Performance report and in the usage text, e.g.
  "52 of 50 used, 2 over limit from offline sales"). Nothing is held for this alone; it becomes an informational note.
- **Fix the known gap:** the quote carries the promotion id per line (`DiscountPromotionId`, `BundlePromotionId`), so an
  approved held sale takes its uses like any other sale. An Admin sees "uses this promotion: 1 use" in the review box.
- **Two sales and one use left** (an offline sale and an online one racing for the last use): the sale made *first* has the
  stronger claim, but the earlier-synced one is already final. Rule: never undo a saved sale; the later-synced one is honored
  and counted as over limit, as above. Document it on the promotion page so owners know a limit is "about", not a hard wall,
  when registers are offline.
- **Prevention at the register.** A promotion can be marked **not available offline** (`Promotions.AllowOffline`, default on for
  unlimited promotions and off for promotions with a usage limit). A limited promotion then shows as "needs connection" on the
  Promos tab when the device is offline, so the shop never promises a use it cannot check. Tick it on for a limited promotion
  the owner accepts the risk for (over limit is counted).
- A limit **per order** (`MaxPerOrder`) is local arithmetic and still works offline; a device that quotes a different number
  of covered items than the server works out is held, as in Phase 6.

**3. Stock**

- An item that has run out **never blocks or holds an offline sale**: the goods were already handed to the customer. At sync,
  deduction runs as usual and the balance may go negative, even for items set to block sales (blocking only applies to a sale
  being made while online). The order is saved normally and a **stock warning** note is added to it (informational, not a
  hold) and to the item (shows in the item's movement history and the next count suggestion, see Inventory Phase 7).
- A held order deducts stock only when approved (it is not a sale until then); a rejected one that was already handed over
  is treated as waste by the same "void asks what happens to the stock" rule (Inventory Phase 5).
- The POS shows "stock last updated" on a low-stock warning when offline, so a cashier knows the count may be old.

**4. Make the review smarter (fewer, clearer decisions)**

- **Structured reasons.** Replace the free-text lines in `ReviewReasons` with rows in `OrderReviewReasons` (order, line, code,
  expected value, quoted value, severity, text). Codes: `PriceChanged`, `AddOnPriceChanged`, `ProductInactive`,
  `PromotionEnded` (only if it ended before the sale), `PromotionOverLimit`, `BundleChanged`, `CustomerInactive`,
  `StockShortfall`, `UnknownProduct`. Severity: **Hold** (needs a decision) or **Note** (saved, informational).
- **Policy settings** (`OfflineSyncPolicy`, per shop later per tenant; the default equals today's behavior): per code, hold or
  note; a price-difference tolerance (for example notes only up to PHP 5 per line); and an optional **auto-approve** for
  reasons that are only notes. Every auto-approval is audited (`OfflineOrderAutoApproved`) with the reasons.
- **Admin actions** on a held order, beside Approve and Reject: *Approve at quoted* (honor, today's approve), *Approve and
  record the difference* (keeps the quoted price but saves the difference to the shop as an adjustment line so reports show
  what honoring the quote cost), and *Reject* (reason required; the sale is cancelled and, if goods were handed over, stock
  is treated as waste). **Bulk approve** with filters (by reason, by branch, by cashier, by date) and a count preview.
- **Aging and alerts.** A held order older than a set number of days is flagged; a daily push or the dashboard insight lists
  how many are waiting and their total value. Today an unanswered hold sits quietly.
- **Cashier feedback.** After a sync the POS shows each queued order's result on the device (saved, saved with a note, sent
  for review, could not sync) in plain words, so the cashier is not left guessing. The cashier still cannot approve.
- **Orders that cannot be saved** (a hard-deleted or unknown product, bad data): today the order stays in the queue with a
  message and blocks nothing else. Add an **Unsynced orders** screen (Admin) showing the quoted order, the error, and the
  choices: fix and retry, save as a note-only record with the quoted lines (for the cash drawer), or discard with a reason.
  Nothing is dropped silently.

**5. Money must still add up while an order is held**

- A held offline sale already has cash in the drawer. The **Daily Close** gets a line "Offline sales held for review" (count and
  amount) so the drawer reconciles with the sales shown, and the dashboard shows the same. Held orders remain excluded from
  revenue, sales counts and reports until approved (as in Phase 6), but they are visible next to them.
- The report that counts discounts and refunds notes the cost of honored quotes (the difference recorded in Admin actions).

**6. Branches, tenants, cashless**

- A queued order carries its branch (see Multiple Branches) and syncs into it; the change log and the policy are per tenant.
- A cashless payment cannot be verified offline (Cashless Payments): an offline "GCash" sale is the unverified fallback and is
  held or flagged for payment confirmation by the same review, with its own reason `PaymentUnverified`.

**Data changes** (script under `tools/sql`, then rescaffold): `CatalogChangeLog`; `OrderReviewReasons`; on `Orders`:
`CatalogSyncedAt`; on `Promotions`: `OverLimitUses`, `AllowOffline`; `OfflineSyncPolicy` settings; audit actions
`OfflineOrderAutoApproved`, `OfflineSyncPolicyChanged`. Existing `ReviewReasons` text stays for old orders.

**Calculations.** Which reasons apply, tolerance checks and the over-limit count are decisions about money and sales, so the
rules go into `WTF.Calculations` (`OfflineOrderReview` already lives with the order review; extend it) with shared sample
cases for the POS side where it quotes.

**Tests and checks.** Unit and handler tests for each code: price changed before vs after the sale, promotion ended before vs
after, over-limit use, stock shortfall (saved with a note, never held), tolerance, policy hold vs note, auto-approve audit,
bulk approve, reject of a handed-over sale writes waste, unsynced orders screen, Daily Close line. Then the same kind of
hand-checked run on a throwaway database as Phase 6 (never the real `WTF` database): API stopped, change the price at a time
before and after a sale, end a promotion, use up a limit with an online sale while the POS is offline, run out of stock; bring
the API back and check what is held, noted, approved and what the reports, the drawer line and the stock show.

**Open questions**

- Honor an offline quote even when a limited promotion is over its limit (assumed yes, counted as over limit)? Or hold those for
  a decision as today?
- Should price differences below a small tolerance never bother an Admin (assumed yes, set by the owner)?
- Is "approve and record the difference" wanted, or is honoring the quote with no extra line enough?
- How long may a held order wait before it is flagged?


---

