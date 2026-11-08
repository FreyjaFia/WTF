### Phases 5-9 - Waste, Costing, Counts, Purchasing and Profit [Planned, added 20 Oct 2026]

What the foundation above still lacks to answer "what did we really earn?": a way to record loss, a cost for every unit,
recipes that turn a sale into ingredient usage, a way to compare the recipe with what the shelf says, and expenses.

| Phase | Name                                     | Needs first            |
| ----- | ---------------------------------------- | ---------------------- |
| 5     | Waste and spoilage (completed)           | Order-time deduction   |
| 6     | Costing and recipes                      | Order-time deduction   |
| 7     | Stock counts and variance                | Phase 6                |
| 8     | Suppliers, receiving and reordering      | Phase 1 stock-in       |
| 9     | Profit and margin reports                | Phases 5, 6 and 7      |

Recommended order: finish order-time deduction, then 5 (small, quick value), 6, 7, 9, with 8 whenever purchasing pain
shows up. Stock transfers between branches are under "Multiple Branches" (Phase 1 there).

#### Phase 5 - Waste and spoilage [Completed, 4 Nov 2026]

Closed 4 Nov 2026: `dotnet build` clean, `dotnet test` 2,752 passing (including the real SQL tests), `ng build` and `ng test`
3,844 passing (186 spec files). The earlier 13-test difference in the Angular count is moot: the suite has grown since and
nothing fails. Only the deploy step (run the SQL script, then the API, then the app) is left for release.

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
6. Change this heading to Completed once steps 1 to 4 pass, and note what was checked by hand. [Done, 4 Nov 2026]

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
  (4) prepared items and Produce batch, dropped on 1 Nov 2026 (built, then removed: the owner wants recipes to work out cost and profit, not to make stock in advance); (5) supplies allowance. Each slice ships on its own with tests and a hand check.

**Slice 1 built (30 Oct 2026; script `tools/sql/20261030_add_item_costing.sql`, run it before deploying the API, then `tools/dbsync.bat`).** Costs are per base unit and now keep six decimals (`Items.CostPrice`, `StockMovements.UnitCost` and the price history were `decimal(10, 2)`). `Items.AverageCost` is the moving weighted average: a stock-in with a cost blends it with what is on hand (an empty or negative balance starts again from the delivery; a stock-in without a cost leaves it alone), and a cost typed by hand in the editor restarts it. `Items.YieldPercent` (1 to 100, default 100) gives the cost per usable unit. Sales, voids, adjustments and waste record the average (or the last cost when there is no average) on their movement. The arithmetic is `CostRules` in `WTF.Calculations`. The new policy `InventoryCostsRead` (Super Admin, Admin, Admin Viewer) decides who sees `costPrice`, `averageCost`, `usableCost`, the price history and movement costs: for every other role the item endpoints return them empty, and their saves leave cost and yield alone. The item details page shows the average and usable cost; the editor has the usable share. Not done in this slice: a live preview in the Angular editor (it shows server values), and the Reports that show costs stay with Reports roles, which already can see them.

**Slice 2 built (31 Oct 2026; script `tools/sql/20261031_add_recipe_allowance.sql`, run it before deploying the API, then `tools/dbsync.bat`).** A product's links to items are its recipe: `ProductItemLinks.QuantityPerSale` is the standard amount and the new `AllowancePercent` (0 to 100, default 0) adds a known, steady loss, so a sale uses quantity x (1 + allowance / 100), rounded to three decimals (`CostRules.EffectiveQuantity`). Every place that takes stock uses it: the sale deduction, the register's stock limits (the cart check) and the Needs Attention "enough for N sales". `GET /api/products/{id}/recipe-cost` (`InventoryCostsRead`) returns each line (effective amount, cost per usable unit, line cost), the total cost, the margin in pesos and in percent (`CostRules.RecipeCost`, `Margin`, `MarginPercent`). An item with no cost yet is counted as unknown, not free, and the answer says how many. The allowance is typed per linked product in Manage Links, and the product editor has a read-only Recipe cost card for the cost roles. Not in this slice: a live preview that follows unsaved edits (the card shows saved data), size-aware amounts and Replace mode (slice 3), and size add-on lines in the cost (they are linked to the add-on, not the product).

