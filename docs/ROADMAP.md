# WTF POS - Feature Roadmap

This document tracks planned features, their phases, and implementation
details. It serves as context for AI assistants (Copilot, Codex, ChatGPT)
and human developers.

---

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

## Inventory Management Feature [In Progress]

Track physical stock for retail products, product bundles, and consumable
items such as cups, lids, milk, syrups, and packaging. Products remain the
sellable POS catalog entries; inventory items are the physical stock being
counted. A product can deduct from one or more inventory items.

### Core Model

- **Product** - what the cashier sells in POS.
  - Example: `1L Oat Milk`, `Oat Milk Box of 6`, `Regular Latte`.
- **Inventory item** - what the business physically counts.
  - Example: `1L Oat Milk`, `Regular Cup`, `Large Cup`, `Cup Lid`.
- **Product inventory link** - how selling a product consumes stock.
  - Example: `1L Oat Milk` deducts `1` from `1L Oat Milk`.
  - Example: `Oat Milk Box of 6` deducts `6` from `1L Oat Milk`.
  - Example: `Regular Latte` deducts `1` from `Regular Cup`.
- **Stock movement** - immutable ledger of stock changes.
  - Add stock, sale deduction, manual adjustment, correction, spoilage,
    and other future movement types.
  - Includes quantity, date/time, user, notes/reference, and before/after
    quantity where useful.

### Product Creation Helper

When adding or editing a product, support an optional inventory setup flow:

- `No stock tracking`
- `Track this product as its own inventory item`
  - Auto-create an inventory item using the product name.
  - Link the product to that inventory item with deduct quantity `1`.
  - Optional starting stock, merchant/cost price, warning level, and
    critical level.
- `Deduct from existing inventory item`
  - Used for boxes, bundles, alternate units, or variants.
  - Example: `Oat Milk Box of 6` deducts `6` from the existing
    `1L Oat Milk` inventory item.
- Future: `Deduct multiple consumables / ingredients`
  - Used for drinks and prepared items that consume cups, lids, milk, etc.

### Phase 1 - Retail Inventory Foundation [Partially Completed]

Implemented:

- Inventory database foundation:
  - `InventoryItems`
  - `ProductInventoryLinks`
  - `StockMovements`
  - indexes, constraints, audit FKs, and SQL deployment script
- Scaffolded EF Core domain/context support for inventory entities.
- Item API endpoints under `/api/items`:
  - list items
  - get item details
  - create/update/deactivate items
  - add stock movement
  - link products to inventory items
- Inventory item fields now track:
  - name, SKU, barcode, base unit, stock display unit
  - units per stock unit
  - current quantity, cost price
  - warning and critical stock levels
  - active/inactive status
  - created/updated audit fields
- Stock movement ledger implemented for initial stock and stock-in movements.
  Sale deduction movements were removed from order creation for now.
- Product inventory links support configurable quantity per sale.
- Order creation deducts stock when a sale completes (see "Done (21 Oct 2026)" below); it blocks only items set to block.
- Inventory audit actions/entity types added for item create/update/delete,
  stock-in, and product-inventory linking.
- Frontend inventory module added:
  - `/inventory/items`
  - `/inventory/items/new`
  - `/inventory/items/details/:id`
  - `/inventory/items/edit/:id`
  - `/inventory/stock-in`
- Inventory item list/details/editor implemented with management-aligned
  responsive layout, low-stock badges, delete confirmation, unsaved-change
  guard, and item action menu.
- Inventory unit constants include display abbreviations for list/detail
  quantity rendering.
- Management and inventory tab navigation now uses array-driven route
  configuration with aria labels.
- Inventory navigation added to sidebar and mobile dock.
- Item-side product link management (v1.8.0):
  - `PUT /api/items/{id}/product-links` assigns an item's full set of product
    links in one request (add, update quantity, remove), validates duplicates,
    quantities, and product existence, writes an audit entry, and returns the
    refreshed item.
  - Item editor has a Linked Products card showing each linked product with
    its quantity per sale in the item's base unit (for example `x200 ml`).
  - `Manage Links` opens a drag-and-drop modal (available vs linked lists)
    with search, a product/add-on filter, and a per-product quantity input.
  - Products and add-ons can both be linked, so size or flavor add-ons can
    consume their own stock once order-time deduction returns.
  - Saving links refreshes only the Linked Products card, so cancelling the
    modal never discards unsaved item form edits.
- Link and restore rules for items, products, and customers:
  - Deleting is always a soft delete (`IsActive = false`); nothing is removed.
    Links stay as they are, so restoring brings everything back.
  - Removing a product from an item in Manage Links deactivates the link and
    keeps its row and quantity; assigning links never deletes them.
  - Re-adding a product reuses the old link and pre-fills its previous
    quantity, including quantities of links removed earlier in the same session.
  - Restore button (list 3-dot menu and details page header, with a confirmation
    dialog via the shared `app-confirm-dialog`) for inactive items, products,
    customers, and users (`POST /api/{items,products,customers,users}/{id}/restore`,
    audited as `ItemRestored`, `ProductRestored`, `CustomerRestored`,
    `UserRestored`). The item list now shows an Inactive badge.
  - Promotions (all three types) are soft deleted too: deleting sets `IsActive = false` and keeps the promotion, its image and its rules, so a promotion used on past orders no longer fails on the order foreign keys. `POST /api/management/promotions/{id}/restore` reactivates it, and the list and details pages have confirmed Delete and Restore actions.
  - Deleting a user deactivates them and revokes their refresh tokens. Login
    and token refresh now reject inactive users, so a deleted user can no
    longer sign in (login only matches active users).
    The users list API now returns all users unless `isActive` is passed.
  - Deleting a price override deactivates it instead of removing the row;
    creating it again reactivates the same row with the new price. Inactive
    overrides are ignored when pricing orders, same as before.
  - Closing the Manage Links modal by clicking the backdrop now runs the same
    cleanup as Cancel.
- Product add-on links are soft deleted too (`tools/sql/20261010_add_product_addons_is_active.sql`
  adds `ProductAddOns.IsActive`; run it before deploying the API):
  - Unlinking from the product or add-on side sets `IsActive = false`; the row
    and its price override are kept, so pending/historical order pricing that
    reads overrides directly is unchanged.
  - Re-linking reactivates the same row and updates its add-on type.
  - Every reader filters on `IsActive`: order create/update validation, the
    POS catalog, product add-on lists, linked-product counts, products-by-add-on,
    promotion validations (discounted, bundle, mix-match), and price override
    create/update/list.
  - The same script drops the `TR_ProductAddOns_ValidateAddOn` trigger. The rule
    (only add-ons can be linked) now lives in the assign handlers, and
    `UpdateProductHandler` blocks turning an add-on into a regular product
    while it has active links.

Done (21 Oct 2026, order-time stock and the inventory screens):

- **Schema** (`tools/sql/20261021_add_order_time_stock_deduction.sql`, run it before deploying the API):
  `Items.AllowNegativeStock` (default on), `StockMovements.ProductId` (FK), `OrderItemId` (a snapshot, no FK, lines are
  rebuilt on edit), the index on `(ReferenceType, ReferenceId)`, new movement types `Sale`, `SaleVoid`,
  `Waste` and `Adjustment`, and the table checks that kept balances at zero or above are dropped (a balance may go negative).
- **One service for all of it:** `IOrderStockService` (`DeductForOrderAsync`, `RestoreForOrderAsync`, in
  `Features/Inventory`) and `StockBalance`, the one place a balance changes. The arithmetic is in
  `WTF.Calculations/Inventory/StockRules` (`Requirements`, `Reconcile`, `Shortfall`, `ReturnedShare`, `AdjustmentDelta`).
- **Wired in:** create (as Completed), update (Pending to Completed, and the Admin override as a net difference), the
  offline sync and old batch (never refused for stock), approving a held offline order, and void. Pending, waiting and
  cancelled orders take nothing. A sale takes the quantity of every active link, add-on lines included (an add-on's
  quantity is per unit of its parent), summed per item and product before the check.
- **Stock adjustment** (`POST /api/items/{id}/stock/adjust`, `StockMovementsWrite`): counted quantity or plus/minus,
  required reason (Count correction, Damaged or spoiled, Lost, Other with a note), audited as `ItemStockAdjusted`.
- **Reading it back:** `GET /api/items/{id}/movements` (paged, by type) and `GET /api/orders/{id}/stock-movements`
  (`StockMovementsRead`). Audit actions `OrderStockDeducted`, `OrderStockRestored`, `ItemStockAdjusted`.
- **Screens:** Stock In page (real form, an item can be preselected from the list), stock history on item details
  (type filter, load more, order number as a link) with an Adjust Stock dialog, the "Allow sales below zero" switch on the
  item editor, the "Track inventory" card in the product editor (no tracking, own item, deduct from an existing item), a
  Stock movements box on order details, the stock choice per line in the refund dialog, and the stock warning in the POS
  completion flow and after an offline sync.

Decisions made:

- **No BranchId on stock movements yet.** The branch design (per-branch balances, transfers) is still open, so the column
  is left to the branches feature (Multiple Branches, Phase 1), which adds it with the rest of the branch model.
- **The balance changes with one guarded UPDATE** (`UPDATE ... OUTPUT`), not a rowversion: two registers, a stock-in and an
  adjustment can never overwrite each other. A blocking item is refused by the `WHERE` of that statement. There is no table
  check for it, because an offline sale is honored whatever the balance.
- **Movements are written per item and product** (and per line when one line caused it), so usage per product stays
  accurate after link edits. The check and the deduction use the sum per item.
- **Edits write the difference only:** more needed is a `Sale` row, less needed is a `SaleVoid` row. Correcting an order
  made before stock tracking started (no movements, older than the first sale movement) deducts nothing.
- **Void:** a refunded sale is always restored from its original movements (`SaleVoid`). A line the voider marks "Not
  returned / was made" also writes a `Waste` row of the same quantity ("Refunded, not resaleable"), so the balance stays
  down but the quantity leaves the sales usage. A line that goes back to the shelf writes only the `SaleVoid`. The refund
  dialog defaults to not returned for everything except retail products; a Pending order voided to Cancelled restores
  nothing. The full waste screens and reasons stay in Phase 5.
- **The refund dialog only asks about lines that took stock.** `OrderDto.StockLineIds` lists the lines of a completed order
  whose product (or one of its add-ons) has a `Sale` movement; an order with none (untracked products, or made before stock
  tracking) skips the question and refunds as before.
- **Stock warnings are not stored on the order.** The create and update responses and the sync result carry
  `stockWarnings` (below zero, or at a warning or critical level) and the POS shows them once; a sale that went below zero
  has the note "Balance went below zero" on its movement and shows in the item history. A held offline order takes its
  stock only when an Admin approves it (never refused).
- **Turning "Allow sales below zero" off** is refused while the balance is negative (count and correct it first).
- **Stock-in now uses the same guarded update**, so it is safe next to sales.

Checked in the running app (throwaway LocalDB database, API on 5282, built-in browser): Oat Milk 10,000 ml and a Latte
linked at 200 ml. Sell 3 (9,400), sell 1 (9,200), void the 1 as not returned (balance stays 9,200; history Sale,
SaleVoid, Waste), void the 3 returned (9,800), then a count of 9,000 from the dialog (difference -800, history row, 9,000),
and a 2-latte sale refunded as returned (8,600 back to 9,000). Also by API: a blocking cup refused an online sale (400
naming the cup and the shortfall, nothing saved), a warn-only syrup went to -50 with a warning, an offline sale of 3 on
the blocking cup (2 in stock) synced with a warning and left -1, and an adjustment lifted it to 0. The item history, the
order details box and the refund dialog showed the same figures. Not checked in the running app: the POS completion
alert for a sale made in the order editor, the Android build, and the stock-in form submit.

Done (26 Oct 2026, deleting and restoring items safely; no schema change):

- **An item still used by an active product cannot be deleted** (or switched off in the item editor): the API answers 400 with
  "This item is still used by N product(s): ... Unlink them first". Before, deleting a blocking item silently switched its
  blocking off, because a sale skips inactive items entirely. Links that are switched off, or that belong to a deleted
  product, do not count (`ItemDeactivation`).
- **Deleting an item tells the stock screens at once** (it goes through `IStockAlertService`, so the Needs Attention list and
  the sidebar, dock and bell counts update live) and **forgets its alert level** (`LastAlertStatus` back to 0), so restoring
  an item that is still low alerts again.
- **Stock-in and adjustments are refused on an inactive item** ("Restore it first"); before, only the buttons were hidden.
- **Switching an item on or off in the editor** is one transaction and is logged as `ItemRestored` / `ItemDeleted` as well as
  `ItemUpdated`, so the audit log shows the same event as the delete and restore buttons.
- **A sale that skips an inactive item says so**: the completion response carries the warning "Oat Milk is inactive, so this
  sale did not take stock from it." (create, update, sync, approving a held order), where it used to skip it silently. The skip
  itself is unchanged: a Pending order whose item is deleted before it completes takes nothing from that item.
- **Links to deleted products are not counted**: the Needs Attention "used by N products" and "enough for N sales" ignore them,
  the item list counts only live links, and the item details page lists active links only and marks a deleted product
  (`ProductItemLinkDto.ProductIsActive`). The link rows stay, so restoring the product brings them back.
- **An Admin can correct a completed order that holds a product deleted after the sale** (override flow): products already on
  the order are not re-checked as inactive, like the ended-bundle rule. Adding a deleted product, or saving a Pending order that
  has one, is still refused.
- Tests: handler tests for each rule above, direct tests for the alert recipient handlers (allowed roles, audit, switching
  people on and off, back to the default roles), and the delete-then-restore alert in `StockAlertServiceTests`.
- **Checked by API on a throwaway database (26 Oct 2026):** deleting Oat Milk (used by Latte and Mocha) and a blocking cup
  (used by Mocha) gave a 400 naming the products; an unlinked item with stock deleted fine; stock-in and adjust on an inactive
  item gave a 400; deleting a critical item dropped it from Needs Attention and restoring it alerted again ("Critically low");
  an item linked to a live and a deleted product showed "used by 1 product"; a Croissant sale linked to an inactive Sleeve
  completed with the warning and left the Sleeve at 10; an Admin override of a completed order holding a deleted product
  worked (quantity 1 to 2), while adding that product to another order or to a new order was refused.
- **Checked in the browser (same database):** the refused delete of Oat Milk shows the error alert with the product names; the
  list shows "1 linked product(s)" for Caramel Syrup (a live and a deleted product) and "2" for Oat Milk; item details lists
  "Retired Drink (deleted product)"; deleting Lid dropped the Needs Attention count from 2 to 1 and restoring it brought it back
  to 2 with a new alert in the bell, all without a refresh. Found and fixed on the way: the list's action menu still offered
  "Add Stock" on an inactive item (the menu now shows only Restore), the action menu printed empty divider lines for the
  actions it hid, and the small-screen item cards did not look like the product list: they now have the same avatar, name and
  detail line with stock and status underneath (cost shows only when set), and the desktop table's "Not set" is smaller and
  lighter. Checked at phone, 640 px and desktop width. Still open: from 640 px the sidebar is always open and leaves the
  content about 380 px, which squeezes pages such as item details (the title wraps one letter per line); that is the app-wide
  layout, not the item list.
- **Long names (26 Oct 2026, checked at phone width with a 95-character name and one with no spaces):** the item list, item
  details, product list and product details wrap names, SKU, barcode and codes instead of overflowing. On phones the pinned title
  of the item and product details pages is limited to 2 lines and a tap expands it (the full name is also its tooltip on
  desktop), so a long name no longer takes half the screen. It is one shared component, `app-page-title`, used by the details
  and editor pages of items, products, customers, users and promotions (ten pages); a new page with a user-entered title uses it
  too. Tap to expand checked in the browser on the product editor; the order details pages keep their fixed title.
- **Coverage list (26 Oct 2026):** it now follows the other lists: search on its own row, the Needs setup / All products switch
  and the refresh icon (with pull to refresh) on the right, and every row keeps its status pill and Set up stock button in
  the same right-hand column whatever the name length (on phones the pill sits under the name). Before, a long name pushed
  them under the title, Refresh was a text button beside the heading, and an unbroken name made the page scroll sideways.
- **Not built, on purpose (decided 26 Oct 2026):** a "write off the remaining stock" option when deleting an item with a balance, a
  "count it" note on restore (the balance can be stale because sales while it was deleted took nothing), and a list of open
  orders and promotions in the product delete confirmation.

Remaining:

- Review report/dashboard inventory impacts after real usage data exists.
- Show "stock last updated" on a POS low-stock warning when offline (Offline Phase 7).
- Per-item blocking can be switched on in the item editor now; it only matters once real stock counts exist.
- **Tell the cashier before checkout when a blocking item cannot cover the cart (built 26 Oct 2026).** A blocking item
  (`AllowNegativeStock` off) used to be enforced only on the server when the sale completed: an order of 2 drinks with stock
  for 1 was refused whole, after the cashier had already taken payment details. Now the order editor says so first.
  - **Data.** Cashiers cannot read stock, so `GET /api/pos/stock-limits` (`OrdersWrite`) gives the register only the active
    items that block sales, their balances and which products take them (no costs, no warn-only items). The POS loads it when
    the editor opens, every minute while online and right before checkout (`StockLimitsService`).
  - **Maths.** `StockRules.Shortfalls` (API) and `stockShortfalls` (`shared/calculations/stock-limits.ts`) sum what the cart
    needs per item across all lines (an add-on takes its item once per unit of its drink) and compare it with the balance; both
    run the `stockShortfalls` cases in `calculation-cases.json`.
  - **Screen.** Each cart line that uses a short item lists it under the product ("Cup Lid: 1 pc left, needs 3 pc"), a
    two-line banner says how many items are short, and Checkout is disabled until the quantity is lowered or the line removed.
    At checkout the latest balances are asked for again, and a refusal shows the same list.
  - **Rules.** Online blocks. Offline only warns (the device cannot know the balance and an offline sale is honored when it
    syncs). Saving an open order is never blocked. An Admin override of a completed order is not judged (the server works out the
    net change). A warn-only item keeps today's behavior. The server stays the authority and still refuses at completion,
    since another register may have taken the stock first.
  - **Checked** on the throwaway database in the browser at phone width: 2 Mochas against 1 Blocking Cup (label, banner,
    Checkout disabled, Save enabled; lowering to 1 cleared it), and a cart of five lines with four short items, including a
    94-character name and one with no spaces (the unbroken name now wraps inside the cart card too). Also checked by hand: a
    customer link order of 2 Mochas was placed (not refused at submit, nothing taken), accepted, and then showed the same label
    with Checkout disabled when staff opened it, while the API refused to complete it; the customer's own page and My orders
    were unchanged and show no stock. Offline (API stopped): the label turned amber, the banner read "Stock may be short (you are
    offline)", and Checkout stayed enabled and opened. Then checked with the API really stopped (the app noticed within 45
    seconds, no faked event): the label turned amber offline and went back to red and blocked when the API returned, without a
    reload; an offline sale of 2 Mochas against 1 Blocking Cup was saved as OFF-261026-001 and, once the API was back, synced by
    itself as a Completed order that took both cups (balance 1 to -1, movement noted "Balance went below zero"; the item still
    blocks, so the next online sale of it is refused until it is counted or restocked). Five rounds of two or three registers
    completing a sale for the last unit at the same moment gave exactly one sale and the rest refused, never below zero.
- Remaining hard deletes (decision pending): promotion child rows (rules and
  bundle items are deleted and recreated on every promotion save), order lines
  (deleted and rebuilt when an order is edited), and replaced or removed images
  (the stored file and image rows are deleted).

#### Order-Time Stock Deduction (detailed plan)

This is the largest unfinished piece of Phase 1. Phases 2 (pack/box selling)
and 3 (consumables) build on it, so it should land first and stay generic.

**Current state**

- `Item.CurrentQuantity` is changed only by `AddItemStockHandler`, which
  writes an `AddStock` row to `StockMovements` (delta, before, after, optional
  unit cost, notes, user).
- `ProductItemLink` (`ProductId`, `ItemId`, `QuantityPerSale`, `IsActive`)
  already exists and is editable from the item editor. Nothing reads it when
  an order is placed, so no stock is ever deducted.
- `StockMovement` has only a generic `ReferenceType`/`ReferenceId` pair, so it
  cannot say which product or order line caused a deduction.

**When stock is deducted**

- Deduct once, at the moment an order first becomes `Completed`:
  - `CreateOrderHandler` / `CreateOrderBatchHandler` when the order is created
    as Completed (POS walk-in sale).
  - `UpdateOrderHandler` when an order moves from Pending to Completed.
- Do not deduct for `PendingApproval`, `Pending`, or `Cancelled` orders.
  Reserving stock for pending orders is out of scope for now.
- Accepting an online order (`ApproveOrderCommand`, PendingApproval to
  Pending) does not touch stock.

**How the quantity is calculated**

- For each order line (including add-on child lines, `ParentOrderItemId`),
  take the product's active `ProductItemLink` rows and deduct
  `QuantityPerSale x OrderItem.Quantity` from each linked item.
- Sum the required quantity per item across all lines first, then check and
  deduct once per item. This keeps the stock check correct when the same item
  is used by several lines (and later by pack/box products in Phase 2).
- Ignore inactive links and inactive items. Unlinked products deduct nothing.
- Size cups stay linked to the Size add-on, not the base product, to avoid
  double deduction (see Phase 3).

**Voiding and editing**

- `VoidOrderHandler`: a Completed order voided to Refunded restores the stock
  that order deducted. A Pending order voided to Cancelled never deducted
  anything, so it restores nothing. A drink that was already made cannot go back on the shelf: the void asks what
  happens to the stock (see Phase 5, "Void asks what happens to the stock").
- Restore from the original deduction movements, not by re-reading the
  product links, so link edits made after the sale do not change what is put
  back. Write the restore as new movement rows (positive delta), never by
  editing or deleting the old ones.
- Order edit on a Completed order (override flow in `UpdateOrderHandler`):
  reverse the old deduction and apply the new one in the same transaction,
  as a net difference per item where possible. Order lines are deleted and
  rebuilt on edit, so movements must not depend on `OrderItem` foreign keys
  that disappear (see schema below).
- Make deduction and restore idempotent: if a Completed order already has
  sale movements, saving it again must not deduct twice.

**Schema changes** (new script under `tools/sql/`, run before deploying the API)

- Add nullable `ProductId` (and a nullable order line id snapshot, stored
  without a hard foreign key because lines are rebuilt on edit) to
  `StockMovements`, so per-product ingredient and cup usage reports stay
  accurate after link edits.
- Set `ReferenceType = "Order"` and `ReferenceId = order.Id` on every sale and
  restore movement, with movement types `Sale` and `SaleVoid`.
- Add an index on `(ReferenceType, ReferenceId)` so voids can find an order's
  movements quickly.
- Add a concurrency token (rowversion) on `Items`, or use an atomic
  `UPDATE ... SET CurrentQuantity = CurrentQuantity - @q`, so two registers
  completing orders at the same time cannot overwrite each other.

**Transaction boundary**

- Deduction runs inside the same database transaction as the order save
  (`CreateOrderHandler` already opens one; `UpdateOrderHandler` and
  `VoidOrderHandler` need one). Order and stock succeed or fail together.
- Put the logic in one shared service (for example `IOrderStockService` with
  `DeductForOrder` and `RestoreForOrder`) called by every handler, instead of
  repeating it in each, matching how discounted-product pricing was merged
  into one shared class.

**Decision: low stock blocking is configurable per item (option C)**

- Add an `AllowNegativeStock` flag on `Item`, default true so nothing blocks
  sales while stock counts are still being set up.
- When the flag is false, completing an order that would take the item below
  zero is rejected with a clear error naming the item and the shortfall. The
  whole order rolls back (see Transaction boundary).
- When the flag is true, the order completes, the balance may go negative,
  and the POS shows a low-stock warning.
- Every movement records the quantity before and after, so negative balances
  are visible in history and can be corrected (next section).
- Options not chosen: never blocking (A) and always blocking (B).

**Stock correction (adjustment)**

- Add an adjustment action so the remaining stock can be corrected, for
  example after a physical count, spoilage, breakage, or a negative balance
  left by non-blocking items. This is the "adjustment/correction workflow"
  already listed in Phase 1 Remaining.
- The user enters the counted quantity (or a plus/minus change) and a
  required reason. The system calculates the difference.
- It never overwrites `CurrentQuantity` silently. It writes a new
  `Adjustment` stock movement with the delta, before and after, reason,
  user, and time, and writes an audit entry. Existing movements are never
  edited or deleted.
- Restrict it to roles allowed to manage inventory, using the same policy
  style as `AddItemStock`.
- An adjustment applies on top of the current balance, so orders completed
  between opening the form and saving are not lost. Use the same concurrency
  protection as order deduction.
- Suggested reasons: Count correction, Damaged or spoiled, Lost, Other (note
  required).
- Adjustments are excluded from sales usage reports but shown in item
  movement history.

**UI and API surface**

- POS: show the stock error (or warning) in the completion flow. Low-stock
  badges can wait for Phase 4.
- Order details: list the stock movements an order caused.
- Item details: movement history shows `Sale`, `SaleVoid` and `Adjustment`
  rows, with the order number as a link on sale rows, plus an Adjust stock
  button.
- Audit log: add an audit action for order stock deduction and restore, or
  include the stock changes in the existing order audit entries.

**Tests**

- Create as Completed deducts; create as Pending does not.
- Pending to Completed deducts once; saving a Completed order again does not
  deduct twice.
- Void Completed restores the original quantities even after the product link
  quantity was changed; void Pending restores nothing.
- Add-on child lines and multiple lines sharing one item sum correctly.
- Inactive links and untracked products are ignored.
- Blocking when `AllowNegativeStock` is false, and warn-only when true, including the transaction rolling
  back the order when stock is insufficient.
- Concurrent completions on the same item do not lose updates.
- Editing a Completed order applies only the net difference.
- An adjustment writes a movement with the correct delta, requires a reason,
  and fixes a negative balance.

**Rollout order**

1. Schema script and the shared stock service with unit tests, not yet wired.
2. Wire into create and update, behind the non-blocking default.
3. Wire into void, then the movement history UI.
4. Add the stock adjustment action, then enable per-item blocking once real
   stock counts exist.
5. Phases 2 and 3 then add pack/box deduct quantities and consumables on top
   of the same service and ledger.

### Phase 2 - Pack, Box, and Shared Stock Selling [Completed, 21 Oct 2026]

- Allow multiple products to deduct from the same inventory item.
- Support configurable deduct quantity per product sale.
- Example:
  - `1L Oat Milk` sells for `PHP150` and deducts `1`.
  - `Oat Milk Box of 6` sells for `PHP850` and deducts `6`.
- Validate stock availability using the total required quantity.
- Show stock impact before saving product inventory mappings.

What was left after Phase 1 and is now built: the stock impact preview. Sharing an item between products, the quantity per
sale and the check against the total required quantity already worked from Phase 1 (the deduction sums per item).

- **Preview.** The Manage Links dialog (item editor) shows under each linked product "1 sale takes 200 ml. In stock now:
  enough for 49 sales." and follows the quantity as it is edited. The product editor's Track inventory card shows the same
  for "deduct from an existing item" (and "the starting stock covers N sales" for an own item). When the stock covers no sale
  it says what will happen: a warn-only item goes below zero and warns, a blocking item refuses online sales of the product
  until stock is added.
- **Maths.** `salesCovered(balance, quantityPerSale)` is a whole number of sales and is zero for an empty or negative
  balance. It lives in `StockRules` (API) and `shared/calculations/stock-adjustment.ts` (Angular), with the shared cases
  `salesCovered` in `calculation-cases.json` run by both test projects.
- **Not changed.** Pack conversion when receiving stock (typing "2 cartons") stays with Phase 8; Stock In still takes the
  base unit.
- **Checked in the running app** (throwaway database): the Manage Links dialog for Oat Milk (9,800 ml, Latte at 200 ml) read
  "enough for 49 sales", then "enough for 1 sale" after changing the quantity to 6000; the product editor read
  "enough for 1 sale" at 6000 and the below-zero warning at 20000.

### Phase 3 - Consumables and Required Product Usage [Partially completed, 21 Oct 2026]

- Treat cups, lids, sleeves, milk, syrups, and other consumables as
  inventory items.
- Link products and required add-ons to consumables.
- Deduct consumables automatically when an order is completed.
- Support multiple required consumables per product or add-on selection.
- Example:
  - regular drink deducts `1 Regular Cup`
  - large drink deducts `1 Large Cup`
  - selected oat milk add-on deducts oat milk stock if configured

Built (21 Oct 2026):

- Consumables are plain items; linking them to products and add-ons, several links per product or add-on, and the deduction
  when an order completes all work (Phase 1). Size cups go on the Size add-ons when the sizes use different cups, or on the
  product when every size uses the same item; never both, or a cup is taken twice.
- **Stock coverage check** (`GET /api/items/coverage`, `ItemsRead`; the Inventory > Coverage tab). It lists every active
  product (add-ons excluded) as *Takes stock*, *Some options missing* or *Takes no stock*, so a drink with no cup linked is
  visible. The rule (`StockCoverageRules` in `WTF.Calculations`): a product is covered when it has an active link to an active
  item, or when every option of one required add-on group (Size, Flavor) has one; it is partial when a required group has
  some options linked and others not (the unlinked ones, for example "Size: Jumbo", would sell without taking stock); it
  takes no stock when nothing is linked anywhere. Optional add-on types (Topping, Extra, Sauce) are ignored. The list shows
  products that need attention first and links to the product editor ("Set up stock") for roles that can write products.

Not built, on purpose:

- **Nothing is enforced.** A product with no stock link still sells; the check only shows the gap. Refusing such a sale, or
  marking a product as "must take stock", is a decision for the owner (retail goods, services and untracked items exist).
- **Replace mode and size-aware amounts** (oat milk replacing dairy, a large drink using 1.5x the milk) belong to Phase 6
  (recipes); until then an add-on only adds.
- **No item types, and no "required items" list (decided 21 Oct 2026).** The check does not know what an item is and should
  not (no cup, lid or milk types). Letting the owner say "this drink must have a lid" was considered (a small table of
  required items per product, shown only in Coverage) and skipped: the Phase 6 recipe says which items a product uses, so a
  second list would only have to be merged into it later. Until recipes exist, Coverage shows products with no stock link
  and Size or Flavor options left unlinked, and nothing more.
- **Checked in the running app** (throwaway database): Latte with Regular linked and Jumbo not read "Some options missing,
  Size: Jumbo"; Water read "Takes no stock"; Mocha (both sizes linked) and Beans read "Takes stock" (counts 2, 1, 1). After
  linking Jumbo to a cup and refreshing, Latte left the list (counts 3, 0, 1).

### Phase 4 - Inventory Alerts and Notifications [Mostly completed, 21 Oct 2026]

