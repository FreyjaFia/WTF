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