**Slice 3 built (1 Nov 2026; script `tools/sql/20261101_add_recipe_size_and_replace.sql`, run it before deploying the API, then `tools/dbsync.bat`).** A recipe now follows what is on the drink. **Replace mode:** a link on an add-on can name the item it replaces (`ProductItemLinks.ReplacesItemId`, add-ons only): with the Oat add-on on a Latte, the sale takes oat milk and skips the Latte's own dairy milk. A replaced link stays in the stock rules with a quantity of zero, so adding the add-on to a completed order gives back what the drink took before; an inactive replacing item still replaces and takes nothing. **Size scaling (built, then removed on 1 Nov 2026):** a Size add-on had a multiplier and recipe lines could be marked to scale with it; it was dropped in favor of the per-size amounts below (script `tools/sql/20261106_drop_scales_with_size.sql` drops `Products.RecipeMultiplier` and `ProductItemLinks.ScalesWithSize`, the multiplier endpoint, the Fill button and the checkboxes). The rule is `StockRules.Requirements` and `stockShortfalls` on the register, which run the same shared cases (`calculation-cases.json`, `stockShortfalls`); the register's stock limits carry `replacesItemId`. Manage Links has, for add-ons, a "Replaces" choice; the Recipe cost card shows the tag. Not in this slice: the recipe cost for a chosen size or add-on mix (the card shows the base recipe), and size add-ons that also change the base price of cost per size.

**Slice 5 built (3 Nov 2026; script `tools/sql/20261103_add_supplies_cost.sql`, run it before deploying the API, then `tools/dbsync.bat`).** `Products.SuppliesCost` is a fixed cost per sale for ice, straws, napkins and stirrers, added to the product's recipe cost without any stock movement (`PUT /api/products/{id}/supplies-cost`, new policy `InventoryCostsWrite` for Super Admin and Admin; the Recipe cost card shows and edits it). Not built: a supplies allowance per order (one amount for the whole order), which needs a place to keep shop-wide settings.

**Ingredients & Cost page (planned 31 Oct 2026, a full page instead of a card inside the product editor)**

The recipe card inside the product editor is cramped, and "Recipe" reads like a how-to guide (that name stays for the Drink Recipe Guide). In the app this
is called **Ingredients & cost**; the code and routes keep the word recipe.

- **Where.** Inventory > Ingredients & Cost (`/inventory/ingredients`); the Coverage tab folds into it ("Needs setup" becomes a filter). Cost, price and margin show
  only to the cost roles (Super Admin, Admin, Admin Viewer); Stock Manager and Item Manager see amounts only. Writing uses the existing item and product link policies.
- **List.** One row per product: price, number of ingredients, cost, margin, status (Ready, Some options missing, Not set up). Search, filters (All, Needs setup,
  Low margin), cards on phones. A row opens the full-page editor.
- **Add.** A "+ Add" button opens a product picker (search, grouped by sub-category, products with no ingredients first), then one step to add ingredient lines to all
  the ticked products at once ("Regular Cup, 1 pc" on twelve drinks). Add-only: a product that already has the ingredient is skipped and listed. One transaction, one audit entry.
- **Full-page editor (one product).** The ingredient lines (item, amount, allowance %, add-on rows with "Replaces"), supplies cost, a sticky live cost and margin summary that
  follows unsaved edits, copy from another product, and the size multiplier for size add-ons. The product editor keeps a read-only summary and a link here.
- **Amounts per size (decided 31 Oct 2026).** Products do not scale evenly with size, so each size gets its own flat amounts in a grid (rows are ingredients, columns are the
  sizes the product offers: Regular 200 ml, Large 300 ml, Jumbo 400 ml; an empty cell means the same as Regular). **This needs new storage:** a size add-on such as Large is one
  shared product used by many drinks, so an amount on its own link would hit every drink. The amounts are kept per drink and size in a new table
  (`ProductSizeAmounts`: product, size add-on, item, quantity), read by the same rules as every other recipe line: when the size is on the sale, that item uses the
  size amount instead of the drink's base amount (or on top of it when the drink has no base line for it, such as a Jumbo-only cup). "Scales with size" and the
  multiplier stay as a shortcut ("fill by 1.5") that fills the cells, and drinks that really scale evenly keep working as they do.
- **Preview.** A size and add-on picker beside the live cost and margin shows what one sale of that combination uses and costs (Large with oat and an extra shot), with
  the add-on prices in the margin. It saves nothing; it adds the saved lines the way a real sale does. Warnings: a size with no amounts or ingredient links set, an
  ingredient ticked "scales with size" when no size has a multiplier.
- **Rules and maths.** The size amounts go into `StockRules.Requirements`, the register's `stockShortfalls`, `GetPosStockLimits`, `OrderStockService`, the recipe cost and
  the new preview, with shared cases in `calculation-cases.json` run by both test projects; the cost preview is mirrored in `shared/calculations` (whole cents, costs with six decimals).