- Notify assigned users or roles when inventory reaches warning or
  critical levels.
- Support per-inventory-item alert recipients or category-level defaults.
- Show warning and critical indicators in Management and POS where useful.
- Prevent duplicate alert noise by tracking last notification state.

Built (21 Oct 2026; script `tools/sql/20261022_add_stock_alerts.sql`, run it before deploying the API):

- **When an alert is sent.** After any change that lowers or moves a balance (a completed sale or a refund, a stock-in, an
  adjustment) and after an item's warning or critical level is edited, `IStockAlertService` looks at the item's level
  (`StockRules.StatusFor`). `Items.LastAlertStatus` remembers the level the last alert was sent for, and
  `StockAlertRules.Decide` (in `WTF.Calculations`) says: alert only when the item got *worse* than that (warning, then
  critical, then out of stock, each once); back to ok forgets it, so a later fall alerts again; a partial recovery is
  remembered without an alert. The state moves with one guarded `UPDATE`, so registers crossing a level together alert once
  (checked on a real SQL Server with ten at once). Existing items start at their current level, so nothing floods on the first
  run. An item that goes further below zero after an out-of-stock alert is not alerted again.
- **Who is told.** The item's named people if it has any (`ItemAlertRecipients`), otherwise every active Super Admin, Admin
  and Stock Manager. Named people can only be those who can read stock notifications (those three and Admin Viewer). Set from
  the item editor's *Stock Alerts* card (`PUT /api/items/{id}/alert-recipients`, `ItemsWrite`; empty goes back to the default;
  audited as `ItemAlertRecipientsUpdated`). Category-level defaults are not built: items have no category yet (Phase 8).
- **How it reaches them.** A saved list per person (`StockNotifications`: title, body, level, quantity, read time) plus a push
  (`PushTypes.StockAlert`, opens `/inventory/alerts`). `GET /api/stock-notifications` (paged, unread count) and
  `POST /api/stock-notifications/read` (some ids, or all), `StockMovementsRead`. A failed push never undoes the sale; the saved
  list is the record. Push is sent when the alert is saved, inside the sale's transaction, so a sale that rolls back after that
  point (rare) could leave one push without an alert.
- **Screens (replaced 21 Oct 2026, see "Needs Attention" below).** Inventory > Alerts (list, unread highlighted, open an alert to mark it read and go to the item, Mark All Read,
  Load More); the unread count on the Alerts tab and sidebar link, and on the Inventory entry when its group is closed (and on
  the Inventory item of the phone dock). The count sits on Alerts while the Inventory group is open and moves to Inventory
  when it is closed, in the wide and the narrow sidebar alike (a small number on the icon in the narrow one, "9+" above nine).
  It refreshes when the app opens, when a push arrives, and when the list is used.
- **Not built.** No indicators in the POS (decided: not now). Counts and lists now update live (see "Global Notifications (the bell)" below).
- **Checked in the running app** (throwaway database, built-in browser): selling past the warning, critical and empty levels
  gave one alert each (3 in total, a further sale while empty added none); the list, sidebar count, Inventory count and
  phone dock count matched; opening an alert marked it read; naming only one person in the item editor sent the next alert to
  that person and not to the admin. Push is not configured on this machine, so the push itself was checked only by unit tests.


**Needs Attention, live counts, and the Stock In and Coverage redesign (21 Oct 2026)**

- **Needs Attention replaces the Alerts tab** (`GET /api/items/attention`, `StockMovementsRead`; `/inventory/attention`, and `/inventory/alerts`
  redirects to it). An event list cannot feel urgent, because what stock people need is what is low *now*. It reads the items, not the saved
  alerts, so an alert that was read or cleared never hides an item that is still low. Worst first (out of stock or below zero, critical, low), three
  count tiles (out in red, critical in orange, low in amber, each a filter), and a card per item: the quantity big, a bar
  against the low level, "Enough for N more sales, used by M products" (or "cannot be made" when empty), the levels, and **Add Stock** with the
  item preselected. When nothing is low it says "All stocked up". The stock alert events still arrive in the bell and on the Notifications page.
- **The counts follow the shelf.** The Inventory entry, the Needs Attention link and tab, and the phone dock show the number of items that need
  attention (not unread alerts), red while anything is critical or out and amber when items are only low, and every screen updates by itself
  when stock changes (`StockAttentionService`, fed by `StockChanged`). `StockAlertService` announces every change, alert or not.
- **Stock In** is a full page, not a form in a box: "1. What arrived?" is a searchable grid of item tiles (a dot and a note for items that are out, critical or running low, those first), "2. How much?" has a big quantity box with presets (+100, +500, +1,000, +5,000 for ml and g, +1, +5, +10, +50 for pieces), and "3. Details" holds cost and note. A sticky summary on the right shows what is in stock now, what is being received and the new balance, with the Add Stock button; after saving the form clears for the next delivery and an "Added just now" list keeps the last five (it no longer jumps to the item).
- **Stock Coverage** shows how much of the menu takes stock as one bar and a percentage, "Needs setup" and "All products" pills with counts, a
  search box, a coloured edge per card and each missing option as a chip, with Set up stock as the main action for products that need it.


**Additions to stock alerts (planned 21 Oct 2026, built 21 Oct 2026; script `tools/sql/20261023_add_stock_alert_reminders.sql`, run it before deploying the API)**

Built: the daily reminder and the two level-change gaps. `StockReminderService` and `StockReminderScheduler`
(`Features/Inventory/StockAlertReminders.cs`), settings under `StockAlertReminders` (08:00 `Asia/Manila`, `DryRun` on in
`appsettings.json`, off in Production), `StockNotifications.ReminderCount` and `LastRemindedAt`. Only items that were
alerted (`LastAlertStatus` above ok) and are still low are reminded; an alert or reminder made today is not repeated the same
day; the row is lifted by one guarded `UPDATE`, so two runs in the same moment lift it once (real SQL test). A reminder reads
"Still low: Oat Milk ... Day 3." (day 1 is the first alert). Creating an item whose starting stock is already under a level
now alerts (an item created with nothing yet stays quiet), and so does restoring an item that fell while inactive. **Left out on
purpose:** snooze, escalation to Admins, skipping closed days and `MaxDays` (the choices below stay open). **Checked** by tests
(.NET suite, including real SQL Server) and in the running app on a throwaway database: an alert read yesterday came back
unread as "Still low: Oat Milk ... Day 2." with the count at 1, a stock manager with no earlier row got a first alert, an
item that is fine got nothing, and restarting the API the same day sent no second reminder. The monthly workbook scheduler
now runs on the same catch-up base (`DailyCatchUpScheduler`) as the other daily jobs, so a cold app catches it up too; its
steps and settings are unchanged.

1. **A daily reminder until the item is dealt with.** Before this, an alert was sent once, when the item got worse. If the person
   opens it and puts it off, nothing happens again. Instead, every day the item is still at a warning, critical or empty level,
   the people who should know are told again, until it is back to ok.
   - *"Dealt with" means the item is back to ok* (stock added or counted, or its levels changed so it is fine). Reading or
     opening an alert does **not** stop the reminders. The item being deactivated stops them.
   - **One row per item while it stays low, not a new row every day.** A reminder lifts the item's existing alert back to the
     top, unread again, with a count ("Still low: Oat Milk, 400 ml left (day 3)") and sends the push. A person who cleared it
     gets it back; the list does not fill with copies. When the item recovers the row stays as history and the next fall starts a
     new one. Needs `ReminderCount` and `LastRemindedAt` on the notification row (or the item).
   - **Runs once a day at a set shop time** (for example 08:00, `Asia/Manila`), using the same catch-up scheduler as the chat
     and image cleanups (`DailyCatchUpScheduler`), so a sleeping app sends the day's reminders when it wakes and never twice in
     a day (the last run is saved the same way). Settings in a `StockAlertReminders` section: `Enabled`, run time, time zone,
     `MaxDays` (0 = no limit), and a dry run that only logs, on for the first run, like the other jobs.
   - Goes to the same people as the first alert (the item's named people, else the stock roles).
   - **Choices still open:** a snooze ("remind me in 1, 3 or 7 days") for a person who knows an order is coming, so the
     reminders do not become noise they learn to ignore; whether to add the Admins to the reminder after some days of silence
     (escalation); whether closed days are skipped; whether to stop after `MaxDays` or go on until fixed.
2. **Alerts when the levels are changed.** Built: editing an item's warning or critical level checks it at once, so
   raising a level above the current balance alerts immediately; an item that gets worse alerts, one that only improves (critical
   back to warning) is remembered without an alert, and one that is fixed by the edit stops being tracked. The two gaps (creating
   an item already under its level, restoring a low item) are closed.

**Tests for these:** the reminder job sends once a day and not twice on a second run the same day; an item back to ok gets no
reminder and its episode ends; reading the alert does not stop the next day's reminder; a reminder bumps the existing row (unread
again, count up) instead of adding one; a recovered item that falls again starts a new row; named people only; `MaxDays`; the dry
run sends nothing; creating a low item and restoring a low item alert once; the real-SQL test that two runs in the same moment
send one reminder.

### Global Notifications (the bell) [Built, 21 Oct 2026]

**Built (21 Oct 2026; script `tools/sql/20261024_generalise_notifications.sql`, run it before deploying the API, then `tools/dbsync.bat`).**
The plan below was built as written, with these details:

- **One table, one producer.** `StockNotifications` became `Notifications` (`Kind`, `Severity`, `Path`, `SubjectId`, `Data` JSON; existing
  rows became `StockAlert` rows with their read state, and the old item, level and quantity columns moved into `SubjectId`, `Severity` and
  `Data`). `INotificationService` (`Features/Notifications`) saves a row per person, tells their open screens and sends the push (push type
  `notification`, with `kind`, `path` and `subjectId`). `NotifyAsync` saves and announces, `AnnounceAsync` only announces (used when a
  reminder lifts an existing row). `StockAlertService` and the reminder job call it and keep only the stock rules.
- **API.** `GET /api/notifications` (by kind, unread only, paged; returns the total unread and the unread per kind), `GET /api/notifications/counts`,
  `POST /api/notifications/read` (some ids, a kind, or all). Any signed-in person; a person only ever sees rows addressed to them. The
  `/api/stock-notifications` routes are gone.
- **Real time.** A new `NotificationHub` (`/hubs/notifications`, any signed-in person, no methods a client can call). Each person joins
  `user-{id}` and hears `NotificationsChanged` when a row is added, lifted or read (also on their other devices); people who can read stock also
  join `StockViewers` and hear `StockChanged` after every stock change. The app then asks the API again, so the count, the bell and the lists
  update without a refresh; a dropped connection reloads everything when it comes back, and the counts are also reloaded every minute.
- **App.** `app-notification-bell` beside the chat envelope (sidebar top row, phone and wide header): the unread count (99+), a panel with the
  latest ten (an icon and colour by severity, a Reminder pill, Mark all read, See all), and a Notifications page (`/notifications`) with a filter
  per kind, unread only, load more, and live reload. A new kind needs a label in `NOTIFICATION_KIND_LABELS` and an icon in
  `notification-display.ts`; nothing else.
- **Inventory Alerts became Needs Attention** (decided 21 Oct 2026): see Inventory Phase 4.
- **Not built:** per-person mute switches, deleting old read notifications, and a second kind (they wait until one is wanted).

One bell beside the chat envelope that collects every kind of notification for a person, so a new kind (stock alerts today,
others later) does not need its own badge, page and push wiring. The bell icon (`icon-notifications`) is already in the icon
sprite and unused; Inventory Alerts uses `icon-stock-alert` (cart with a warning mark) so the bell is free.

**What the person sees**

- A bell in the same place as the envelope (the top row of the sidebar, the top bar on a phone). Its badge is the unread count
  across all kinds ("9+" above nine).
- Tapping it opens a short panel (the latest ten, newest first, unread highlighted, an icon per kind, "Mark all read" and
  "See all"). "See all" opens a Notifications page with a filter per kind and paging. Opening one marks it read and goes to
  its screen.
- Chat messages stay in the envelope (they are conversations, not events); the bell is for events.
- **Inventory Alerts stays.** It becomes the stock-alert *view* of the same feed: `/inventory/alerts` lists only the stock
  alerts, and the Alerts tab, the sidebar link and the Inventory entry keep their own counts, which are the unread count of
  that one kind. So stock people still see "3 stock alerts" where they work, and the bell shows "3" plus whatever else is
  waiting. A stock alert read in either place is read in both (it is one row).

**Data and API (a generalisation of what Phase 4 built, not a second system)**

- Rename `StockNotifications` to `Notifications` and add: `Kind` (`StockAlert` for every existing row), `Severity`
  (Info, Warning, Critical), `Path` (where it opens, for example `/inventory/items/details/{id}`), `SubjectId` (the item, the
  order, the promotion), and `Data` (JSON for what only that kind needs: a stock alert keeps its level and quantity there).
  One migration script; existing rows become `StockAlert` with their item as the subject. Keep `ReadAt`; add an index on
  `(UserId, Kind, ReadAt)`.
- `GET /api/notifications` (filter by kind, paged, returns the total unread and the unread per kind), `POST
  /api/notifications/read` (some ids, a kind, or all). Any signed-in staff role may call them: a person only ever sees rows
  addressed to them, and each kind decides who is addressed. The `/api/stock-notifications` routes are removed once the app
  uses the new ones (no outside callers).
- One producer: `INotificationService.NotifyAsync(kind, userIds, title, body, path, subjectId, severity, data)` saves the rows
  and sends the push (the push `type` becomes `notification` with the same `path`; `stock-alert` is still understood for one
  release). `StockAlertService` keeps what is stock-specific (levels, the last-alerted state, recipients) and calls it.
- Per-kind rules stay with the kind: who is told, how not to repeat (stock alerts have `LastAlertStatus`; another kind needs
  its own), and the wording.

**Reminders and the bell.** A stock reminder lifts the item's existing row back to the top, unread, so the bell count and the
Inventory count go up again the same way a new alert would; the count of that kind and the bell total stay one number each.

**Kinds that could use it later (each is its own small change, none is planned yet)**

| Kind | Told | Today |
| --- | --- | --- |
| Stock alert | Stock roles, or the item's named people | Built (Phase 4) |
| Offline order held for review | Admins | A banner on the orders list |
| Online order waiting for approval | Cashiers and Admins | A banner and a push, no saved list |
| Promotion about to end or almost used up | Admins | Nothing |
| Item expiring soon, reorder list ready | Stock roles | Phase 8 would add them |
| Daily close not done | Admins | Nothing |

**Choices to make before building**

- **Panel or page only.** A panel (above) is quick to use on a phone; a page alone is less to build. Recommended: both.
- **Per-person switches.** Let each person mute a kind (a `NotificationPreferences` table, defaults by role). Recommended
  after the second kind exists, not before.
- **Keeping it small.** Delete read notifications after N days (for example 30) with the same daily catch-up job used for chat
  and images, and keep unread ones. Needs the number.
- **Online orders.** Whether the existing "awaiting approval" banner and push should also save a notification, or stay as they
  are (the banner already shows what is waiting).
- **When.** Build when a second kind is wanted; the first change (rename and generalise) is small and can be done then
  without touching how stock alerts work for the people using them.

**Tests and checks when built:** the migration keeps every existing stock alert and its read state; the bell count equals the
sum of the per-kind counts; reading a stock alert from the bell clears the Inventory counts and the other way round; a person
never sees another person's rows; the push carries the path; the existing Phase 4 specs and handler tests keep passing with the
new names; hand check on a throwaway database with a stock alert and a second kind side by side.

### Phases 5-9 - Waste, Costing, Counts, Purchasing and Profit [Planned, added 20 Oct 2026]

What the foundation above still lacks to answer "what did we really earn?": a way to record loss, a cost for every unit,
recipes that turn a sale into ingredient usage, a way to compare the recipe with what the shelf says, and expenses.

| Phase | Name                                     | Needs first            |
| ----- | ---------------------------------------- | ---------------------- |
| 5     | Waste and spoilage (built, not verified) | Order-time deduction   |
| 6     | Costing and recipes                      | Order-time deduction   |
| 7     | Stock counts and variance                | Phase 6                |
| 8     | Suppliers, receiving and reordering      | Phase 1 stock-in       |
| 9     | Profit and margin reports                | Phases 5, 6 and 7      |

Recommended order: finish order-time deduction, then 5 (small, quick value), 6, 7, 9, with 8 whenever purchasing pain
shows up. Stock transfers between branches are under "Multiple Branches" (Phase 1 there).

#### Phase 5 - Waste and spoilage [Built, not yet verified, 27 Oct 2026]

**Built (27 Oct 2026; script `tools/sql/20261027_add_stock_waste.sql`, run it before deploying the API, then
`tools/dbsync.bat`).** The original plan follows below; this is what exists and what is still to do.

- **Schema.** `WasteReasons` (editable list, the eight reasons from the plan seeded, `Other` is a system reason that needs
  a note), `StockWastes` (item, quantity, unit, reason, note, source POS or Inventory, status, who and when, review and
  reverse details, `ClientRequestId` with the unique index `UX_StockWastes_ClientRequestId` so a retried request is not
  recorded twice), `Items.WasteApprovalLimit`, movement types `Waste` and `WasteReversed`.
- **Rules.** Recording runs the guarded balance update, a `Waste` movement (reference `StockWaste`, unit cost kept) and
  the waste row in one transaction, then the stock alert check. A blocking item cannot go below zero; a warn-only item
  can. Above the item's approval limit the waste is still deducted at once but marked **Pending review**; an Admin
  confirms, disputes (no stock change) or reverses it (a `WasteReversed` movement puts the quantity back, once only).
  Confirm, dispute and reverse use guarded UPDATEs, so two reviewers cannot both act. Admins get a notification for each
  pending waste (`WasteReviewNotifications`). Arithmetic in `WTF.Calculations/Inventory/WasteRules` (grouping per item and
  unit; mixed units leave the quantity blank) with shared cases in `calculation-cases.json`.
- **API.** `POST /api/items/{id}/stock/waste` (`StockWasteWrite`), `GET /api/stock-waste`, `GET /api/stock-waste/pending-count`,
  `POST /api/stock-waste/{id}/confirm|dispute|reverse` (`StockWasteReview`), `GET/POST/PUT /api/waste-reasons` plus
  deactivate and restore (`WasteReasonsManage`), `GET /api/pos/waste-items` (the slim item list for the POS sheet),
  `GET /api/reports/waste` (by item, reason, staff or day, Excel, PDF and CSV, row cap, dates in the shop's time zone and
  `toDate` covering the whole day). Daily Close has a waste section with quantity and unit, and the monthly workbook a
  Waste sheet (13 sheets). Audit actions for record, confirm, dispute, reverse and reason changes. Route table and policy
  matrix snapshots updated.
- **Screens.** Inventory > Waste (list with filters, pending review, confirm, dispute, reverse), Waste Reasons page, the
  Record Waste dialog on item details, a quick waste sheet in the POS (online only), the approval limit on the item
  editor, the Waste report in the Reports catalog, sidebar and routes.
- **Decisions.** POS waste is online only (it needs the live balance and the blocking rule). Pending waste counts in the
  reports, disputed waste is shown separately and reversed waste is left out. A Cashier records waste from the POS sheet
  only; `/inventory/waste` needs `StockMovementsRead`. Quantity only until Phase 6 gives every unit a cost. Item Managers
  and Admin Viewers cannot record waste. Refund waste written by the void dialog stays out of the waste report (it is
  only `StockWastes` rows).
- **Tests.** About 76 new .NET tests (handlers, rules, real SQL Server race tests in `StockWasteFixesDatabaseTests`,
  shared cases, workbook) and 231 Angular tests in 9 spec files. Last full runs: .NET 2,551 passing, Angular 3,682 passing (the author's run). Re-run on 29 Oct 2026 after import: .NET 2,551 passing, Angular 3,669 passing (176 spec files, includes the 2 new login specs); the 13-test difference from 3,682 is not explained yet.

**Local database:** `tools/sql/20261027_add_stock_waste.sql` was run on the local `WTF` database (`.\SQLEXPRESS`) on 29 Oct 2026 (8 reasons seeded, `StockWastes` and `Items.WasteApprovalLimit` present). CI picks it up on tag builds (it runs every `tools/sql/*.sql` in name order, and this one sorts after `20261024`).

**Not built (on purpose, for later phases):** waste of a made product through its recipe (Phase 6), cost value and
waste as a share of usage (Phase 6), the optional photo, comps and "reason for free" on orders, a per-line "what happens
to the stock" choice beyond the existing refund dialog, and a branch column (Multiple Branches).

**Next steps (in this order):**

1. **Playwright end-to-end tests** [Done, 29 Oct 2026]. `src/wtf-e2e` has the fixtures, 15 page objects and specs for auth and
   roles, orders and checkout, order details and refunds, customer link ordering, items and Stock In, stock alerts and the
   bell, waste recording, review, reasons and the register sheet, and the waste report. 70 tests pass against a throwaway
   LocalDB database (API on 5282, app on 4300). They found: the role guard loop, the missing Waste report, Stock Manager
   without `ItemsRead`, the Refund button shown to every role, and Admin Viewer's empty reason filter (all fixed).
2. **Run the 22 manual scenarios** [Done, 29 Oct 2026: all passed, no bug found; see "Checked by hand" below] (record each reason, note for Other, inactive reason and item, blocking vs warn-only,
   alert levels, approval limit, who may review, confirm, dispute, reverse once, POS quick entry, viewer refused, reasons
   page, refund waste kept out, waste report, Daily Close, two people wasting the last units, phone width, long names) in
   the built-in browser on the throwaway `WTF_Phase5_Manual` database. Never the real `WTF` database.
3. **Fix the login loop for Stock Manager and Item Manager** [Done, 29 Oct 2026]. They could not open the orders
   screens, so the post-login route sent them back to the login page. `getPostLoginRoute` in `login.ts` now sends a Stock
   Manager to `/inventory/attention` and an Item Manager to `/inventory/items` (2 new specs in `login.spec.ts`). The role
   guard had the same problem: opening a page the role may not see sent these two roles to the login page, which sent them
   back (a loop). Its fallback now ends on Needs Attention or the Items list (2 specs in `guards.spec.ts`).
   Also found while preparing the end-to-end run: the **Waste report was not in the Reports catalog** (the service, models
   and API existed). It now has a definition (group by item, reason, staff or day) and a filter. The shared confirm
   dialog scrolls on short screens, and the waste screens were restyled to match the sibling lists (search box, refresh icon
   with pull to refresh, outline Turn Off button, `bg-surface` tiles) in the default and cafe styles.
   Three more fixes from the end-to-end run (29 Oct 2026): `GET /api/waste-reasons` has its own policy, `WasteReasonsRead`
   (Super Admin, Admin, Admin Viewer, Stock Manager, Cashier), so Admin Viewer's reason filter is no longer empty; the Stock
   Manager role now has `ItemsRead`, so Stock In shows its item grid (read only; item writes stay with Item Manager); and the
   Refund Order button on order details shows only to roles that can write orders (the API already refused the rest).
4. **Full builds and tests**: `dotnet build`, `dotnet test src/WTF.Tests` (including the real SQL tests),
   `npx ng build --configuration=development` and `npx ng test --watch=false` in `src/wtf-pos`.
5. **Deploy order**: run the SQL script on the target database first, then deploy the API, then the app.
6. Change this heading to Completed once steps 1 to 4 pass, and note what was checked by hand.

**Checked by hand (29 Oct 2026, throwaway `WTF_Test_*` database, API 5282, built-in browser).** Three items: Man Milk (1,000 ml,
approval limit 100, warn 500, critical 200), Man Cup (5 pc, blocks below zero) and Man Syrup (300 ml, warn-only, a 95-character
name). All 22 scenarios gave the hand-worked answer:

- Each of the 7 reasons records; Other without a note is refused (screen and API), with a note it records.
- Limit: 100 ml records, 101 ml goes to review; 0 and negative are refused. Blocking cup: 6 on a balance of 5 is refused and
  nothing changes, 2 records. Warn-only syrup went to -180 and the POS dialog said "Count the item soon".
- Roles: Cashier and Stock Manager record; Admin Viewer and Item Manager get 403; Stock Manager, Cashier and Viewer cannot
  review (403), Admin can. Confirm twice is refused, reverse needs a reason, reverse twice is refused, reverse after a dispute
  works and puts the quantity back.
- Review dialogs on screen (Confirm, Dispute, Reverse): an empty note on Dispute and Reverse shows the error alert, a note
  closes the dialog and the Needs review count drops (19 to 16). Admin Viewer sees the list with no review buttons and no tile.
- Three registers wasting the last 3 cups at once: one succeeded, two refused, balance 0.
- Inactive reason and inactive item are refused with a clear message.
- Refund "not returned" of 2 lattes (400 ml): balance stayed down, a `Waste` movement "Refunded, not resaleable" was written,
  and the waste list count and the Man Milk waste report row (261 ml) did not change.
- Waste report by item matched the hand tally (syrup 485 ml in 10 entries, milk 261 ml in 5, cup 5 pc); the Daily Close
  Waste section showed "5 entries, 261 ml" for the milk.
- Alerts: Low stock (Man Milk 339 of 500), Out of stock (cup), Below zero (syrup), Waste to review (101 and 150 ml) all reached
  the bell and Needs Attention.
- Phone width (375 px): waste list with the long name, the POS waste sheet and dialog, the reasons page and the report: no
  sideways scroll.

Small things seen and fixed the same day: the Daily Close column is now "Orders / Entries" and its waste rows show the
quantity and unit (as the Excel and PDF already did) instead of 0.00; the waste report shows "-" for a quantity that mixes
units (by reason, staff or day) instead of a meaningless ml plus pc sum (the exports already showed "-"). Still open: at 640 to
1023 px the item details title wraps one letter per line (the known layout item in the polish pass).

**Follow-up polish (29 Oct 2026, checked on screen and by specs):** the five details pages (item, product, customer, user,
promotion) stack the title above the action buttons until 1024 px, which fixes the one-letter title at 640 to 1023 px; the item
details back arrow returns to the Waste page when opened from it (`returnUrl`, in-app paths only); "Filter by Item" is an outlined
button; the full-width "Needs review" bar is now a small "N need review" chip, shown only to reviewers and only when something
waits; a waiting entry says "Stock was already taken"; the Confirm, Dispute and Reverse dialogs say when to use each; the record
dialog shows the item's approval limit before the amount goes over it. Decided: the Waste Reasons page stays Admin and Super
Admin only.

Stock in adds; sales deduct; **waste** is stock that left without a sale. Today there is no way to say so, so a spilled
litre of milk can only be hidden inside an "adjustment". Waste is a different thing from an adjustment: waste is a known loss
with a reason, an adjustment fixes an unknown difference found on a count (Phase 7). Reports must tell them apart.

- **Waste entry.** New movement type `Waste` (negative delta, before and after, user, time, note, and the unit cost at that
  moment). Reasons, in a list the owner can edit: Expired or spoiled, Spilled or dropped, Wrong order or remade, Quality
  failed (bad shot, burnt), Staff meal, Sample or tasting, Breakage, Other (note required). Fast entry from the POS and the
  item page (phone first: item, quantity, reason, done), optional photo for large amounts, and a limit above which an Admin
  must confirm (a setting).
- **Waste of a made product.** Wasting "1 Latte (remade)" deducts what the recipe uses (Phase 6), in one transaction, as
  several `Waste` movements that share one reference. Wasting a raw item (a bottle of milk) deducts the item itself.
- **Void asks what happens to the stock.** When a Completed order is refunded, the voider chooses per line: *Returned to
  stock* (retail items, sealed goods: restores the quantity as `SaleVoid`, as planned) or *Not returned / was made* (writes
  `Waste` with the reason "Refunded, not resaleable"). The default is Returned for retail products and Not returned for
  made products. Without this, voiding a made latte would put its milk back on the shelf and inflate the balance.
- **Comps and staff meals.** A free order given to staff or a customer is a sale at a zero price today. Add an order
  "reason for free" (Staff meal, Complaint, Marketing, Owner) so the cost shows as expense, not as lost revenue, and so
  nobody can zero a sale without a trace. (Ties to "Manual discount with a reason" in the promotion ideas.)
- **Waste report** (Reports > Inventory): by reason, item, product, staff, day and branch, with quantity, cost value, and
  waste as a share of usage. Top wasted items, and a trend line so a rise is visible. Daily Close gets a waste line.
- Audit `StockWasted`; AdminViewer cannot enter waste; the ledger is never edited (a wrong entry is reversed by a new
  `WasteReversed` movement with a reason).
- Tests: waste lowers the balance and records the cost at that moment; wasting a product writes one movement per
  ingredient and rolls back together; refund with Returned vs Not returned; the report totals; roles.

#### Phase 6 - Costing and recipes [Planned]

Goal: know what each product **costs** to make, so profit can be worked out. Builds on `ProductItemLink`
(product, item, `QuantityPerSale`), which already is a one-level recipe; this phase makes it complete and adds cost.

**Decisions (30 Oct 2026)**

- **The shop weighs and measures ingredients** and sells made-to-order drinks, so recipes are a tight standard: allowances
  default to 0% and are only set for a known, steady loss. Retail goods stay simple (one item per product, quantity 1).
- **Who sees costs:** Super Admin and Admin (read and write), Admin Viewer (read only). Cashier, Stock Manager and Item Manager
  never see costs or margins, on screens or in API responses (a new `InventoryCostsRead` policy; the cashier POS and the
  customer link carry no cost fields). Stock-in keeps taking a cost price from the roles that can add stock, but they cannot
  read costs back.
- **Build in slices:** (1) cost per unit and weighted average on stock-in, with `UnitCost` kept on every movement; (2) recipe
  lines with allowance, and the product editor's cost and margin preview; (3) size-aware amounts and Replace mode for add-ons;
  (4) prepared items and Produce batch; (5) supplies allowance. Each slice ships on its own with tests and a hand check.

**Slice 1 built (30 Oct 2026; script `tools/sql/20261030_add_item_costing.sql`, run it before deploying the API, then `tools/dbsync.bat`).** Costs are per base unit and now keep six decimals (`Items.CostPrice`, `StockMovements.UnitCost` and the price history were `decimal(10, 2)`). `Items.AverageCost` is the moving weighted average: a stock-in with a cost blends it with what is on hand (an empty or negative balance starts again from the delivery; a stock-in without a cost leaves it alone), and a cost typed by hand in the editor restarts it. `Items.YieldPercent` (1 to 100, default 100) gives the cost per usable unit. Sales, voids, adjustments and waste record the average (or the last cost when there is no average) on their movement. The arithmetic is `CostRules` in `WTF.Calculations`. The new policy `InventoryCostsRead` (Super Admin, Admin, Admin Viewer) decides who sees `costPrice`, `averageCost`, `usableCost`, the price history and movement costs: for every other role the item endpoints return them empty, and their saves leave cost and yield alone. The item details page shows the average and usable cost; the editor has the usable share. Not done in this slice: a live preview in the Angular editor (it shows server values), and the Reports that show costs stay with Reports roles, which already can see them.

**Cost per unit (`Items`)**

- Keep the cost **per base unit** (per ml, per g, per piece), derived from the stock-in cost and `UnitsPerStockUnit` (a
  1 L bottle at PHP 150 is PHP 0.15 per ml). Show both in the item page.
- **Method: moving weighted average.** Each stock-in recomputes `AverageCost` = (value on hand + value received) / (quantity
  on hand + quantity received). Simple, fair when prices change, and needs no batch tracking. (Alternatives, not chosen for
  now: last purchase price, which jumps around; FIFO, which needs lots; revisit with expiry tracking in Phase 8.)
- **Every movement keeps the unit cost it happened at** (`StockMovements.UnitCost`). A sale on Tuesday keeps Tuesday's cost
  even if milk costs more on Friday, so past profit never changes by itself. Cost of goods sold (COGS) = sum of the sale
  movements' quantity x unit cost.
- **Yield and trim.** An item can have a usable percentage (a fruit that is 80% usable after peeling): the cost per usable
  unit is cost / yield. Stored as `YieldPercent` (default 100).

**Recipe (`ProductItemLink` grows into a recipe line)**

- Each line: item, quantity in the item's base unit, and an optional **allowance %** (for known, small, unavoidable loss like
  the spill that always happens when pouring). Total used per sale = quantity x (1 + allowance).
