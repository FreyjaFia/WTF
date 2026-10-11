# WTF POS - Feature Roadmap

This document tracks planned features, their phases, and implementation
details. It serves as context for AI assistants (Copilot, Codex, ChatGPT)
and human developers.

---

## Offline Feature (Phases 1-5)

Enable the POS app to function without a network connection.

| Phase | Name                          | Status      |
| ----- | ----------------------------- | ----------- |
| 1     | Connectivity & Cart Persistence | [Completed] |
| 2     | Catalog & Image Caching       | [Completed] |
| 3     | Offline Order Queue           | [Completed] |
| 4     | Edit Pending Offline Orders   | [Completed] |
| 5     | Batch Sync & Advanced Offline | [Completed] |

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
- Re-introduce order-time stock handling, currently removed: deduct linked
  stock when an order becomes Completed (on create and on update), restore it
  when a completed order is voided, and decide whether insufficient stock
  should block completion. Record the product (and order line) on each
  sale deduction movement so per-product ingredient/cup usage reports stay
  accurate after link edits.
- Remaining hard deletes (decision pending): promotion child rows (rules and
  bundle items are deleted and recreated on every promotion save), order lines
  (deleted and rebuilt when an order is edited), and replaced or removed images
  (the stored file and image rows are deleted).

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

| Phase | Name                           | Status       |
| ----- | ------------------------------ | ------------ |
| 1     | Core Reports + Export UX       | [Completed]  |
| 2     | Monthly Workbook Automation    | [Completed]  |

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

### Sales Reporting Remaining Work

- None for current approved scope (Phases 1-2 complete).

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
  - `POST /api/pos/promotions/evaluate`
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


---

## Automated Testing Plan [In Progress]

Goal: cover both the API and the POS app with automated tests, run on every push.

**Scope decision:** unit tests only for now. Integration tests (a real database, a running API, or a
browser) are deliberately deferred; the cases that need them are listed under "Needs a real database".

### Status (as of 11 Oct 2026)

| Area | State |
| --- | --- |
| API unit tests (`src/WTF.Tests`) | **Done for everything that needs no database**: 299 tests. |
| Angular unit tests (`src/wtf-pos`) | **Every guard, interceptor, pipe, service, shared component and feature page has a spec**: 102 files, 1886 tests. |
| CI | **Done**: `test-api` and `test-frontend` jobs run on every push and pull request, and the build and SQL deploy jobs depend on them. |
| API handler tests | **Planned (next).** About 75 handler files and 10,000 lines have no tests. See "Next: handler tests". |
| Tests that need a real database | **Deferred.** See "Needs a real database". |
| E2E (Playwright) | Not started; optional. |

### Layout