- **Slices, each tested and committed on its own.**
  - **A.** The list page, read only, with Coverage folded in (new `GET /api/products/ingredients` with cost and margin per product).
  - **B.** The full-page editor for base lines and supplies cost; the product editor's card becomes a summary and link; labels renamed. **Built 31 Oct 2026:** `/inventory/ingredients/:productId` (`GET/PUT /api/products/{id}/ingredients`), lines with amount, allowance, scales with size and (add-ons) Replaces, a sticky live cost and margin summary from `shared/calculations/recipe-cost.ts` (shared `recipeCost` cases), supplies cost for the cost roles, unsaved-changes guard, list rows link to it, and the product editor card keeps its content with an "Open full page" link. Not yet: removing the old card controls (multiplier, supplies) from the product editor.
  - **C.** Amounts per size: schema script, rules on both sides, deduction, register limits, the grid. **Built 31 Oct 2026** (script `tools/sql/20261104_add_product_size_amounts.sql`, run it before deploying the API, then `tools/dbsync.bat`; already run on the local `WTF` database). `ProductSizeAmounts` (drink, size add-on, item, flat quantity, soft delete) is read by `StockRules.Requirements` and the register's `stockShortfalls` (the same shared cases, `sizeAmounts`): when the size is on the sale that amount replaces the drink's own amount for that item (or adds the item when the drink has no line for it), ignores the allowance, and an add-on's "Replaces" still wins and gives zero. Used by the sale deduction (`OrderStockService`), `GET /api/pos/stock-limits` (`sizeAmounts`, blocking items only) and the recipe cost. The editor shows a grid (one column per size, sorted by price; an empty box means the drink's own amount). The Fill button and its size multiplier were removed on 1 Nov 2026.
  - **D.** The size and add-on preview picker and the warnings. **Built 31 Oct 2026**: `GET /api/products/{id}/recipe-preview?addOnIds=` works out one sale of the drink with the chosen size and add-ons through the same `StockRules.Requirements` (lines, cost per line, price with the add-on prices, margin, replaced items, warnings such as "Jumbo has no amounts of its own") and saves nothing. It works from the saved ingredients, so the card says "save first to see your changes". Cost roles only.
  - **E.** The "+ Add" picker and bulk add. **Built 31 Oct 2026**: `POST /api/products/ingredients/bulk-add` (up to 200 products, add-only: a product that already has the ingredient keeps its amount and is listed as skipped, a line switched off earlier comes back; one transaction, one audit entry). The list page's "+ Add" opens a drawer: products grouped by sub-category (those with no ingredients first), search, "pick all shown", then the ingredients to add. Admin, Super Admin and Item Manager (anyone who can write items).
  - **F.** Browser tests, hand check on a throwaway database, roadmap. **Done 31 Oct 2026**: `ingredient-sizes.spec.ts` and `ingredients-bulk-add.spec.ts` in `src/wtf-e2e`; hand-checked in the built-in browser on a throwaway database at 375, 820, 1024, 1440 and 1920 px (a Latte at 150 with Milk 200 ml at 0.15, Cup 4, Lid 1 and a Large amount of 300 ml: the Large preview read milk 45, total cost 50, price 180, margin 130 (72.2%), the Jumbo preview with no amounts of its own read 210 ml and the warning). Found and fixed on the way: below 1024 px the editor's single grid column grew to the size table's width (cards 416 px in a 375 px screen, Amount boxes cut off), the bulk drawer's item list refreshed itself forever when no item existed (a self-triggering effect), and the closed drawer left a second "Search products" box in the page (it now exists only while open). Closed 2 Nov 2026: the product editor's Recipe cost card is now read only (the supplies box moved to the full page only), and the Preview one sale box follows unsaved edits (`POST /api/products/{id}/recipe-preview` takes the draft lines, size amounts and supplies cost and runs the same `StockRules.Requirements`, so the maths stays in one place; it saves nothing). **Moved into the browser (2 Nov 2026):** the preview is now worked out on screen with no wait (`shared/calculations/recipe-preview.ts`, which mirrors `StockRules.Requirements` and the cost maths), the same way the order editor prices a cart. The edit endpoint now sends each add-on option's own recipe links (`AddOnOptions[].Links`, costs only for the cost roles) so the page has what it needs. Both sides run the same `recipePreview` cases in `calculation-cases.json` (add-ons, Replace, a size amount, zero size amount, the same item twice, replace over a size amount, unknown cost). The `POST /recipe-preview` endpoint stays as the authority (and as the tested counterpart), but the page no longer calls it. Checked in the browser against that endpoint on three size and add-on mixes (same cost and price), at 375, 640, 820, 1024 and 1920 px with no overflow; the size table is a little narrower so it fits a phone card. **Redesigned (1 Nov 2026): the "+ Add" bulk picker is now a centered dialog, not a side drawer.** Two columns on wide screens (1. which products, with search, pick all shown and sub-category groups; 2. what do they take, with the ingredient lines), stacked on phones, with a footer showing the counts, Cancel and the Add button; same behavior, test ids and API. Unit specs and the bulk-add browser spec pass; the viewport sweep (375 to 1920 px) is still to do. **Whole module restyled (1 Nov 2026):** every picker uses the new shared searchable `app-select-dropdown` (native selects are gone from the list, editor, preview and bulk dialog), the bulk dialog follows the other modals (no header Close, Cancel and primary at the standard size, shared search box), sub-category names read Non-Coffee through `formatSubCategoryName`, the list shows the sub-category under each name, the Add button matches the Items page, the editor shows a cost and margin chip on phones and clearer wording (Bigger sizes use more, Add an ingredient). Unit and browser tests updated; checked at 375 to 1920 px in the default style (cafe style not checked by eye).
  - **Zero size amounts and grouped preview (1 Nov 2026; script `tools/sql/20261105_allow_zero_size_amounts.sql`, run it before deploying the API).** A size amount of 0 means the drink does not use that ingredient in that size (a 16oz cup on a Large), so shared size add-ons no longer force a cup on other products. The Preview one sale box groups add-ons like the order editor (Sizes, Flavors, Sauces, Toppings, Extras) with + / - quantities; a repeated add-on id in `recipe-preview` counts as its quantity and the price follows.


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
- **Prepared items (sub-recipes), not wanted (decided 1 Nov 2026).** Syrup made from sugar and water, cold brew batch, espresso from beans, whipped cream: an
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