- **Size-aware recipes.** Size is an add-on in this app, so a recipe line can be "per size": the Large size add-on carries
  its own cup and lid links, and a base-product line can scale by a multiplier tied to the chosen size (Large uses 1.5x the
  milk). Rule of thumb: things that change with size are linked to the size add-on; things that never change stay on the
  product. (This is the "size cups stay linked to the Size add-on" rule, extended.)
- **Add-ons replace or add.** An oat milk add-on can *replace* the recipe's dairy milk (deduct oat, not dairy) or *add* an
  extra (extra shot). A line gets a mode: Add (default) or Replace item X. Without Replace the cashier selling oat milk would
  still deduct dairy.
- **Prepared items (sub-recipes).** Syrup made from sugar and water, cold brew batch, espresso from beans, whipped cream: an
  item can be marked *prepared* with its own recipe and a yield ("this batch makes 4 L"). A **Produce batch** action
  consumes the ingredients, adds the prepared item to stock at the batch's cost per ml, and writes both movements together.
  Sales then deduct the prepared item. Without this, "1 espresso shot" has no honest cost.
- **Supplies not worth tracking exactly** (ice, water, napkins, straws, stirrers): instead of an item per piece, a
  **supplies allowance** per product or per order (for example PHP 2 per drink), counted into cost without stock movements.
- **Recipe editor** on the product page (product editor "Track inventory" flow from Phase 1): add ingredient lines, see the
  live **cost, price, margin PHP and margin %**, warning when the margin is below a target. A copy-from-product button
  (Large Latte from Regular Latte) and a CSV import for opening setup. Cost shown only to roles with inventory rights, never
  on the customer link or the cashier's POS (a setting).
- **Where the maths lives.** `WTF.Calculations` gets `CostRules` (cost per unit, weighted average, yield, recipe cost per
  size and add-on replacement) and `MarginRules` (margin, markup, price for a target margin). The Angular recipe editor shows
  a live preview through `shared/calculations`, using the same shared cases in `calculation-cases.json`, in whole cents
  (costs per ml need more decimals: store cost as a decimal with 4-6 places and round only at totals).
- **Deduction uses the recipe.** The order-time stock service (Phase 1 plan) sums recipe lines per item, applies allowances
  and replacements, then deducts. Because the recipe is a standard, this is the **theoretical** usage (see Phase 7).
- Tests: weighted average over several stock-ins, a sale keeps its own cost after a later price change, yield, allowance,
  size multiplier, Replace mode, prepared item batch, supplies allowance, rounding, and the editor preview equals the API.

#### Phase 7 - Stock counts and variance (when real life differs from the recipe) [Planned]

The recipe says a latte uses 180 ml of milk. Real baristas pour 195 on some, 170 on others, and some milk is spilled. **The
system should not pretend the recipe is exact.** It should treat the recipe as the standard, measure the real balance by
counting, and show the difference as **variance**, so you can tell a wrong recipe from waste from loss.

- **Three numbers per item and period:** *Theoretical usage* (what the sales and recipes say should have been used), *Recorded
  waste* (Phase 5), and *Actual usage* (opening count + received - closing count). **Variance = actual - theoretical -
  recorded waste.** A small steady variance is normal; a large or growing one needs a look.
- **Stock count (stocktake).** A count session for a branch, a storage area or a list of items: the counter enters what is
  physically there (in stock units with fractions: "2.5 cartons"), the system shows the expected balance, and on closing it
  writes `CountAdjustment` movements for the differences (so it is the same ledger and audit as adjustments, with the reason
  "Count"). Options: blind count (the counter does not see the expected number), cycle counts (a few key items daily: milk,
  beans, cups), full count monthly, and a count sheet that works on a phone and offline. Counts above a tolerance need an
  Admin to approve before posting.
- **Opening a period.** A closed count becomes the new opening balance for that item, so variance is measured period to
  period. Month-end can lock a period (no backdated movements; corrections are new movements dated today).
- **Variance report** (Reports > Inventory): per item and period, theoretical, waste, actual, variance in quantity, in PHP
  and in percent, with a tolerance setting per item (for example 5%) that flags the outliers. Sorted by PHP so the milk
  and beans surface before the napkins. Filter by branch and by shift/day when counts are daily.
- **Reading the pattern** (shown as hints in the report, not automatic changes):
  - Steady positive variance on one item, spread over all days: the recipe is too low. Suggest "average real use per drink
    is 195 ml; recipe says 180" and offer to update the recipe or the allowance (an Admin action, audited, with the old
    value kept).
  - Spikes on certain days or staff: pouring habits, spoilage or loss; follow up with training or a closer count.
  - Negative variance (more stock than expected): missing sales entries, a recipe too high, or an unrecorded stock-in.
- **Why not force the recipe to match.** Changing the recipe after every count would hide waste. The standard stays the
  standard; the **allowance %** (Phase 6) captures the normal, unavoidable overuse, and variance shows what is left.
- **Negative stock.** Items that allow negative balances (the Phase 1 setting) are corrected by the next count, with the
  counts showing exactly how far off the sales-based balance was.
- Tests: variance maths with waste and receipts in the period, a count writes the right adjustment, blind count hides the
  expected, a period lock refuses backdating, tolerance flags, the recipe suggestion, roles.

#### Phase 8 - Suppliers, receiving and reordering [Planned]

- **Suppliers** (name, contact, lead time, payment terms, notes) and an item can have several suppliers with a preferred one
  and its pack size and price. Supplier price history shows creeping costs.
- **Receiving instead of bare stock-in.** A receipt has a supplier, invoice number, date, lines (item, quantity in pack
  units, cost, expiry date for perishable items), and a total that can be checked against the invoice. It writes the same
  `AddStock` movements, so the ledger does not change; photo of the invoice optional (private storage, like chat images).
- **Purchase orders (optional).** Draft an order to a supplier from the reorder list, mark it sent, receive against it
  (partial receipts), and see what is still on its way.
- **Reorder levels.** Beside the warning and critical levels: a *par level* (target to hold) and *days of cover* (on hand
  divided by average daily usage, from recent sales). The **reorder list** shows what is below par, with a suggested
  quantity (par - on hand - on order, rounded up to the pack size), grouped by supplier, and exportable or copyable to send.
- **Expiry and lots.** For perishables, receiving records an expiry date; usage takes the earliest expiry first (FEFO); an
  "expiring soon" list and an alert (Phase 4 notifications); expired stock is written off as `Waste` with reason Expired in
  one click. With lots, FIFO costing becomes possible, but weighted average stays the default.
- **Returns to supplier** (a negative receipt with a reason and credit note reference).
- **Barcode scanning** at receiving and counting (the barcode field exists; camera scanning on the phone).
- **Units and storage.** Keep unit conversions per item (bottle to ml, carton to bottles), optional storage area (bar, back
  room, freezer) to organise counts, and an item category (dairy, dry goods, packaging, retail) for filters and reports.
- Tests: weighted average after a receipt with different pack prices, FEFO order, par/reorder maths, partial receipts,
  expiry write-off, roles.

#### Phase 9 - Profit and margin reports [Planned]

"Net income" needs more than stock: it needs sales, cost of goods sold, waste, discounts and the **running costs** of the
shop. The POS can answer part of it honestly; the rest needs an expenses record. It is **management reporting, not
accounting or tax filing** (the app still stores no tax); the accountant's books stay the official ones.

- **Gross profit report** (Reports > Sales, owner level): Sales (net of discounts and refunds, already defined) minus **COGS
  from recipes** (theoretical) = *theoretical gross profit*; minus recorded waste minus count variance = *actual gross
  profit*. Both lines are shown, because the gap between them is the lesson (Phase 7). By day, week, month, branch, source.
- **Product margin report:** price, recipe cost, margin PHP and %, units sold, total profit; sortable. **Category rollup.**
  Products with no recipe are listed as "cost unknown" instead of counted as free (so profit is never overstated).
- **Menu engineering** view: popularity against margin in four groups (Stars: high both; Plowhorses: popular, low margin;
  Puzzles: high margin, unpopular; Dogs: neither), to decide what to promote, reprice or drop.
- **Price guidance.** In the product editor: the price needed for a target margin (cost / (1 - target)), and an alert on the
  dashboard when an ingredient's cost rises and a product's margin falls below its target. Ties to the promotion guardrail
  "warn when a discount sells below cost".
- **Expenses (new, small).** `Expenses` (date, branch, category [Rent, Salaries, Utilities, Supplies, Marketing, Delivery,
  Payment fees, Other], amount, note, optional receipt photo, recurring option) entered by Admin roles. Provider fees from
  cashless payments (Cashless Payments Phase 1) flow in automatically. The **Profit and loss summary** = actual gross
  profit - expenses = *operating profit* for the period, with the percentages of sales. Label it clearly as an estimate.
- **Dashboard tiles** (owner only): gross margin %, waste %, top variance item, stock value, items below par.
- **Calculations:** `WTF.Calculations` (`ProfitRules`: gross profit, margin, operating profit, shares), shared cases for the
  Angular preview; the Reports catalog gets a new group, **Profit**, driven by report definitions like the others; exports
  (Excel, PDF, CSV) and the monthly workbook get the sheets.
- Tests: hand-worked examples (sales, recipe costs, waste, variance, expense) on a throwaway database checked on screen, as
  for the other reports; unknown-cost products excluded or flagged; refunds reduce sales but waste records cost.

**Inventory open questions**

- Does the shop weigh and measure when preparing, or pour by eye? (Decides how small the allowances are and whether daily
  counts of milk and beans are realistic.)
- Which items should be counted daily, weekly and monthly?
- Are made-to-order drinks the main product, or is retail (bottled goods) bigger? (Retail mostly needs Phases 5 and 8.)
- Who may enter waste, approve counts and see costs? (Assumed: Cashier enters waste; Admin approves counts and sees costs.)
- Will expenses be entered in the app, or only imported from the accountant monthly?

### Polish pass before deploying inventory to production [Planned, added 26 Oct 2026]

Inventory is built and checked on throwaway databases, not yet on the live shop. Before it goes to production, do one
deliberate polish pass over everything built so far (Phases 1 to 4, the Needs Attention and Coverage screens, notifications,
the delete and restore rules, the pre-checkout stock label), so the first real day does not find the rough edges. Nothing here
is new work; it is the checklist for finishing and proving what exists.

**Release steps**

- Run the SQL scripts for stock in order on a copy of the live database first (`tools/sql`: order-time stock, stock alerts,
  alert reminders, notifications), then `tools/dbsync.bat` and a build. Confirm CI runs them on the tag build in the same order
  and that the API is deployed after them.
- Confirm the Production settings: stock reminders on with `DryRun` off at the intended time (already so in
  `appsettings.Production.json`), push credentials (FCM and Huawei) set, and the images and report storage reachable.
- Run the whole test suites on CI (including the real SQL Server tests) and fix any flaky test first; the one known flake is an
  image-preview test in the product editor that passes alone.
- Build and try the Android app, which has never been checked for inventory: the stock-in form submit, the POS completion
  stock warning, pull to refresh on Coverage, the bell and the Needs Attention counts.

**Data and setup on the live shop**

- Enter real opening counts with Stock In or an adjustment (reason Count correction), set warning and critical levels, then link
  every product and size or flavor add-on that takes stock; use the Coverage tab until nothing important is left unlinked.
- Switch "Allow sales below zero" off (blocking) only for items with a trusted count, and tell the staff what the red stock
  label at checkout means. Items with no real count stay warn-only.