```
src/
  WTF.Api/
  WTF.Domain/
  WTF.Tests/        <- API unit tests (Common/, Endpoints/, Features/, Services/), in WTF.slnx
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

### Next: handler tests (planned)

Handlers use `WTFDbContext` directly, so a mock of the context would test almost nothing. The plan is to run
handlers against **EF Core InMemory**: the handler's real queries run against actual tables held in memory,
with no SQL Server. (This adds one test package, `Microsoft.EntityFrameworkCore.InMemory`.)

| Phase | What | Needs a database stand-in? |
| --- | --- | --- |
| 1 | **Pricing and promotion rules**: fixed price vs percent, exact add-on matching, active date windows across time zones, bundle consumption in `EvaluatePromotionsHandler`. Test the pure helpers directly. | No |
| 2 | **Test setup**: a factory for an in-memory `WTFDbContext`, fakes for audit, push, the SignalR hub and the current user, and builders for users, products, orders and promotions. | Sets it up |
| 3 | **Orders**: create (totals, stock and loyalty effects, promotions), update, void, override (reason required, Completed only), batch. Highest risk: money, stock, loyalty. | Yes |
| 4 | **Auth**: login, refresh, logout, change password, me. Password checks, expired and revoked tokens, inactive users. | Yes |
| 5 | **Items, products, customers, users, promotions CRUD**: soft delete and restore, unique codes, add-on links, price history, audit entries, role limits. | Yes |
| 6 | **Reports and dashboard**: aggregations, time zone boundaries, the monthly workbook. | Yes |

**Pricing math is duplicated three times.** `GetDiscountedUnitPrice`, `SatisfiesExactAddOns`,
`CalculateDiscountedUnitPrice` and `IsPromotionActiveOnLocalDate` exist in both `CreateOrderHandler` and
`UpdateOrderHandler`, and `EvaluatePromotionsHandler` has its own copies of two of them. If they drift, the
cart preview and the saved order can disagree on price. Plan: make the helpers `internal`, pin the current
behavior in all three places with tests, then merge them into one shared class with those tests proving nothing
changed. The pure rules in `EvaluatePromotionsHandler` (`ApplyFixedBundles`, `ApplyDiscountedProducts`) need no
database at all.

**Limits of the in-memory database:** it does not enforce keys or unique indexes, ignores transactions, does not
apply SQL Server defaults (`newid()`, `getutcdate()`, `sysdatetime()`) and matches text case-sensitively. Tests
account for these; anything that depends on them goes to the list below.

### Needs a real database (deferred)

These behaviors only exist in SQL Server, so they are not worth testing against the in-memory fake:

| Behavior | Where |
| --- | --- |
| Transaction rollback: a failed order in a batch undoes the earlier ones | Order batch sync, create order, create item |
| Unique and foreign key constraints: duplicate product code, SKU or barcode; missing references | Products, items, orders |
| `SqlException` handling (database duplicate error turned into a normal response) | Push token subscribe |
| Case-insensitive text search | List search filters |
| Values that rely on database defaults | Anywhere a handler leaves a column to its default |
| Two users saving at the same moment | Stock changes, order numbers |

Plan for when these are added (about 10 to 15 tests, in a separate "needs database" category):

- **Local:** the tests read `WTF_TEST_SQL`. If it is not set they use LocalDB (`(localdb)\MSSQLLocalDB`, already installed on the dev machine). Each run creates a throwaway database named `WTF_Test_<random>`, builds the tables from the EF model, and drops it afterwards. Leftover `WTF_Test_*` databases from killed runs are removed at the start of the next run. Nothing touches the real dev database.
- **CI:** the workflow starts a SQL Server container (`mcr.microsoft.com/mssql/server`) next to the test job and sets `WTF_TEST_SQL` to it (or uses Testcontainers). Ubuntu runners have Docker; the `deploy-sql` job already uses a Docker image. Expect about 20 to 40 seconds of extra start-up.
- **No database reachable:** these tests skip with a clear message, so `dotnet test` still works for anyone without SQL Server.
- Until then, keep these cases as skipped placeholder tests so the gap stays visible.

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
skipped for them). When the database tests above are added, the API job needs the SQL Server container.

---

## Customer Ordering Links Feature [Planned]

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
  they will pay (`AmountReceived`), so staff know how much change to prepare. Must be >= total.
  Tips are hidden on the public page.
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
  `OrderMetrics.ComputeOrderTotal` (`src/WTF.Api/Common/Orders/OrderMetrics.cs`).
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

Public page (`/order/:token`):

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
| 2     | Public validation, ordering page, My orders  | [Planned] |
| 3     | Order submission, approval, staff alerts     | [Planned] |
| 4     | Reporting by source and per-link usage       | [Planned] |
| 5     | Order chat (per order, SignalR both sides)   | [Planned] |

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

#### Phase 2 - Public validation, ordering page and My orders

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

#### Phase 3 - Order submission, approval, notification

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

#### Phase 4 - Reporting

- Filter orders and reports by `Source`; per-link usage stats (orders count, last used) in the
  customer details links table; check the monthly workbook and PDF/Excel labels.

#### Phase 5 - Order chat (one thread per order)

Customer and staff talk about a specific order (for example "is 5pm pickup ok?") before or after
approval.

- Database script `tools/sql/<date>_add_order_messages.sql`: `OrderMessages(Id uniqueidentifier,
  OrderId FK Orders, SenderType tinyint [Customer|Staff], SenderUserId FK Users null, Body
  nvarchar(1000), CreatedAt datetime2, ReadByStaffAt null, ReadByCustomerAt null)`, index
  `(OrderId, CreatedAt)`. Append-only; then rescaffold.
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

---

## Button States & Text Audit [Planned]

A cleanup pass over every button in the app, following `docs/BUTTONS.md` and the
`button-conventions.spec.ts` rules. To be reviewed before work starts.

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

- Automated tests for the override rules (role gating, pending/refunded rejection, price keep).

---

## Image Storage CORS [Planned]

Browser `fetch()` of Azure Blob images from `https://wtfbyfaith.runasp.net` is blocked
(`No 'Access-Control-Allow-Origin' header`), so the offline image cache
(`ImageCacheService`) and the receipt image conversion cannot download them on the web
build. Images still display normally through `<img>` tags.

- Fix is configuration, not code: add a CORS rule on the `wtfstorageacc` Blob service
  (Storage account -> Resource sharing (CORS)): allowed origins `https://wtfbyfaith.runasp.net`
  (plus any staging/dev origins), methods `GET, HEAD, OPTIONS`, allowed headers `*`,
  exposed headers `*`, max age `3600`.
- Android (Capacitor) builds are not affected the same way; verify after the change.