#### Phase 7 - Stock counts and variance (when real life differs from the recipe) [Slice 1 built, 2 Nov 2026]

**Slice 1 built (2 Nov 2026; script `tools/sql/20261107_add_stock_counts.sql`, run it before deploying the API, then `tools/dbsync.bat`; already run on the local `WTF` database).** Stock count sessions. `StockCounts` (name, status Open/Posted/Cancelled, blind or not, note) and `StockCountLines` (item, counted quantity, the balance shown when it was entered). `POST /api/stock-counts` starts a count of every active item (or a chosen list), `PUT /{id}/lines` saves counted numbers (empty clears one), `POST /{id}/post` and `/cancel`, `GET` list and one count (`StockMovementsRead`; starting, saving, posting and cancelling need `StockMovementsWrite`). Posting writes one `Count` movement (reference `StockCount`) per item whose counted quantity differs from what was expected, applied **on top of the balance at that moment** (`StockRules.AdjustmentDelta`, the same maths as an adjustment), so sales made after an item was counted are kept; a blind count hides the expected balance and the difference until it is posted; an item deactivated after counting is skipped; a posted or cancelled count cannot change, and two people posting at once apply it once (a guarded status update). Audited as `StockCountStarted`, `StockCountPosted`, `StockCountCancelled`. Screens: Inventory > Counts (start form and the list) and a count sheet (search, one box per item, Save Progress, Post Count and Cancel Count with confirmations, read only after posting with the difference per item). Checked by hand on a throwaway database at desktop and phone width: a blind count of two items, a sale of 10 between counting and posting (balance 190), counted 185 against 200 expected gave 175 with one `Count` movement. **Slice 2 built (2 Nov 2026; no schema change):** the Stock Variance report (Reports > Inventory, `GET /api/reports/stock-variance`, optional `itemId` and `tolerancePercent`, default 5; Excel, PDF and CSV like the others). It reads the stock ledger for the period: opening is the balance before the first movement, received is `AddStock`, expected use is sales minus voids (`Sale` + `SaleVoid`), waste is `Waste` + `WasteReversed` (refund waste included), and closing is the balance after the last movement. Actual use = opening + received - closing, and variance = actual - expected - waste, which works out to the net of the `Count` and `Adjustment` corrections made in the period (positive = more went than the sales explain). Percent is of expected use (blank when none), value uses the cost on those correction movements (blank if any lacks one), and an item is **Not counted** (no `Count` movement in the period), **OK** (within the tolerance) or **Check**. Rows are sorted by value so milk and beans come before napkins. The maths is `VarianceRules` in `WTF.Calculations`; the report is server-built, so there is no Angular copy. Checked on a throwaway database through the API, the Excel/PDF endpoints and the screen (a milk item: 1,500 received, 50 waste, count 70 ml short, so actual 120, variance 70, value 10.50). **Also checked:** a real sale and refund on the throwaway database (expected use 360, variance 80, 22.2%, value 12.00), the Excel, PDF and API outputs, every role (Super Admin, Admin, Admin Viewer read it; Cashier, Stock Manager and Item Manager get 403) on screen and by API, and phone width; 12 new browser tests in `tests/reports/stock-variance.spec.ts`. Full runs: .NET 2,751, Angular 3,843, browser suite 817, all passing. **Later the same day:** the monthly workbook gets a Stock Variance sheet (14 sheets); the PDF drops Opening, Received, Waste and Closing (as the other reports drop low-value columns) because 11 columns collided on a portrait page, checked by reading the PDF text; the date filter, and the contents of the Excel and CSV downloads, are covered by browser tests. **Not built:** per-item tolerance, branch and shift filters, and the recipe suggestion hint. **Not in slice 1:** variance report (slice 2), period opening and lock, an Admin approval above a tolerance, the recipe suggestion, cycle count presets and an offline count sheet. Browser specs added 2 Nov 2026 (`tests/inventory/counts`, 14 tests: posting on top of the balance, empty lines untouched, cancel, blind, roles, the screen flow, phone width).

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

