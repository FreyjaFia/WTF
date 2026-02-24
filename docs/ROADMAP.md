# WTF POS — Feature Roadmap

This document tracks planned features, their phases, and implementation
details. It serves as context for AI assistants (Copilot, Codex, ChatGPT)
and human developers.

---

## Offline Feature (Phases 1–5)

Enable the POS app to function without a network connection.

| Phase | Name                          | Status      |
| ----- | ----------------------------- | ----------- |
| 1     | Connectivity & Cart Persistence | ✅ Completed |
| 2     | Catalog & Image Caching       | ✅ Completed |
| 3     | Offline Order Queue           | ✅ Completed |
| 4     | Edit Pending Offline Orders   | ✅ Completed |
| 5     | Batch Sync & Advanced Offline | ⏳ Pending   |

### Phase 1 — Connectivity & Cart Persistence ✅ Completed

- Ping-based connectivity detection (`ConnectivityService`)
- Offline banner in header when disconnected
- Cart persistence via IndexedDB/Dexie.js (`carts` table)

### Phase 2 — Catalog & Image Caching ✅ Completed

- Batch POS catalog sync endpoint (`GET /api/sync/pos-catalog`)
- `CatalogCacheService` — caches products, categories, subcategories,
  add-on types, and product add-ons in Dexie (`catalog` table)
- `ImageCacheService` — caches images as blobs in Dexie (`images` table),
  serves blob URLs for offline display
- Order editor reads from catalog cache when offline
- Header profile image cached for offline display
- Receipt logo uses `URL.createObjectURL(blob)` (fixes NG0913)

### Phase 3 — Offline Order Queue ✅ Completed

- `pendingOrders` table in Dexie (v4)
- `OfflineOrderService` — queue, syncAll, auto-sync on reconnect
- Order editor checks connectivity; queues order locally when offline
- Pending offline orders UI in order list (amber banner, status badges,
  Sync Now button)
- Order list hides synced orders table and pull-to-refresh when offline
- Cart cleared from IndexedDB on logout

### Phase 4 — Edit Pending Offline Orders ✅ Completed

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

### Phase 5 — Batch Sync & Advanced Offline ⏳ Pending

- **Batch create order endpoint:** `POST /api/orders/batch` accepting an
  array of orders, each with a `createdAt` field (UTC). The API processes
  all orders in a single request/transaction.
- **Frontend batch sync:** `syncAll()` sends pending orders in batches of
  5 to the batch endpoint, with the offline `createdAt` timestamp
  converted to UTC.
- **Retry with exponential backoff** for failed syncs
- **Stale catalog detection** — detect when product prices have changed
  since last catalog sync
- **Periodic background catalog refresh** when online
- **IndexedDB storage management** — clear old cached images

---

## Auto-Update Feature ⏳ Pending

Enable in-app update detection and APK download from GitHub Releases.

### Versioning Strategy

- **Single source of truth:** `package.json` `version` field
- Follow semver: MINOR bump for features, PATCH for fixes, MAJOR only
  for breaking changes
- `build.gradle` `versionCode` and `versionName` derived from
  `package.json` at CI build time
  - `versionCode = MAJOR * 10000 + MINOR * 100 + PATCH`
  - `versionName = "MAJOR.MINOR.PATCH"`
- Angular app gets version injected at build time via a generated
  `src/environments/version.ts` constant
- First release: `1.0.0`

### CI/CD Workflow (`main.yml`)

| Trigger           | What happens                                                    |
| ----------------- | --------------------------------------------------------------- |
| `push to main`    | Build API + Frontend + Android APK (CI check only, no deploy)   |
| `push tag v*`     | Build everything → Deploy to MonsterASP → Create GitHub Release |

- Deploy and Android jobs only run on tag pushes (`v1.0.0`, `v1.1.0`, etc.)
- GitHub Release auto-created with tag name as title, signed APK attached
- Tag format: `v{MAJOR}.{MINOR}.{PATCH}`

### Build-Time Version Injection

