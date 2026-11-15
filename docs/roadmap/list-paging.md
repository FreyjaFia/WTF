## List paging: infinite scroll for Orders, pagination for Management and Inventory [Built on branch `list-paging`, not merged]

**Pogi's decision (15 Nov 2026).**

1. **Order list: infinite scroll.** Rows load automatically as the person scrolls. No "Load more" button.
2. **Management and Inventory list pages: classic pagination** (page numbers, Previous and Next, rows per page).

Built on branch `list-paging` (15 Nov 2026). This file is the design plus the notes below; update it and the status row in `docs/ROADMAP.md` as phases land.

### Summary of what we found

*Checked against origin main `dcf7c83` (version 1.21.0) on 15 Nov 2026. Since the first draft, main moved Record Waste to its own pages (the waste sheet on the order list is gone; Waste is still a Load More list), and merged Senior and PWD, customer address and plan gating. Everything below still holds.*

The app is already half way there, which shapes the plan:

- **The order list already scrolls infinitely** (`order-list.ts`: an `IntersectionObserver` on a sentinel, `rootMargin` 300px, 20 rows a page, a small spinner at the bottom, no button). The real problem is that **status filter, date range, sort and the status counts all run in the browser over the pages loaded so far**. With 20 rows loaded, "Completed (3)" counts only those 20, "Last 30 days" only filters those 20, and sorting by total sorts only those 20. This is wrong as soon as there are more than 20 orders, and it will look worse once shops have a year of orders. Fixing this means moving status, date range and sort to the API, which is the bulk of the Orders work.
- **Users, Customers, Products, Promotions, Roles and Inventory Items all load everything in one call** and then filter, sort and count in the browser. No paging at all.
- **Pagination exists in one place already:** Audit Logs (`audit-logs.ts` and `.html`) has page size options (10, 25, 50, 100), "first to last of total", numbered pages with ellipses on desktop, "Page X of Y" on phone, and a sticky bar. It is page-local code, not a shared component. We lift it out and reuse it.
- **"Load More" buttons exist on Inventory Waste and Notifications.** Under the new decision, Waste becomes paginated like the rest of Inventory. Notifications is in neither group; see the open questions.
- The API already has a paged shape: `PagedResultDto<T>(Items, Page, PageSize, TotalCount)` (`WTF.Api/Common/DTOs/PagedResultDto.cs`, with a duplicate under `Features/Audit/DTOs`). Orders, Audit Logs, Waste, Item Movements and Notifications use `Page` and `PageSize` with a cap of 100.

### Current state of each list page

"Client" means the API returns the whole list and the browser filters, sorts and counts. "Server" means the API pages. Row counts are what we expect for a single coffee shop, to judge how much each page needs this.

