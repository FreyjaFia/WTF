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
- Order creation no longer deducts inventory or blocks orders on low stock.
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

Remaining:

- Complete the stock-in workflow UI beyond the placeholder page.
- Add product editor inventory setup/linking UI (linking is currently only
  available from the item editor).
- Expose stock movement history and adjustment/correction workflows in the UI.
- Review report/dashboard inventory impacts after real usage data exists.
- Re-introduce order-time stock handling, currently removed. Detailed plan
  below.
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
  anything, so it restores nothing.
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

### Phase 2 - Pack, Box, and Shared Stock Selling [Planned]

- Allow multiple products to deduct from the same inventory item.
- Support configurable deduct quantity per product sale.
- Example:
  - `1L Oat Milk` sells for `PHP150` and deducts `1`.
  - `Oat Milk Box of 6` sells for `PHP850` and deducts `6`.
- Validate stock availability using the total required quantity.
- Show stock impact before saving product inventory mappings.

### Phase 3 - Consumables and Required Product Usage [Planned]

- Treat cups, lids, sleeves, milk, syrups, and other consumables as
  inventory items.
- Link products and required add-ons to consumables.
- Deduct consumables automatically when an order is completed.
- Support multiple required consumables per product or add-on selection.
- Progress: linking items to products and add-ons works from the item editor.
  Order-time deduction is currently disabled (see Phase 1 Remaining). Size cups
  are meant to be linked to the Size add-on (not the base product) to avoid
  double deduction once deduction returns.
- Example:
  - regular drink deducts `1 Regular Cup`
  - large drink deducts `1 Large Cup`
  - selected oat milk add-on deducts oat milk stock if configured

### Phase 4 - Inventory Alerts and Notifications [Planned]

- Notify assigned users or roles when inventory reaches warning or
  critical levels.
- Support per-inventory-item alert recipients or category-level defaults.
- Show warning and critical indicators in Management and POS where useful.
- Prevent duplicate alert noise by tracking last notification state.

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
| E2E (Playwright) | Not started; optional. |

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
