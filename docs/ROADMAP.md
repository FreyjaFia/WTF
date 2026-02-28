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
| 2     | Google Sheets Integration      | [Planned]    |
| 3     | Scheduled Reports              | [Planned]    |

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

### Phase 2 - Google Sheets Integration [Planned]

- Add a "Send to Sheets" action (do not generate local `.gsheet` files).
- File strategy:
  - create/use 1 spreadsheet per month (example: `WTF Sales Reports - 2026-02`)
  - create/use tabs per report type inside that file:
    - `Daily Sales`
    - `Product Sales`
    - `Payments`
    - `Hourly`
    - `Staff`
- Write strategy:
  - append rows to the target tab (do not create a new spreadsheet per export)
  - auto-create missing monthly spreadsheet/tabs on first write
  - include metadata columns on each write:
    - `GeneratedAtUtc`
    - `FromDate`
    - `ToDate`
    - `GeneratedBy`
    - `GroupBy`
- Reliability:
  - support idempotency key / dedupe guard to avoid accidental duplicate pushes
  - keep Excel/PDF export as fallback if Sheets push fails

### Phase 3 - Scheduled Reports (Stretch Goal)

- Configure daily/weekly email summary in management settings
- API background job generates the report and sends via email
- Configurable recipients and frequency

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