- CI step reads version from `package.json`
- Writes `versionCode` and `versionName` into `build.gradle`
- Generates `src/environments/version.ts`:
  ```typescript
  export const appVersion = '1.0.0';
  ```

### In-App Update Check

- **`UpdateService`** (`core/services/`):
  - On app startup + every 30 minutes, calls GitHub Releases API:
    `GET https://api.github.com/repos/{owner}/{repo}/releases/latest`
  - Compares `tag_name` against current app version
  - Sets `updateAvailable` signal with release info (version, download
    URL, release notes)
- **Update banner UI** (`shared/components/update-banner/`):
  - Non-blocking banner: "Update available: v1.1.0 — [Download]"
  - Download opens APK URL via Capacitor `Browser.open()`
  - User installs APK manually (standard Android sideload)
  - Optional: "Remind me later" dismissal

### Files to Change

| File                                    | Change                                         |
| --------------------------------------- | ---------------------------------------------- |
| `package.json`                          | Set version to `1.0.0`                         |
| `.github/workflows/main.yml`            | Split triggers, add release + version injection |
| `android/app/build.gradle`              | Read version from env var / variables.gradle   |
| `src/environments/version.ts` (new)     | Auto-generated version constant                |
| `core/services/update.service.ts` (new) | GitHub Release check + version comparison      |
| `core/services/index.ts`               | Export UpdateService                           |
| `shared/components/update-banner/` (new)| Update available UI component                  |
| `app.ts`                                | Inject UpdateService, show banner              |

---

## Audit Log Feature ⏳ Pending

Track every significant action in the system so the shop owner can see
who did what, when, and what changed. Useful for accountability,
troubleshooting disputes, and debugging.

### Database

New `AuditLog` table:

| Column        | Type           | Description                              |
| ------------- | -------------- | ---------------------------------------- |
| `Id`          | `GUID` (PK)   | Auto-generated                           |
| `UserId`      | `GUID` (FK)   | The user who performed the action        |
| `Action`      | `nvarchar(50)` | Enum-like: `OrderCreated`, `OrderVoided`, `ProductUpdated`, `UserLogin`, etc. |
| `EntityType`  | `nvarchar(50)` | `Order`, `Product`, `User`, `Customer`   |
| `EntityId`    | `nvarchar(50)` | The PK of the affected record            |
| `OldValues`   | `nvarchar(max)`| JSON snapshot of the entity **before** the change (null for create actions) |
| `NewValues`   | `nvarchar(max)`| JSON snapshot of the entity **after** the change (null for delete actions) |
| `IpAddress`   | `nvarchar(50)` | Optional — client IP                     |
| `Timestamp`   | `datetime2`    | UTC timestamp                            |

### Actions to Log

- **Orders:** created, status changed (e.g., `New → InProgress →
  Completed`), voided/cancelled, payment method changed, items modified,
  tips changed
- **Products:** created, updated (name, price, category, active toggle),
  add-on assignments changed, price overrides changed
- **Users:** login, logout, refresh token issued, password changed
- **Customers:** created, updated, deleted

### API

- `AuditService` — injectable service that handlers call to log actions.
  Captures `HttpContext.User.GetUserId()` and serializes before/after
  state as JSON.
- `GET /api/audit-logs` — paginated query with filters:
  - `userId`, `action`, `entityType`, `entityId`
  - `fromDate`, `toDate` (UTC)
  - `page`, `pageSize`
  - Returns `PagedResult<AuditLogDto>`

### Frontend

- New route: `/management/audit-logs`
- **Audit log viewer** with:
  - Date range picker
  - Filter dropdowns (user, action type, entity type)
  - Searchable by entity ID
  - Paginated table: timestamp, user name, action, entity type,
    entity ID, expandable diff (old → new values)
  - Click a row to see full JSON before/after in a side panel or modal
- Accessible from the management navigation menu

### Retention

- Configurable in `appsettings.json` (e.g., `AuditLog:RetentionDays: 90`)
- Background job or SQL agent job to purge old records