#### Phase 8 - Suppliers, receiving and reordering [In progress, branch `inventory-phase-8`]

**Build order (slices).** 1 Suppliers and item-supplier packs (done). 2 Receiving (done). 3 Par levels (done) and the reorder list.
4 Purchase orders. Expiry and lots, returns to supplier, barcode scanning, units/storage/categories follow after these four.

**Slice 1 built (script `tools/sql/20261114_add_suppliers.sql`, then `tools/dbsync.bat`).**
- **Schema.** `Suppliers` (name unique, contact, phone, email, address, lead time days, payment terms, notes, active),
  `ItemSuppliers` (item, supplier, supplier's code, pack name, units per pack, pack price, preferred; unique per item and
  supplier; at most one preferred per item through the filtered index `UX_ItemSuppliers_Preferred` on `ItemId, IsPreferred`),
  `ItemSupplierPriceHistory` (every pack price change, with source Manual or Receipt).
- **Rules.** `PurchasingRules` in `WTF.Calculations`: unit cost from pack price, units from packs, price change percent,
  cheapest supplier. The first supplier of an item becomes preferred; asking for another preferred one moves the flag.
  Inactive suppliers keep their links but cannot get new items.
- **API.** `/api/suppliers` (list, get, create, update, deactivate, restore) and `/api/items/{id}/suppliers` (list, save
  link, remove link). Reads need `StockMovementsRead`, writes `StockMovementsWrite`; pack prices and unit costs are removed
  for roles that cannot read costs (`CostAccess`). Audit actions `SupplierCreated/Updated/Deactivated/Restored`,
  `ItemSupplierSaved/Removed`.
- **POS.** Inventory > Suppliers (list, add) and a supplier page (details, linked items with pack and price, link form).
- Tests: `PurchasingRulesTests`, `SupplierDatabaseTests` (real SQL), Angular specs for the service and both screens.
- **Tenancy.** All new tables carry `TenantId` (NOT NULL, FK to Tenants, default tenant #1), implement `ITenantOwned`
  (so the query filter, stamping, export and delete pick them up) and the supplier name is unique per shop.

**Slice 2 built (script `tools/sql/20261115_add_stock_receipts.sql`, run after the suppliers script, then dbsync).**
- **Schema.** `StockReceipts` (supplier, received date, invoice number, invoice total typed from the paper, note,
  `ClientRequestId` unique so a retry is not recorded twice) and `StockReceiptLines` (item, packs, units per pack, pack
  price, units added, unit cost, the movement written). A receipt is never edited.
- **Rules.** Recording a receipt writes one `AddStock` movement per line (reference `StockReceipt`), through the same
  guarded balance update, cost price history and weighted average as a plain stock-in. The pack seen on a delivery is
  remembered on the item's supplier link (first delivery creates it, a changed pack price writes history with source
  Receipt). `PurchasingRules.LineTotal` and `InvoiceDifference` tell whether the lines match the invoice; the shared cases
  `receiptLine` and `invoiceDifference` in `calculation-cases.json` are checked by both the API and Angular tests.
- **API.** `/api/stock-receipts` (list, get, record); costs are removed for roles that cannot read them.
- **POS.** Inventory > Receiving: the receipt list (tap a row for its lines) and a form with supplier, date, invoice,
  lines that prefill from the supplier's pack, running totals and the difference from the invoice total.


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