| Page (route area) | Component | API call | Paging today | Sort / filter today | Counts today |
| --- | --- | --- | --- | --- | --- |
| Orders | `orders/order-list` | `GET /api/orders/paged` (`GetPagedOrdersQuery`) | Server, 20 a page, infinite scroll | Search and source on the server; **status, date range and sort in the browser over loaded rows**; default newest first | Status chip counts computed from loaded rows only |
| Users | `management/users/user-list` | `GET /api/users` | None (client) | All client; sort by name by default; role and status filters | Computed from the full list in the browser |
| Customers | `management/customers/customer-list` | `GET /api/customers` | None (client) | All client; status filter; search also matches address | Computed in the browser |
| Products | `management/products/product-list` | `GET /api/products` | None (client) | All client; category and status filters | Computed in the browser |
| Promotions | `management/promotions/promotion-list` | Three calls merged in the browser: fixed bundles, mix and match, discounted product | None (client) | All client; type and status filters | Computed in the browser |
| Roles | `management/roles/role-list` | `GET /api/roles` | None (client) | All client; built-in or custom filter | Computed in the browser |
| Expenses | `management/expenses` | `GET /api/expenses` | None; the handler caps at `MaxRows` | Client sort; filter drawer | Totals computed in `WTF.Calculations` |
| Audit Logs | `management/audit-logs` | `GET /api/audit-logs` (`GetAuditLogsQuery`) | **Server, numbered pagination (done)** | Filters on the server; client sort of the visible page | Total from the server |
| Waste Reasons | `management/waste-reasons` | `GET /api/waste-reasons` | None (client) | Client sort | None |
| Setup (categories, sub-categories, add-on types) | `management/setup`, `management/catalog` | Catalog setup endpoints | None (client) | Client sort | "N active" cards |
| Schema Scripts | `management/schema-scripts` | `GET /api/schema-script-history` | None (client) | None | None |
| Inventory Items | `inventory/items/item-list` | `GET /api/items` (includes product links) | None (client) | All client; stock status (ok, warning, critical) is computed in the browser from stock and limits | Computed in the browser |
| Stock Counts | `inventory/counts/stock-counts` | `GET /api/stock-counts` | None (client) | Client sort | Computed in the browser |
| Receiving | `inventory/receiving` | `GET /api/stock-receipts` | None (client) | Client sort | Computed in the browser |
| Purchase Orders | `inventory/purchase-orders` | `GET /api/purchase-orders` | None (client) | Client sort, status filter | Computed in the browser |
| Suppliers | `inventory/suppliers` | `GET /api/suppliers` | None (client) | Client | None |
| Ingredients | `inventory/ingredients` | Product and item links | None (client) | Client | None |
| Stock Attention | `inventory/stock-attention` | Stock attention service (live via SignalR) | None (client) | Client | Banner counts |
| Waste | `inventory/waste` | `GET /api/stock-waste` (`GetStockWastesQuery`) | **Server, "Load More" button** | Server filters, client sort | From the server |
| Item Movements (inside item details) | `inventory/items/item-details` | `GET /api/items/{id}/movements` | **Server, Page and PageSize** | Type filter | Total from the server |
| Notifications | `notifications` | `GET /api/notifications` | **Server, "Load More" button** | Kind and unread filters | Total from the server |
| Platform: Shops, Log | `platform/platform-tenants`, `platform-log` | Platform endpoints | Client | Client sort | None |

Every list uses `ListStateService` (`localStorage`, one key per page such as `orders:order-list`) to remember search, filters and sort. None remembers its scroll position or page number.

### Goals and non-goals

**Goals**

- The Orders list stays correct and fast with tens of thousands of orders: status, date range, search and sort are answered by the API; chip counts are true totals, not counts of loaded rows.
- Management and Inventory lists show 10, 25, 50 or 100 rows per page (default 25) with the same pagination bar everywhere.
- One shared pagination component and one shared scroll loader, in the existing POS look, so no page invents its own.
- Nothing about how a page looks or behaves changes for people who have few rows.

**Non-goals**

- No virtual scrolling. 20 rows a page loaded on demand is enough, and a long cache still stays well under a few thousand rows in memory in a normal shift.
- No change to reports, the dashboard, receipts or exports. Exports (Audit Logs PDF and similar) keep asking for everything.
- No change to the order editor, cart or product picker. They need the full catalog (and work offline), so they keep using the all-rows endpoints.

### The API paging contract

One contract for every server-paged list, so the Angular side needs one reader.

**Request (query string):**

| Parameter | Meaning |
| --- | --- |
| `page` | 1-based page number. Values below 1 become 1. |
| `pageSize` | Rows a page. Default 25 for Management and Inventory, 20 for Orders. Maximum 100. Zero or negative uses the default. |
| `sortBy` | One of a fixed list per endpoint (for example `name`, `status`, `createdAt`). Anything else is ignored and the default sort is used. Never put the value into a raw SQL string. |
| `sortDirection` | `asc` or `desc`. |
| `searchTerm` and the page's own filters | As today, applied before counting. |

**Response:** the existing `PagedResultDto<T>(Items, Page, PageSize, TotalCount)`. One copy of it (move the Audit one into `WTF.Api/Common/DTOs` and delete the duplicate, namespace-only change). Add nothing to it for pagination; the browser derives total pages as `ceil(TotalCount / PageSize)`.