---

## Receipt & Kitchen Printing Feature 💡 Planned

Bluetooth/USB thermal printer integration for customer receipts and
kitchen order tickets.

**⚠️ Requires physical printer hardware for testing.** Development can
start with print preview UI and a mock print service. Actual hardware
integration happens when a printer is available.

### Printer Connection

- Evaluate Capacitor ESC/POS printer plugins (e.g.,
  `capacitor-thermal-printer`, `@nicecode/escpos`)
- Support connection types: **Bluetooth** (most common for mobile POS),
  **USB**, and **Network/IP** (for kitchen printers)
- `PrinterService` (`core/services/`):
  - `discoverPrinters()` — scan for nearby Bluetooth/network printers
  - `connect(printerId)` / `disconnect()`
  - `printReceipt(order)` — format and send receipt data
  - `printKitchenTicket(order)` — format and send kitchen ticket
  - `testPrint()` — send a test page to verify connection
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
1x Iced Latte (L)       ₱180
   + Vanilla Syrup        ₱30
1x Croissant             ₱120
-----------------------------
Subtotal                 ₱330
Tips                      ₱20
TOTAL                    ₱350
-----------------------------
Cash                     ₱500
Change                   ₱150
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
 ORDER #1042 — NEW
 2:30 PM — Cashier: Alain
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

## Sales Reporting Feature 💡 Planned

Downloadable sales reports to complement the existing real-time
dashboard. The dashboard shows live data; reports provide historical
analysis that can be exported and shared.

### API Endpoints

All under `/api/reports`. Require authentication and admin/manager role.

| Endpoint                        | Description                          |
| ------------------------------- | ------------------------------------ |
| `GET /api/reports/daily-sales`  | Revenue, order count, avg per day    |
| `GET /api/reports/product-sales`| Sales breakdown by product/category  |
| `GET /api/reports/payments`     | Breakdown by payment method          |
| `GET /api/reports/hourly`       | Sales distribution by hour of day    |
| `GET /api/reports/staff`        | Revenue and orders per staff member  |

**Common query parameters:** `fromDate`, `toDate` (required, UTC),
`groupBy` (day/week/month), `categoryId`, `subCategoryId`, `staffId`.

**Response format:** JSON array, but each endpoint also supports
`Accept: text/csv` header to return CSV directly, and
`Accept: application/pdf` for PDF (using a library like QuestPDF or
iTextSharp on the API).

### Report Types

1. **Daily Sales Summary**
   - Columns: date, total revenue, order count, average order value,
     tips total, void/cancelled count
   - Totals row at the bottom

2. **Product Sales Breakdown**
   - Columns: product name, category, subcategory, quantity sold,
     revenue, % of total revenue
   - Sortable by quantity or revenue
   - Grouped by category with subtotals

3. **Payment Method Breakdown**
   - Columns: payment method (Cash, GCash, etc.), order count, total
     amount, % of total
   - Useful for reconciling cash vs. digital payments

4. **Hourly Sales Distribution**
   - Columns: hour (6 AM, 7 AM, ..., 10 PM), order count, revenue
   - Helps identify peak hours for staffing decisions

5. **Staff Performance**
   - Columns: staff name, order count, total revenue, average order
     value, tips received
   - Date-filtered to a single day or range

### Frontend

New route: `/management/reports`

- **Date range picker** (presets: Today, Yesterday, This Week, This
  Month, Last Month, Custom Range)
- **Report type selector** — tabs or dropdown to switch between report
  types
- **On-screen preview** — render the report as a table/chart in the
  browser
- **Download buttons:** "Download CSV" and "Download PDF"
  - CSV: calls the API with `Accept: text/csv`, triggers browser
    download
  - PDF: calls the API with `Accept: application/pdf`, triggers browser
    download
- **Charts** (stretch goal) — bar/line charts using a lightweight
  library (e.g., Chart.js or ngx-charts) for visual summaries alongside
  tables

### Scheduled Reports (Stretch Goal)

