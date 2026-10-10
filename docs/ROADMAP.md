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

## Automated Testing Plan [Planned]

Goal: cover both the API and the POS app with automated tests, run on every push.

### Layout

```
src/
  WTF.Api/
  WTF.Domain/
  WTF.Tests/        <- new API test project (sibling of Api/Domain, added to WTF.slnx)
  wtf-pos/          <- specs live beside their source files (*.spec.ts)
```

### Test Types

- **Unit**: one class/function in isolation (pure helpers, validators, pipes, guards).
- **Integration**: several parts together, in-process (endpoint + auth + EF + real SQL Server).
- **E2E** (later, optional): real browser driving the running app (Playwright), main flows only.

### API (`WTF.Tests`)

Handlers use `WTFDbContext` directly, so mocking the DbContext tests very little. The API
leans on **integration tests against a real SQL Server**; unit tests cover pure logic only.

- Stack: xUnit, NSubstitute, Shouldly, `Microsoft.AspNetCore.Mvc.Testing`.
- Database: **TBD** (LocalDB vs Docker/Testcontainers vs InMemory/SQLite). Docker is not
  installed on the dev machine; LocalDB is the current recommendation.
- Shared `WebApplicationFactory` fixture; Azure Blob, FCM and Huawei replaced with fakes
  (`IImageStorage` and `IReportFileStorage` already exist as interfaces).
- JWT helper that mints tokens per role; per-test data reset.
- Folders mirror the API: `Features/Auth`, `Features/Orders`, ..., plus `Common/` and
  `Infrastructure/`.

| Phase | Area                                                                 | Why                          |
| ----- | -------------------------------------------------------------------- | ---------------------------- |
| 1     | Auth: login, refresh token, role guards                              | Security                     |
| 2     | Orders: create, update, void, batch (offline sync)                   | Money, stock, loyalty        |
| 3     | Promotions: `EvaluatePromotionsHandler` and the three validators     | Complex pricing rules        |
| 4     | Soft delete / restore for products, items, links; add-on overrides   | Recently changed behavior    |
| 5     | Users, customers, audit log entries                                  | CRUD plus rules              |
| 6     | Reports and dashboard                                                | Aggregation correctness      |

Open item: order/promotion math is embedded in large handlers (`CreateOrderHandler`,
`UpdateOrderHandler`). Consider extracting it into a small calculator class so it can be
unit tested directly (decision pending).

### Angular (`wtf-pos`)

Vitest via `ng test`. **Every file with logic or a template gets a spec** (no area skipped):

1. Guards, interceptors, pipes, utilities, constants and messages.
2. All services in `core/services` (HTTP services via `HttpTestingController`).
3. All shared components (charts, icons, badges, dialogs, cart drawer, order receipt, ...).
4. All feature pages: login, dashboard, not-found, orders, inventory (items, stock-in),
   management (products, customers, users, promotions, reports, audit logs, schema scripts),
   each with list, details and editor views.

Depth per file keeps this maintainable:

- Simple components: smoke test (renders) plus key interactions.
- Logic-heavy ones (order editor, checkout modal, cart drawer, promotion editor, offline
  sync): thorough tests.
- Shared fakes and a `provideTestingDefaults()` helper keep specs short.

Work is done in batches by area, running `ng test` and committing after each batch.

### Applying the Plan to New and Existing Files (Rules, Not a Snapshot)

This plan may be implemented later, after more files have been added. The lists above are
examples as of writing; the **rules below are what to follow**, so the plan applies to any
file that exists when the work starts and to every file added afterwards.

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

**Keeping it enforced (optional, add after the baseline exists):**

- CI fails the build when tests fail.
- A small script (or CI step) lists source files without a matching spec/test and reports
  them, so gaps from new files are visible.
- Optional coverage thresholds (start low and raise gradually) rather than a one-time big-bang.

### CI

Run `dotnet test` and `ng test` on every push. If Docker/Testcontainers is chosen, the
runner must support Docker; if LocalDB is chosen, a Windows runner is required.

---

## Customer Ordering Links Feature [Planned]

Let selected customers place orders themselves through a personal link, without logging in
to the POS. Staff control which customers get a link and can set an end date so links expire.

### Behavior

- On the **customer details page**, a staff member with the right role can:
  - enable/disable "Allow ordering link" for that customer (opt-in per customer; default off)
  - generate a link, optionally with an **end date** (no end date = never expires)
  - see existing links with status (Active / Expired / Revoked), created by, last used
  - copy, revoke, or regenerate a link
- Only customers with ordering enabled can have links generated.
- Opening a link shows a public ordering page (catalog, cart, submit) scoped to that customer.
- Expired, revoked, or unknown tokens show a friendly "link no longer valid" page (reuses the
  404-style layout); the response does not reveal whether the token ever existed.
- Disabling ordering for a customer immediately invalidates all of their links.

### Open Questions

- Do submitted orders go straight into the normal order flow, or into a "pending approval"
  state that staff must confirm?
- Payment: pay on pickup/delivery only, or online payment later?
- Can a link be used for multiple orders until it expires, or is it single use?
- Should the public page show the full catalog or a restricted list/price set per customer?
- Notifications: push/SignalR alert to staff when a link order arrives (existing infra can be reused).

### Database Changes

Reuse or extend the existing `ShortLink` entity (currently `Token`, `TargetType`, `TargetId`,
`TargetUrl`, `ExpiresAt`) with a new `TargetType = "CustomerOrder"`, adding:

- `RevokedAt` (nullable), `CreatedAt`, `CreatedBy`, `LastUsedAt`
- `Customer.AllowOrderingLink` (bool, default false)

Order-side: `Order.Source` (POS / CustomerLink) and `Order.OrderLinkId` (nullable FK) to trace
where an order came from.

### API

Staff endpoints (authenticated, role-gated, audited):

- `PUT /api/customers/{id}/ordering-link-access` - enable/disable
- `POST /api/customers/{id}/ordering-links` - generate (body: optional `expiresAt`)
- `GET /api/customers/{id}/ordering-links` - list with status
- `DELETE /api/customers/{id}/ordering-links/{linkId}` - revoke

Public endpoints (anonymous, token-based, rate limited like the existing `loyalty-policy`):

- `GET /api/public/order-links/{token}` - validate; returns customer display name + catalog
- `POST /api/public/order-links/{token}/orders` - submit an order

### Security

- Tokens must be long and cryptographically random (e.g. 32 bytes from
  `RandomNumberGenerator`, URL-safe). The existing 8-character `System.Random` token in
  `GenerateShortLinkHandler` is not suitable for this feature.
- Store only a hash of the token if links never need to be re-displayed; otherwise store it
  but never log it.
- Validate on every request: token exists, not revoked, not expired, customer active and
  ordering enabled.
- Strict rate limiting per token and per IP; server recalculates prices and promotions
  (never trust client totals); cap items per order.
- All link creation, revocation and link-originated orders are written to the audit log.

### Frontend

- Customer details page: new "Ordering link" section (toggle, generate with optional end
  date picker, links table with copy/revoke).
- New public route (outside `authGuard`/`LayoutComponent`), e.g. `/order/:token`, with a
  mobile-first catalog, cart and confirmation screen.
- Invalid/expired state page.
- Permissions: new roles/role-group entries for managing ordering links.

### Phases

1. Data model + staff endpoints + customer details UI (generate, expire, revoke).
2. Public validation endpoint + public ordering page (read-only catalog, cart).
3. Order submission, staff notification, and approval flow (per open questions).
4. Reporting: filter/report orders by source; usage stats per link.

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