**Stable sort (required).** Every ordered query ends with a tie breaker on the primary key (`ThenBy(x => x.Id)`), so two rows with the same name or the same timestamp never swap or repeat between pages. The default sort of each page keeps today's order (Orders newest first; Users, Customers by last then first name; Products and Items by name).

**Out-of-range page.** If `page` is past the last page (a row was deleted between loads), return the last page's rows and the real `Page` in the response, so the UI can correct itself. Do not return an empty page with a non-zero total.

**Where the logic lives.** The "what counts as a status", "stock status" and total rules stay in `WTF.Calculations` (CLAUDE.md rule). Paging and sort mapping is plumbing in the handler. One small shared helper (`PagingRequest` and an `ApplyPaging` extension in `WTF.Api/Common`) holds the clamp, skip and take so ten handlers do not each re-implement it. Tests for it live in `WTF.Tests`.

**Counts for filter chips.** Today chips such as "Completed (12)" are counted in the browser. With paging, a chip count has to come from the API, or it would only count the visible page. Two options:

- Return a `Counts` dictionary beside the page (for example `{ "active": 41, "inactive": 3 }`), computed with one grouped query using the same filters except the chip's own filter. This is the recommended option: one round trip per load.
- A separate `/counts` endpoint per list. More calls, simpler responses.

Recommended: a small wrapper `PagedResultDto<T, TCounts>` is not needed; add an optional `Facets` dictionary (`IReadOnlyDictionary<string, int>`) to the response, null when a page has no chips. The counts follow the other active filters, so the numbers always match what tapping a chip would show. Open question 4 asks whether chip counts should ignore the other filters (simpler, slightly less accurate).

**Orders specifics.**