- Configure daily/weekly email summary in management settings
- API background job generates the report and sends via email
- Configurable recipients and frequency

---

## Dynamic Catalog Management Feature 💡 Planned

Currently, product categories (`ProductCategory`), subcategories
(`ProductSubCategory`), and add-on types (`AddOnType`) are referenced
by integer IDs that map to hardcoded enums (`ProductCategoryEnum`,
`ProductSubCategoryEnum`, `AddOnTypeEnum`). Adding a new category or
add-on type requires a code change, database insert, and redeployment.

This feature makes them fully dynamic — managed through the UI with no
code changes needed.

### Database Changes

**`ProductCategory` table** — add columns:

| Column       | Type         | Description                           |
| ------------ | ------------ | ------------------------------------- |
| `SortOrder`  | `int`        | Display order in POS (lower = first)  |
| `IsActive`   | `bit`        | Soft delete — hide without removing   |
| `CreatedAt`  | `datetime2`  | Audit timestamp                       |
| `CreatedBy`  | `GUID` (FK)  | Who created it                        |
| `UpdatedAt`  | `datetime2?` | Last update timestamp                 |
| `UpdatedBy`  | `GUID?` (FK) | Who last updated it                   |

**`ProductSubCategory` table** — same new columns as above, plus:

| Column       | Type         | Description                           |
| ------------ | ------------ | ------------------------------------- |
| `CategoryId` | `int` (FK)   | Link subcategory to parent category   |

Currently subcategories are independent of categories. Adding
`CategoryId` creates a proper hierarchy: Category → Subcategory →
Product.

**`AddOnType` table** — add columns:

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

**Categories** — `/api/categories`

| Method | Route              | Description                        |
| ------ | ------------------ | ---------------------------------- |
| GET    | `/api/categories`  | List all (with subcategories)      |
| POST   | `/api/categories`  | Create new category                |
| PUT    | `/api/categories/{id}` | Update name, sort order        |
| DELETE | `/api/categories/{id}` | Soft delete (set `IsActive=false`) |
| PUT    | `/api/categories/reorder` | Batch update sort orders    |

**Subcategories** — `/api/categories/{categoryId}/subcategories`

| Method | Route                                          | Description        |
| ------ | ---------------------------------------------- | ------------------ |
| GET    | `/api/categories/{categoryId}/subcategories`   | List for category  |
| POST   | `/api/categories/{categoryId}/subcategories`   | Create             |
| PUT    | `/api/subcategories/{id}`                      | Update             |
| DELETE | `/api/subcategories/{id}`                      | Soft delete        |
| PUT    | `/api/subcategories/reorder`                   | Batch sort orders  |

**Add-On Types** — `/api/addon-types`

| Method | Route                | Description                        |
| ------ | -------------------- | ---------------------------------- |
| GET    | `/api/addon-types`   | List all (with rules)              |
| POST   | `/api/addon-types`   | Create with name + rules           |
| PUT    | `/api/addon-types/{id}` | Update name, rules, sort order  |
| DELETE | `/api/addon-types/{id}` | Soft delete                     |
| PUT    | `/api/addon-types/reorder` | Batch sort orders            |

### Frontend — Management UI

New routes under `/management/catalog/`:

**Categories page** (`/management/catalog/categories`):
- List all categories with their subcategories in a tree view
- Inline edit category/subcategory names
- Drag-and-drop or up/down arrows to reorder
- Toggle active/inactive with a switch
- "Add Category" and "Add Subcategory" buttons
- Delete confirmation modal — warn if products exist under it
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

### Frontend — POS Enforcement

Update the order editor's add-on selector to enforce the dynamic rules:

- Read `AddOnType.IsRequired`, `MinSelect`, `MaxSelect` from the
  cached catalog (synced via `PosCatalogDto`)
- **Required types:** Show a visual indicator (red asterisk) and
  prevent order submission until selection is made
- **Min/Max:** Show counter (e.g., "Select 2–4") and disable the
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