**Slice 3 built (script `tools/sql/20261116_add_item_par_level.sql`, then dbsync).**
- **Schema.** `Items.ParLevel` (nullable, not negative). An item with no par never appears on the reorder list.
- **Rules.** `ReorderRules` in `WTF.Calculations`: below par means on hand plus on order is under par; the suggested
  quantity is par minus on hand minus on order, rounded up to whole packs of the preferred supplier (whole units when no
  pack is known; a negative balance counts as empty); average daily usage is the net sales (sales minus voided sales) of
  the last 28 days over the days, and days of cover is on hand over that pace.
- **API.** `GET /api/reorder` (groups by preferred supplier, "No supplier set" last, with the estimated cost for cost
  roles only), `GET /api/reorder/par-levels`, `PUT /api/reorder/par-levels/{itemId}` (audited as `ItemParLevelChanged`).
- **POS.** Inventory > Reorder: the list per supplier with a Copy order button (plain text for a message to the
  supplier), and a Par levels panel to set them. Not built: the "reorder list ready" notification.

**Slice 4 built (script `tools/sql/20261117_add_purchase_orders.sql`, then dbsync).**
- **Schema.** `PurchaseOrders` (number per shop, status, expected date, note, who and when it was created, sent and closed),
  `PurchaseOrderLines` (pack, units per pack, pack price, packs ordered and received; one line per item) and
  `StockReceipts.PurchaseOrderId`. All tenant owned.
- **Statuses.** Draft, Sent, Partly received, Received, Cancelled. Only a draft can be edited. A draft or a sent order with
  nothing received can be cancelled; a partly received one can be closed (it becomes Received).
- **Rules.** `PurchasingRules.Progress` says nothing / partial / complete from the packs ordered and received, and
  `UnitsOnOrder` is the packs still to come times the pack size. Sent and partly received orders feed the reorder list's
  "on order", so a sent order stops the item being suggested again.
- **API.** `/api/purchase-orders` (list with status, supplier and open-only filters; get; create; create from the reorder
  list for one supplier; update a draft; send, cancel, close). Reading needs the stock read policy, writing the stock write
  policy; prices are hidden from roles that cannot read costs. A receipt can carry a `PurchaseOrderId`: the order must be
  open, from the same supplier, and the receipt may only list items on it.
- **POS.** Inventory > Orders (list with search, status filter and badges, create and edit a draft, confirm before send,
  cancel and close), a Create order button on each supplier group of the Reorder list, and in Receiving an "Against purchase
  order" choice that fills the lines with what is still to arrive. Checked in a browser on a throwaway database (Reorder to
  draft to sent to partly received, with the totals matching a hand count).
- **Style rule for Phase 8.** Inventory screens reuse the app's shared search box, refresh button, searchable dropdown,
  badges, confirm dialog and input styling.

#### Phase 9 - Profit and margin reports [Completed: Product Profit 1 Nov, Gross Profit 4 Nov, Expenses and P&L 4 Nov 2026]

"Net income" needs more than stock: it needs sales, cost of goods sold, waste, discounts and the **running costs** of the
shop. The POS can answer part of it honestly; the rest needs an expenses record. It is **management reporting, not
accounting or tax filing** (the app still stores no tax); the accountant's books stay the official ones.

**Built (1 Nov 2026): the Product Profit report** (Reports > Products, `GET /api/reports/product-margin`, Super Admin, Admin and Admin Viewer like every report; Excel, PDF and CSV). It takes the revenue of the product sales report (add-ons and bundles on their own rows, refunds taken out) and sets against it what the sales really cost: the cost comes from the stock movements each sale wrote (`Sale` and `SaleVoid`, quantity times the cost the item had at that moment), so it is the cost at the time of the sale and it already follows the size, the add-ons, Replace and the allowance; the per-sale supplies cost is added for each unit sold. A product sold alone and inside a bundle in one order has its cost split between the two rows by units (`ProfitRules.AllocateByUnits`). Each row says whether its cost can be trusted: **Known** (every unit sold has a cost), **Partly known** (some units were sold before stock tracking, or a movement has no cost: the cost is shown for the known part and no profit is claimed) or **No cost** (the product takes no stock and has no supplies cost: shown as "-", never as free). Profit and margin appear only for Known rows, and the totals add up only those. Not built: the expenses record, the profit and loss summary and the dashboard tiles (the rest of this phase).