- Status (single or several), date range (`from` and `to`, UTC instants built from the shop's local day, Asia/Manila), source, search, customer and `sortBy` of `orderNumber`, `createdAt` or `totalAmount`.
- **Sort by total** needs the total in SQL. The total comes from `OrderMetrics.ComputeOrderTotal` today (override prices and pending preview prices). Sorting by it on the server needs either a stored total column or a projection that mirrors the calculation exactly. This is the one real design risk in the plan, see the risks below. Recommended: first release supports sorting by order number and date on the server and keeps "total" sortable only for the rows already loaded, with the header showing a small hint, until a stored total is decided. Open question 1.
- Infinite scroll on a changing list: new orders arrive while someone scrolls (SignalR). With offset paging a new order pushes every row down by one, so the next page repeats the last row of the previous one. The browser removes repeats by order id when it appends a page, and `TotalCount` is re-read from each response. Keyset paging (a cursor of created time and id) removes the problem completely but only works for the default newest-first sort; recommended to keep offset plus id de-duplication and revisit if shops see gaps. Open question 2.

### How sorting and the filters drawer interact

Rule everywhere: **any change to search, a filter, the sort column or direction, or rows per page goes back to page 1 and, on Orders, back to the top.** Changing only the page number keeps everything else.

- Search keeps its 300 ms debounce (`app-search-input`), then reloads page 1.
- Filters apply from the drawer when the person closes it or taps Apply (as today on each page); one reload, not one per tap.
- Sort uses the existing `app-sort-header` component and `toggleSort`; the click sends `sortBy` and `sortDirection` to the API instead of sorting a local array. Arrow animation stays 200 ms ease-out.
- "Reset" in the drawer clears filters and reloads page 1.
- While a reload runs, the list keeps showing the old rows dimmed (opacity-60, `pointer-events-none`) instead of blanking, so the page does not jump. First load shows the existing centered spinner.
- A request that is still running when a newer one starts is cancelled (RxJS `switchMap`), so a slow old answer can never overwrite a newer one.
- Counts on filter chips come from the response `Facets` (above).
- The saved state (`ListStateService`) gains `pageSize` for paginated pages (Audit Logs already does this). The current page number is **not** saved to `localStorage`: it goes in the URL (below), so a stale page is not reopened days later.

### Orders: infinite scroll

Keep the existing component structure and make it correct.

- Reuse the sentinel idea but move it into a **shared scroll loader** (below) so other screens can use it later without copying the observer code.
- First page 20 rows; every next page also 20. The sentinel triggers a load 300 px before the end (as now).
- **No "Load more" button, ever.** The bottom of the list shows one of: a small spinner while loading, nothing while more rows exist, or an "end of list" line ("You are all caught up") once `loaded rows >= TotalCount`. The end line is plain muted text, no button.
- **Failure while loading a page:** show a small inline "Could not load more. Tap to retry" row at the bottom (a retry link, not a Load More button, because the person asked for no button for normal loading) and stop the observer firing again until retry or the next scroll away and back. Error text goes through the existing `AlertService` and `http-error-messages.ts` strings.
- **Empty state:** the existing "No orders found" card, plus, when filters or search are active, a "Clear filters" action in the same style.
- **Scroll position on back navigation.** Opening an order and coming back must land the person where they were. The list is rebuilt from the API, so two things are saved in `sessionStorage` (not `localStorage`, so it dies with the tab): the number of pages loaded and the scroll offset. On return, the list reloads pages 1 to N in one request (`pageSize = N x 20`, capped at 100, then the rest in follow-up requests) and then restores the offset. A small `ListScrollService` in `core/services` owns this. Reload with the browser or new tab starts at the top.
- **Refresh and pull to refresh.** Pull to refresh (`app-pull-to-refresh`) and the refresh button reload page 1 and scroll to top. They do not reload every loaded page.
- **Live updates (SignalR).** `mergeIntoList` keeps working: an updated order replaces its row; a brand new order is added at the top only when it matches the current status, date range and search (the same check the API applies, kept in `WTF.Calculations` or `shared/calculations` per the CLAUDE.md rule, tested against `calculation-cases.json`). Otherwise only the counts are refreshed.
- **Date grouping headers** ("Today", "Yesterday") stay. They work with infinite scroll as long as the sort is by date; for other sorts they are hidden (as the sort header state already implies).

### Offline behavior of the order list

The order list needs the API, so offline it cannot page. What must stay true:

- **Pending offline orders and held orders stay at the top**, above the paged list, outside the paging. They are not part of `TotalCount` and never move with scroll loading. The held-for-review banner and the "Pending offline orders" box keep their current place and their `max-h-[25vh]` inner scroll.
- **Going offline mid-scroll:** loaded rows stay visible and usable (opening a loaded order that was cached still works only if the detail is cached, as today). The sentinel stops asking. The bottom shows "Offline. Older orders load when you are back online." Reconnecting re-arms the observer and loads the next page (the existing `ConnectivityService` effect).
- **Reconnect after pending orders sync:** keep the existing flow (wait for sync to finish, then reload page 1). Reset to the top, because new orders from the sync belong at the top.
- **Offline cache.** The first 20 rows are not stored in IndexedDB today and this plan does not add it. Open question 3 asks whether the last loaded page of orders should be cached for a read-only offline view; recommended no for now, since the offline phases already hold pending sales.

### Management and Inventory: classic pagination

**Shared component `app-pagination`** (new, `shared/components/pagination`). It is the Audit Logs bar, lifted out unchanged in look and behavior:

- Sticky to the bottom of the list area (`sticky bottom-0 z-10`, `bg-surface`, `rounded-xl`, `shadow-lg`, `ring-1 ring-gray-100`), so it is reachable with 50 or 100 rows.
- Left: "Rows per page" select (10, 25, 50, 100) and "first - last of total".
- Right: Previous, numbered pages with ellipses on `sm:` and up, "Page X of Y" on phone, Next. Buttons are the existing `app-btn app-btn-secondary app-btn-sm`; the current page is `app-btn-primary`. `aria-label="Page N"` and `aria-current="page"` as now.
- Inputs: `page`, `pageSize`, `totalCount`, `pageSizeOptions`, `label` (for `aria-label` of the nav), `disabled` while loading. Outputs: `pageChange`, `pageSizeChange`.
- Hidden when `totalCount` is zero; shows only "first - last of total" when there is a single page and the page size is the smallest (so tiny lists do not get a bar that does nothing). Open question 5 asks whether a one-page list should hide the bar completely.
- The page number logic (`pageItems`) moves into a plain function in `shared/calculations` style helpers (`pagination.ts`) with a spec, instead of a computed inside a page.
- Audit Logs switches to the shared component in the same change that introduces it, so the component is proven on a page that works today.

**Page and URL.** The current page lives in the query string (`?page=3`) so a refresh, a shared link and the browser Back button all return to the same page. Opening a record and pressing Back returns to that page with the same sort and filters (these come from `ListStateService`). Changing a filter, search or sort drops `page` back to 1 (and removes it from the URL).

**Scroll on page change.** Going to another page scrolls the list container back to the top (smooth is not used, instant, so it does not fight the 200 ms animations). On Back navigation the page number from the URL is restored and the scroll offset is restored through the same `ListScrollService` as Orders.

**Rows per page.** Default 25, saved per page in `ListStateService` (not shared across pages, so Users and Items can differ). On phones the options and default are the same; the sticky bar stacks.

**Server and chips.** Each page below gets a paged endpoint using the contract above. The existing all-rows endpoints stay (the order editor, pickers, dropdowns and offline catalog cache use them).

### Shared scroll loader

New directive or small component `shared/components/scroll-loader` (name open). It owns the `IntersectionObserver`, the spinner, the end line, the error retry row and the offline note, so Orders does not hold that code and the next infinite list is a few lines:

- Inputs: `hasMore`, `isLoading`, `error`, `offline`, `rootMargin` (default `300px 0px`).
- Output: `loadMore` (fires at most once while loading; guards double firing).
- It uses the existing `loading loading-spinner loading-sm` classes and the muted gray text of the empty states. No button element in the normal path.
- The Orders page keeps its `ordersCache` and dedupe logic; the loader only decides when to ask.

### Loading and empty states

Follow the Users page and Setup (CLAUDE.md and the `setup-lists` notes):

- **First load:** centered `loading loading-spinner loading-lg` (as the order list does).
- **Reload for a new page, sort or filter:** keep old rows, dimmed, with a small spinner in the page's top bar; no layout jump.
- **Empty (no rows at all):** the shared empty-state card ("No orders found", "No users found").
- **Empty with filters or search on:** same card with the filter summary and a "Clear filters" action.
- **Connection failed (status 0):** the shared "Unable to connect" panel inside pull to refresh, as every Setup list does.
- **Error on a page change:** keep the current page, show the error through `AlertService`, and leave the pagination bar usable.
- **A page that is now empty (rows were deleted):** the API returns the last real page (contract above), the bar updates, no empty screen.

### Mobile and viewports (375, 820, 1440)

| Viewport | Orders | Management and Inventory |
| --- | --- | --- |
| 375 | Single column cards; spinner, end line and retry row full width; bottom bar of the app (dock) must not cover the sentinel: the sentinel sits above the dock padding | Pagination bar stacks: select and range on one row, then Previous, "Page X of Y", Next. No numbered buttons. The sticky bar sits above the dock (`bottom` offset follows the dock height) |
| 820 | Row layout as today | Numbered pages visible (`sm:`), bar in one line |
| 1440 | Table layout with sort headers; infinite scroll inside the page scroll | Full bar, numbered pages with ellipses |

Check explicitly: sticky column headers (`sticky top-0 z-10`) and the sticky pagination bar do not overlap; the filters drawer (`side-drawer`) is on top of both; the bar does not hide the last row (list has bottom padding equal to the bar height); pull to refresh still works (it only triggers at scroll top).

### Multi-tenancy

Multi-tenancy is always on. The EF global query filters on `TenantId` apply to every query, so a paged query and its `CountAsync` are both tenant-scoped automatically; no handler adds its own `TenantId` check. Rules for this work:

- Count and page come from the same filtered `IQueryable`, so `TotalCount` can never include another shop's rows.
- Any raw SQL, `IgnoreQueryFilters` or `FromSql` added for counts or the stock status calculation must keep the tenant filter (a code review item).
- The `Facets` counts go through the same filtered queryable.
- Tests: a two-tenant case for each new paged endpoint (tenant A with 30 rows, tenant B with 5: page counts and totals for B see only 5).
- Platform admin pages (`platform-tenants`, `platform-log`) are outside tenants and keep their own rules; they are in the last phase.

### Performance and database indexes

- **Orders:** the default list sorts by `CreatedAt` descending and filters by status and tenant. The paged query also does `Include` of items, products, add-ons and bundle promotions. With paging that is 20 orders, not all of them. Keep `Skip` and `Take` before the `Include`s (as the handler does now) so the heavy joins only run for the page. Search by order number uses `OrderNumber.ToString().Contains(term)`, which cannot use an index and scans; acceptable for pilot sizes, flagged for later (store a searchable text column).
- **Count queries:** `CountAsync` on a filtered set is the next cost. The facet counts are one grouped query rather than one per chip.
- **Candidate indexes** (verify first with `sys.indexes` and the actual query plans on the real database; only add what a plan shows is needed):
  - `Orders (TenantId, CreatedAt DESC, Id)` with `StatusId` included, for the default list and the status filter.
  - `Orders (TenantId, StatusId, CreatedAt DESC)` if status filtering is slow.
  - `Customers (TenantId, LastName, FirstName)`, `Users (TenantId, LastName, FirstName)`, `Products (TenantId, Name)` and `InventoryItems (TenantId, Name)` for the default sorts. `InventoryItems.Name` already has an index from phase 1 without `TenantId`; check how multi-tenancy changed it before adding another.
  - `StockReceipts`, `PurchaseOrders`, `StockCounts`, `Expenses` on `(TenantId, <date column> DESC, Id)`.
- **Script rules:** one new idempotent file in `tools/sql/` (next free date prefix at implementation time; the latest on main is `20261203_add_order_item_quantity_check.sql`, so for example `20261204_add_list_paging_indexes.sql`), each `CREATE INDEX` guarded with `IF NOT EXISTS (SELECT 1 FROM sys.indexes ...)`. Never edit old scripts. Run it on the real `WTF` database on `.\SQLEXPRESS` first, then `tools\dbsync.bat`. A cloud thread runs the script and dbsync against its own throwaway database and says which database it used. Keep the `dbsync.bat` scaffold output exactly as generated (delete only true duplicates the build needs, and say so). The cloud scaffold is not the source of truth; the real rescaffold runs on the laptop against `.\SQLEXPRESS`.
- **Inventory item stock status** (ok, warning, critical) is computed in the browser from stock levels and limits. To filter and count it on the server, the handler needs the on-hand total per item (a join or a view over movements or the cached stock column, whichever phase 1 introduced) and the rule from `WTF.Calculations` run in the query. This is the second real design risk; if it is heavy, Items keeps a client side filter for stock status inside the paged result, with a clear note, until the rule can be a SQL expression. Open question 6.

### Every affected page

Phase tags: P1 shared pieces, P2 Orders, P3 Management, P4 Inventory, P5 the rest.

| Page | Change | Phase |
| --- | --- | --- |
| Orders list | Server status, date, sort and chip counts; shared scroll loader; scroll restore | P2 |
| Users | Paged endpoint, `app-pagination`, sort and role/status filters on the server, chip counts | P3 |
| Customers | Same; search includes address | P3 |
| Products | Same; category and status filters | P3 |
| Expenses | Replace the `MaxRows` cap with paging; totals via `WTF.Calculations` over the full filtered set (not just the page) | P3 |
| Audit Logs | Swap its own bar for `app-pagination`; no behavior change | P1 |
| Promotions | Needs one combined endpoint over the three promotion kinds, or client-side paging (see below) | P3 |
| Roles | Client-side paging of the full list with the same component (roles are few) | P3 |
| Setup lists (categories, sub-categories, add-on types, waste reasons) | Client-side paging, hidden bar when one page | P5 |
| Schema Scripts | Client-side paging | P5 |
| Inventory Items | Paged endpoint; stock status question (above) | P4 |
| Stock Counts | Paged endpoint, status filter | P4 |
| Receiving | Paged endpoint | P4 |
| Purchase Orders | Paged endpoint, status filter and counts | P4 |
| Waste | Replace the Load More button with `app-pagination` (the endpoint already pages) | P4 |
| Suppliers, Ingredients, Stock Attention | Client-side paging of the full list | P4 |
| Item Movements (inside item details) | The endpoint already pages; use `app-pagination` | P4 |
| Platform: Shops, Log | Client-side paging (platform admin only) | P5 |
| Notifications | Not in Pogi's two groups; see open question 7 | P5 |

**Client-side paging for small lists.** For lists that will never be large (roles, setup lists, schema scripts, suppliers, platform shops), the API keeps returning everything and the same `app-pagination` component slices the array in the browser. The user sees the same bar. Cheaper than ten new endpoints, and trivial to upgrade to server paging later, because the component only needs `page`, `pageSize` and `totalCount`. Open question 8.

**Pages that must not page** (they need the full list): the order editor product grid, the customer dropdown, add-on and bundle selectors, product item link pickers, the offline catalog cache, reports and exports.

### Testing plan

Follows the CLAUDE.md rules: the throwaway database only (never `.\SQLEXPRESS` `WTF`), Playwright through the `playwright-skill`, the app on `localhost:4200` and the API on `localhost:5282`, browser time zone `Asia/Manila`, test accounts for the throwaway database only (never in chat or in the repo), scripts kept outside the repo unless asked.

- **Unit and API tests (in `WTF.Tests`):** the paging helper (clamp, skip, take, out of range), the page item (ellipsis) function in Angular, each paged handler (total, page boundaries, stable order with equal keys, sort whitelist, tenant isolation), order status and date filters against `calculation-cases.json` where a rule is shared. Run `dotnet test src/WTF.Tests` and `npx ng test --watch=false` from `src/wtf-pos`.
- **Seed data:** the throwaway database gets enough rows to cross every boundary: 61 orders (3 full pages plus 1), orders sharing the same timestamp, 55 customers, 30 users, 120 products, 80 items, mixed statuses, and a second tenant with a few rows.
- **Playwright, at least 3 workers**, with separate E2E tag, ports and stop file per run (`E2E_API_PORT`, `E2E_APP_PORT`, `E2E_DB_TAG`, `E2E_STOP_FILE` in `src/wtf-e2e/run.ps1`) so runs never overlap. No flaky tests (wait on responses and visible state, never fixed sleeps), no skipped tests.
- **Cases per paginated page:** first page shows 25 rows and "1 - 25 of N"; next, previous and numbered page; last page partial; rows per page change returns to page 1 and survives reload; search, filter and sort each reset to page 1 and the URL drops `page`; open a record, press Back, same page, sort and scroll; empty and filtered-empty states; the "unable to connect" state; no row appears on two pages; counts on chips equal what the chip shows when tapped.
- **Cases for Orders:** scroll to the bottom twice loads pages 2 and 3 with no button on the page; the end line shows at the end; no duplicate order rows; changing status, date range or sort returns to the top and reloads; back from an order detail restores position; a new order arriving over SignalR appears at the top and does not repeat a row later; going offline stops loading and shows the offline line, held and pending orders stay at the top the whole time, and reconnecting resumes.
- **Viewports 375, 820 and 1440** for each case above, with screenshots (sticky bar over the dock at 375, no overlap with sticky column headers at 1440).
- **Regression checks:** the order editor, cart and offline sales still use the full catalog; Audit Logs behaves exactly as before after the component swap.

### Phased rollout

Each phase ships on its own, in this order, and is checked with the full test suites and Playwright before the next.

1. **P1 Shared pieces.** `PagingRequest` and `ApplyPaging` helper, one `PagedResultDto`, `app-pagination` and `pagination.ts`, `ListScrollService`, shared scroll loader. Audit Logs switches to `app-pagination` (the proof; no visible change). No SQL.
2. **P2 Orders.** Status, date range, sort and counts on the API; scroll loader; scroll restore; the offline behavior above. Index script if the plans ask for it.
3. **P3 Management.** Users, Customers, Products, Expenses, Promotions, Roles. One list per commit.
4. **P4 Inventory.** Items, Stock Counts, Receiving, Purchase Orders, Waste, Suppliers, Ingredients, Stock Attention, Item Movements.
5. **P5 The rest.** Setup lists, Schema Scripts, Platform lists, Notifications (if chosen).

Throughout: linear git history (rebase or replay, never merge commits), commits as the repo owner's git identity, one concern per commit, a short update in the thread after each finished task, and the roadmap status row updated as phases land. Senior and PWD, customer address and plan gating are now merged into main (version 1.21.0), so this plan is based on origin main at `dcf7c83`. Offline Phase 7 and the kitchen view are not merged and both touch `order-list`; rebase onto latest main before each phase and check for conflicts with those branches.

### Risks

- **Sort by order total on the server.** The total is a calculation (override and preview prices), not a column. See question 1.
- **Stock status filter on Items.** Rule lives in the browser today. See question 6.
- **Counts that no longer match the visible rows** if chip counts are not computed with the other filters. Decided by question 4.
- **Dual maintenance of filter logic** (SQL and the SignalR "does this new order belong here" check). Mitigate by keeping the shared rule and cases in `calculation-cases.json`.
- **Large `pageSize` when restoring scroll** (many pages loaded). Capped at 100 and split into follow-up requests.
- **Conflicts** with branches that edit the same list components (offline Phase 7, plan gating, kitchen view).

### Open questions for Pogi

1. **Sort by total on Orders.** Store the order total in a column (needs SQL and a fill for old orders) so the server can sort by it, or keep "total" sortable only over loaded rows for now? Recommended: server sort for order number and date now; decide the stored total with the offline and Senior or PWD work.
2. **Orders paging style.** Offset with de-duplication (recommended, simple) or a cursor (no repeats, only for newest-first)?
3. **Offline view of old orders.** Cache the last loaded order page in IndexedDB for reading offline? Recommended no for now.
4. **Chip counts.** Counts that follow the other active filters (accurate, recommended) or counts for the whole list ignoring filters (simpler)?
5. **One-page lists.** Hide the pagination bar completely when everything fits one page at the default size, or always show "1 - N of N"?
6. **Inventory Items stock status filter.** Compute ok, warning and critical in SQL (more work, exact) or filter that one chip on the loaded page only until later?
7. **Notifications and Waste "Load More".** Waste becomes paginated (Inventory). Notifications is neither Orders nor Management or Inventory; make it infinite scroll like Orders (recommended, a feed) or leave the button?
8. **Small lists.** Client-side paging for roles, setup lists, schema scripts, suppliers and platform shops (recommended), or leave them unpaged since they are short?
9. **Default rows per page.** 25 (recommended) or keep Audit Logs' 10 for all lists?
10. **Branch for the build.** Start from latest origin main (`dcf7c83`, 1.21.0), or wait for Offline Phase 7 to merge first since it also edits the order list?


### Build notes (15 Nov 2026)

Built on branch `list-paging`, from main. No new SQL script was needed (no new indexes yet).

- **Server paging** (`PagedResultDto`, `/paged` endpoints, page in the URL, rows per page remembered): Orders (infinite scroll),
  Customers, Users, Products, Audit Logs, Items, Waste, Stock Counts, Receiving, Purchase Orders, Expenses, item stock history.
- **Notifications:** infinite scroll through `app-scroll-loader`.
- **Browser paging** (`ClientPager`, small lists): Roles, Suppliers, Ingredients, Promotions, Schema Scripts, Platform shops
  and log, Waste Reasons, Catalog lists.
- **Assumptions:**
  - Needs Attention is not paged. It is a live worst-first alert list and must show every low item.
  - Items keep the old three-state stock rule for their chips (ok, warning, critical).
  - Expenses sort by category uses the category id, not its name.
  - Users who cannot read costs get the cost/total sort ignored on the paged endpoints.
- **Not paged:** supplier details, the stock count sheet and the Setup hub.
- **Tests:** a `list-paging` E2E spec for Orders, Customers and Inventory lists. Existing E2E tests that look for a row now
  search first, because a shared test database holds more than one page of rows.