- Decide who is told about each item (the item's named people, else Super Admins, Admins and Stock Managers) and check that
  those people exist and are active.
- Take a backup of the live database right before the first run.

**Screens and wording**

- Walk every inventory screen as each role (Super Admin, Admin, Stock Manager, Item Manager, Admin Viewer, Cashier) at phone,
  tablet and desktop width, in the default and cafe styles, with long names: Items, item details and editor, Stock In, Needs
  Attention, Coverage, the bell, order details stock box, the refund dialog, and the editor's stock label.
- Review every message for plain words and consistency (errors, warnings, confirmations, empty states), and the "Not set" style
  on the item details page.
- Fix the layout between 640 and 1023 px, where the always-open sidebar leaves the content about 380 px wide and squeezes pages
  such as item details (one letter per line for a long title). It is the app-wide layout, not inventory only.
- Accessibility pass: focus order, labels on icon buttons, contrast of the red and amber labels, and the tap-to-expand title.

**Behavior to decide or confirm**

- The open choices on daily stock reminders: snooze, escalation to Admins, skipping closed days, `MaxDays`.
- The remaining hard deletes (promotion child rows, order lines, replaced images).
- Whether to build the three items left out on purpose: write off the remaining stock when deleting an item, a "count it" note
  on restore, and a dependency list when deleting a product.
- Show "stock last updated" on the POS stock label when offline (with Offline Phase 7).
- Check the load: every register asks for stock limits once a minute and every stock screen reloads on a change; watch the API
  on a busy day and slow the poll if needed.

**Proof on a copy of the live data**

- A full hand run on staging with a copy of the real catalog: sell, void with and without returning stock, offline sale and sync,
  customer link order, stock in, adjustment, delete and restore of an item, and the daily reminder, checking each balance and
  alert against a hand-worked answer (never the real `WTF` database).
- A rollback plan: what to switch off first (blocking, reminders) and how to undo the scripts if the first day goes wrong.

### Backend Notes

- Prefer a stock movement ledger over directly editing quantities without
  history.
- Keep sale deductions tied to order references so inventory changes can be
  reviewed later.
- Consider transaction boundaries carefully: order creation and inventory
  deduction should succeed or fail together for tracked products.
- Avoid separate systems for retail stock and consumables; both should use
  the same inventory item and stock movement model.

### Frontend Notes

- Product editor should expose a simple `Track inventory` flow instead of
  forcing users to manually create separate records every time.
- Inventory management should allow adding stock with date, user, quantity,
  cost, notes, and optional supplier/merchant details.
- For mobile/tablet management screens, follow the existing responsive
  table/card pattern used by audit logs, reports, and promotions.

---

## Drink Recipe Guide (barista guide) [Nice to have, planned]

A guide inside the POS that shows staff **how to make** each drink the shop's way, so a new barista can make a Spanish Latte
the same as the owner does. It is different from the inventory recipe (which says *what and how much is used* so stock and
cost work); the guide says *how to prepare it*. They share one source of truth for the ingredient list, so they cannot
disagree.

### What a guide holds (per product, and per size where it differs)

- **Ingredients and amounts**, read from the inventory recipe (Inventory Phase 6): item, quantity, unit. Amounts follow the
  chosen size and add-ons (Large, oat milk instead of dairy, extra shot), so the guide for "Large Oat Latte" is right.
  Until the inventory recipe exists, the guide has its own ingredient list, which is replaced by the shared one later (a
  migration step, not two lists forever).
- **Steps**: ordered, short text, optional photo or short video per step, a timer where it matters (shot time, steep time).
- **Standards**: cup and lid, glass or ice, target volume and temperature, shot time or yield, garnish, how it should look.
- **Notes and warnings**: common mistakes, "stir before serving", **allergens and dietary tags** (dairy, nuts, gluten,
  vegan), caffeine level.
- **Prepared items** (syrups, batches) get their own guide, linked from the drinks that use them ("Brown sugar syrup: see
  recipe").
- A **hero photo** of the finished drink (the product image can be reused).

### Where staff see it

- **Order editor and Orders list:** a "Recipe" button on a cart line or order line opens the guide for that exact item with
  its add-ons and size. Useful when the order is in front of the barista.
- **Product card:** a small book icon (or long press) on the POS menu opens the guide before ordering.
- **Search:** a "Recipes" page listing every drink with search, category filter and tags (hot, iced, blended), usable as a
  training reference.
- **Training mode (later):** a side-by-side quick check or quiz ("what goes in a Spanish Latte?"), and a "new/changed
  recipe" badge so staff notice a changed guide. Mark as read per user.
- **Kitchen ticket (with Printing):** an optional line with the key steps or a recipe code for a busy bar.
- **Not on the customer link** by default. A setting may show the ingredient and allergen list publicly, because customers
  care about allergens.

### Data and editing

- Tables: `RecipeGuides` (product or add-on, optional size, hero image, notes, standards, version, active) and
  `RecipeGuideSteps` (order, text, image, timer seconds). Soft delete and restore like the other management records.
- **Editing is Admin and above**; everyone who can take orders can read. Keep a version history (who changed what and when,
  the previous version kept) so a bad edit can be undone and so staff can see what changed. Audit `RecipeGuideUpdated`.
- Images and videos use the existing image storage (add the guide images to `ImageReferences.ReferencingEntities` so Stale
  Image Cleanup keeps them; its test fails otherwise). Keep videos short and small (compress, size cap), or link to a video
  instead of storing it.
- **Offline:** the guide is part of the POS catalog cache (Dexie `catalog`) with its images in the image cache, so it works
  without a connection like the rest of the catalog. Add the guides to `GET /api/sync/pos-catalog` or a lighter separate
  sync endpoint, refreshed with the periodic catalog refresh; keep the payload small (text and compressed photos only).
- **Multi-tenant and branches:** guides belong to the tenant and are shared by its branches; a branch may later have its own
  variation (a different machine, a different syrup brand).
- **Printing:** a printable recipe card (PDF) per drink or per category, for the bar wall.

### Phases

| Phase | Content |
| ----- | ------- |
| G1    | Guide per product: ingredients (own list), steps (text), standards, allergens; Recipe button in the editor; Recipes page; Admin editor; offline cache |
| G2    | Photos per step, hero image, timers, versions and "changed" badge, printable cards |
| G3    | Ingredients read from the inventory recipe and follow size/add-ons; training mode; optional public allergen info |

### Tests

Guide opens for the right product, size and add-ons; amounts follow the size; Cashier can read but not edit; Admin edit keeps
the old version; images survive Stale Image Cleanup; offline open from the cache; the editor refuses an empty step; specs
for the service, the editor and the Recipes page.

### Open questions

- Who writes the guides (the owner, head barista), and are step photos or videos realistic for them to produce?
- Should the guide be visible to every role including Cashier, or only to kitchen/bar staff?
- Is it also a training tool (quiz, sign-off), or only a reference?

---

## Auto-Update Feature [Completed]

Implemented in-app update detection and APK download flow using GitHub Releases.

### Versioning Strategy

- **Single source of truth:** `package.json` `version` field
- Follow semver: MINOR bump for features, PATCH for fixes, MAJOR only
  for breaking changes
- `build.gradle` `versionCode` and `versionName` derived from
  `package.json` at CI build time
  - `versionCode = MAJOR * 10000 + MINOR * 100 + PATCH`
  - `versionName = "MAJOR.MINOR.PATCH"`
- Angular app version is available via `src/environments/version.ts`

### CI/CD Workflow (`main.yml`)

| Trigger           | What happens                                                    |
| ----------------- | --------------------------------------------------------------- |
| `push to main`    | Build API + Frontend + Android APK (CI validation build)        |
| `push tag v*`     | Build everything -> Deploy to MonsterASP -> Create GitHub Release |

- Deploy and release jobs run on tag pushes (`v1.0.0`, `v1.1.0`, etc.)
- GitHub Release is auto-created with the tagged APK attached
- Tag format: `v{MAJOR}.{MINOR}.{PATCH}`

### Build-Time Version Injection [Completed]

- CI reads version from `src/wtf-pos/package.json`
- CI computes and injects:
  - `APP_VERSION_NAME={MAJOR}.{MINOR}.{PATCH}`
  - `APP_VERSION_CODE=MAJOR * 10000 + MINOR * 100 + PATCH`
- Android consumes these in `src/wtf-pos/android/app/build.gradle`
- CI generates `src/wtf-pos/src/environments/version.ts` for build artifacts

### In-App Update Check [Completed]

- **`UpdateService`** (`src/wtf-pos/src/app/core/services/update.service.ts`):
  - Runs on Android only
  - Checks on startup, every 30 minutes, and when connectivity returns
  - Calls GitHub Releases latest API:
    `GET https://api.github.com/repos/{owner}/{repo}/releases/latest`
  - Compares release `tag_name` vs current app version using semver parsing
  - Prefers `.apk` asset download URL, falls back to release page URL
  - Supports per-version "Later" dismissal via localStorage
- **Update banner UI** (`src/wtf-pos/src/app/shared/components/update-banner/`):
  - Non-blocking banner with version and actions
  - Download opens release URL for manual APK install
  - "Later" dismisses current version notice

### Implemented Files

| File                                                   | Implemented change |
| ------------------------------------------------------ | ------------------ |
| `src/wtf-pos/package.json`                             | Semver source of truth + release scripts |
| `src/wtf-pos/scripts/release-version.mjs`              | Version bump + commit + tag workflow |
| `.github/workflows/main.yml`                           | Version resolve/validation + build + release flow |
| `src/wtf-pos/android/app/build.gradle`                 | Reads `APP_VERSION_NAME` and `APP_VERSION_CODE` |
| `src/wtf-pos/src/environments/version.ts`              | Exposes `appVersion` for UI/runtime |
| `src/wtf-pos/src/app/core/services/update.service.ts`  | Release polling + version compare + dismiss state |
| `src/wtf-pos/src/app/shared/components/update-banner/` | Update banner component |
| `src/wtf-pos/src/app/shared/components/layout/`        | Renders update banner globally |

---

## Audit Log Feature [Completed]

Track significant actions so management can review who performed an action and when.

### Implemented Database

- SQL script: `tools/sql/20260226_add_audit_log.sql`
- `dbo.AuditLog` table created with:
  - `Id`, `UserId`, `Action`, `EntityType`, `EntityId`
  - `OldValues`, `NewValues`, `IpAddress`, `Timestamp`
- Indexes added for common reads:
  - `IX_AuditLog_UserId`
  - `IX_AuditLog_Action`
  - `IX_AuditLog_EntityType`
  - `IX_AuditLog_Timestamp`
- Scaffolded into `WTFDbContext` and domain entities.

### Implemented Backend

- `IAuditService` + `AuditService` implemented and registered in DI.
- Uses enum-based action/entity values (`AuditAction`, `AuditEntityType`) to avoid magic strings.
- Audit logging currently integrated in key flows including:
  - auth login/logout handlers
  - order creation flow
- Read endpoints implemented:
  - `GET /api/audit-logs` (paged response)
  - `GET /api/schema-script-history`
- Authorization hardening implemented:
  - dedicated policies for audit resources (`AuditRead`, `SchemaScriptHistoryRead`)
  - only `SuperAdmin` can access audit logs and schema script history
  - existing admin capabilities retained for `SuperAdmin`

### Implemented Frontend

- Management routes and pages added:
  - `/management/audit-logs`
  - `/management/schema-scripts`
- Navigation entries and icons added under Management.
- Role-gated management navigation:
  - audit logs and schema scripts are visible to `SuperAdmin` only
  - route guards aligned with backend authorization rules
- Audit logs page:
  - fetches and displays audit log entries
  - refresh support + pull-to-refresh
  - responsive table/card styling aligned with management list pages
  - Filters drawer (same pattern as orders): date range (today / last 7 days / last 30 days / custom) and multi-select actions, remembered between visits
  - Download Excel / Download PDF of the filtered logs (`Accept` header negotiation on `GET /api/audit-logs`; `GET /api/audit-logs/actions` lists the action names)
- Schema scripts page:
  - displays executed SQL script history
  - refresh support + pull-to-refresh
  - responsive table/card styling aligned with management list pages

### Deployment Support

- Tag-based SQL deployment in CI (`.github/workflows/main.yml`).
- SQL scripts run in `tools/sql` order on tag builds.
- Role migration script added: `tools/sql/20260227_add_super_admin_role.sql`
  - upserts `SuperAdmin` in `UserRoles`
  - upgrades username `admin` to `SuperAdmin`
- Re-run protection via `dbo.SchemaScriptHistory` check:
  - already applied scripts are skipped
  - newly applied scripts are inserted into history

---

## Sales Reporting Feature (Phases 1-3)

Downloadable sales reports to complement the existing real-time
dashboard. The dashboard shows live data; reports provide historical
analysis that can be exported and shared.

| Phase | Name                                     | Status       |
| ----- | ---------------------------------------- | ------------ |
| 1     | Core Reports + Export UX                 | [Completed]  |
| 2     | Monthly Workbook Automation              | [Completed]  |
| 3     | Central Calculator + Report Consistency  | [Completed]  |
| 4     | Report Page Rework + New Reports         | [Implemented, checked] |

### Phase 1 - Core Reports + Export UX [Completed]

### Implemented API

- Endpoints under `/api/reports` with authorization policy:
  - `GET /api/reports/daily-sales`
  - `GET /api/reports/product-sales`
  - `GET /api/reports/payments`
  - `GET /api/reports/hourly`
  - `GET /api/reports/staff`
- Supported query parameters:
  - required: `fromDate`, `toDate`
  - optional: `groupBy` (daily report), `categoryId`, `subCategoryId`, `staffId`
- Response formats implemented:
  - JSON (`application/json`) for on-screen preview
  - Excel (`Accept: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`)
  - PDF (`Accept: application/pdf`)
- Totals included in Excel exports and summary sections in PDF exports.
- Product report revenue computation aligned to order math:
  - `(parent unit price + add-ons per unit) * parent quantity`
- Timezone handling:
  - filtering/comparison based on UTC range
  - grouped/displayed periods respect request timezone (`X-TimeZone`).

### Implemented Frontend

- New route: `/management/reports`.
- Visual alignment with Management pages:
  - consistent headers, spacing, table/card styling, refresh pattern, loading/empty states.
- Report controls implemented:
  - report type selector
  - date presets (`Today`, `Yesterday`, `This Week`, `This Month`, `Last Month`, `Custom`)
  - report-specific filters (`groupBy`, `category`, `subcategory`, `staff`)
  - search across all visible columns
  - sortable columns for all report tables
- Responsive behavior implemented:
  - mobile/tablet hideable filters
  - mobile card rendering for report rows
- Export UX implemented:
  - download Excel/PDF from UI
  - Android flow supports save + open/share fallback.

### Reports UX Enhancements (Implemented)

- Reports filters now use a full-height side drawer pattern on mobile and
  short-height screens for better usability.
- Search and action buttons remain outside the drawer for faster access.
- Drawer interaction and styling are aligned with other management screens
  and shared through a reusable side drawer component.

### Phase 2 - Monthly Workbook Automation [Completed]

- New monthly workbook APIs under `/api/reports/monthly-workbook`:
  - `GET /status?year=YYYY&month=MM`
  - `POST /generate?year=YYYY&month=MM`
  - `GET /download?year=YYYY&month=MM`
- Workbook design:
  - one Excel workbook per month (year/month selector)
  - report sheets for:
    - `Daily Sales Summary`
    - `Product Sales Breakdown`
    - `Payment Method Breakdown`
    - `Hourly Sales Distribution`
    - `Staff Performance`
  - company header/branding and report summaries included
- File lifecycle:
  - regenerate/overwrite the same monthly workbook for same year/month
    parameters (prevents duplicate historical files for the same period)
  - storage abstraction supports local filesystem and blob storage
- Frontend UX:
  - Reports page has dedicated `Monthly Workbook` tab
  - year/month selectors with `Generate Workbook` and `Download Workbook`
    actions
  - `Download Workbook` disabled when file does not exist or generation is
    in progress
- Scheduler:
  - hosted scheduler regenerates the workbook automatically at configured
    local time (default `00:00`, `Asia/Manila`)
  - scheduler settings are configurable via `MonthlyReportWorkbookScheduler`
    app settings section

### Phase 3 - Central Calculator + Report Consistency [Completed]

Why: the dashboard and the reports each decided for themselves what counts as revenue, an order, an average and tips, so
the same day showed different numbers. All business arithmetic now lives in one project.

**`WTF.Calculations` (new project, `src/WTF.Calculations`)**

- Pure arithmetic on objects already in memory: no EF queries, no HTTP, no file formats. References `WTF.Domain` only.
  `WTF.Api` and `WTF.Tests` reference it. All of its tests stay in `WTF.Tests` (`Calculations/`, `Common/`, `Features/Pricing/`).
- `Orders/OrderMetrics` (order and line totals, add-on overrides, bundles), `Orders/PromotionPricing` (discounted-product
  rules; no longer depends on an API DTO) and `Orders/PromotionLabelFormatter`. Moved here unchanged from `WTF.Api/Common/Orders`.
- `Sales/OrderStatuses` (status ids) and `Sales/SalesRules`: the one definition of a sale. `IsSale` (completed only),
  `IsVoided` (cancelled or refunded), `Summarize` -> `SalesSummary` (total, completed and voided counts, revenue, tips,
  average order value), `Average` and `PercentOfTotal`. A test keeps `OrderStatuses` equal to the API's `OrderStatusEnum`.
- `Time/ReportDateRange` (local day range -> UTC) and `Time/ReportPeriods` (local date, hour, and the day, Monday-based week
  or month an order falls in).
- In `WTF.Api`, `Common/Orders/AddOnPriceLookup` is the one database query that loads the active add-on price overrides an
  order total needs. It replaced about fifteen copy-pasted versions (five reports, the dashboard, and the order handlers).

**Definitions (reports and dashboard now agree)**

- Revenue, order count, average order value and tips count **completed orders only**. Cancelled, refunded and pending
  orders never add to them.
- Average order value = completed revenue / completed orders. (The dashboard used to divide by every order and add tips
  from cancelled and refunded orders; both fixed. Order counts and the status breakdown still count every status.)
- Customer link orders are saved under the system user `customer-link`. The staff report shows that row as
  "Customer link (online)" and the staff filter no longer lists the user.
- Orders are still bucketed by **creation time**, so a refund made later lowers the revenue of the day the order was created.

**Who uses it:** the dashboard (summary, hourly and daily points, payment methods, top products), the five reports, the
monthly workbook (through the reports), and the create, update, void, list, history and public order handlers.

**Removed:** the unused `POST /api/pos/promotions/evaluate` endpoint with `EvaluatePromotionsHandler`, its DTOs and its
tests, and the client method `PromotionService.evaluateCart` with its models. Nothing in the app called them, and the
handler held a second copy of the fixed-bundle logic. (Bundle prices are taken from the promotion when an order is saved.)

**Angular side (`src/wtf-pos/src/app/shared/calculations`)**

- The POS cannot ask the API for every cart change (no round trip per tap, and it must work offline), so it keeps its own
  calculator, now in one place instead of copies spread over components:
  - `money.ts`: all money maths in whole cents, so sums match the API's decimal arithmetic to the centavo.
  - `order-pricing.ts`: add-on totals, unit and line prices, cart totals, saved-order line totals, promotion discount.
  - `promotion-pricing.ts`: exact add-on matching, discounted price (fixed wins, never below zero, half a centavo
    rounds up), promo label and the best matching rule.
- Used by the order editor, order details, receipt, order list (offline pending total), add-on selector, public order
  page and public add-on picker. The discounted-product rules had four copies (editor, details, add-on selector twice);
  there is now one.
- **Compared against the API.** `calculation-cases.json` holds sample orders, discounts, labels and rule matches with the
  answers both sides must give. The Angular specs and `WTF.Tests/Calculations/SharedCasesTests.cs` both run it, so a rule
  changed on one side only fails a test.
- The API stays the authority: it recomputes the total whenever an order is saved, and offline orders send no totals.
- Also in the module: `addMoney`, `subtractMoney` and `roundMoney` (checkout change, amount due, exact amount), and
  `sales-stats.ts` (`average`, `percentOfTotal`, `percentChange`) used by the dashboard, the donut chart and the report
  totals. `average` and `percentOfTotal` run the same shared cases as `SalesRules` in the API.

**Checked in the running app (14 Oct 2026)**

Ran the API and the Angular app against a throwaway LocalDB database with hand-calculable data (never the real `WTF`
database) and compared every figure with the answer worked out by hand, using the Playwright skill for the browser.

- API: 79 checks on order totals (every status, add-on overrides, bundle), the dashboard (today vs the day before,
  hourly and daily points, payment methods, top products), all five reports, and the source filter. All match.
- Excel exports of the five reports: 17 checks, all match (the PDF endpoint returns a valid PDF; PDF text was not read).
- Screens: dashboard tiles and change percentages, all five reports, order details and receipt (promotion discount,
  add-on override, bundle), the live cart in the order editor (exact add-on promotion, override price, an extra add-on
  blocking the promotion, quantity), the POS checkout change, the customer link page (cart, add-on picker, tip, cash
  change, order placed and what the server saved), and the saved order against the cart total. All match.
- **Bug found and fixed:** an order queued while offline showed its list-price total in the Orders list (285.00) instead
  of the total with promotions (273.00) that the cart and receipt showed. Queued orders now store the total worked out
  at queue time (`PendingOrder.previewTotal`); the list shows it.
- **Tips in cash payments (decided and done):** the POS checkout and the customer link used to differ. The customer link
  added the tip to what must be paid; the POS left it out, so for 700 handed over on a 629 order with a 10 tip it told
  the cashier to give back 71 instead of 61. Both now follow the real cash workflow: a tip is part of what the customer
  hands over, so amount due = total + tip and change = cash - (total + tip). `CashPayment` (API) and `cash-payment.ts`
  (Angular) run the same shared cases; the POS dialog's "Exact amount" and "insufficient payment" use the amount due,
  and the server works the change out itself when an order is created or updated (it no longer trusts the app's figure,
  which also corrects an order queued offline by an older version). Orders saved before this keep their old change.
- **GCash tips (open):** the POS offers a tip only for cash; the customer link offers it for both. Since nobody checks
  the amount sent, a GCash tip would be recorded, not verified. Proposed: allow it at the POS too, show the amount to
  send (total + tip), and later split tips by payment method in the Payments report so GCash tips can be reconciled
  against the GCash statement.
- Two smaller findings, both fixed afterwards:
  - Opening `/orders/editor` directly with an empty local cache (a fresh device) showed "No products found". The connection
    check starts out "not online", so the first catalog load read the empty local cache. The background refresh that should
    follow once the connection is confirmed ignores any moment before the load has finished, and nothing retried it, so the
    catalog stayed empty until the next 15-minute refresh. `CatalogCacheService.load()` now catches up right after a
    cache-only load, and a new order follows the shared catalog as it fills in (the editor had copied the list once).
    Found by testing in the running app: the first fix (following the catalog) alone did not help.
  - A finished order (completed, cancelled or refunded) with no stored promotion showed a "best guess" promo discount line
    from today's promotions, although nothing was discounted. The guess is now only made for orders still waiting, which
    have no stored prices yet.
- Build: the packages with known vulnerabilities (`System.Security.Cryptography.Xml` and `Pkcs`, and the SignalR client
  used by the tests) are updated to 10.0.13; `dotnet list package --vulnerable` reports none.

**Tooling**

- Root `.editorconfig` (C# style, usings sorting, unused usings as a warning) so `dotnet format` and the
  `dotnet-cs-cleanup` skill apply the project's own rules. The Angular app keeps its own `.editorconfig`.
- Root `CLAUDE.md` for Claude Code (shares `.github/copilot-instructions.md` and this roadmap): run the C# cleanup on
  every edited `.cs` file, put calculations in the two calculator folders, how to run the tests.

**Shared line breakdown (19 Oct 2026)**

- The "+ and -" list under an order line is built in one place: `shared/calculations/line-breakdown.ts`
  (`buildLineBreakdown`, `breakdownOfCartItem`, `groupAddOns`, `addOnDetail`, `countedName`, `listUnitPriceOf`,
  `formatPeso`), all in whole cents, and drawn by `app-line-breakdown` (`card` variant for screens, `receipt` variant
  with inline styles for the off-screen receipt image). The rows always add up: base + add-ons - discount = line total.
- Wording (amount first, so the maths on a row can be checked): base row `Price · ₱150.00 each` (a plain line of several
  items gets this row too, a single item gets none), an add-on that is one per item reads `₱30.00 each`, several per
  item read `₱40.00 × 4 (2 per item)`, several on a single item `₱40.00 × 2`, a free add-on shows no detail. The discount
  row is just `Discount` with the amount; the promo name is the green pill under the product name (order details and the
  downloaded summary, like the carts). Long names wrap with a hanging indent and the amounts stay on the far right.
- Used by the order editor cart, order details, the downloaded summary, the customer cart and customer My orders. The
  three copies of `getGroupedAddOns` / `getGroupedBundleItemAddOns` and the "(PHP x / unit)" footer are gone (bundle
  child add-ons use the `addOnLabels` pipe). The summary shows the quantity in front of each name (`2x Latte`).
- Order details shows the order note in its own "Order note" box (it was only on the summary before) and keeps each
  product's note under its line.
- A waiting order (no stored prices) shows the promotion guess in its breakdown, so its line total matches the order
  total the server works out (`PendingOrderPreview`). A limited promotion marks the lines it covers
  (`discountPromotionId`), so the other lines of a waiting order are not guessed (before, a part-covered order showed the
  promotion on every line and its lines did not add up to the total).
- `CartItemDto.originalPrice` carries the list price; `PublicCartAddOn.type` lets the customer cart sort like the staff
  screens.
- Checked in the running app on a throwaway database (several add-ons and quantities, a promotion on part of a line, a
  negative-priced add-on, long names, notes): order details, the downloaded summary, the customer cart and My orders.
  - Customer My orders now gets the promotion and add-on type from the API (`PublicOrderItemDto.OriginalPrice` and
  `PromoLabel`, `PublicOrderAddOnDto.Type`): a saved order sends what was stored on its line, a waiting order the promotion it
  would get today (`PreviewDiscount.Label`). So it shows the same promo pill, `Discount` row and Size-first add-on order as the
  staff screens, and a plain line of several items gets its `Price · ₱120.00 each` row there too (`showPlainBase`).
- Checked in the running app: My orders at phone width (promo line, discount row, three lines adding up to 560). Still not
  checked: the editor cart for every case. The Orders list Awaiting approval card still says only "N items" on purpose.

**Still open**

- Saved orders on the details and list screens show the server's `totalAmount` for the whole order but still work out
  each line's total in the browser (now with the shared calculator, so it cannot drift from the API). Showing a
  server-provided line total would need a new field on `OrderItemDto`.

### Phase 4 - Report Page Rework + New Reports [Implemented, checked]

**Built (Oct 2026):** exports follow the on-screen search and sort (`search`, `sortBy`, `sortDir`; totals over the remaining rows); daily sales shows gross sales, refunded and net sales (`SalesSummary.RefundedAmount/GrossSales/NetSales`); product report can list add-ons as separate rows (`splitAddOns`); the page is a report catalog (Sales, Products, Staff, Customers, Operations, Inventory) driven by one definition per report (`report-definitions.ts`) and one generic table with the shared sort header, charts, CSV and more date presets; new reports: Daily Close (Z-report), Voids and Refunds (with reason), Promotions Performance, Customer Link Orders, Customers, Stock Status. Report ranges are capped at 366 days and exports at 50,000 rows. New math lives in `WTF.Calculations` (`ReportRules`, `StockRules`, `SalesRules.VoidRate`). Not done: see "Still open" at the end of Round 2.

The original findings and plan follow.

**Round 2 (Oct 2026):** every sales table now shows its steps in order, gross (list price x quantity, add-ons included) - discount (OriginalPrice vs Price) - refunded = net, with a Total row that equals the sum of the rows on screen, Excel, PDF and CSV (not on Daily Close, whose sections mix different measures). Applies to daily sales, product, the new Sales by Category, payments, hourly and staff. Refunded orders now feed those reports (quantity and order counts stay completed-only); a bundle's price is both its gross and net (no discount is attributed); tips and the average order value stay outside the identity (tips are order-level). The math is in `OrderMetrics.ComputeOrderBreakdown` and `SalesSummary.Discounts/GrossSales`. Layout: below 1280 px the reports show cards (two columns from tablet width), the table starts at 1280 px with low-value columns hidden until 1536 px; the report header is a compact back button, title, filters and refresh, with search and Excel/PDF/CSV below. The monthly workbook now has 12 sheets built from the same report tables (adds Daily Close, Sales by Category, Promotions, Customers, Customer Link Orders, Voids and Refunds, Stock Status). The dashboard has an insights row (refunds and discounts, void rate, stock to restock, awaiting approval, customer link orders, top promotion, new vs returning customers) that links to the matching report (`/management/reports?report=<slug>`).

**Still open (after Round 2):**

- Weekday x hour heatmap and add-on attach rate (add-on performance) reports.
- Inventory reports: purchases (stock-in with cost) and theoretical usage and margin.
- Step 4 upgrades not built: pending count and previous-period comparison, best and worst day (daily); cumulative share, active products with no sales (product); source split (payments); average per day, peak hour, hide closed hours (hourly); voids per staff, items per order (staff). Refunded amount and net sales for the daily report are done (Round 2).
- Report handlers still load full order graphs into memory; they now refuse a range over 100,000 rows with a clear message, but a lighter query is still to do.
- Not yet checked: the contents of the Excel/PDF/CSV exports (the workbook files were generated and downloaded per source, but not opened).

**Round 3 (18 Oct 2026):** the monthly workbook takes an optional source (`source` on status, generate and download; its own file per source, `...-Pos.xlsx` and `...-CustomerLink.xlsx`; the shop-only file leaves out the Customer Link Orders sheet; the scheduler still builds the all-orders file). The Monthly Workbook tab has a Source select. Report handlers refuse more than 100,000 rows (`ReportQueryLimits`). Payments report has a Tips column (tips per method). Chart y-axes no longer repeat a label when the maximum is tiny (`chartTickCount`). The closed Filters drawer no longer casts a shadow on the right edge of the page. The cafe style's awning stripe is painted over the top edge instead of taking 7px of layout, so the header and page start at the same place in both styles.

**Checked in the running app (18 Oct 2026):** API and Angular app against a throwaway LocalDB database (never the real `WTF` database) with five hand-countable orders: today two completed (2 Latte at 150 with a 10 tip, cash; Croissant 120 + Latte 150, GCash), one refunded (Latte 150), one cancelled; yesterday one completed (2 Croissant, 240). Everything matched the hand-worked answer:

- Daily sales API: today revenue 570, 2 orders, average 285, tips 10, 2 voided (1 refunded, 150), gross 720, net 570; yesterday 240.
- Payments: cash 300 (gross 450, refunded 150), GCash 270; 52.6% / 47.4%.
- Product sales: Latte 3 sold, revenue 450, gross 600, refunded 150; Croissant 1, revenue 120.
- Screens: Daily Sales Summary tiles over the 7-day default (gross 960, refunded 150, net 810, 3 orders, average 270, tips 10), the net sales chart, the report catalog page and Daily Close (same figures). The catalog lists all six groups.
- Layout sweep (headless browser, Asia/Manila): the dashboard, orders, items, products, customers, the report catalog and six reports (daily, close, payments, products, voids, stock), plus the Monthly Workbook tab, at desktop (1440), tablet (820) and phone (390), in the default and cafe styles. No horizontal overflow, no page errors, and the header and page titles sit at the same position in both styles. Figures matched the hand-worked seed (dashboard: 570 sales, 4 orders, 285 average, +138% vs yesterday, void rate 50%, 1 low-stock item; stock status Warning for 3 L against a warning level of 5).


Findings from a review of the reports page and handlers (Oct 2026). Build the shared pieces first, then the reports.

**Problems still to fix**

- Excel and PDF exports ignore the on-screen search and column sort, while the totals cards reflect them. The monthly
  workbook ignores the source filter.
- Refunds are only counted: no refunded amount, net sales or reason is shown, although the reason is saved in `Order.Note`.
- Add-ons are invisible in the product report (their revenue is folded into the parent line).
- The report type picker sits inside the filters drawer, so on mobile you open the drawer to switch reports.
- Searching the daily report by month name finds nothing (it matches an ISO string, not the displayed label).
- Every report loads full order graphs into memory with no limit; a year range or the monthly workbook will get slow.
- `reports.ts` (about 1,500 lines) and `reports.html` repeat one block per report and the sort header about 24 times,
  although the shared sort-header component exists.

**Suggested order**

1. Refactor the page to one report definition per report (columns, query, totals) driving a generic table that uses the
   shared sort header; add a report catalog landing page (Sales, Products, Staff, Customers, Operations, Inventory); make
   exports respect search and sort; add CSV; more date presets (last 7 and 30 days, last week, quarter, year to date);
   charts reusing the dashboard charts.
2. New reports from data that already exists:
   - **Daily close (Z-report):** one printable day with sales, cash vs GCash, tips, voids with reasons, per-staff totals.
   - **Voids and refunds:** order, date, staff, amount, reason, who voided; void rate per staff.
   - **Promotions performance:** uses, revenue and discount given per promotion (`OrderBundlePromotions`,
     `OrderItem.OriginalPrice` vs `Price`, `PromoLabel`).
   - **Customer link orders:** accepted vs rejected, rejection reasons, time to accept and to ready, pickup vs delivery,
     orders per link.
   - **Customers:** top spenders, new vs returning, last visit, loyalty points.
   - **Add-on performance:** sold, revenue, attach rate per product.
   - **Weekday x hour heatmap.**
3. Inventory reports: stock status (warning, critical, out of stock, stock value), purchases (stock-in with cost), and
   theoretical usage and margin (sales x `ProductItemLink.QuantityPerSale` x item cost; works without order-time stock
   deduction). Actual vs theoretical usage needs order-time stock deduction (see Inventory).
4. Upgrades to existing reports: daily (pending count, previous-period comparison, best and
   worst day); product (add-on toggle, category rollup, cumulative share, active products with no sales); payments (source
   split, tips per method); hourly (average per day, peak hour, hide closed hours); staff (voids per staff, items per order).

New report math goes into `WTF.Calculations`, not into handlers. Tax and VAT cannot be reported: nothing stores them.

---

## Multiple Branches, Branding and Selling to Other Stores [Planned, design decided]

Three related goals, planned together because they all need the same foundation: the app must know **which shop** and
**which branch** a request belongs to. Today it knows neither. There is one database, one set of users, one catalog, one
inventory, and the shop's name, logo, currency (PHP), time zone (`Asia/Manila`) and hosts are written in code and in
`appsettings.json`.

| Phase | Name                                   | Status    |
| ----- | -------------------------------------- | --------- |
| 1     | Branches inside one shop               | [Planned] |
| 2     | Branding settings (white label)        | [Planned] |
| 3     | Selling to other stores (multi-tenant) | [Planned] |

### Terms

- **Tenant** (a shop, the customer who buys the app): owns its own users, catalog, customers, promotions and settings.
- **Branch** (a location of one tenant): owns its own stock, orders, cash and staff assignments.
- **White label**: the buyer's own name, logo, colors and address on the app, receipts, customer link page and emails,
  with no "WTF" showing. ("White labeling" is the right term.)

### Decision: one shared app and database, tenants separated by a `TenantId` (not one isolated install per store)

Options compared:

| | Shared app + one database, `TenantId` on every row (chosen) | Database per tenant | Fully isolated install per store |
| --- | --- | --- | --- |
| Cost per store | lowest | low to medium | highest (a server, a database, a deploy each) |
| Releasing a fix | once, everyone gets it | once, plus a migration run per database | once per store; stores drift onto old versions |
| Data separation | by code (a missed filter leaks data) | strong | strongest |
| Onboarding a new store | a row and an invite | script that creates a database | a full deployment |
| Fits this codebase | needs `TenantId` everywhere (large but mechanical) | needs a connection per request | nothing to change, but does not scale |

Why shared: the hosting is MonsterASP shared hosting with `tools/sql` scripts run by CI on tag builds; running a copy per
store would multiply every release and every SQL script by the number of stores. Isolated installs are only worth it for
one large buyer who demands it (see "Escape hatch").

**Safety net for the shared model (required, not optional):** a global EF Core query filter on `TenantId` for every
tenant-owned entity, and `TenantId` set in one place on save (`SaveChanges` override), so a handler cannot forget it. A
test fails if an entity that has `TenantId` is missing the filter, and a database test proves tenant A never reads tenant B
in each area (orders, customers, items, reports, images, chat, audit log). Cross-tenant leaks are the one risk that would
end the business, so this test is the gate for Phase 3.

### Decision: subdomains for addressing, custom domains later

- Each store gets `{slug}.<our domain>` (for example `moonbrew.wtfpos.app`). The API reads the host, resolves the
  tenant, and puts it on the request. One certificate (wildcard) covers all of them. Needs a domain we own and a wildcard
  DNS record; MonsterASP shared hosting may not offer wildcard bindings, so check the plan before promising this
  (fallback: a path or header such as `/t/{slug}`, or a hosting move).
- The customer ordering link keeps the same tail (`/shop/:token`) under the store's subdomain. The token already names the
  customer, so the tenant also comes from the link, never from anything the visitor types.
- Custom domain per store (`order.theircafe.com`) is a paid extra for later: a `TenantDomains` table (host to tenant) and
  automatic certificates. Do not build it first.
- The Android app is a single app with a "shop code" (or the subdomain) entered at first login, stored on the device. One
  APK for everyone. A store-branded APK (own name and icon on the Play Store) is a separate paid tier, because it needs its
  own build and store listing (see Phase 2).

### Phase 1 - Branches inside one shop [Planned]

Goal: one owner, several locations, with their own stock, orders and staff, and reports that can show one branch or all.

**Data model** (`tools/sql/<date>_add_branches.sql`, idempotent, then `tools/dbsync.bat`)

- `Branches`: `Id`, `Name`, `Code` (short, used in order labels), `Address`, `Phone`, `TimeZone`, `IsActive`, audit columns.
  Soft delete like the rest of the app. The existing data becomes the first branch ("Main"), created by the script.
- `UserBranches` (user to branch, many to many) plus `Users.DefaultBranchId`. SuperAdmin and Admin see every branch; a
  Cashier works in the branches they are assigned to.
- `BranchId` (required, backfilled to Main) on: `Orders`, `StockMovements`, `OrderLinks` (a link orders from one branch),
  `AuditLog` (optional filter), and the cash/shift records when they exist.
- **Shared across branches** (one catalog, edited once): products, categories, add-ons, promotions, customers, loyalty,
  images. **Per branch:** orders, inventory quantities, stock movements, order numbers, staff assignments, receipt header.
- Optional later: per-branch price override or "not sold here" flag on a product (`ProductBranches`). Not in the first
  cut; ask before building, because it changes how every price and the offline catalog are worked out.

**Inventory.** `Items` stay shared as a definition (name, unit, SKU), but `CurrentQuantity` moves to `ItemBranchStock`
(`ItemId`, `BranchId`, `CurrentQuantity`, warning and critical levels, `AllowNegativeStock`). Stock movements carry the
branch. Add a **stock transfer** (movement pair `TransferOut` and `TransferIn` with one reference id, in one transaction).
This must land before or together with the order-time deduction plan, so deduction is written branch-aware once and not
reworked: `IOrderStockService` takes the order's `BranchId`.

**Request context.** A `ICurrentBranch` service (like `HttpContext.User.GetUserId()`): the POS sends the active branch in
a header (`X-Branch-Id`) chosen at login and switchable from the header menu; the API checks the user is assigned to it.
Handlers use `ICurrentBranch`, never a branch id from the body for writes. The public customer link takes its branch from
the link.

**Order numbers.** `OrderNumberSeq` is one global sequence. Keep it global (unique, simple); show a branch prefix on
screens and receipts (`MNL-1042`) from `Branch.Code`. Offline order numbers (`OFF-YYMMDD-###`) gain the branch code, and
`OfflineLocalId` stays unique per device.

**Calculations (`WTF.Calculations`).** No arithmetic changes, but the report layer needs a branch filter and a branch
breakdown. New math (for example sales per branch, share of total, transfers in and out) goes into `ReportRules` and
`StockRules`, with the shared cases kept in step on the Angular side. `ReportPeriods` already takes a time zone; make it
use the **branch's** time zone, so the "shop day" is right for a branch in another zone.

**Reports and dashboard.** A branch picker (All branches / one branch) on the dashboard and every report, remembered like
the other filters, and a "by branch" report (sales, orders, average, voids, low stock per branch). The Daily Close (Z-report)
is per branch. The monthly workbook gets a branch option, like the source option (its own file per branch).

**Authorization.** New policy `BranchesManage` (SuperAdmin, Admin). Every order, stock and report handler checks the
caller may use the requested branch. Add to `RouteTableTests` and `PolicyMatrixTests`.

**Offline.** The device stores its branch in the cart and queue records; a queued order syncs to the branch it was sold in,
even if the user switched branch afterwards. The sync review (Offline Phase 6) is unchanged. Catalog cache is shared; the
stock cache (when POS stock warnings arrive) is per branch.

**Customer link.** Pickup happens at a branch: the link (or the order) names the branch, delivery too. A customer who can
order from several branches picks one at checkout (list of active branches). Staff alerts and the "Awaiting approval"
banner go to staff of that branch only.

**Tests.** A branch cannot be read or written by a user who is not assigned to it; backfill puts all old rows in Main;
transfers move stock in one transaction and refuse a negative result when blocking is on; reports for one branch plus the
others add up to "All"; order numbers stay unique; the offline sync saves into the branch it was queued in.

### Phase 2 - Branding settings (white label) [Planned]

Goal: the buyer sees their own name and look everywhere, with nothing hardcoded.

**What becomes a setting** (`TenantSettings`, one row per tenant; `BranchSettings` for the per-branch parts):

- Identity: shop name, short name, tagline, logo (light and dark), favicon, receipt logo, address, phone, email.
- Colors: a primary and an accent color (and the DaisyUI theme name to start from). The app already has a default and a
  cafe style; the new theme is generated from the two colors, so contrast is checked automatically (reject a pair that
  fails accessible contrast).
- Locale: currency code and symbol, decimal places, time zone, date format, week start. Today `Asia/Manila`, PHP and the
  peso sign are scattered through code (about 290 occurrences in 80 files, mostly tests); they move behind one
  `ShopLocale` (API) and one `locale` provider (Angular) so a new shop can use another currency. `money.ts` and
  `Money` already work in whole minor units; only the symbol and the number of decimals become settings.
- Receipt text: header lines, footer message, optional tax/registration number line (display only; the app does not compute
  tax, see the reports section).
- Customer link page: header name, logo, welcome line, contact info, order rules text.
- Push and email wording that now says "WTF".

**How it reaches the app.** A public, cached, no-auth `GET /api/public/brand` (resolved from the host) returns the name,
logo URLs, colors and locale. The Angular app loads it before first paint, sets CSS variables for the theme, the page title
and favicon, and exposes it through a `BrandService`. The customer link page loads it the same way, so a customer never
sees another store's brand. Fallback: the default WTF brand when nothing is set (and for the development host).

**Where "WTF" is allowed to stay.** A small "Powered by WTF POS" line on the customer link page and the login screen for the
standard plan; removable on a higher plan (a feature flag on the tenant). Decide this pricing question before building.

**The Android app.**

- Standard: one shared app; after the shop code is entered, it takes the name, logo and colors from the brand endpoint.
  The launcher icon and the app name in the Android list stay "WTF POS", because those are fixed at build time.
- Premium (optional): a branded build per store (own name, icon, splash, package id, and its own Play Store listing). Needs a
  build pipeline that takes a tenant brand file and produces a signed APK or AAB. It is real ongoing work (store
  accounts, review, updates per store), so price it as a separate service, not a toggle. The auto-update check
  (`UpdateService`, GitHub Releases) is tied to our repository and would need a per-store release source.

**Images.** Brand images use the existing image storage, in a folder per tenant (`images/{tenantId}/...`). Stale Image
Cleanup must treat the tenant brand rows as in use (add them to `ImageReferences.ReferencingEntities`; its test fails
otherwise).

**Tests.** Brand falls back to defaults; a color pair with poor contrast is refused; the brand endpoint is anonymous but
returns nothing private; currency and decimals change the totals shown and the export headers; receipts and the customer
page render the brand; no "WTF" string remains in templates except through the brand (a test greps the templates).

### Phase 3 - Selling to other stores (multi-tenant) [Planned]

Goal: a second, third and tenth shop can sign up (or be set up by us) and run on the same deployment, without seeing each
other.

**Data model**

- `Tenants` (`Id`, `Name`, `Slug` (unique, lowercase, reserved words blocked), `Status` (Trial, Active, Suspended,
  Cancelled), `Plan`, `TrialEndsAt`, created and updated columns) and `TenantDomains` (host to tenant, for custom domains
  later).
- `TenantId` on every tenant-owned table (users, roles assignments if stored per tenant, branches, products, categories,
  subcategories, add-on types, product add-ons and overrides, promotions and all rule tables, customers, loyalty, items,
  stock movements, orders and children, order links, conversations and messages, images, audit log, report and workbook
  files). Written as a script that adds the column, backfills the current data to a first tenant (the WTF shop itself), then
  makes it required and adds the global query filter. Child tables that always travel with a parent can inherit the parent's
  tenant, but keep `TenantId` on anything queried on its own (orders, items, customers, audit log, images, messages).
- **Unique rules become per tenant:** product names, SKU, barcode, usernames or emails, customer numbers, link tokens stay
  globally unique (they are secrets), promotion names. Every unique index that is not a secret gets `TenantId` in it.
- **Users:** a user belongs to one tenant (simplest). Login takes the tenant from the host (or shop code on Android). The same
  email can exist in two shops. A user who works for two shops is two accounts for now.
- **Roles:** the existing roles (SuperAdmin, Admin, Cashier, AdminViewer) become per tenant. A new platform role,
  `PlatformAdmin` (us), lives outside any tenant and can create and suspend tenants and look into one for support, with
  every such access audited. Never reuse the tenant `SuperAdmin` for that.

**Request pipeline.** Tenant resolution middleware (host to tenant; unknown host is a 404 that reveals nothing; a suspended
tenant gets a clear "account suspended" page and its API calls are refused except for the owner billing page). The tenant id
is also put in the JWT and checked against the host on every request (a token from shop A is refused on shop B's host).
An `ICurrentTenant` service feeds the query filter, the audit service, storage paths and the rate limiter.

**Per-tenant everything that is global today** (each is an item to review, and a test):

- Background jobs: the monthly workbook scheduler, stale image cleanup and chat message expiry loop over tenants and run
  each in the tenant's own time zone and settings, and one tenant's failure never stops the others.
- Storage: the blob container, report folder and chat image container are shared, with a `{tenantId}/` prefix; the cleanup
  jobs only look at the tenant they are running for.
- Rate limits and `PromotionLimitGate`: partitioned by tenant so one busy shop cannot slow another; the gate key includes
  the tenant (it is one lock per process today).
- SignalR: groups are prefixed by tenant (`DashboardViewers`, staff and customer order hubs), and the hub checks the tenant
  on connect.
- Push notifications: recipients are chosen within the tenant only; FCM and Huawei credentials stay ours (one app), with the
  shop name in the title from the brand.
- Order number sequence: one global sequence still works (unique); decide whether a shop may see its own count starting at 1
  (a `TenantOrderCounter` table with a lock) because a new shop seeing order 48,213 on day one looks odd. Recommended: a
  per-tenant counter.
- Audit log, schema script history and SuperAdmin-only pages: the tenant SuperAdmin sees only their own audit log; the
  schema script history and system pages move to `PlatformAdmin`.
- Customer link tokens and the loyalty redirect: tokens remain global secrets, but the lookup also sets the tenant.
- CORS: the "AllowUI" policy accepts `*.<our domain>` and registered custom domains, not a fixed list.

**Onboarding and billing**

- A `PlatformAdmin` page (a separate small area of the app, or a separate admin site) to create a tenant, pick the slug and
  plan, create the first SuperAdmin, load starter data (a few categories, one branch, sample products, optional), suspend
  and export. Self-service sign-up is a later step; start with us creating each store by hand while there are few.
- Plans and limits (decide the pricing first): number of branches, number of users, optional features (branding removal,
  chat images, customer links, inventory, branded Android app) as flags on the tenant, checked server side by one
  `ITenantFeatures` service and mirrored in the UI.
- Payment: start with manual invoicing; add a payment provider only when there are enough stores to justify it (subscription
  billing handles card data, so it must go through the provider's hosted checkout, never our own forms).
- Data export on request (their orders, customers, products as files) and a deletion procedure when a store leaves.
  Also required for privacy law (the Philippines Data Privacy Act, and similar elsewhere): a data processing agreement,
  a privacy notice for the customer link page, and clear retention (chat expiry already exists).

**Escape hatch: a fully isolated install.** If one buyer insists (own server, own database, their own legal control), deploy
the same code as a single-tenant instance: one tenant row, their own host and database, same release. This works because the
app always runs with a current tenant, even when there is only one. Keep this possible; do not build a separate fork.

**Security and risks**

- The `TenantId` filter is the whole separation; guard it as described above (filter on every entity, tests per area, no
  `IgnoreQueryFilters` outside platform code, and a review rule for raw SQL, which bypasses filters).
- Never trust a tenant id from the body, query string or headers for writes; it comes only from the host and the token.
- Reports and exports (Excel, PDF, CSV, the workbook) must be built from tenant-filtered queries and saved under the tenant's
  folder; a test downloads one tenant's file with another tenant's login and expects a 404.
- Back up and restore per tenant is harder in a shared database: plan the export tool before the first paying store.
- Support access (`PlatformAdmin` reading a tenant's data) is audited and visible to the tenant.

**Pricing and plans (to decide before onboarding a paid store)**

- **Charge per branch per month, not per user.** Cafes share logins and hire part-timers; per-user pricing pushes owners to
  share one cashier account, which defeats the audit log, voids and per-staff reports. Our costs grow with orders, storage
  (images, chat photos) and support, not with user count. Include a generous user count (for example 10, or unlimited) in
  every plan. A branch is also what an owner can see and predict.
- **Plan shape (sketch, numbers to be set after market research):**

  | Plan | For | Includes |
  | --- | --- | --- |
  | Starter | one branch | POS, orders, basic reports, offline mode |
  | Pro | one or more branches | adds inventory, promotions, customer ordering links and chat, all reports and the monthly workbook |
  | Business | chains | adds multi-branch reports, stock transfers, removal of "Powered by", priority support |

  Price per branch per month, with a discount for paying yearly. Separate add-ons: branded Android app (setup fee plus
  yearly fee), custom domain, data migration or setup help, and cashless payment fees (see Cashless Payments).
- **Implementation.** Plans are feature flags on the tenant, checked by one `ITenantFeatures` service and mirrored in the
  UI. Gate only the few features the plans actually differ on; do not scatter checks. Branch count is a hard limit checked
  when a branch is created.
- **To research before setting numbers:** current Philippine POS competitors and any free tiers (a free tier sets the ceiling
  for small shops), our real cost per store (hosting, storage, push, support time), and payment-provider fees.
- **Pilot first.** The first outside store runs at a discount in exchange for feedback; set the price list after that.
- **Collecting money.** Start with manual invoicing (bank or e-wallet transfer). Add subscription billing only when there are
  enough stores, and only through the provider's hosted checkout (never our own card forms).
- **Open decisions:** is "Powered by" removal a paid feature, is a free trial offered (length), what happens to a suspended
  store's data and for how long (read-only period, then export, then deletion).

**Order of work (do not skip ahead)**

1. Decide the commercial questions: who the first buyers are, price and plans, whether branding removal is paid, whether a
   branded Android app is offered, and which domain the subdomains live under (check that the host allows wildcards).
2. Phase 1 (branches) first. It is useful to the current shop on its own and teaches the codebase to carry a "where" on every
   row; the `TenantId` work is the same pattern one level up, so it is cheaper afterward.
3. Phase 2 (branding settings and locale) next: it is mostly settings and removing hardcoded strings, and it needs no tenant
   separation, so it can ship before any second store exists.
4. Phase 3 in this order: tenants table and middleware, `TenantId` and filters with the leak tests, per-tenant jobs and
   storage, then the platform admin page, then onboarding the first outside store as a pilot at a discount.
5. Only after a pilot has run a few weeks: custom domains, branded Android builds, self-service sign-up, payments.

**Open questions for the owner**

- Is a branch allowed to have its own prices or its own menu, or is the catalog always the same everywhere?
- Do branches share one cash drawer concept, or does each branch close its own day (assumed: each branch closes its own day)?
- Should customers be shared across branches (assumed yes, with loyalty points usable at any branch)?
- Should one login be able to work for two different shops (assumed no)?
- Is the app sold as a subscription run by us (assumed), or as a one-time install for the buyer to host (this changes the
  isolated-install option from escape hatch to the main product)?

---

## POS Checkout Discounts: Senior Citizen / PWD [Planned, confirm the rules first]

Moved here from the promotion ideas. A senior citizen / person-with-disability discount is **not a promotion**: it is set by
law, it belongs to a person (not to a product or a date), the cashier applies it at the register after checking an ID, and the
shop must keep records of it. So it is a checkout discount type with its own rules, ID capture, receipt wording and report.

**Check before building (written from memory of the Philippine rules, not verified).** Ask the shop's accountant or the BIR
for the current rules on: the rate (20%), the VAT exemption for VAT-registered shops, which purchases qualify (food and
drinks for the person's own use), whether a group order is discounted only for the senior/PWD's own items, whether it may be
combined with a store promotion (usually the person takes the better of the two, not both), what the receipt and the sales
record must show, and how the shop claims the discount back as a deduction. The design below is made so each of these is a
setting or a small rule, not a rewrite.

### How it works at the register

1. In the cart, the cashier chooses **Senior / PWD discount** and picks which lines (and how many of a line) are for the
   senior or PWD. Splitting a line works like the part-covered promotion lines: 3 Lattes, 1 for the senior, becomes a
   discounted line of 1 and a normal line of 2. The default is "all items" for a one-person order.
2. The cashier enters the type (Senior / PWD), the ID number and the name on the ID (the ID is shown, not photographed).
   Both are required; the screen reminds the cashier to check the ID.
3. The cart shows the discount as its own row, separate from promotions, and the totals update live (it must also work
   offline: the arithmetic is local).
4. The order is saved with the discount; the server recomputes it (the API is the authority) and refuses a missing ID.

### Calculation (in `WTF.Calculations`, mirrored in `shared/calculations`, shared cases in `calculation-cases.json`)

- New `SeniorPwdDiscount` rule class with whole-cent maths like the rest. Settings: the discount rate (default 20%), the VAT
  rate (12%), and whether the branch/shop is **VAT-registered**.
- VAT-registered shop (as commonly applied): VAT is removed from the covered amount first, then the discount is taken on
  the VAT-exclusive amount: `net = amount / 1.12`, `discount = net x 20%`, `amount due = net - discount`. Non-VAT shop: the
  discount is taken on the price as charged (`discount = amount x 20%`). Round half up to the centavo, per line, and the
  lines must add up to the order total.
- Combining with promotions: the line gets the better of the promotion or the senior/PWD discount for the covered items,
  never both, unless the accountant says otherwise (a setting). This is one of the stacking rules (see "Promotion Ideas
  for Later").
- Tips and add-ons: add-ons on a covered item are covered; tips never are. Bundles: covered only if the rule is confirmed
  for bundles (otherwise block it and say why).
- Reports keep the statutory discount **separate** from promotion discounts (their own column), so the existing gross -
  discount - refunded = net table stays honest, and the VAT-exempt amount can be shown.

### Data (script under `tools/sql`, then rescaffold)

- `OrderSeniorPwdDiscounts`: `OrderId`, `Type` (Senior/PWD), `IdNumber`, `CustomerName`, `CoveredAmount`, `VatExemptAmount`,
  `DiscountAmount`, `RecordedBy`, `CreatedAt`; and a nullable `OrderItems.SeniorPwdDiscountId` so covered lines are known.
  Append-only, like audit data: a correction is a new order override with a reason.
- Settings (until Branding Phase 2 exists, plain app settings): discount rate, VAT rate, VAT-registered yes/no, TIN and
  business address for the receipt. With branches/tenants these become per-branch/tenant settings.
- Privacy: an ID number and name are personal data. Store only these two fields, show the ID masked in lists (last 4
  characters) and in reports shown on screen, show it in full only on the receipt copy and the claim export, restrict the
  export to Admin and above, and include it in the retention rules (it is tax-record data, so it may need to be kept for
  years; ask the accountant).

### Receipt, reports and audit

- **Receipt and order summary:** a Senior/PWD block with the type, name, ID number, the VAT-exempt amount, the discount, and
  a signature line, as the rules require (confirm the exact wording).
- **Senior/PWD report** (Reports > Sales): per day or month, one row per order: date, order number, type, name, ID number,
  gross covered amount, VAT-exempt amount, discount, net; totals row; Excel, PDF and CSV like the others, and a sheet in
  the monthly workbook. It is what the accountant needs to claim the discount.
- **Daily Close (Z-report)** gets a line for the day's senior/PWD discounts and VAT-exempt sales.
- **Audit:** `SeniorPwdDiscountApplied` with the order, type and amount (ID number masked in the audit text); voiding or
  refunding the order reverses the discount in reports.
- **Roles:** Cashier and above can apply it (policy to be added to `PolicyMatrixTests`); removing or editing it on a
  completed order needs the existing Admin override with a reason. AdminViewer cannot.

### Not in the first version

- Online (customer link) orders: the ID must be checked in person, so the discount is not offered on the link. An order
  placed online can have it applied at pickup by staff before completing, if the shop wants (it goes through the same
  cashier action).
- Other statutory or ID-based discounts (solo parent, national athletes, others the law may add): the same design works with
  a new "type" and rate; add them only when asked, with the legal check.
- Tax invoices and VAT reporting beyond the exempt amount: the app still stores no tax (see the Reporting notes). This
  feature adds the minimum, the VAT-exempt amount per covered sale; a full VAT split needs its own decision.

### Tests

- Shared cases for both sides: VAT-registered and non-VAT, one item, several items, a part-covered line, an add-on, a
  tip, a promotion on the same line (better one wins), rounding to the centavo, lines adding up to the total.
- A missing or blank ID is refused; the server recomputes a total the POS got wrong (`expectedTotal` check); a covered line
  voided or refunded reverses the amounts; the offline queue stores the discount and the sync saves the same numbers.
- The report: totals equal the sum of rows on screen, Excel and CSV; ID masked where it should be; Cashier cannot export.
- Check by hand on a throwaway database with a worked example before release (for instance a 100.00 item for a VAT-registered
  shop: net 89.29, discount 17.86, amount due 71.43), plus a screen check of the receipt and the report.

### Open questions

- Is the shop VAT-registered (changes the formula and the receipt), and does it issue official receipts?
- Does the accountant want the ID number on the receipt, on the report only, or both?
- Is the discount allowed on bundles, and may it combine with a store promotion?
- Does the shop want a daily cap or a per-customer limit on its own (some shops add one)?

---

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

## Receipt & Kitchen Printing Feature [Planned]

Bluetooth/USB thermal printer integration for customer receipts and
kitchen order tickets.

**NOTE: Requires physical printer hardware for testing.** Development can
start with print preview UI and a mock print service. Actual hardware
integration happens when a printer is available.

### Printer Connection

- Evaluate Capacitor ESC/POS printer plugins (e.g.,
  `capacitor-thermal-printer`, `@nicecode/escpos`)
- Support connection types: **Bluetooth** (most common for mobile POS),
  **USB**, and **Network/IP** (for kitchen printers)
- `PrinterService` (`core/services/`):
  - `discoverPrinters()` - scan for nearby Bluetooth/network printers
  - `connect(printerId)` / `disconnect()`
  - `printReceipt(order)` - format and send receipt data
  - `printKitchenTicket(order)` - format and send kitchen ticket
  - `testPrint()` - send a test page to verify connection
  - Maintain connection state as signals (`isConnected`,
    `connectedPrinter`)

### Receipt Printing

Triggered after a completed order or manually via the order detail page.

**Receipt layout (58mm or 80mm thermal paper):**
```
=============================
        WTF Coffee Shop
     123 Main St, City
    Tel: (02) 1234-5678
=============================
Order #1042
Date: 24 Feb 2026, 2:30 PM
Cashier: Alain
-----------------------------
1x Iced Latte (L)       PHP180
   + Vanilla Syrup        PHP30
1x Croissant             PHP120
-----------------------------
Subtotal                 PHP330
Tips                      PHP20
TOTAL                    PHP350
-----------------------------
Cash                     PHP500
Change                   PHP150
=============================
    Thank you! Come again!
=============================
```

- Shop branding (name, address, phone) configurable in settings
- Footer message configurable (e.g., "Thank you! Come again!")

### Kitchen Ticket Printing

Auto-printed when an order is created or when items are added to an
existing order. Sent to a separate kitchen printer.

**Kitchen ticket layout:**
```
=============================
 ORDER #1042 - NEW
 2:30 PM - Cashier: Alain
=============================
 1x Iced Latte (L)
    + Vanilla Syrup
 1x Croissant
-----------------------------
 Special: No ice please
=============================
```

- Only includes items and special instructions (no prices)
- Bold/large font for order number for visibility
- When items are **modified** on an existing order, reprint with
  "MODIFIED" header and highlight changes

### Printer Settings UI

New route: `/management/settings/printers` (or a section within a
general settings page).

- List discovered printers with connect/disconnect buttons
- Assign printer roles: **Receipt Printer** and **Kitchen Printer**
  (can be the same or different devices)
- Toggle: auto-print receipt on order completion (on/off)
- Toggle: auto-print kitchen ticket on order creation (on/off)
- Test print button for each connected printer
- Save printer preferences in `localStorage` (device-specific)

### Print Preview

- Before sending to a physical printer, show an on-screen preview
  modal with the formatted receipt/ticket
- Useful for development without a printer and for user confirmation
- "Print" and "Cancel" buttons on the preview

### Reprint

- On the order detail page, add "Print Receipt" and "Print Kitchen
  Ticket" buttons
- Works for any past order, not just the current one

---

## Dynamic Catalog Management Feature [Planned]

Currently, product categories (`ProductCategory`), subcategories
(`ProductSubCategory`), and add-on types (`AddOnType`) are referenced
by integer IDs that map to hardcoded enums (`ProductCategoryEnum`,
`ProductSubCategoryEnum`, `AddOnTypeEnum`). Adding a new category or
add-on type requires a code change, database insert, and redeployment.

This feature makes them fully dynamic - managed through the UI with no
code changes needed.

### Database Changes

**`ProductCategory` table** - add columns:

| Column       | Type         | Description                           |
| ------------ | ------------ | ------------------------------------- |
| `SortOrder`  | `int`        | Display order in POS (lower = first)  |
| `IsActive`   | `bit`        | Soft delete - hide without removing   |
| `CreatedAt`  | `datetime2`  | Audit timestamp                       |
| `CreatedBy`  | `GUID` (FK)  | Who created it                        |
| `UpdatedAt`  | `datetime2?` | Last update timestamp                 |
| `UpdatedBy`  | `GUID?` (FK) | Who last updated it                   |

**`ProductSubCategory` table** - same new columns as above, plus:

| Column       | Type         | Description                           |
| ------------ | ------------ | ------------------------------------- |
| `CategoryId` | `int` (FK)   | Link subcategory to parent category   |

Currently subcategories are independent of categories. Adding
`CategoryId` creates a proper hierarchy: Category -> Subcategory ->
Product.

**`AddOnType` table** - add columns:

| Column       | Type          | Description                          |
| ------------ | ------------- | ------------------------------------ |
| `IsRequired` | `bit`         | Must the customer pick at least one? |
| `MinSelect`  | `int`         | Minimum selections (0 = optional)    |
| `MaxSelect`  | `int`         | Maximum selections (0 = unlimited)   |
| `SortOrder`  | `int`         | Display order in the add-on selector |
| `IsActive`   | `bit`         | Soft delete                          |
| `CreatedAt`  | `datetime2`   | Audit timestamp                      |
| `CreatedBy`  | `GUID` (FK)   | Who created it                       |
| `UpdatedAt`  | `datetime2?`  | Last update timestamp                |
| `UpdatedBy`  | `GUID?` (FK)  | Who last updated it                  |

### Remove Hardcoded Enums

- Delete `ProductCategoryEnum`, `ProductSubCategoryEnum`,
  `AddOnTypeEnum` from the codebase
- Replace all enum references with dynamic lookups (the entities
  themselves become the source of truth)
- Update `PosCatalogDto` sync endpoint to include the full
  `AddOnType` records (with rules) so the POS can enforce them offline

### API Endpoints

**Categories** - `/api/categories`

| Method | Route              | Description                        |
| ------ | ------------------ | ---------------------------------- |
| GET    | `/api/categories`  | List all (with subcategories)      |
| POST   | `/api/categories`  | Create new category                |
| PUT    | `/api/categories/{id}` | Update name, sort order        |
| DELETE | `/api/categories/{id}` | Soft delete (set `IsActive=false`) |
| PUT    | `/api/categories/reorder` | Batch update sort orders    |

**Subcategories** - `/api/categories/{categoryId}/subcategories`

| Method | Route                                          | Description        |
| ------ | ---------------------------------------------- | ------------------ |
| GET    | `/api/categories/{categoryId}/subcategories`   | List for category  |
| POST   | `/api/categories/{categoryId}/subcategories`   | Create             |
| PUT    | `/api/subcategories/{id}`                      | Update             |
| DELETE | `/api/subcategories/{id}`                      | Soft delete        |
| PUT    | `/api/subcategories/reorder`                   | Batch sort orders  |

**Add-On Types** - `/api/addon-types`

| Method | Route                | Description                        |
| ------ | -------------------- | ---------------------------------- |
| GET    | `/api/addon-types`   | List all (with rules)              |
| POST   | `/api/addon-types`   | Create with name + rules           |
| PUT    | `/api/addon-types/{id}` | Update name, rules, sort order  |
| DELETE | `/api/addon-types/{id}` | Soft delete                     |
| PUT    | `/api/addon-types/reorder` | Batch sort orders            |

### Frontend - Management UI

New routes under `/management/catalog/`:

**Categories page** (`/management/catalog/categories`):
- List all categories with their subcategories in a tree view
- Inline edit category/subcategory names
- Drag-and-drop or up/down arrows to reorder
- Toggle active/inactive with a switch
- "Add Category" and "Add Subcategory" buttons
- Delete confirmation modal - warn if products exist under it
- When deactivating, show count of affected products

**Add-On Types page** (`/management/catalog/addon-types`):
- List all add-on types with their current rules displayed
- Edit form per add-on type:
  - Name (text input)
  - Required toggle (yes/no)
  - Selection mode: Single / Multiple
  - Min selections (number, 0 = optional)
  - Max selections (number, 0 = unlimited)
- Reorder via drag-and-drop or arrows
- Show count of products using each add-on type

### Frontend - POS Enforcement

Update the order editor's add-on selector to enforce the dynamic rules:

- Read `AddOnType.IsRequired`, `MinSelect`, `MaxSelect` from the
  cached catalog (synced via `PosCatalogDto`)
- **Required types:** Show a visual indicator (red asterisk) and
  prevent order submission until selection is made
- **Min/Max:** Show counter (e.g., "Select 2-4") and disable the
  "Save" button until valid
- **Single select:** Radio-button style selection
- **Multi select:** Checkbox style selection
- Show validation errors inline (e.g., "Size is required",
  "Select at least 2 toppings")

### Migration Strategy

1. Run EF Core migration to add new columns with defaults
   (`SortOrder=0`, `IsActive=true`, `IsRequired=false`,
   `MinSelect=0`, `MaxSelect=0`)
2. Populate `SubCategory.CategoryId` based on current usage patterns
3. Replace enum references in handlers/DTOs with entity lookups
4. Deploy API changes
5. Deploy frontend management UI
6. Update POS catalog sync to include add-on type rules
7. Update POS add-on selector to enforce rules





## Promotions / Bundles Feature [Phase 1 Completed]

### Implemented Scope

| Promo Type | Phase | Status |
| ---------- | ----- | ------ |
| Fixed Bundle (Preset Combo) | Phase 1 | [Completed] |
| Mix & Match (Choose from category) | Phase 1 | [Completed] |
| Buy X Get Y (BXGY) | Phase 1 (legacy) | Replaced by Mix & Match |
| Percentage Discount (Category-based) | Phase 2+ | Future |
| Time-Based Promo | Phase 2+ | Future |
| Order Amount Discount (Spend X Get Y Off) | Phase 2+ | Future |
| Add-On Upsell Promo | Phase 2+ | Future |
| Free Size Upgrade | Phase 2+ | Future |
| Limited Quantity Promo | Phase 2+ | Future |

### Implemented Database

- `Promotions` base table implemented with:
  - `TypeId`, `IsActive`, `StartDate`, `EndDate`
  - audit columns: `CreatedAt`, `CreatedBy`, `UpdatedAt`, `UpdatedBy`
- Promotion image mapping implemented using centralized image table:
  - `PromotionImages` -> `Images`
- Type tables implemented:
  - `FixedBundlePromotions`, `FixedBundlePromotionItems`, add-on mappings
  - `MixMatchPromotions`, `MixMatchPromotionProducts`, add-on mappings
- Order-level bundle tracking implemented:
  - `OrderItems.BundlePromotionId`
  - `OrderBundlePromotions` for sold bundle header rows (qty + unit price)

### Implemented API (Vertical Slices)

- Admin fixed bundle:
  - `POST/GET/PUT/DELETE /api/management/promotions/fixed-bundles`
- Admin mix & match:
  - `POST/GET/PUT/DELETE /api/management/promotions/mix-match`
- POS promotions:
  - `POST /api/pos/promotions/evaluate` (not called by the app; see Sales Reporting Phase 3, "Still open")
- Promotion image endpoints implemented under management promotions.

### Implemented Domain Logic

- Explicit type-based logic (no generic rule engine yet).
- Idempotent promotion evaluation flow.
- Loop prevention rules for promo-produced lines.
- Validation added for:
  - inactive/expired promotions (timezone-aware)
  - inactive/missing products and add-ons
- Global API exception mapping added:
  - `InvalidOperationException` and `ArgumentException` return `400` with user-facing message.

### Implemented Frontend (Management + POS)

- Promotions management list/details/editor implemented and aligned to existing management design language.
- Typed promotion routes implemented:
  - `/management/promotions/fixed-bundles/:id`
  - `/management/promotions/mix-match/:id`
- Promotion images supported in details/editor using centralized image flow.
- Date UX uses local timezone display while persisted values remain UTC.
- Bundle item selector supports linked add-on constraints and required rules.

### Implemented Order Flow Integration

- New bundles tab added in order editor.
- Bundle promotions render as product-like cards (image/name/price).
- Selected bundles are represented as a grouped bundle line with child items in cart, checkout summary, and order summaries.
- Bundle quantity editing supports reopen/reselect behavior and max-selection rules for mix & match.
- Grouped item/add-on display and sorting standardized across cart, order details, and generated summaries.
- Mobile cart includes collapsible order-actions/details section (notes, totals, actions).
- Discounted-product promotions are captured on the order line when the price is saved (`OrderItems.OriginalPrice` and `PromoLabel`, added by `tools/sql/20261010_add_order_item_promo_details.sql`). The discount is `OriginalPrice - Price`, and the server writes the label, so new promotion types need no new columns. Order details, the downloadable summary, and the Payment Summary total discount read the stored values, so percent promotions, promotions larger than the price (free items), and ended promotions display correctly. Orders saved before this keep the previous best-effort display from the promotions active today. Bundle promotions are not included in the total discount.
- A final unit price of zero is allowed for products and bundles (for example a promotion that covers the whole price); only negative prices are rejected, in the product selector, the editor cart, and the server.

### Implemented Reporting/Dashboard Integration

- Dashboard and report totals updated to include bundle header sales correctly.
- Product sales breakdown supports promotions category/type filtering.
- Bundle sales treated as bundle product rows in top-selling/product breakdown contexts.
- Workbook/Excel/PDF report labels updated where subcategory/type wording applies.

### Phase 2+ Expansion Notes

- Keep explicit evaluators per promo type while scope is small.
- Introduce a shared `PromoEngine` orchestrator only when multiple additional promo types are live.
- Future candidates:
  - percentage/category discounts
  - time-window promos
  - spend-threshold promos
  - add-on upsell/upgrade promos
  - limited-quantity promos

### Post-Phase 1 Follow-up (Planned)

Enable configurable add-ons on bundled child products during order building for both:

- Fixed Bundle
- Mix & Match

Planned behavior:

- Cashier can select allowed add-ons per bundled child item in POS (not only preselected/default add-ons).
- Add-on validation still follows existing product add-on rules (`required`, `max`, add-on type constraints).
- Bundle pricing remains promo-defined at bundle header level; child add-ons are tracked per selected child item for audit/report detail.
- Cart, checkout summary, order details, and receipt rendering include selected child add-ons under each bundled child line.

Planned implementation slices:

- Admin promotion payload support for child-item add-on policy mode (`locked defaults` vs `cashier selectable`).
- POS selector enhancements for bundled child item add-on picking.
- Order persistence mapping for selected bundled child add-ons.
- Reporting review to ensure bundled child add-on selections are represented consistently where needed.


### Promotion Ideas for Later (20 Oct 2026) [Ideas, none started]

Ideas beyond the three types that exist (Fixed Bundle, Mix & Match, Discounted Product). The older "Phase 2+" table above
already lists percentage/category discounts, spend thresholds, add-on upsell, free size upgrade; they are included here with
a rough value and effort. Schedule (days and hours), usage limits (`MaxRedemptions`) and `MaxPerOrder` already exist for all
three types and are reused by every idea below.

**What every new type must bring** (the checklist from the audit, so none is half built)

1. The arithmetic in `WTF.Calculations` and in `shared/calculations`, with sample answers in `calculation-cases.json`.
2. Validation when the promotion is saved (products and add-ons exist, active, required add-ons satisfiable).
3. Pricing when an order is saved (create, update, offline sync review, pending-order preview) and the `expectedTotal` check.
4. The Promos tab, the cart label, order details, receipt, and the customer link page (`PublicCatalogDto.Deals`).
5. Offline: saved in the catalog cache; sync review holds a sale when the quote no longer matches.
6. Reports: discount given per promotion (`OrderItem.OriginalPrice` vs `Price`, `DiscountPromotionId`), uses, voids giving uses back.
7. Audit entries for create, update, delete and restore (still missing for the existing types).

**Prerequisite: stacking rules.** Today one discount per line and bundle lines are left alone. Before adding a third or
fourth type, define what happens when two apply: a priority per promotion, "best price wins" as the default, an optional
"cannot combine" flag, and an order-level cap (a discount never goes below zero and never above a set share of the order).
This is the "shared `PromoEngine` orchestrator" the notes above say to build when several types are live; do it first.

| # | Idea | What it does | Value | Effort / notes |
| - | ---- | ------------ | ----- | -------------- |
| 1 | **Multi-buy** | 3 for PHP 200, 2nd item 50% off, buy 2 get the cheapest free, buy 5 get 1 free | High | Medium. Same product (or category) across lines; pairs with `MaxPerOrder`. Lines are split like the part-covered lines already are |
| 2 | **Category / sub-category discount** | 10% off all Non-Coffee, PHP 20 off any pastry | High | Low to medium. Like Discounted Product but the rule targets a category; the list of covered products changes as the menu does |
| 3 | **Order amount discount** | Spend 500 get 50 off, or spend 400 get a free drink | High | Medium. Needs a minimum spend, which was left out of the first version on purpose; define whether it uses the total before or after other discounts, and how tips and delivery are treated |
| 4 | **Combo slots** | Any drink + any pastry for 199 (one slot per category) | High | Medium. Decided: built as a multi-slot Mix & Match, each slot with its own list, category or sub-category (see Decisions below); the bundle machinery (child lines, add-on rules) is reused |
| 5 | **Free size upgrade / add-on upsell** | Large for the price of Regular, free oat milk with a pastry | Medium | Medium. A discount on a Size or add-on line, only when the add-on matches; reuses the exact add-on matching rules |
| 6 | **Coupon codes** | Typed code, single use or limited, optional per customer or expiry; on the customer link too | High | Medium. Decided: a "requires a code" setting on any promotion, not a new type. A `PromotionCodes` table with its own redemptions; must be rate limited on the public page against guessing |
| 7 | **Loyalty rewards** | Redeem points for a free drink or a discount, stamp card (buy 9, 10th free), birthday treat, nth visit | High | Medium to high. Decided: its own feature on top of promotions (Rewards tab). Loyalty points already exist; this spends them. Needs a points ledger entry per redemption and care that a refund returns the points |
| 8 | **Customer-based pricing** | First order discount on the customer link, returning-customer deal, staff/employee price | Medium | Low. A promotion with an audience (everyone, new, returning, listed customers or a customer group); "new" uses the order history |
| 9 | **Senior citizen / PWD discount** | Moved to its own section, "POS Checkout Discounts (Senior Citizen / PWD)" below. It is a statutory discount applied at the register, not a marketing promotion | | |
| 10 | **Manual discount with reason** | A cashier or manager applies a discount to a line or the order (spoilage, complaint, goodwill) | High | Low to medium. Role-limited (cashier up to a set percent, larger needs an Admin PIN or approval), reason required, audited, shown in reports as a separate line from promotions |
| 11 | **Payment-method promo** | 5% off when paying with GCash/QR | Medium | Low once Cashless Payments exist. The discount is decided at checkout; do not offer it for the unverified GCash fallback |
| 12 | **Pickup / delivery incentives** | Free delivery over a set amount, off-peak pickup discount, pre-order discount | Medium | Low to medium. Customer link only; delivery has no fee in the app today, so a fee needs designing first |
| 13 | **Reusable cup / bring-your-own** | PHP 10 off with your own cup | Medium | Low. Already close to a negative-priced add-on; make it a labelled promo with a limit per day so it cannot be abused |
| 14 | **Clearance by stock** | Discount a product automatically when its linked item is at the warning level or near expiry | Medium | High. Needs order-time stock deduction and expiry dates first; list as a later add-on to Inventory |
| 15 | **Gift cards / prepaid credit** | Sell a card, spend the balance later | Medium | High. Not a discount but a payment method with a balance; needs a ledger, refunds and fraud checks. Consider after Cashless Payments |
| 16 | **Referral** | Customer link: share a code, both get a reward | Low to medium | High. Needs coupon codes and customer identity first |

**Decisions (20 Oct 2026)**

- **Coupon codes (#6) are a requirement on any promotion, not a new promotion type.** A promotion gets an optional "requires
  a code" setting. A `PromotionCodes` table holds the codes (single use, limited uses, per customer, expiry) and a
  `PromotionCodeRedemptions` table records each use. A code unlocks a promotion that is otherwise hidden, so it works with
  every existing and future type and is the easiest way to run a campaign (flyers, social posts, referrals later). Rules:
  - The server checks the code when an order is saved; the POS and the customer link only send what was typed.
  - Redemptions are held from the moment an order is saved and given back when it is cancelled, rejected or refunded, like
    usage limits today (`DiscountBudget`).
  - On the public page the code box is rate limited per address and per link, with the same answer for a wrong, expired or
    used-up code, so codes cannot be guessed.
  - A code never appears in the customer's `Deals` list until it is entered.
  - Offline: a code cannot be checked offline, so an offline sale with a code is held for review by the sync, like other
    changed-catalog cases, or the POS refuses codes while offline (decide).
- **Combo slots (#4) are a multi-slot Mix & Match, not a new type.** A Mix & Match promotion gets several **slots**; each slot
  has its own source (a product list, a category or a sub-category) and a count, plus the bundle price. Example: Drink slot
  (Coffee sub-category, 1) + Pastry slot (Snacks sub-category, 1) for 199. Today's Mix & Match is the one-slot case, so
  existing promotions keep working (a script turns each into one slot). Reuses the bundle machinery (child lines, add-on
  rules, `MaxPerOrder`, usage limits, offline catalog, `BundleRules` checks). Work to do: slots in the editor and the bundle
  picker, `BundleRules` checking each slot, and a category/sub-category source that follows the menu as it changes (a product
  added to the sub-category joins the slot at once).
- **Loyalty rewards (#7) are their own feature that builds on promotions.** A promotion is a rule on products; a reward is
  something a customer spends points on. It needs a points balance, a ledger (earned, redeemed, returned) and refund handling,
  none of which belong in the promotion tables. It reuses promotion pricing: redeeming attaches a hidden discounted-product
  or bundle rule to the order, so totals, labels, receipts and reports come from code that already exists. In the UI it shows
  as a Rewards tab next to Promos; the reward rules are edited under Management > Loyalty. Includes stamp cards (buy 9, the
  10th free), a birthday treat and nth-visit rewards. Plan it as a separate section when it is started.

**Suggested order (value over effort):** stacking rules and the engine; manual discount with reason (#10); senior/PWD (own
section above, confirm the rules first); coupon codes as a promotion requirement (#6); category discount (#2); multi-buy
(#1); multi-slot Mix & Match (#4); order amount (#3); loyalty rewards (#7); the rest on demand.

**Guardrails to build once and apply to every type**

- A promotion can be saved as a draft or in "preview" and shown to staff only, before it goes live.
- A report of what each promotion cost (discount given, uses, revenue on the promoted lines) so an owner can end one that
  loses money. A warning in the editor when the discount makes a product sell below its linked item cost (when cost exists).
- A simulator on the promotion page: pick a cart, see the price each active promotion would give and which wins.
- Per-promotion audit entries and an "ended" status that the list and details actually show (still open from the audit).

**Open questions**

- Should discounts ever stack by default, or is "best single discount per line" the rule for good?
- Is the senior/PWD discount required for the shop's registration (ask the accountant), and does the shop issue VAT receipts?
- Who may give a manual discount, and up to how much without approval?
- Are coupon codes wanted on the customer link, and should one customer be able to use the same code twice?

### Promotions Audit (18 Oct 2026)

Audited the API and the screens, and reproduced each bug on a throwaway database.

**Fixed (server, checked by hand on a throwaway database and by tests)**

- **Bundle contents are checked when an order is saved** (`WTF.Calculations/Orders/BundleRules`, used through `WTF.Api/Common/Orders/BundlePromotionResolver` by both the create and the update handler, replacing two copies). A fixed bundle needs exactly its products, at its quantity times the bundle quantity, with exactly its add-ons. A mix & match needs its required count times the bundle quantity, only listed products, and no product above the per-order maximum times the bundle quantity. A mismatch is a 400 that names the bundle and the product. Before this, a "2 Lattes" bundle with one Croissant in it was billed at the bundle price.
- **A completed order can still be corrected after its bundle ends.** In the override flow a bundle already on the order keeps the price it was sold at and is not re-checked. Adding an ended bundle to an order is still refused.
- **Promotion save validation:** products and add-ons must exist (a missing one used to be a 500), be active, and an add-on cannot be the sold product; a fixed bundle cannot list a product twice (was a 500) or have a negative price; names over 100 characters give a 400 (was a 500). An inactive promotion may still list products that have been deactivated since (`PromotionProductValidation`).

**Done after the audit:** the offline flow (see Offline Phase 6).

**Review of the three promotion types (18 Oct 2026), all fixed 19 Oct 2026**

Findings, and what was done (uncommitted at the time of writing; SQL script `tools/sql/20261019_add_promotion_schedule_and_limits.sql`, run it before deploying the API):

1. **Cashiers can sell bundles.** `GET /api/pos/promotions/bundles` (`OrdersWrite`) returns the active fixed bundles and mix & match promotions with their items and uses. The POS uses it instead of the management endpoints.
2. **Bundles work offline.** The POS saves the bundles (with items) and every discounted-product promotion in the catalog cache (`CatalogCacheService.getFixedBundle/getMixMatch`), so a bundle opens without the server.
3. **No bundle that can never be sold.** Saving a Fixed Bundle, Mix & Match or Discounted Product checks each product's required add-on types (`PromotionAddOnRules`): exactly one Size and one Flavor when the product has that type, at most one Sauce.
4. **Discounted Product rule for plain products.** A rule that lists no add-ons is for the plain product only (an item with no add-ons); a rule that lists add-ons matches exactly those. Required Size/Flavor must be listed, optional add-ons may be left out. The API and the POS run the same shared cases.
5. **Schedule and usage limit for all three types** (`Promotions.DaysOfWeek` bit mask Sunday=1 to Saturday=64, `StartTime`, `EndTime`, `MaxRedemptions`; `WTF.Calculations/Orders/PromotionSchedule` and `DiscountBudget`, and `shared/calculations/promotion-schedule.ts`). Days: null means every day. Times: both or neither, the end is excluded, an end before the start runs past midnight, and the weekday is the day the moment falls on. The server uses the request `X-TimeZone`, the POS the device time. A bundle uses its quantity per sale, a discount one use per discounted item (`OrderItems.DiscountPromotionId`); cancelled and refunded orders give their uses back. A rule with fewer uses left than the line's quantity is skipped, and a bundle sold above what is left is a 400. The editor has a Schedule and limit card, and the list and details show days, hours and uses. A minimum spend was left out on purpose.
6. **Naming.** Discounted Product "Fixed Price" is now "Amount Off", and Mix & Match "Max Selections / Order" is now "Max per Product" (labels and messages only).
7. **Discounts no longer touch bundle lines.** Products inside a bundle line get no discounted-product price or label. (Done with the pricing change.)

**Checked in the running app (19 Oct 2026)** against a throwaway LocalDB database: a Cashier gets the bundles (and 403 on the management route), sees the Bundles tab, and opens a bundle with the API stopped; a latte bundle without a Size or with two Sizes is a 400; a croissant discount applies to the plain croissant (110) and not to one with oat milk (140); a bundle limit of 7 with 5 used refuses a quantity of 2 and the order after the limit; the happy hour (Monday 14:00 to 17:00 Manila) discounts at 14:00 and 16:59 but not at 13:59, at 17:00 or on Tuesday; a 3-use discount skips a quantity of 2 with 1 left; a Friday 22:00 to 02:00 window works at 22:30 and not on Saturday; voiding an order frees its use; bad schedules (usage limit 0, one time only, equal times, no days) are 400; the details page shows Days, Hours and Usage; the editor loads the saved schedule.

**Follow-ups (19 Oct 2026)**

- **Pending orders show the discounted total.** A Pending or waiting order saves no prices, so its total used to be the list price while the cart showed the discounted one (order 179: 305.00 against 185.00). `PendingOrderPreview` (API) works out each plain line's discounted unit price with the promotions on right now and `OrderMetrics.ComputeOrderTotal` takes it as an optional argument. Used by the order list, the paged list, one order, the dashboard's recent orders and the customer's My orders (total and line price). Each pending order is judged on its own, so nothing is used up before an order completes; lines saved with a price, bundle lines and finished orders are never repriced. Create and update responses for a Pending order still return the list price (the price is fixed when it completes). Line prices on the staff DTOs are unchanged, so the order details page still works out its own lines.
- **Labels and warnings.** An amount off that covers the whole price is labelled "Free" instead of the amount set on the promotion (`PromotionLabelFormatter.Format(..., basePrice)` and `formatPromoLabel(rule, basePrice)`, same shared cases); a percentage keeps its label even at 100. The add-on selector no longer shows a promo badge under the product name before the selection matches: only the label next to the total, which appears when the add-ons match a rule exactly. The promo editor warns when the amount off is the same as or more than a listed product's price.
- **Checked on a throwaway database:** pending totals in the list, paged list, one order and dashboard for a free rule, a rule blocked by an extra add-on, a plain-product percent rule, a usage limit smaller than the quantity, and several orders sharing a limit; completing the orders (saved total, price 0 and the label "Free"); the limit running out, a void giving the use back and an inactive promotion; the customer link (enable, create, open, place orders with and without a matching discount, GCash with a tip, a size left out refused, My orders totals, staff accept and complete, the customer seeing the completed total, a revoked link answering 404). The orders screen and the editor cart showed the same totals, and the editor warning appeared.
- **Promos tab and discounts in the customer's cart (19 Oct 2026).** The Bundles tab of the order editor is now **Promos**: the bundles, plus one card for each discount rule that is on (`buildDeals` in `shared/calculations/deals.ts`). A card is the product with exactly the add-ons its rule needs, with the discounted price, the list price struck through and the label ("Promo -₱40.00", "Promo -10%" or "Free"); tapping it opens the add-on selector with those add-ons already chosen, and the discount shows as long as they match. The tab also shows for discounts alone, hides rules that are closed or out of uses, and the search narrows the cards. The customer link page gets the same: `PublicCatalogDto.Deals` carries the live rules (product, add-ons, amount off or percent, uses left; no promotion id or name), a **Promos** section comes first in the menu (same tab strip and scroll sync), the add-on picker prices a choice with the discount (and starts from a card's add-ons), and the cart shows the strikethrough price, the label and the discounted total. A discount with a usage limit adds "confirmed when the shop accepts your order" under the total. The server prices the order again: the public submit works the total out with the discounts that are on and the cash must cover that (`SubmitPublicOrderHandler.ComputeTotalAsync`), and the order's change is worked out from the same discounted total (a pending order's create and update use `PendingOrderPreview` too, so the saved change, the list and the cart agree). Public bundles stay out of scope. **Label rule:** "Free" is shown only when the whole item costs nothing. When an amount off covers the product's price but add-ons are still charged, the label shows the price that really came off (a drink at 130 with a charged extra reads "Promo -₱130.00", not "Free"), on the Promos cards, the add-on selector and picker, the carts, the details and receipt, and the label saved on the order line (`AppliedDiscount.LabelWith`, `formatPromoLabel(rule, basePrice, addOnsPerUnit)`, the shared cases have the add-on amount).
- **Checked on a throwaway database (19 Oct 2026):** the customer link at desktop (1280), tablet (820) and phone (375) widths: the Promos section and cards, the picker opened from a card (Free, and the price going back when another size is chosen), the cart as the side panel and as the phone drawer (labels no longer wrap), the checkout total and amount due, My orders in every state (waiting 326.00, accepted 30.00, rejected 180.00, completed 108.00) and an order's details, the tab strip following the scroll, and a revoked link; a cash amount one centavo short of the discounted total refused and the exact amount accepted, with change saved as 0.00. The POS at desktop and phone widths: the Promos tab, the selector from a card, the cart (real amounts off, "Free"), the orders list (awaiting-approval banner, pending, completed and cancelled orders showing the same totals as the cart), and the details of a waiting online order and of a completed order (Mocha x2 free: discount -320.00, total 60.00).
- **Usage limits hold from the moment an order is saved, and races are closed (19 Oct 2026).**
  - **Reserving.** A limited discount now counts like a bundle: a Pending or waiting-for-approval order holds its uses from the moment it is saved (`OrderItems.DiscountPromotionId` is set while `Price` stays empty, `reservesDiscount` in `CreateOrderHandler` and `UpdateOrderHandler`). Cancelled, rejected and refunded orders give them back. Editing an open order moves its own uses instead of adding to them, and completing it keeps them. `PendingOrderPreview` gives an order its own held uses back before judging it (`DiscountBudget.Return`), the customer catalog hides a deal whose uses are all held, and the POS editor adds an order's own held uses to a promotion's remaining uses (`OrderItemDto.discountPromotionId`). The per-customer cap of 5 waiting orders still limits how many uses one customer can hold.
  - **One at a time.** `PromotionLimitGate` (one per process; the API runs as one instance) wraps everything from reading the uses left to saving the order: create, update, the offline sync (review and save together), the old batch, and the customer submit (total, cash check and save). Callers that already hold it pass `GateHeld` so the order handler does not wait for itself. Checked with ten registers completing a sale at once against real SQL Server: exactly the uses left are handed out, and the same tests fail with the gate switched off.
  - **Total check at checkout.** The POS sends `expectedTotal` (the total the cashier saw and collected against) with a finished sale, and the customer page sends it with the order. If the server works out another total (a price or a promotion moved, or someone took the last use) the sale or order is refused with "The total changed to PHP X ..." and nothing is saved (`OrderTotalCheck`; a refused new sale is rolled back, an update is refused before anything changes). Not applied to open orders, offline sales (the sync review holds them instead) or an Admin's correction. The POS also asks the shop again before opening checkout when the cart has a promotion or bundle, and stops with the new total if it moved; after a refusal it reloads the promotions.
  - **Offline sync, checked:** a discounted sale is saved and uses a use while one is free; after the promotion runs out the sale is held at the quoted price and takes no use; two sales in one request share the last use; a sale quoted at full price while a promotion is on is held; an open offline order reserves like any open order; a retried sync is not counted twice; and a sync racing a live sale for the last use gives it to exactly one. Known limit: a held offline sale that an Admin approves later was already given the discount, but takes no use (the quote has no promotion id).
  - **Known limits:** the gate is per process, so a second API instance would need a database lock (`sp_getapplock`); a bundle is still not checked against a placed order's total beyond its own limit check; uses held by an order that is never completed or cancelled stay held.

**Limit per order and partial coverage (19 Oct 2026).** A promotion can limit how much one order gets (`Promotions.MaxPerOrder`, script `tools/sql/20261020_add_promotion_max_per_order.sql`, run it before deploying the API). A discounted line above the limit, or above the uses the shared pool has left, is not refused or dropped: the items it covers get the discount and the rest are charged the list price. Rules: an order's allowance for a promotion is the smaller of the pool left (`MaxRedemptions` minus uses held or taken) and `MaxPerOrder`, and it is shared by all the lines of the order, in order (`DiscountBudget`, `allocateDiscounts`). A part-covered line is saved as two order lines (the discounted segment keeps the label and `DiscountPromotionId`, the rest has neither); the pool is charged only for the covered items. A bundle cannot be split, so a bundle above its `MaxPerOrder` is refused with a message naming the limit. The POS cart, the add-on selector, the customer page and its picker show the part-covered line with a note ("Promo on 2 (limit of 2 per order); the other 3 at full price."); the public submit refusal lists the same notes with the new total, and the customer page's deals carry `maxPerOrder` and an opaque `groupKey` so rules of one promotion share the limit without exposing promotion ids. An offline sale sends a part-covered line as two lines with their own quoted prices; if the shop later covers a different number of items, the sale is held for review. Shared cases (`calculation-cases.json`) cover `maxPerOrder` and `discountedQuantity`.

**Still open from the audit**

- Status on the screens: the list and details show "Active" for an expired or not-yet-started promotion and show no dates or price.
- The editor shows a blank name for a bundle product that was deactivated since.
- No audit entries for promotion create, update, delete and restore.
- Smaller: three copies of the add-on grouping method in `promotion-editor.ts`; the list subtitle leaves out discounted products; no inline check for end before start or a negative price; the date pickers use the browser's time zone while the server uses Asia/Manila.
- A product that is sold offline and deactivated before sync is held; a hard-deleted product or a product the server cannot find is still a per-order error (the order stays in the queue with the message).

---

## Automated Testing Plan [Mostly Completed]

Goal: cover both the API and the POS app with automated tests, run on every push.

**Scope decision:** API unit/handler tests (in-memory) and real SQL Server tests are done. Browser E2E tests are
deliberately deferred.

### Status (as of 13 Oct 2026)

| Area | State |
| --- | --- |
| API unit and handler tests (`src/WTF.Tests`) | **Done**: about 1,240 test methods covering validators, mappers, helpers, every handler area (customers, products, items, users, auth, orders, pricing, promotions, loyalty, reports, dashboard, audit, sync, order links, conversations), services, hubs and endpoints. |
| Angular unit tests (`src/wtf-pos`) | **Done**: 124 spec files, about 2,350 tests. |
| Tests that need a real database | **Done** (`src/WTF.Tests/Database`): orders, customers, items, products, promotions, users, order links and conversations run against SQL Server (LocalDB locally, a container in CI) and skip when none is reachable. |
| CI | **Done**: `test-api` (with a SQL Server container) and `test-frontend` run on every push and pull request; build and SQL deploy jobs depend on them. |
| Pricing math consolidation | **Done.** One shared class, `PromotionPricing`. |
| Calculation consolidation | **Done** (14 Oct 2026). `WTF.Calculations` holds order totals, pricing, sales rules and report periods; 1,779 API tests pass. |
| E2E (Playwright) | **Built** (`src/wtf-e2e`, about 570 tests in 34 files by section; runs on CI without blocking, see "CI" below). |

### Layout

```
src/
  WTF.Api/
  WTF.Calculations/ <- all business arithmetic (order totals, promotion pricing, sales rules, report periods); no EF or HTTP
  WTF.Domain/
  WTF.Tests/        <- API and calculation unit tests (Calculations/, Common/, Endpoints/, Features/, Services/), in WTF.slnx
  wtf-pos/          <- specs live beside their source files (*.spec.ts)
    src/app/testing/  <- shared test helpers (HTTP service setup, fake services, feature helpers)
    vitest.config.ts  <- turns on per-file isolation (see "Angular notes")
```

### Test Types

- **Unit**: one class/function in isolation, or a handler against an in-memory fake database.
- **Integration**: several parts together against a real SQL Server (deferred).
- **E2E** (later, optional): real browser driving the running app (Playwright), main flows only.

### API (`WTF.Tests`) - what exists

Stack: xUnit, NSubstitute, Shouldly. `WTF.Api` exposes its internals to the test project.

- Validators and mappers: customers, users, products, items, the three promotion types.
- Pure helpers: order total calculation, promotion labels, time zones, report date ranges, URL helper, claims helper.
- `JwtService`, local image and report file storage, options defaults, Excel and PDF builders.
- **Route table snapshot** (`Endpoints/RouteTableTests`): a reviewed list of every route and who may call it. Adding a route or changing its access rule fails the test, so security changes are deliberate. The only anonymous routes are `/api`, `/api/health`, login, logout, refresh, validate and the loyalty redirect link.
- **Role matrix** (`Endpoints/PolicyMatrixTests`): for each authorization policy, which roles are admitted, evaluated by the real authorization service.
- **Endpoint validation** (`Endpoints/EndpointValidationTests`): the checks inside endpoint delegates (ID mismatch, report date and month ranges, push token input, login) run against a fake `ISender`.
- **Audit paging** (`Endpoints/AuditPagingTests`): paging is forwarded for the screen and dropped for Excel and PDF exports.

To make the routes testable, the policies live in `AddAppAuthorization()` and the route mapping in `MapAppEndpoints()` (behavior-neutral extraction from `Program.cs`).

### Angular (`wtf-pos`) - what exists

Vitest via `ng test`. Shared helpers in `src/app/testing`.

- Guards, interceptors, pipes, constants, messages and models.
- Every service in `core/services`: HTTP services (request URL, verb, params, body and every error path), connectivity, offline order queue (with an in-memory stand-in for the Dexie table), catalog and image caches, update check, push, SignalR, file and image download.
- Every shared component, and every feature page (login, dashboard, orders, inventory, management, audit logs, reports).
- App-level checks: the route table (guards and role data), role groups vs the API policies (the UI may never grant a role the API denies), and button conventions.

**Angular notes**

- `vi.mock` works for package names but not for relative imports (the Angular builder blocks those).
- The Angular builder shares the module cache between spec files by default, which made specs that mock packages pass or fail depending on file order. `vitest.config.ts` sets `isolate: true` and `angular.json` points the test target at it. Keep it.
- The Dexie `db` is replaced with small in-memory fakes (see `offline-order.service.spec.ts`).

### Bugs the tests found (all fixed)

`GetUserIdFromToken` always returned null; the alert auto-dismiss timer was never cleared; bundle and item search never re-filtered; over-long product fields showed no error; a discounted item without a product got the wrong message; promotion `isEditMode` stayed false after a create; SignalR could not reconnect after stop/start or a failed start; the audit export swallowed save errors; header and sidebar avatars did not refresh; the add-on selector reordered the shared catalog cache; missing report dates got a bare framework 400.

### Handler tests (done)

Handlers run against EF Core InMemory (`Microsoft.EntityFrameworkCore.InMemory`) with fakes for audit, push, SignalR and
the current user, plus builders in `Features/*/*Seed.cs` and `Infrastructure/TestDb.cs`. The in-memory database does not
enforce keys or unique indexes, ignores transactions, does not apply SQL Server defaults and matches text
case-sensitively, so those behaviors are covered by the real-database tests below.

### Pricing math merged (done)

The discounted-product rules now live in one class, `PromotionPricing` in the `WTF.Calculations` project
(`src/WTF.Calculations/Orders/PromotionPricing.cs`, moved from `WTF.Api/Common/Orders`; see Sales Reporting Phase 3). Its methods are `IsPromotionActiveOnLocalDate`,
`GetDiscountedUnitPrice`, `CalculateDiscountedUnitPrice`, `SatisfiesExactAddOns`. `CreateOrderHandler`,
`UpdateOrderHandler`, `EvaluatePromotionsHandler` and the discounted-product handlers all call it, so the cart preview and
the saved order cannot drift apart. The cart-line overload of `SatisfiesExactAddOns` in `EvaluatePromotionsHandler` is a
thin wrapper. The pricing tests (`Features/Pricing`) now run against the shared class; the old "all copies agree" tests
were removed because there is one copy.

### Real-database tests (done)

`WTF_TEST_SQL` points the tests at a SQL Server; if unset they use LocalDB, and they skip with a clear message when
neither is reachable. Each test creates and drops its own throwaway `WTF_Test_*` database. Covered: transaction rollback
in batches, unique and foreign key constraints, case-insensitive search, database defaults, the order link re-check and
the full submit/approve/reject flows. Not covered: two users saving at the same moment (stock changes, order numbers).

### Known gaps in the existing tests

- `order-editor`: scroll-position tab syncing, real interaction with the add-on selector and checkout modal (both are spied), template checks beyond a smoke render.
- Debounced search in the product, customer and user lists: `SearchInputComponent` raises a change-detection error when rendered there, so those tests use a template-less version of the list.
- `push-notification`: the Huawei token success path (a relative import that cannot be mocked) and the web notification click handler.
- Real drag-and-drop in the swappers (tested by moving DOM nodes) and logo loading in the order receipt (jsdom has no images or canvas).
- Some specs combine several files (`guards.spec.ts`, `interceptors.spec.ts`, a few service specs) where the rules below say one `<name>.spec.ts` beside each file. Cosmetic.
- Private helpers inside handlers (for example the scheduler's `GetNextDelay`) and the Excel and PDF document builders in the endpoint files are not reachable from tests yet.
- API clients for Azure, FCM and Huawei, and `DashboardHub`, are untested.
- The `.NET` tests have only been run on Windows; the first run on the Linux CI runner may show differences (two time zone tests use Windows ids).

### Not started

- E2E tests (Playwright) for the main flows.
- A script or CI step that lists source files without a matching spec or test.
- Coverage thresholds (start low and raise gradually).

### Applying the Plan to New and Existing Files (Rules, Not a Snapshot)

The plan is partly implemented and files keep being added. The lists above describe the state on
the date shown; the **rules below are what to follow**, so the plan applies to any file that exists
when the work starts and to every file added afterwards.

**Step 0 - build the inventory when starting (do not rely on the lists above):**

- Angular: list every non-spec `.ts` under `src/wtf-pos/src/app` that has no sibling
  `*.spec.ts` (guards, interceptors, pipes, services, components, pages).
- API: list every handler, validator, service and endpoint group under `WTF.Api` that has no
  matching test in `WTF.Tests`.
- Work through the gaps in batches by area, in the API phase order above.

**Mapping rules (which test a new file needs):**

| New file                                  | Test required                                              |
| ----------------------------------------- | ---------------------------------------------------------- |
| Angular guard / interceptor / pipe / util | Unit spec beside the file                                  |
| Angular service                           | Spec with `HttpTestingController` for each public method   |
| Angular component / page                  | Smoke spec (renders) + key interactions; thorough if logic-heavy |
| API handler (`Features/<Area>/*Handler`)  | Integration test in `WTF.Tests/Features/<Area>/`           |
| API validator / pure helper in `Common/`  | Unit test in `WTF.Tests/Common/` or `Features/<Area>/`     |
| API endpoint group / auth rule            | Integration test covering status codes and role access     |
| Bug fix                                   | Regression test that fails before the fix                  |

**Conventions:**

- Angular: `<name>.spec.ts` next to `<name>.ts`; shared fakes and
  `provideTestingDefaults()` live in one testing folder.
- API: test class `<Handler>Tests` in the folder mirroring the source path; test names
  `Method_Scenario_ExpectedResult`.
- Every handler test covers: success, validation failure, not found, forbidden (wrong role),
  and any soft-delete/restore or audit-log side effect it has.

**Definition of done for new code:** a feature or fix is not complete until its files follow
the mapping above and `dotnet test` / `ng test` pass.

**Keeping it enforced:**

- CI fails the build when tests fail (done: see the CI section).
- A small script (or CI step) lists source files without a matching spec/test and reports
  them, so gaps from new files are visible.
- Optional coverage thresholds (start low and raise gradually) rather than a one-time big-bang.

### CI

Done. `.github/workflows/main.yml` has two jobs that run on every push and pull request:

- `test-api`: `dotnet test src/WTF.Tests/WTF.Tests.csproj --configuration Release`
- `test-frontend`: `npm ci` then `npm test -- --watch=false` in `src/wtf-pos`

The build jobs (API, frontend, Android, production and staging) and both SQL deploy jobs `need` both test jobs, so
a failing test blocks the build and the deploy. Pull requests run only the test jobs (the build and deploy jobs are
skipped for them). The API job also starts a SQL Server container for the real-database tests.

**Browser tests (added 30 Oct 2026, not blocking).** A third job, `test-e2e`, runs the Playwright suite in `src/wtf-e2e` on its own SQL
Server container (`run.sh`: a throwaway `WTF_E2E_*` database, the API on 5290, the app on 4300 served with its `e2e` configuration,
4 workers and 1 retry on CI). No other job lists it in `needs` and `continue-on-error` is on, so it cannot hold up a build or a
deploy; its report is uploaded as the `e2e-report` artifact. Plan: watch it for about a week, fix flaky tests, then add it to the
`needs` of the build and deploy jobs (or only a small smoke subset, with the full suite nightly).

**Browser test suite, state on 30 Oct 2026.** `src/wtf-e2e`: 760 tests in 34 files (one folder per app section, see its README), all
passing in about 6 minutes on a developer PC (5 workers). It runs on a throwaway `WTF_E2E_*` database (`tools/E2eDb`, started by
`run.ps1` or `run.sh`, which also drop the leftovers of an interrupted run), serves the app with its own Angular configuration (`e2e`,
API on 5290), and signs each role in once (`global-setup.ts`) and reuses the session, so a test does not type the login form. No test is
skipped. Started from the Claude Code Terminal panel it can fail to start LocalDB while another session holds the instance, so run it
from one place at a time.

Product bugs the suite found, all fixed with a regression test:
- **Nothing enforced the validation attributes** on commands (an empty product name, a negative price or a name over the column
  length was accepted, or gave a 500). A MediatR step (`ValidationBehavior`) now validates every request and answers 400 with the
  message. Customer and user names (50 characters), usernames and roles are checked too.
- **New product add-on links were saved inactive** (EF sent `false` although the column default is true), so add-ons never reached the
  POS. Both assign handlers now set `IsActive = true` (real-database test `ProductAddOnDatabaseTests`).
- **A stock change of 0.001 did not move the balance** (the raw SQL parameter was typed decimal(18,2)); it is decimal(18,3) now.
- **A size, flavor or sauce could be ordered twice** through the API (`PickOneAddOnRule`, create and update).
- **A completed cash sale with less cash than the total was saved** with change 0; a new sale is now refused (tips are left out of the
  check so orders queued by an older offline app still sync). **Not done:** the same check when an open order is completed later
  (`UpdateOrderHandler` saves before it works the change out, so it needs a rollback first).
- The sidebar showed a Dashboard link to roles that cannot open it.
- The public ordering and chat limits are per address; `RateLimiting:Multiplier` (default 1) lets the test API raise them.

---

## Customer Ordering Links Feature [Completed]

Let selected customers place orders themselves through a personal link, without logging in
to the POS. Staff control which customers get a link and can set an end date so links expire.
Orders from a link wait for staff approval, and the customer and staff can chat about each order.

This section is written so the work can be picked up later without the original discussion:
it lists the decisions, the exact files to touch, the gotchas found while reading the code, and
the tests and checks each phase needs. Paths are relative to the repo root; `app/` means
`src/wtf-pos/src/app/`.

### Behavior

- On the **customer details page**, a staff member with the right role can:
  - enable/disable "Allow ordering link" for that customer (opt-in per customer; default off)
  - generate a link, optionally with an **end date** (no end date = never expires)
  - see existing links with status (Active / Expired / Revoked), created by, last used
  - copy, revoke, or regenerate a link ("regenerate" = revoke + create)
- Only customers with ordering enabled can have links generated.
- Opening a link shows a public ordering page (full catalog, cart, submit) scoped to that customer.
- A link can place **multiple orders** until it expires or is revoked.
- Expired, revoked, or unknown tokens show a friendly "link no longer valid" page (reuses the
  404-style layout); the response does not reveal whether the token ever existed.
- Disabling ordering for a customer immediately invalidates all of their links.

### Decisions

- **Approval:** orders from a link are created as `PendingApproval` (new order status, id 5).
  Staff **Accept** (-> `Pending`, joins the normal flow) or **Reject** (reason required ->
  `Cancelled`) from an "Awaiting approval" banner on the orders list page. `Pending` was not
  reused because it means "open POS order". Unapproved orders must not appear in sales
  totals, the dashboard, reports or the active order list (see "Status audit" below).
- **Payment:** same methods as the POS (Cash, GCash). For cash the customer enters the amount
  they will pay (`AmountReceived`), so staff know how much change to prepare. Must be >= total plus the tip.
  An optional tip for the shop can be entered (cash or GCash); it is sent as `Tips`, stored on the order, and
  shown to staff and on My orders. The cash amount must cover the total and the tip, and the change is
  `amount - total - tip`. The tip is not part of the order total.
- **Fulfillment:** the customer chooses **Pickup** or **Delivery**. Delivery needs an address
  (prefilled from the customer, editable). A contact number is required on every link order
  (customers have no phone field).
- **Catalog:** the full catalog for now, no per-customer restrictions. Bundles are not in the
  first version of the public page; discounted-product promotions still apply server side
  because the order goes through `CreateOrderHandler`.
- **Customer visibility:** the public page has a **My orders** tab listing the customer's link
  orders with a customer-facing status.
- **Chat:** one thread per order, real time over SignalR for both sides (Phase 5). The
  customer is anonymous, so the customer gets no push, only live updates in the page.
- **Notifications:** staff get a push/SignalR alert when a link order or a customer message arrives.
- **Database:** SQL Server through EF Core. There are no EF migrations: schema changes are
  hand-written idempotent scripts in `tools/sql`, then `tools/dbsync.bat` rescaffolds
  `src/WTF.Domain/Entities/*.cs` and `Data/WTFDbContext.cs` (never hand-edit
  `OnModelCreating`, only `OnModelCreatingPartial`).
- **Revoke is final.** There is no restore / un-revoke button: revoking is the "this link is compromised"
  action, and restoring would bring the same token back for anyone who still holds it. A revoked link is
  replaced by generating a new one (the old one stays dead). Disabling ordering for a customer revokes all of
  their links and re-enabling it does not bring them back. An "extend end date" for expired links is a possible
  later addition, only while ordering is enabled for the customer.
- **Out of scope for now:** the customer cancelling or editing an order, bundles on the public
  page, per-customer catalogs or prices, online payment.

### Key design decisions (read before coding)

1. **Reuse `CreateOrderHandler`** (`src/WTF.Api/Features/Orders/CreateOrderHandler.cs`) for the
   public submit, because price, promotion, add-on and required-selection validation live
   there. Follow the existing pattern of `[JsonIgnore]` command fields that the request body can
   never set (like `IsOverride` on `UpdateOrderCommand`): `ActorUserId`, `Source`, `OrderLinkId`,
   `FulfillmentType`, `DeliveryAddress`, `ContactNumber`. The handler currently reads the user from
   `HttpContext.User.GetUserId()` (line ~53) and would fail for anonymous callers, so make it
   prefer `ActorUserId`. Prices are only captured for Completed/Cancelled orders
   (`shouldCapturePrice`), so a `PendingApproval` order stores no prices and they are computed on
   read, same as `Pending`.
2. **System user.** `Orders.CreatedBy` is a required FK to Users and anonymous callers have no
   user. Seed an inactive "Customer Link" user and use its id for link orders and their audit
   entries. Login only matches active users, so it cannot be used to sign in.
   `AuditService.LogAsync` silently returns when no user id is resolved, so always pass
   `userId` explicitly for anonymous actions.
3. **Reuse `ShortLink`** with `TargetType = "CustomerOrder"` (entity
   `src/WTF.Domain/Entities/ShortLink.cs`; model config in `WTFDbContext.cs` ~784-796, unique
   index `IX_ShortLinks` on `Token`).
4. **Loyalty redirect bug to fix in Phase 1.** `RedirectToLoyaltyHandler`
   (`src/WTF.Api/Features/Loyalty/`) does not filter on `TargetType`, so an order-link token
   passed to `GET /api/loyalty/redirect/{token}` would return the customer id. Add
   `TargetType == "Loyalty"` and a regression test.
5. **Token.** 32 bytes from `RandomNumberGenerator`, base64url (~43 chars), stored as is (staff
   need Copy later), never logged. Do not reuse the 8-character `System.Random` generator in
   `GenerateShortLinkHandler`. The `Token` column is `varchar(20)` and must be widened to 64.
6. **Public catalog needs its own DTO.** `GET /api/sync/pos-catalog`
   (`Features/Sync/GetPosCatalogHandler.cs`) is authenticated, returns every active customer, and
   its `ProductDto` carries `CreatedBy`/`UpdatedBy` ids. Extract the product and add-on loaders
   (`LoadProductsAsync`, `LoadAddOnsByProductIdAsync`) so both handlers share them, and return a
   slim `PublicCatalogDto` (no customers, no audit fields). Promotions endpoints
   (`/api/pos/promotions/*`) require `OrdersWrite`, so they are not available to the public page.
7. **Uncommitted work.** When this plan was written, `CreateOrderHandler.cs`,
   `UpdateOrderHandler.cs`, `EvaluatePromotionsHandler.cs` and the test project had uncommitted
   changes in the working tree. Check `git status` first and build on top of them.

### Status audit (do this with the `PendingApproval` status)

Search every place that treats "not Completed/Cancelled" as active or open, and every status
switch, before shipping Phase 3:

- API: `GetOrdersHandler` (`ExcludeFinalized`), `GetPagedOrdersHandler`, active-orders endpoint,
  dashboard handlers, report handlers and the monthly workbook, `VoidOrderHandler`,
  `UpdateOrderHandler` (only `Pending` can be edited; `PendingApproval` must not be editable
  from the POS), push `SendOrderStatusChangedAsync`.
- Frontend: the three duplicated `getStatusVariant`/`getStatusLabel` switches in
  `app/features/orders/order-list`, `order-details` and `order-editor`; the status filter in the
  orders list; `OrderStatusEnum` in `app/shared/models/order.models.ts` (All=0, Pending=1,
  Completed=2, Cancelled=3, Refunded=4 today).
- Tests that snapshot statuses or totals.

### Database changes

`tools/sql/20261012_add_customer_ordering_links.sql` (use the next free date prefix).
Idempotent, same header and `IF COL_LENGTH(...) IS NULL` style as
`tools/sql/20261011_add_order_override_details.sql`:

- `Customers.AllowOrderingLink bit NOT NULL DEFAULT 0`
- `ShortLinks.Token` widened to `varchar(64)`; new `CreatedAt`, `CreatedBy` (FK Users),
  `RevokedAt` (null), `LastUsedAt` (null)
- `Orders`: `Source` (POS / CustomerLink, default POS), `OrderLinkId` (null FK ShortLinks),
  `FulfillmentType` (Pickup / Delivery, null for POS), `DeliveryAddress`, `ContactNumber`,
  `RejectionReason`
- `Statuses` row `PendingApproval` (id 5). The Statuses/PaymentMethods seed rows are not in
  `tools/sql`, so check the live data before assuming id 5 is free.
- Seed the inactive "Customer Link" user and expose its id (config value or a lookup by a fixed
  username) so the API can find it.
- `CI` runs scripts in order on tag builds and records them in `dbo.SchemaScriptHistory`, so
  new scripts must sort after the existing ones.

Phase 5 adds its own script (`OrderMessages`, below).

### API design

Policy `OrderLinksManage` (SuperAdmin, Admin, Cashier, same as `CustomersWrite`) in
`src/WTF.Api/Common/Auth/AppPolicies.cs` and `AppAuthorizationExtensions.cs`. Reads use
`CustomersRead`.

Staff endpoints (new `Features/OrderLinks/` slice, `Endpoints/OrderLinkEndpoints.cs`, add
`MapOrderLinks()` to the chain in `Endpoints/EndpointRegistration.cs`; all audited):

| Route | Notes |
| --- | --- |
| `PUT /api/customers/{id}/ordering-link-access` | Enable/disable. Disabling sets `RevokedAt` on all active links |
| `POST /api/customers/{id}/ordering-links` | Body `{ expiresAt? }`. Customer must exist, be active and have ordering enabled; expiry must be in the future |
| `GET /api/customers/{id}/ordering-links` | Status (Active / Expired / Revoked) computed from `RevokedAt`/`ExpiresAt`; created by; last used |
| `DELETE /api/customers/{id}/ordering-links/{linkId}` | Soft revoke, link must belong to the customer |
| `POST /api/orders/{id}/approve` | `OrdersWrite`; only from `PendingApproval`; -> `Pending` |
| `POST /api/orders/{id}/reject` | `OrdersWrite`; reason required; -> `Cancelled`, stores `RejectionReason` |

Public endpoints (anonymous; map under `/api/public`; rate limited):

| Route | Notes |
| --- | --- |
| `GET /api/public/order-links/{token}` | Validate; first name + `PublicCatalogDto`; sets `LastUsedAt` |
| `GET /api/public/order-links/{token}/orders?page&pageSize` | My orders |
| `GET /api/public/order-links/{token}/orders/{orderId}` | One order, 404 unless it belongs to this customer and has `Source = CustomerLink` |
| `POST /api/public/order-links/{token}/orders` | Submit an order |

Every public handler runs one shared token check: exists, `TargetType = "CustomerOrder"`, not
revoked, not expired, customer active, `AllowOrderingLink` true. Every failure returns the same 404.

Other API pieces:

- Enums: `OrderStatusEnum.PendingApproval = 5` (`Features/Orders/Enums/`); `AuditAction`
  gets `OrderLinkEnabled/Disabled/Created/Revoked` and `OrderApproved/Rejected`;
  `AuditEntityType` gets `OrderLink` (`Features/Audit/Enums/`).
- Add `AllowOrderingLink` to `CustomerDto` (`Features/Customers/DTOs/CustomerDto.cs`) and
  `CustomerMapping`.
- Rate limiting: add `order-link-policy` next to `loyalty-policy` in `Program.cs` (~157-170,
  fixed window per IP, plus a per-token partition). `UseRateLimiter()` runs before auth, which is
  fine for anonymous routes. The group must call `.RequireRateLimiting("order-link-policy")`.
- Public order DTO (`PublicOrderDto`): order number, created time, customer-facing status, items
  with add-ons, total, fulfillment, address, payment method and cash amount, special
  instructions, rejection reason. No staff names, user ids or audit fields. Compute totals with
  `OrderMetrics.ComputeOrderTotal` (`src/WTF.Calculations/Orders/OrderMetrics.cs`).
- Customer-facing status labels: `PendingApproval` "Waiting for confirmation", `Pending`
  "Accepted", `Completed` "Completed", `Cancelled` with a rejection reason "Rejected" (show the
  reason), other `Cancelled` "Cancelled", `Refunded` "Refunded".
- Push: `SendOrderCreatedAsync` (`Services/PushNotificationService.cs`) excludes the actor and
  AdminViewer and uses the title "New order created". Add a link-order variant ("New online
  order", path `/orders`) and, in Phase 5, a customer-message variant.
- SignalR names live in `src/WTF.Api/Hubs/HubNames.cs`; the order events use
  `DashboardViewers` group, `OrderUpdated` and `DashboardUpdated`.
- Global exception middleware maps `InvalidOperationException` and `ArgumentException` to 400
  with `{message}`, so handlers can throw those for validation. Public handlers should map
  link-state failures to 404 instead.

### Security checklist

- Tokens: 32 random bytes, never logged, same 404 for every invalid state.
- **Link state is checked on every call and again at the moment something is finalized.** Every public handler
  runs `OrderLinkAccess.ResolveAsync` first, which reads `RevokedAt` and `ExpiresAt` (and the customer's
  active / `AllowOrderingLink` flags) fresh from the database on every request; nothing about a link is
  cached or trusted from an earlier call. A write must not rely on the check made at the start of the request
  alone: the submit handler checks the link again immediately before it creates the order (so a link revoked
  or expired while the customer was filling in checkout, or while the request was being validated, cannot
  place an order), and any later write (chat message, hub connection) does the same right before it saves.
  The check compares against the current UTC time, never a client-supplied time.
- **The page treats any 404 from a public call as "link no longer valid"**: a failed menu refresh, My orders
  load, order submit or chat send switches to the invalid-link page and keeps nothing on screen, so a revoked
  link stops working mid-session instead of failing quietly.
- Rate limits per IP and per token on every public route; separate, tighter limit for chat.
- Server recalculates prices and promotions (through `CreateOrderHandler`); cap items per order
  and quantity per item; maximum text lengths for address, contact and instructions.
- Public responses never include staff names, user ids or audit data.
- The slim public catalog never includes customers or internal ids.
- All link creation, revocation, approval, rejection and link-originated orders are audited.
- CORS: policy "AllowUI" in `Program.cs` (~115-150) allows only localhost, capacitor and the two
  `*.runasp.net` hosts; the public page is served from the same host, so no change expected.
  Re-check if the link is ever served from another domain.
- The auth interceptor must not attach a bearer token to, or refresh/redirect on 401 for,
  `/public/` requests.

### Frontend design

Customer details page (`app/features/management/customers/customer-details/`):

- New "Ordering link" section after "Address" in the right-hand column, same section style
  (`border-t border-gray-100 pt-5`, heading `text-xs font-semibold tracking-wider text-gray-400 uppercase`):
  enable toggle, "Generate link" with optional end date, links table/cards (`BadgeComponent`
  status, created by, last used, Copy, Revoke). Revoke and disable go through `app-confirm-dialog`
  with `modalStack`, like the existing delete/restore dialogs. Buttons follow `docs/BUTTONS.md`
  (`app-btn ...`, explicit `type`, busy labels). Hide the section for roles without
  `OrderLinksWrite` and on inactive customers.
- New `OrderLinkService` (`app/core/services/`, pattern of `customer.service.ts`: `catchError`
  into `new Error(this.getErrorMessage(...))`, add texts to `app/core/messages`), models in
  `app/shared/models/order-link.models.ts`, `allowOrderingLink` on `CustomerDto`
  (`app/shared/models/customer.models.ts`).
- Role group `AppRoleGroups.OrderLinksWrite` in `app/shared/constants/app-roles.ts`.

Public page (`/shop/:token` (links sent as `/order/:token` before still redirect to it)): the menu is `/shop/:token`, the order list `/shop/:token/orders` and one order `/shop/:token/orders/:id` (same page, so Back, Refresh and shared links work). The old `/order/:token` redirects.

- Route placed in `app/app.routes.ts` between `login` and the layout shell, no guards; add it to
  `app/shared/constants/app-routes.ts`. `app.routes.spec.ts` requires the first route to be the
  login redirect and the last to be `**`/NotFound, so keep the public route in the middle.
- Same visual language as `app/features/orders/order-editor/order-editor.html`: product cards
  `card rounded-xl bg-white shadow-lg hover:-translate-y-0.5 hover:shadow-xl` in the grid
  `grid-cols-1 sm:grid-cols-[repeat(auto-fill,minmax(220px,1fr))]`, `app-btn app-btn-primary
  app-btn-lg`, `app-cart-drawer` on mobile and an aside cart on `xl`, `AddonSelectorComponent`,
  `BadgeComponent`. No sidebar, dock or header menu: a slim header (logo + "Ordering as
  {first name}") and a Menu / My orders tab switch.
- The order editor (3000+ lines) is tied to `AuthService`, `OfflineOrderService`,
  `CatalogCacheService` and `CartPersistenceService`, so it is not reused whole. There is no
  standalone product-card component; extract one (and the checkout form) only if the change is
  small, otherwise copy the same classes. `AddonSelectorComponent` reads add-ons through
  `CatalogCacheService.getAddOnsForProduct`, so give it an input for add-ons or build a small
  public variant. `checkout-modal` is the best base for the payment step: it already has the
  Cash/GCash toggle, amount received and change; add Pickup/Delivery, address and contact, hide tips.
- Do not use the offline stack on this page (no Dexie cart, no queue): the customer must be online.
- **No local copy of the catalog.** The page never uses `CatalogCacheService`, `ImageCacheService` or any
  IndexedDB/localStorage copy of products, prices or the cart, so a customer cannot order from an obsolete
  list. It loads the catalog fresh on every page load and every return to the Menu tab. Public API responses
  send `Cache-Control: no-store`, and the service worker (`ngsw-config.json`) has no data groups, so it never
  caches them. The server still revalidates every product, add-on and price on submit (Phase 3) and rejects
  inactive or missing ones.
- `app/app.ts` eagerly injects `PushNotificationService` and `OfflineOrderService` and
  `app.html` mounts global alert, update-banner and exit-confirm components. Check they are
  harmless for a logged-out visitor.
- Invalid link page modeled on `features/not-found` (centered card, logo, message).
- Add a `/public/` exclusion to `app/core/interceptors/auth.interceptor.ts`.

```
Mobile                                   Desktop (xl)
+---------------------------+            +-----------------------------+--------------+
| [logo]  Ordering as Maria |            | [logo]  Ordering as Maria   |  Your order  |
| [Menu] [My orders]        |            | [Menu] [My orders]          |  2x Latte    |
| [search..................]|            | [search.................... ]|  1x Croissant|
| (All)(Coffee)(Food)(...)  |            | (All)(Coffee)(Food)(...)    |  ----------  |
| +----------+ +----------+ |            | +------+ +------+ +------+  |  Total       |
| | Latte    | | Croissant| |            | | card | | card | | card |  |  [Checkout]  |
| | PHP150 + | | PHP120 + | |            | +------+ +------+ +------+  |              |
| +----------+ +----------+ |            +-----------------------------+--------------+
| [ View order (3) PHP420 ] |  <- sticky button opens the cart drawer

Checkout: ( ) Pickup ( ) Delivery -> address | Contact number (required)
          Payment [Cash] [GCash]; Cash: "I will pay with PHP ____" -> change staff prepare
          Special instructions | [ Place order ] -> My orders tab, "waiting for confirmation"
```

Orders list (`app/features/orders/order-list/`): amber "Awaiting approval" banner at the top,
styled like the pending-offline block (`order-list.html` ~185-240): customer, pickup/delivery,
contact, total and the change to prepare, with Accept / Reject buttons; reject opens a reason
dialog. New status in the badges and filter. Order details shows fulfillment, address, contact,
source, rejection reason. SignalR `OrderUpdated` (already handled by `OrderList`) refreshes the list.

### Push notifications (update the existing push flow)

Current state (read before changing): `IPushNotificationService`
(`src/WTF.Api/Services/PushNotificationService.cs`) has two methods, `SendOrderCreatedAsync` and
`SendOrderStatusChangedAsync`. Each one selects the recipients with its own copy of the same
query (active push tokens of active users, excluding the `AdminViewer` role and the acting
user), then sends through `IFcmPushClient` and `IHuaweiPushClient` (both skipped when not
configured). The data payload carries `orderId`, `orderNumber` and `path`: created orders point to
`/orders/editor/{id}`, status changes to `/orders/details/{id}`. On the client,
`app/core/services/push-notification.service.ts` routes by `orderId`/`path` (foreground web to the
order editor, native tap to order details, default the orders list) and creates the Android
channel `orders`.

Why it must change for this feature:

- A `PendingApproval` order cannot be opened in the POS editor, so the existing created-order
  path would open the wrong screen. Link orders need their own payload and routing.
- The system "Customer Link" user is the creator, so "exclude the actor" no longer filters
  anyone; recipients are all staff who can act on orders.
- Customer chat messages need a notification too (Phase 5).

Notification events:

| Event | Recipients | Title / body | Opens | Phase |
| --- | --- | --- | --- | --- |
| New link order | Active staff except AdminViewer | "New online order" / `Order #n - {customer} - Pickup|Delivery - PHP total` | Orders list (Awaiting approval banner), or order details | 3 |
| Customer message | Same | "Message from {first name}" / first 80 chars of the message | Order details with the chat open (`?chat=1`) | 5 |
| Order accepted / rejected | Optional: other staff, not the one who acted | "Order #n accepted" / "Order #n rejected" | Order details | 3 (optional, off by default to avoid noise; the banner already updates over SignalR) |

Work items:

- **Server:** extract the duplicated recipient query into one private method (for example
  `GetRecipientTokensAsync(excludeUserId)`) used by every send method; add
  `SendLinkOrderCreatedAsync(Order, decimal total, ...)` and
  `SendOrderMessageAsync(Order, string senderName, string preview, ...)`; add both to
  `IPushNotificationService`. Add a `type` field to the data payload (`online-order`,
  `order-message`; existing events keep working without it) next to `orderId`, `orderNumber`, `path`.
  Keep sends after commit and failure-tolerant, like the existing calls (a failed push never
  fails the order or the message). Link order create and chat call sites live in the Phase 3
  submit handler and the Phase 5 message handler.
- **Client:** in `push-notification.service.ts` route by `type`: `online-order` to the orders
  list (or order details), `order-message` to order details with the chat open; never to
  `OrderEditorById` for a `PendingApproval` order. Keep the existing default for payloads without
  a `type`. Both the web (Firebase) and native/Huawei tap handlers need the same routing.
- **Android channel (optional):** notification channels are immutable once created, so a
  distinct sound or importance for online orders needs a new channel id (for example
  `online-orders`) created alongside `orders`; the server then sends the channel id in the
  payload. Skip if the default channel is fine.
- **Customer side:** customers are anonymous, so no push for them. They get live updates over
  the Phase 5 customer hub and the My orders poll. Web push for customers (a per-link
  subscription) is a possible later addition.
- **Tests:** add `PushNotificationService` tests in `src/WTF.Tests/Services/` using NSubstitute
  fakes for `IFcmPushClient`/`IHuaweiPushClient` and the in-memory `WTFDbContext`: recipients
  exclude AdminViewer, inactive users and inactive tokens; nothing is sent when no client is
  configured; payload has the right `type`, `orderId` and `path`; one failing client does not
  stop the other. Frontend: `push-notification.service.spec.ts` cases for routing by `type`
  (online order, message, and a legacy payload without `type`).

### Phases

| Phase | Name                                         | Status    |
| ----- | -------------------------------------------- | --------- |
| 1     | Data model, staff endpoints, customer UI     | [Completed] |
| 2     | Public validation, ordering page, My orders  | [Completed] |
| 3     | Order submission, approval, staff alerts     | [Completed] |
| 4     | Reporting by source and per-link usage       | [Completed] |
| 5     | Order chat (per order, SignalR both sides)   | [Completed] |

#### Phase 1 - Data model, staff endpoints, customer details UI [Completed]

Deliverables:

- SQL script and rescaffold (columns above, `PendingApproval` status row, system user).
- `OrderStatusEnum.PendingApproval`, new audit actions/entity type, policy `OrderLinksManage`.
- `Features/OrderLinks/` handlers + endpoints (enable/disable, create, list, revoke), token
  generator, `AllowOrderingLink` on `CustomerDto`.
- Loyalty redirect `TargetType` fix.
- Frontend: `OrderLinkService`, models, messages, `OrderLinksWrite` role group, customer
  details "Ordering link" section.

Tests:

- API: `RouteTableTests.ExpectedRoutes` (add the four routes), `PolicyMatrixTests.Expected`
  (`OrderLinksManage`; `WritePolicies_NeverAdmitAdminViewer` applies), handler tests in
  `src/WTF.Tests/Features/OrderLinks/` using the in-memory `WTFDbContext` helpers in
  `src/WTF.Tests/Database` (success, customer missing/inactive/not enabled, past expiry, link of
  another customer, revoke, disable revokes all, audit entry), token generator tests (length,
  uniqueness, URL-safe), loyalty redirect ignores order tokens.
- Frontend: `order-link.service.spec.ts` (each method and error path), `customer-details.spec.ts`
  additions, `apiPolicies` entry in `app-roles.spec.ts`; `button-conventions.spec.ts` runs
  automatically.
- Note: the in-memory database does not enforce unique indexes or defaults (see the Automated
  Testing Plan limits), so token uniqueness cannot be proven there.

Done when: a Cashier can enable ordering, generate (with and without end date), copy, revoke and
disable links; an AdminViewer cannot; an order-link token returns 404 on the loyalty redirect.

#### Phase 2 - Public validation, ordering page and My orders [Completed]

Implemented: `OrderLinkAccess` (the shared token check, ordinal token compare), `GET /api/public/order-links/{token}` (+ `/orders`, `/orders/{id}`), `PublicCatalogDto` built from the loaders now shared with the POS sync (`PosCatalogLoader`), `LastUsedAt` (written at most once a minute), `order-link-policy` (per IP) plus a per-token global limiter, `Cache-Control: no-store`, the `/shop/:token` page (menu, search, categories, own add-on picker, in-memory cart, My orders with a 30 s poll), the invalid-link page and the `/public/` interceptor exclusion. The cart has no checkout yet (Phase 3). Verified harmless for a logged-out visitor: push registration only runs after login, the offline queue only syncs when authenticated, and the update banner only offers a web refresh.

- `GET /api/public/order-links/{token}` with the shared token check, `PublicCatalogDto` (extract
  the loaders from `GetPosCatalogHandler`), `LastUsedAt`, `order-link-policy`.
- Public page, invalid-link page, interceptor exclusion, route constants (see Frontend design).
- **My orders** (ships in this phase, empty until Phase 3 adds submission): the list and detail
  endpoints above. The list returns the link customer's `Source = CustomerLink` orders across
  all of that customer's links (so a regenerated link keeps the history), newest first. The page
  shows cards grouped by date with `BadgeComponent` statuses (amber for "Waiting for
  confirmation"), tap to expand details (items, add-ons, total, pickup/delivery, payment),
  `PullToRefreshComponent`, and a 30 s poll while the tab is visible (the SignalR hub needs a
  login; Phase 5 adds a customer hub).
- Tests: `RouteTableTests` (the new routes go in `OnlyTheExpectedRoutesArePublic`; they are
  GETs so the write-routes list is unaffected), token-check cases (revoked, expired, disabled,
  inactive customer, wrong `TargetType`, all identical 404), catalog contains no customers or
  audit fields, My orders only returns this customer's link orders and hides POS orders and other
  customers', status label mapping, service and page specs, `app.routes.spec.ts` still passes.

#### Phase 3 - Order submission, approval, notification [Completed]

Implemented (details; the original plan follows below):

- **Placing an order.** `POST /api/public/order-links/{token}/orders` (`SubmitPublicOrderHandler`) creates the order
  through the normal `CreateOrderCommand`, so the size/flavor/sauce and add-on rules, inactive products and the
  rest are checked in the one place that already does it. Server-only fields on the command (`ActorUserId`,
  `Source`, `OrderLinkId`, `FulfillmentType`, `DeliveryAddress`, `ContactNumber`) are `[JsonIgnore]`, so a
  signed-in caller cannot set them. The order starts as `PendingApproval` and is owned by the system user
  `customer-link`. The request carries no prices; the server works the total out from today's catalog (product
  price plus each add-on at the price set for that product) and requires a cash amount that covers it. Limits:
  30 lines per order, quantities 1-99 for items and add-ons, 20 different add-ons per item, address 300, contact
  7-30 characters (digits, spaces, + ( ) -), notes 100, cash amount at most 1,000,000, and at most 5 orders
  waiting for confirmation per customer. Repeated add-ons are merged. GCash stores no cash amount.
- **The link is re-checked right before the order is created** (`OrderLinkAccess.IsStillValidAsync`, a fresh
  yes/no query: EF would otherwise hand back the already-loaded link unchanged). `TimeProvider` is injected so
  a link expiring mid-request is testable. A link that stopped working returns the same 404 and creates nothing.
- **Approve / reject.** `POST /api/orders/{id}/approve` and `/reject` (`OrdersWrite`, so Cashier and up). Only
  `PendingApproval` orders; approve -> `Pending`, reject -> `Cancelled` with a required reason (max 500) stored in
  `Orders.RejectionReason` and shown to the customer. Both are audited (`OrderApproved` / `OrderRejected`) and
  tell open screens through SignalR. Revoking a link does not stop staff from answering orders already placed.
- **Status audit done.** Waiting orders are left out of the normal order lists (`All` and `ExcludeFinalized` both
  hide them; they come back only for `Status = PendingApproval`), the dashboard's recent orders, void (use reject)
  and edit (the update handler refuses them and refuses moving any order into the status). Staff cannot create an
  order as `PendingApproval`. The add-on unlink handlers treat them like pending orders. Reports, the dashboard
  totals and the monthly workbook already counted only Completed orders, so they needed no change.
- **Order data for staff.** `OrderDto` now carries `source`, `fulfillmentType`, `deliveryAddress`,
  `contactNumber` and `rejectionReason`.
- **Staff alerts.** `SendLinkOrderCreatedAsync` -> "New online order" to every active non-viewer staff member (the
  system user is the actor, so nobody is excluded), `type = online-order`, `path = /orders/list`. The app routes
  an `online-order` push to the orders list on every platform and never to the editor.
- **Staff screens.** Orders list: an "Awaiting approval" banner (oldest first) showing customer, pickup/delivery,
  items, contact, address, total and the change to prepare, with Accept and Reject (reject asks for a reason in
  `RejectOrderDialogComponent`); it refreshes over SignalR and a waiting order never appears in the normal list.
  Order details: an "Online order" box with handover, address, contact, what the customer will pay and the
  rejection reason, plus Accept / Reject. The editor sends a waiting order to its details page.
- **Public checkout.** `PublicCheckoutComponent`: pickup or delivery (address prefilled from the customer),
  contact number, cash (with an "I will pay with" amount, change preview and an exact-amount button) or GCash, and
  notes. It checks the same rules the server does, then the page sends the cart, clears it and opens My orders,
  where the order shows as "Waiting for confirmation". A server refusal is shown inside the checkout; an item that
  is no longer sold also refreshes the menu and cart underneath; a 404 switches to the invalid-link page.
- **Optional tip.** `SubmitPublicOrderRequest.Tips` (max 100,000, rounded to the cent, never negative, zero is none) is
  stored in `Orders.Tips` and returned to the customer; the banner and order details show it to staff.
- **Colored payment states** on the public checkout: the amount box and a status row are gray while no amount is
  typed (amount due), red as soon as the amount is too small (still needed) and green when it covers it (change to
  prepare). The logged-in checkout turns its amount box red the same way.
- **Hold to place the order.** On the public checkout, Place Order only acts when pressed and held for one second
  (`HoldButtonComponent`: a fill grows across the button, letting go early cancels and shows a reminder; it also
  works from the keyboard by holding Enter or Space), so an order is never sent by an accidental tap. The form is
  still checked when the hold completes.
- **Logged-in checkout modal restyled like the public checkout** (rounded card, header with the total, Cash / GCash
  as radio buttons, peso icon inside the amount received and tips boxes, an "Exact amount" button, the same footer).
  The "View Order" order-summary panel was removed from it, and the modal no longer takes the cart, customer name or
  order note as inputs.
- **Logged-in order screen:** product cards now show the product description under the name, like the public page.
- **Real-database tests** (`Database/OrderLinkDatabaseTests`): the link re-check query, the case-insensitive token
  match, the unique token index, column lengths, the new status row, the full submit and approve/reject flows with
  every foreign key enforced.

Not done / decided:

- A discounted-product promotion is applied when staff complete the order (as for every pending order), not at
  submit, so the total a customer sees is the base price total.
- No push to the customer (they are anonymous); they see the answer on My orders (30 s poll).
- No "order accepted / rejected" push to other staff (the banner already updates over SignalR).

Original plan:

- **Re-check the link before finalizing.** `SubmitPublicOrderHandler` resolves the link at the start (so a bad
  link fails fast with the same 404) and checks `RevokedAt`, `ExpiresAt` and the customer flags once more
  right before it sends the create-order command. If the link is no longer valid at that point it returns the
  same 404 and creates nothing. Tests: revoked or expired between the first check and the create, ordering
  disabled mid-request, and a revoked link whose earlier orders still show and are still approved or rejected
  by staff (revoking a link stops new orders, it does not cancel existing ones).
- **The checkout switches to the invalid-link page on a 404** from the submit call (and keeps nothing).

- The public page already lets a customer add toppings and extras more than once (a per-add-on quantity, same as the shop's own add-on screen; size, flavor and sauce stay pick-one). The submit request must carry that quantity per add-on (the child order item's `Quantity`, per unit of the parent), validated like any other.

- `POST /api/public/order-links/{token}/orders`: items, fulfillment, delivery address (required
  for Delivery), contact number (required), payment method, cash amount (>= server total),
  special instructions. Server recalculates everything, caps items and quantities. Creates the
  order through `CreateOrderHandler` with `PendingApproval`, `Source = CustomerLink`,
  `OrderLinkId`, created by the system user. Multiple orders per link are allowed.
- This POST is the first anonymous write route: add it to the allowed list in
  `WriteRoutes_WithoutAPolicy_AreOnlyAuthAndPushRoutes` (`RouteTableTests`).
- `approve` / `reject` endpoints (only from `PendingApproval`, reason required to reject, audited,
  SignalR `OrderUpdated` + `DashboardUpdated`).
- Push to staff for a new link order, and the shared recipient query + client routing by
  `type` (see "Push notifications" above).
- Orders list banner, status badges/filters, order details additions, the status audit above.
- Public page checkout step and the post-submit "waiting for confirmation" state on My orders.
- Tests: submit (totals, add-on rules, promotions, expired/revoked token, delivery without
  address, cash below total, multiple orders), approve/reject (wrong status, missing reason,
  role access), status audit regressions (unapproved orders excluded from reports/dashboard),
  route and policy snapshots, order-list and checkout specs.

#### Phase 4 - Reporting [Completed]

- **Reports by source.** Every report (daily sales, product sales, payments, hourly, staff) takes an optional
  `source` (`Pos` = 0, `CustomerLink` = 1; anything else is a 400). Left out it counts every order, so existing
  numbers do not change. It filters the order rows (and, for product sales, both the items and the bundles). The Excel
  and PDF exports say which source they cover in their subtitle ("Source: Shop orders" / "Customer link orders").
  The reports page has a Source select (All Orders, Shop Orders, Customer Link Orders) that counts on the Filters
  badge.
- **Orders by source.** `GET /api/orders/paged` takes `source` too. The order list's Filters drawer has a Source
  section (Shop orders, Customer link orders): one chosen asks the server for that source, both or none asks for all,
  it is remembered with the other list filters and counts on the Filters badge. Orders waiting for approval stay out of
  the normal list either way.
- **Link usage.** The customer details links list shows how many orders each link produced (`OrderLinkDto.OrdersCount`,
  whatever became of the orders) next to "Last used".
- **Monthly workbook.** Checked: it builds its sheets from the same handlers without a source, so it keeps counting
  every completed order and its labels are unchanged. Waiting, rejected and cancelled orders were already excluded
  from revenue by the status audit.
- Tests: each report limited to a source and the same totals when added up, paged orders by source (waiting orders
  stay hidden), link order counts, the report and order services' parameters, the reports page and order list
  filters, and the links list.

#### Phase 5 - Order chat (one thread per order) [Completed]

Customer and staff talk about a specific order (for example "is 5pm pickup ok?") before or after
approval.

- Database script `tools/sql/<date>_add_order_messages.sql`: `OrderMessages(Id uniqueidentifier,
  OrderId FK Orders, SenderType tinyint [Customer|Staff], SenderUserId FK Users null, Body
  nvarchar(1000), CreatedAt datetime2, ReadByStaffAt null, ReadByCustomerAt null)`, index
  `(OrderId, CreatedAt)`. Append-only; then rescaffold.
- Every customer-side write and the hub connection re-check the link (`RevokedAt`, `ExpiresAt`, customer
  flags) right before they act, like the order submit does; a revoked link also sends `LinkRevoked` and closes
  the connection.
- Rules: only for `Source = CustomerLink` orders; open while `PendingApproval` or `Pending`,
  read-only history after Completed/Cancelled/Refunded; body trimmed, 1-1000 chars, plain text
  only (never render as HTML); tighter `order-chat-policy` rate limit per token and IP.
- Sending is always a REST `POST` (validated, saved, rate limited); SignalR only delivers, so a
  hub client can never write. Audit chat open/close, not every message.
- Staff API (authenticated): `GET /api/orders/{id}/messages` (`OrdersRead`),
  `POST /api/orders/{id}/messages` and `POST /api/orders/{id}/messages/read` (`OrdersWrite`,
  AdminViewer cannot send).
- Customer API (anonymous, token check, order must belong to the customer):
  `GET`/`POST /api/public/order-links/{token}/orders/{orderId}/messages` and `POST .../read`.
- Real time, staff: reuse the authenticated `DashboardHub` (`/hubs/dashboard`) with a new
  `OrderMessageReceived` event in `HubNames.Events`.
- Real time, customer: new anonymous `CustomerOrderHub` at `/hubs/customer-orders`, mapped in
  `Program.cs` next to `DashboardHub`. The token is sent as the connection `access_token` query
  value and validated in `OnConnectedAsync` (abort on failure); the connection joins group
  `customer-{customerId}`. The server pushes `OrderMessageReceived`, `OrderStatusChanged` (so
  approve/reject shows instantly) and `LinkRevoked` (client leaves and shows the invalid-link
  page). No client-callable methods that read or write data; limit connections per IP. Keep the
  30 s poll as fallback when the socket drops. The public page needs its own SignalR client (pattern
  of `app/core/services/signalr.service.ts`, without the JWT factory).
- Push to staff on a new customer message (`order-message` type, opens the order with the chat
  open; see "Push notifications" above).
- UI: a shared presentational chat component (message bubbles + input, busy state) used in a
  `SideDrawerComponent` for staff ("Chat" button with unread badge on awaiting-approval cards and
  order details) and inside an order in My orders for the customer; unread badges on both sides.
- Tests: send/list, other customer's order 404, closed thread rejected, length limits, unread
  marking, hub connection validation (valid token joins; revoked/expired/disabled aborts),
  `RouteTableTests` (public POSTs on the write-routes list), service and component specs.

**What was built (and where it differs from the plan above).**

- **Conversations, not order threads.** The tables are `Conversations` (customer, kind `Order`/`Support`, optional order, title
  "Order #1042", last message time, closed time) and `ConversationMessages` (sender customer/staff, staff user, body 1-1000,
  read-by-staff and read-by-customer times), from `tools/sql/20261012_add_conversations.sql`. An order has at most one conversation
  (unique filtered index); it is created by the first message. Only the Order kind has screens: Support can be added later
  without a change to the tables, as its own inbox with its own access rule.
- **One shared staff inbox.** An order has no owner. A customer's message reaches every signed-in staff member who can read orders
  (live) and every active staff device except viewers (push, type `order-message`, opens the order with the chat open). Opening a
  chat or replying marks the customer's messages read for everyone; each reply shows who sent it. Admin Viewers can read but not reply.
- **API.** Staff: `GET /api/conversations` (the envelope list, unread first, with the number of unread conversations),
  `GET /api/orders/{id}/conversation`, `POST /api/orders/{id}/messages`, `POST /api/orders/{id}/messages/read`. Customer, behind the
  link: `GET .../conversations`, `GET|POST .../orders/{orderId}/messages`, `POST .../orders/{orderId}/messages/read`. Every customer
  call runs the link check, only reaches an order the customer placed through a link, and sending re-checks the link right before
  saving. A customer sees a staff member's first name only. Chat is open while the order is waiting or accepted and read-only after;
  a customer can send ten messages in a row before the shop must reply; sending has its own rate limit (`order-chat-policy`).
- **Real time uses two hubs, and the dashboard hub is unchanged.** `DashboardHub` keeps its dashboard-only policy, so cashiers (who
  answer customers) cannot connect to it. Staff chat events go through a new `StaffOrderHub` (`/hubs/staff-orders`, orders-read
  policy). Customers use `CustomerOrderHub` (`/hubs/customer-orders`): anonymous, the link token (`access_token`) is checked on
  connect and anything invalid is aborted, ten connections per address, and no method a client can call. The events only say that
  something changed (`OrderMessageReceived`, `ConversationRead`, `OrderStatusChanged`, `LinkRevoked`); the page then asks for the
  data again. Approve, reject and ready update the customer's page at once; revoking a link sends every page open through it to the
  invalid-link page.
- **Screens.** An envelope with a red unread count (conversations, not messages) in the sidebar's top row (beside the logo) and in the
  phone top bar (name, role, status and clock moved into the avatar's menu); it opens a list, unread first, and a row opens that order
  with its chat open. Staff: a Chat button with an unread badge on every waiting order, on order details and in the editor, a badge on
  list rows, and a side panel. Customer: the same envelope, a "Chat with the shop" card on an order's details, a badge on rows, and a
  chat that rises as a sheet on phones and opens as a panel on wide screens. Nothing of the chat is stored on the customer's device.
- Tests: handlers (staff and customer), rules, the notifier, both hubs, push, real SQL Server tests, route snapshots, and the services,
  chat, envelope, panels, header, sidebar and pages on the front end.

### Testing and verification

New code follows the Automated Testing Plan rules above (a handler test per handler, spec per
service/component, snapshots updated in the same change).

- `dotnet test src/WTF.Tests/WTF.Tests.csproj` and `npm test -- --watch=false` in `src/wtf-pos`.
- Run each SQL script twice against a dev database (idempotency), rescaffold, build the API.
- Manual, phase 1: enable ordering, generate with and without an end date, revoke, disable and
  see links flip to Revoked; Cashier allowed, AdminViewer blocked; loyalty redirect with an
  order-link token returns 404.
- Manual, phases 2-3: open the link on a phone-width browser while logged out, place several
  orders, see them in the Awaiting approval banner, accept one and reject another with a reason,
  check My orders shows the new statuses, check the audit log, and confirm unapproved orders are
  missing from the dashboard and report totals.
- Manual, phase 5: chat from both sides in two browsers, revoke the link while connected, check
  unread badges and the staff push.

### Order details redesign and public page addresses (19 Oct 2026)

- **Order details (POS and public) share one layout.** A top card with a status-colored strip, the order number and status badge, a large total and the plain facts (customer, items, payment, source on the POS; the status sentence on the public page). Below it, the items on the left (a plain list, no inner scroll box) and the payment summary on the right, which stays in view on wide screens. Notes use one gray "Order note" style, also for a line's own instructions; only warnings (needs review, online order, overridden) stay amber. The "2x" in front of a name is gray, also on the downloaded order summary.
- **Status colors.** One scheme on both sides: waiting amber, accepted blue, ready orange, completed green, rejected and refunded red, cancelled gray. The POS uses it through the order's status; the public page takes it from `publicStatusAccent` in `public-order-status.ts`. A refunded order is red (it was orange).
- **The heading stays put.** On the POS the heading is outside the scrolling area; on the public page it is sticky at the top of it, and the payment panel sticks just under it.
- **Public page addresses.** The page moved from `/order/:token` to `/shop/:token`, with the menu, the order list and one order as child routes (`/shop/:token`, `/shop/:token/orders`, `/shop/:token/orders/:id`) of the same page, so Back, Refresh and a shared link work, and tapping My orders returns to the list. The page reads its tab and open order from the address (`PublicOrderComponent.syncFromUrl`); `selectTab`, `openOrder` and `closeOrder` change the address. Old `/order/:token` links redirect, so nothing sent so far breaks. The database stores only the token, so no script was needed.
- **Keeping a changed number or address (20 Oct 2026).** At checkout, when the contact number (or, for a delivery, the address) differs from the one on file, one tick box under the contact number asks "Save my new number for next time" (it says "address" or "number and address" when that is what changed). It starts unticked and is not shown while the value matches what is on file. The request carries `saveContactNumber` and `saveAddress`; after the order is placed the server updates the customer (address only for a delivery, `UpdatedBy` the customer-link user, audited as `CustomerUpdated`), and a failure there never undoes the order. The page then shows the new values as the ones on file, so it asks no more.
- **The public menu groups products like the POS (20 Oct 2026).** The tabs and sections are the sub-categories (Coffee, Non-Coffee, Snacks, Retail, in that order) instead of the main categories (Drinks, Food, Desserts, Other). A product with no sub-category (or one the page does not know) is not shown, the same as on the POS editor, so give every product one. Promos still come first.
- **Small matches (20 Oct 2026).** The POS New Order screen has no back arrow (the menu already has Orders); editing an existing order keeps it. The public page header reads "POS v1.18.1", the same as the POS.
- **Orders list.** The "Awaiting approval" and the offline sync sections start collapsed ("Needs review" stays open).
- **Checked in the running app** (throwaway database, 20 products in one order, 30 more orders over many dates): both details pages at desktop, tablet and phone widths, the sticky heading, the deep link to an order, the Back button, and the date groups of My orders.

---

## Button States & Text Audit [Partly done]

A cleanup pass over every button in the app, following `docs/BUTTONS.md` and the
`button-conventions.spec.ts` rules. To be reviewed before work starts.

**First pass (18 Oct 2026):** a script scanned every template. Every save, delete, restore, download, sync and generate button already has a disabled state and a spinner, directly or through `app-confirm-dialog`'s busy state; loading texts follow one pattern (Saving..., Deleting..., Restoring..., Downloading...); the only dialogs without a busy state are the synchronous ones (discard, leave, log out). No layout wrapping or overflow was found in the browser sweep. Still open: editor pages can be opened by URL for inactive records (no route guard yet), and "Updating Order..." vs "Saving Order..." vs "Processing Order..." could be unified.

### Audit checklist

- **Right button for the job:** primary / secondary / ghost / danger / restore applied to the
  correct actions (e.g. login, cancel, clear, delete, restore, "Later" on the update banner).
- **Busy states:** every save / update / delete / restore / download / refresh button shows a
  spinner, is disabled while running, and cannot be double-submitted.
- **API-call feedback:** every API call shows its in-progress text (Saving..., Loading...,
  Updating..., Deleting...) and then updates to the result (success alert, error alert, reset
  label); no stuck or missing loading text, including offline and failed calls.
- **Button text:** consistent wording per state (e.g. Save / Saving..., Update / Updating...,
  Delete / Deleting..., Download Excel / Downloading...), no stray spaces or punctuation.
- **Loading vs empty vs error states:** spinners, empty-state text and error alerts match
  across list, details and editor pages.
- **Edit / read-only rules:** edit actions hidden or disabled on inactive (soft-deleted)
  records; Add Stock hidden on inactive items; route guard for edit URLs of inactive records.
- **Layout:** toolbars follow one pattern (Filters + Refresh row, downloads row) and labels
  never wrap (see shared `.app-btn` rules); check phone width and the Android build.
- **Disabled / hover / pressed / focus / cursor** states are consistent, including the 3-dot
  menus and dialog buttons.
- **Tests & docs:** extend `button-conventions.spec.ts` where a rule can be enforced, and
  update `docs/BUTTONS.md`.

---

## Completed Order Override [Implemented]

Admins and above (`Admin`, `SuperAdmin`) can correct a completed order after the fact
(items, add-ons, quantities, customer, payment method / amount / tips, special instructions)
instead of only refunding it.

### Implemented

- API: `PUT /api/orders/{id}/override` behind the `OrdersOverride` policy (SuperAdmin, Admin).
  It reuses `UpdateOrderHandler` through an `IsOverride` flag that is never bound from the
  request body, so the regular update endpoint still rejects non-pending orders.
- Rules: only `Completed` orders, the order stays `Completed`, and a reason is required.
- Prices already paid are kept for lines that remain on the order (same product / bundle), so
  later promo changes do not reprice them; new or changed lines are priced as in a normal
  completed order.
- Audit: `OrderOverridden` entry with the full before / after snapshot (items, add-ons,
  payment, tips, total) and the reason, visible in Audit Logs and their exports.
- No push notification; the order-updated SignalR event still fires.
- UI: "Override Order" button on order details (hidden for other roles) opens the editor in
  override mode (`?override=1`). The footer becomes Review Payment (reuses the payment dialog
  so change and tips are recalculated) and Cancel Override. A reason dialog is shown before
  saving.
- Order details shows an "Overridden" box with the reason and time of the latest override
  (columns `Orders.OverrideReason` / `OverriddenAt`, script
  `tools/sql/20261011_add_order_override_details.sql`).

### Decisions on the earlier open questions

- No time window: Admins can override any completed order.
- Reports and receipts use the corrected values; the reason and time of the latest override are saved on the order and shown on order details, and the audit log keeps the full history.
- Online only: override is not offered for offline-created orders.

### Possible follow-ups

- None. Override rules are now covered by `UpdateOrderHandlerTests` and `UpdateOrderDatabaseTests` (override path, reason
  required, non-pending rejected), and the policy is in the route and role snapshots.

---

## Image Storage CORS [Completed]

Browser `fetch()` of Azure Blob images from `https://wtfbyfaith.runasp.net` was blocked
(`No 'Access-Control-Allow-Origin' header`), so the offline image cache
(`ImageCacheService`) and the receipt image conversion could not download them on the web
build. Fixed in configuration (a CORS rule on the `wtfstorageacc` Blob service), not code.

- Keep the rule if the storage account or hosts change: allowed origins `https://wtfbyfaith.runasp.net`
  (plus any staging/dev origins), methods `GET, HEAD, OPTIONS`, allowed headers `*`,
  exposed headers `*`, max age `3600`.
- Still worth checking once: the Android (Capacitor) build.

---

## Stale Image Cleanup [Completed]

**Implemented** in `Features/Images` (`StaleImageCleanupScheduler`, `StaleImageCleanupService`, `ImageReferences`),
settings under `StaleImageCleanup` in `appsettings*.json`. Differences from the plan below:

- **Cold start.** The app goes cold, so the scheduler does not just sleep until 02:00. Every pass (at least every 30
  minutes, and on startup) asks "is today's run due?": past the run time and the last run was not today (Manila time).
  The last run is saved as `system/stale-image-cleanup.json` in report storage, so it survives restarts and a cold
  start after 02:00 catches up at once. A failed run is retried (`RetryCount`/`RetryDelayMinutes`), never lost.
- **Dry run is on by default** in code and `appsettings.json` (cap `MaxDeletesPerRun: 100`). Check the logs, then set `DryRun` to `false`.
- **Scope.** `Categories` (default `["users"]`) limits the cleanup to `images/{category}/` folders; widen it later
  (`customers`, `products`, `promotions`). "In use" is always judged against every image row, whatever the scope.
- **Third pass.** An in-use image row whose file is gone from storage loses its link and row, so the owner simply has no
  image (`RemoveRowsWithMissingFile`). It needs a non-empty storage listing, and is skipped if no file matches any row.
- **URL matching.** `ImageKey` normalises saved URLs (encoding, slashes, container name, prefixes) and a file also counts
  as used if its file name (ends in a GUID) matches a row. If no file matches any row, the file pass deletes nothing.
- **No audit entry:** `AuditLogs.UserId` is required and a background job has no user, so the run is logged and its
  result is the saved JSON state instead. The optional "Run now" button is not built; `IStaleImageCleanupService.GetLastRunAsync` is ready for it.
- **Fixed on the way:** `AzureBlobImageStorage.DeleteAsync` used the URL path including the container name as the blob
  name, so deletes of saved images silently found nothing; it now strips the container. This is likely where existing orphan blobs came from.
- **Chat images:** add the new chat image reference to `ImageReferences.ReferencingEntities` and the `Unreferenced` query
  (a test fails if an entity referencing `Image` is missing from the list).

Remove images that nothing uses any more after a configurable number of days, so the blob storage does not grow
forever. Replaced or removed images currently delete the stored file and image rows right away (see the hard-delete
note under Inventory); this feature covers what that path misses: orphaned blobs (an upload that was never saved, a
failed delete, a removed product or promotion), and the chat images below once their messages expire.

- **Setting.** `StaleImageCleanup:RetentionDays` (default 30, `0` = disabled) in app settings, plus `Enabled` and the
  run time (default `02:00`, `Asia/Manila`), in the style of `MonthlyReportWorkbookScheduler`.
- **Hosted service** (`StaleImageCleanupScheduler`, registered next to the workbook scheduler in `Program.cs`). Once a
  day, two passes:
  1. **Blobs with no database row:** list the container, skip anything newer than `RetentionDays` (so an upload that is
     still being saved is never touched), delete the rest.
  2. **Image rows nothing points to** (no product, customer, user, promotion or chat message references them) older than
     `RetentionDays`: delete the blob, then the row.
- **Safety.** Dry-run mode that only logs what would be deleted (on for the first run), a cap on how many files one run
  may delete (stop and log if exceeded), never touch the shared logo or report folders, one audit entry per run with the
  counts.
- **Needs first:** one central list of every place that references an image (product, customer, user, promotion and
  chat), so a new feature cannot be forgotten, plus a test that fails when an entity with an image reference is missing
  from the list.
- **Tests.** A recent unreferenced blob is kept, an old one is deleted, a referenced one is never deleted at any age,
  `RetentionDays = 0` does nothing, the delete cap stops a run, a failing delete does not stop the others.
- Optional: a "Run cleanup now" button and the last run's result for SuperAdmin on a management page.

---

## Chat Images and Message Expiry [Completed]

Builds on the order chat (Customer Ordering Links, phase 5). Two parts: send pictures in the chat, and delete old
messages automatically.

### Images in chat [Completed]

**Implemented** (message expiry below is still planned). Differences from the plan:

- **Private container, not the `Images` table.** Pictures live in their own private container (`ChatImages:Container`,
  default `wtf-chat-images`, created with no public access; locally `App_Data/chat-images`). They are columns on
  `ConversationMessages` (`ImageKey`, `ImageContentType`, `ImageWidth`, `ImageHeight`, `ImageSizeBytes`,
  `ImageRemovedAt`), script `tools/sql/20261013_add_conversation_message_images.sql`. Because they are not in
  `Images`, Stale Image Cleanup never sees them; **message expiry must delete the blob with the message** (`ImageKey`).
- **Image library: SkiaSharp** (MIT, no key). ImageSharp 4 fails a Release build without a paid Six Labors licence key,
  and ImageSharp 3.1.12 has known high-severity decoder vulnerabilities, so neither is used. Every upload is decoded and
  written out again as a JPEG (no metadata), turned upright from its orientation tag, shrunk to 1600 px if larger, never
  scaled up, and flattened onto white. The type comes from the first bytes; the pixel size is read from the header before
  decoding.
- **Endpoints.** Staff: `POST /api/orders/{id}/messages/image`, `GET` and `DELETE /api/orders/{id}/messages/{messageId}/image`.
  Customer: `POST .../orders/{orderId}/messages/image` and `GET .../messages/{messageId}/image` under the link. Pictures
  are sent as `multipart/form-data` (`file`, `body`); served with our own type, `nosniff`, `inline`, private 60 s cache.
- **Limits.** 5 MB, 4096 px per side, 5 pictures a minute per address (`order-chat-image-policy`), 30 a day per customer
  (`ChatImages:DailyLimitPerCustomer`, counted from the database), and pictures count toward the ten messages before the
  shop replies. Refused uploads that look hostile are written to the audit log (`ChatImageRejected`); staff removal is
  `ChatImageRemoved`.
- **UI.** Attach button, preview with Remove, caption, client checks (type, 5 MB), spinner while sending, tap to enlarge,
  pictures load only when scrolled into view and are never stored on the device. Staff fetch a picture as a file with
  their login (the customer's link token is the proof for the customer). Staff can remove a picture after a confirm.
- Push text for a picture without text is "Sent a photo"; lists show "Sent a photo" or "Photo removed".
- **One validation for every picture upload.** `Services/ImageProcessing.cs` (`ImageSanitizer`, `ImageUploads`) now checks and
  cleans the chat photos AND the user, customer, product and promotion pictures: the real type from the first bytes (the
  file name is ignored), size and pixels from the header before decoding, then decode and write out again (no metadata,
  upright, shrunk to 2048 px at most, never scaled up). Chat always stores a JPEG on white; the others keep their own type
  and transparency, and the stored extension comes from what the picture really is (so a `.gif` name no longer matters).
  A refusal is now a 400 with an explanation instead of an empty 404. The endpoints share one reader that enforces the
  5 MB limit before reading the file (the customer, promotion and own-profile uploads had no limit before the handler).

Original plan:

Use case: a customer sends a GCash payment screenshot or a photo of what they want; staff send a product photo. Both
sides can send, and the customer is anonymous, so everything is enforced on the server.

- **Rules (server side, never trust the client).**
  - Allowed types: JPEG, PNG and WebP only. No SVG, GIF or HTML. The type is decided from the file's first bytes (magic
    numbers), not the file name or the `Content-Type` header.
  - Maximum 5 MB per image (`ChatImages:MaxBytes`) and a maximum pixel size (for example 4096 x 4096, against
    decompression bombs). One image per message, with an optional caption (the existing 1-1000 character body).
  - Re-encode every upload (decode, strip metadata such as GPS/EXIF, resize to about 1600 px, save as JPEG or WebP).
    This removes hidden payloads and means the stored file is ours, not the sender's.
  - Random server-generated file names in a dedicated `chat` folder; the original name is never stored or shown.
  - Served with our own `Content-Type`, `X-Content-Type-Options: nosniff` and `Content-Disposition: inline`.
- **Access.** Images are not public URLs. They are served by an endpoint that applies the same checks as the message
  list (customer: link check and the order must be theirs; staff: `OrdersRead`), either streaming the file or issuing a
  short-lived signed URL (a few minutes). Once the message is deleted the URL stops working.
- **Rate limiting.** Tighter than text (for example 5 images per minute and 30 per day per customer) using the existing
  `order-chat-policy` partitions; the "ten messages before the shop replies" rule counts images too. Read-only
  conversations accept no images, same as text.
- **Database.** New script `tools/sql/<date>_add_conversation_message_images.sql`: `ConversationMessages.ImageId` (null
  FK to `Images`) or its own table (blob key, content type, size, width, height); `Body` may be empty when an image is
  present (the rule becomes "text or image"). Then rescaffold.
- **API.** Staff and customer send endpoints accept `multipart/form-data` (file plus optional text); a GET for the image
  on each side; a larger request size limit on those endpoints only. Message DTOs get `imageUrl`, `imageWidth` and
  `imageHeight` (so the layout does not jump). The staff push says "Sent a photo" when there is no text.
- **UI.** Attach button in the shared chat component (file picker, camera on phones), a preview with Remove before
  sending, client-side type and size checks that use the server's messages (convenience only), progress and error
  state on the bubble, tap an image to see it larger. Images load lazily and are never stored on the customer's device
  (same rule as the rest of the public page).
- **Abuse.** Audit uploads that look hostile (wrong magic bytes, oversized), not every image. Staff can remove one
  message's image (the picture is deleted, a "photo removed" line stays).
- **Tests.** Wrong type renamed to `.jpg`, SVG, oversized file, oversized dimensions, corrupt image, a disguised
  executable, metadata gone after re-encode, rate limit, read-only conversation, another customer's order is 404, revoked
  link is 404, viewer role cannot send, response headers; front end: attach, preview, remove, error messages.

### Automatic message expiry [Completed]

**Implemented** (`ChatMessageExpiryService` and `ChatMessageExpiryScheduler` in `Features/Conversations`), settings under
`ChatRetention`. Differences from the plan below:

- **Same cold-start handling as the image cleanup.** Both daily jobs now share `DailyCatchUpScheduler`: a pass on startup
  and at least every 30 minutes asks "past the run time and not run today?" using the last run saved in report storage
  (`system/chat-message-expiry.json`), so a sleeping app catches up when it wakes. Run time is 03:00 Manila.
- **Rule.** A message goes `MessageDays` (default 90, `0` = keep for ever) after it was sent, but only when its order is
  Completed, Cancelled or Refunded (a chat with no order expires by age). Open orders (waiting or accepted) keep their chat.
  System lines ("Order accepted") expire with the rest. Orders are never changed.
- **Pictures.** The picture file is deleted first, then the message, in batches of `BatchSize` (500). A picture that cannot
  be deleted leaves its message for the next run; the rest of the run goes on. A conversation left empty is deleted too.
- **Safety.** `DryRun` (on in `appsettings.json`), `MaxDeletesPerRun` (5000), no audit entry (a background job has no
  user; each run is logged and saved as JSON), nothing at all when `MessageDays` is `0` or `Enabled` is false.
- **People are told.** `OrderConversationDto.retentionDays` drives a line in both chats: "Messages are deleted after N days
  once the order is finished."
- **Not built:** a live push so an open envelope drops expired chats at once; they disappear on the next refresh or open.
- Tests include a real SQL Server one (`ChatMessageExpiryDatabaseTests`).

Original plan:

- **Setting.** `ChatRetention:MessageDays` (default 90, `0` = keep forever), counted from each message's `CreatedAt`.
  A setting, not hard-coded; a change applies at the next run.
- **Hosted service** (`ChatMessageCleanupScheduler`, same pattern as the workbook scheduler, daily). Deletes messages
  older than the limit in small batches (for example 500 per statement) so a large backlog does not lock the table, and
  removes the message's image file at the same time (blob first, then row, so a failure leaves a row to retry instead of
  an orphan; Stale Image Cleanup is the safety net).
- **Conversations.** A conversation left with no messages is deleted too, so the envelope list shows no empty threads;
  the "Chat with the shop" card then starts a new one. Unread counts and the envelope update through the existing
  SignalR events, and an open chat drops deleted messages on its next refresh.
- **Order records are unaffected.** Deleting chat never changes an order, its status or its history. The system lines that
  record order changes ("Order accepted") are chat messages too; recommended: they expire with the rest, because the
  audit log is the permanent record.
- **Decisions (confirmed).**
  - Chats of orders that are still open (waiting or accepted) are kept regardless of age; messages expire only once the
    order is Completed, Cancelled or Refunded, counted from each message date.
  - The limit is shown to users ("Messages are deleted after 90 days"): a line in the staff panel and on the customer sheet.
- **Safety.** Dry-run on the first run, a cap per run, one audit entry per run with the counts, and no deletion at all
  when the setting is `0`.
- **Tests.** A message exactly at, before and after the limit; the open vs closed order rule; image blob removed with
  its message; empty conversation removed and non-empty one kept; `0` disables; batch limit; one failing blob delete does
  not stop the run; a real SQL Server test for the batch delete.

Suggested order: Stale Image Cleanup first (it also protects the chat images), then message expiry, then chat images.