**Built (4 Nov 2026; no schema change): the Gross Profit report and two workbook sheets.** Reports > Sales > Gross Profit (`GET /api/reports/gross-profit`, `groupBy` Day, Week or Month, Excel, PDF and CSV; Super Admin, Admin and Admin Viewer). Per period: net sales (the daily sales report), cost, *Profit (recipes)* (net sales less cost), waste cost, count variance cost, *Actual profit* (recipe profit less waste less count variance) and margin on actual profit. Cost is read as the Product Profit report does (the order's `Sale` and `SaleVoid` movements at the cost they carry, plus supplies cost per unit); waste (`Waste` and `WasteReversed`) and count corrections (`Count` and `Adjustment`) are placed in the day they were recorded, valued at the cost on the movement, and a surplus found on a count raises the profit. A refunded sale adds no revenue and its movements net to what stayed gone, which the refund's waste entry carries, so the cost is not counted twice. A day with waste but no sales gets its own row. The maths is `ProfitRules.GrossProfit`, `MovementCost` and `CostStatus` in `WTF.Calculations`; the report is server-built and the screen only adds the footer totals through the existing `summarizeProfit`. **Decision:** unlike Product Profit, a period is *Partly known* (profit still shown, status badge amber) when some units sold have no cost, and only *No cost* (profit shown as "-") when none has, because a day almost always includes an untracked item such as bottled water and a column of dashes would be useless. The owner reads the status next to the number. All sources are included (waste and counts have no source). The monthly workbook now has **Product Profit and Gross Profit sheets (16 sheets)**. Tests: rules, 13 handler tests (in-memory), one real SQL Server test, PDF columns, route and policy snapshots, workbook sheets, Angular definition specs. **Checked by hand (4 Nov 2026, throwaway `WTF_E2E_*` database, API 5290, built-in browser):** Milk 10,000 ml at 0.10 per ml, a Latte at 150 taking 200 ml, an untracked Water at 20; sold 3 Lattes and 1 Water, wasted 150 ml, counted 100 ml short. Hand answer: net 470, cost 60, recipe profit 410, waste 15, count variance 10, actual profit 385, margin 81.91%, status Partly known (the Water has no cost). The API, the screen tiles, the day card and the footer total all gave exactly that, and Product Profit agreed (Latte cost 60, profit 390; Water No cost). Month and Week grouping work, a bad `groupBy` or a missing date is a 400, Super Admin, Admin and Admin Viewer read it and Cashier, Stock Manager and Item Manager get 403, Excel and PDF download, the workbook has the 16 sheets, and the page has no sideways scroll at 375 px. Not checked: the PDF text (no reader on this machine), a day with a fully known cost, and the report in the cafe style.

**Built (4 Nov 2026; no schema change): price guidance in the Ingredients & Cost editor.** Under the cost box of a product (not add-ons, cost roles only) a Price guidance card takes the margin you want (default 70%, 0 to 99, remembered on this device) and shows the lowest price that reaches it, cost / (1 - target) rounded up to the centavo, with a green note when the current price already reaches it and an orange one saying how much too low it is. It follows unsaved ingredient edits live. The maths is `CostRules.PriceForTargetMargin` and `priceForTargetMargin` (`recipe-cost.ts`), both running the shared `priceForTargetMargin` cases. Checked: unit and shared-case tests, 10 browser tests (live follow, remembered target, no ingredients, Admin Viewer sees it, Item Manager sees no costs, phone, tablet and desktop width in both styles), full suites passing (.NET 2,795, Angular 3,876). **Not built:** a target margin stored per product or per shop, the dashboard alert when an ingredient cost rises and a margin falls below its target (it needs the stored target), and a button that applies the suggested price.

**Built (4 Nov 2026; no schema change): the Menu Engineering report.** Reports > Products > Menu Engineering (`GET /api/reports/menu-engineering`, same filters and roles as Product Profit; Excel, PDF and CSV; a sheet in the monthly workbook, now 17 sheets). It takes the Product Profit rows (add-ons and the Promotions bundles are left out) and sorts every product with a **full cost** into **Star** (popular, high margin), **Plowhorse** (popular, low margin), **Puzzle** (high margin, unpopular) or **Dog** (neither). *Popular* means a share of the units sold of at least 70% of an even share (0.7 divided by the number of rated products); *high margin* means profit per unit at or above the average profit per unit of everything rated (total profit over total units). A product without a full cost is **Not rated** and does not move anyone else's class, so a missing recipe never makes the menu look better than it is. Rows show quantity, share, profit per unit, profit, class and cost status, Stars first. The maths is `MenuEngineeringRules` in `WTF.Calculations`; the report is server-built and the screen only counts the classes for its tiles. Tests: 6 rule tests, 4 handler tests, one real SQL Server test, route snapshot, workbook sheet, Angular definition specs. .NET 2,788 and Angular 3,867 passing, `ng build` clean. **Checked (4 Nov 2026, throwaway `WTF_E2E_*` database, real API and app):** 4 browser tests in `src/wtf-e2e/tests/reports/menu-engineering.spec.ts` (a rated product with profit per unit 130, a product with no stock is Not rated, the cashier gets 403, the report opens as Admin and shows the product and 130.00). The four classes are asserted only in the handler tests, because the browser database is shared by parallel tests and a class depends on the whole menu. Also checked (4 Nov 2026, 10 browser tests): a refunded order does not change the profit per unit of the sales that stayed, add-ons and bundles are not listed, the category filter, the source filter, Admin Viewer on screen, and Stock Manager and Item Manager refused; the whole reports folder (116 tests) passes. By hand: Excel, PDF and CSV download, no sideways scroll at 375 px, and the cafe style looks right. Not checked: the PDF text, and the per-category popularity cutoff (the cutoff is one rule over everything shown). Not built: the dashboard view and price suggestions per class.


**Built (4 Nov 2026; no schema change): owner dashboard tiles.** Four tiles under the insights row, for the cost roles only (Super Admin, Admin, Admin Viewer; every other role gets `profit: null` and no tiles): *Gross margin* (actual profit margin, with a note when the cost is only partly known), *Waste* (waste cost as a share of stock used, `ProfitRules.WastePercent`), *Biggest count difference* (the Check item with the largest value in Stock Variance) and *Stock value*. They are worked out in `GetDashboardHandler` by running the Gross Profit, Stock Variance and Stock Status report handlers over the dashboard's own period, so each number equals its report; each tile links to that report. `ProfitRules.CombineCostStatus` merges the daily statuses. **Not built: "items below par"**, because par levels belong to Inventory Phase 8. Tests: rule tests, 4 handler tests, 3 Angular specs groups (52 dashboard specs), `src/wtf-e2e/tests/dashboard/profit-tiles.spec.ts` (roles, links, Admin Viewer, 375/820/1440 px in both styles). Full runs: .NET 2,808, Angular 3,880, dashboard browser folder 44, all passing.

**Built (4 Nov 2026; script `tools/sql/20261108_add_expenses.sql`, run it before deploying the API, then `tools/dbsync.bat`): expenses and the Profit and Loss report. This finishes Phase 9.** `Expenses` (date, category, amount, note, soft delete, audit columns). Categories are fixed in `ExpenseCategories` (Rent, Salaries, Utilities, Supplies, Marketing, Delivery, Payment fees, Other; Other needs a note). API `GET/POST /api/expenses`, `PUT/DELETE /api/expenses/{id}`, `POST /api/expenses/{id}/restore`, `GET /api/expenses/categories`; new policies `ExpensesRead` (Super Admin, Admin, Admin Viewer) and `ExpensesWrite` (Super Admin, Admin); audited as `ExpenseCreated`, `ExpenseUpdated`, `ExpenseDeleted`, `ExpenseRestored`. Screen: Management > Expenses (`/management/expenses`, sidebar link and tab) with a date range (this month by default), a category filter, a Show deleted switch, totals per category, and an add, edit, delete and restore flow; read only for Admin Viewer. Report: Reports > Sales > **Profit and Loss** (`GET /api/reports/profit-loss`, `groupBy` Day, Week or Month, Excel, PDF and CSV, a sheet in the monthly workbook, now 18 sheets). It runs the Gross Profit handler and places each expense in the period of its local date: **operating profit = actual profit - expenses** (`ProfitRules.OperatingProfit`). When the gross profit is unknown (no cost at all) no operating profit is claimed; a period with expenses and no sales gets its own row; deleted expenses are left out. It is an estimate for management, not accounting. **Not built:** a receipt photo, recurring expenses, a branch column, provider fees flowing in from Cashless Payments, and an operating-profit tile on the dashboard. **Checked:** 2,867 .NET tests (rules, handlers, real SQL Server, route and policy snapshots, workbook) and 3,918 Angular tests; browser tests in `src/wtf-e2e/tests/management/expenses.spec.ts` (API validation, create, edit, delete, restore and audit, every role, P&L by day, week and month, with sales, the screen flows, a long unbroken note and a huge amount at 375, 820 and 1440 px in both styles) and the security, layout, reports, dashboard and management folders all pass. Found and fixed on the way: a late answer to an older filter could replace the list (the page now drops the older request), and the management content wrapper lacked `min-w-0`, so a long unbroken word made every management page scroll sideways on desktop.


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

