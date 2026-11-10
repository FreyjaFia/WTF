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

### Where the rest lives

This feature is split by phase so a task opens only what it needs:

- [Phase 1: retail foundation and order-time stock deduction](inventory-phase1-stock.md): items, movements, links, deduction, adjustment, restore rules, deleting items, the pre-checkout stock label.
- [Phases 2-4 and the bell](inventory-phases2-4-alerts-notifications.md): pack and shared stock, consumables and coverage, alerts, reminders, Needs Attention, global notifications.
- [Phases 5-9](inventory-phases5-9-costing-profit.md): waste, costing and recipes (Ingredients & Cost), counts and variance, suppliers, profit reports and expenses.

### Polish pass before deploying inventory to production [Screens done 10 Nov 2026; setup and Android steps open]

Inventory is built and checked on throwaway databases, not yet on the live shop. Before it goes to production, do one
deliberate polish pass over everything built so far (Phases 1 to 4, the Needs Attention and Coverage screens, notifications,
the delete and restore rules, the pre-checkout stock label), so the first real day does not find the rough edges. Nothing here
is new work; it is the checklist for finishing and proving what exists.

**Status (10 Nov 2026, cloud run on a throwaway database):** every inventory screen (hub, items list, details and editor, Stock In, Needs Attention, Coverage, counts, reorder, purchase orders, receiving, waste, alerts, Suppliers) was opened as Owner, Admin, Stock Manager, Item Manager, Admin Viewer and Cashier at 375, 820 and 1440 px. No page scrolled sideways, no request failed, and each role was sent where its permissions say. Fixed: the sidebar now starts collapsed between 640 and 1023 px (the squeeze that made long item titles wrap one letter per line), and three controls on the item editor had no accessible name (Active toggle, product search and filter in the link dialog). Layout (95) and inventory (259) Playwright tests pass with 3 workers; the Angular suite passes (4,294). Still open: the Android check (stock-in form, POS stock warning, pull to refresh, bell), the live-shop data steps (opening counts, links, who is told), the production release steps, the open reminder choices, the "Record Waste" button sharing the trash icon with Delete on item details, and a second wording and contrast review in the Cafe style. Not checked on a copy of real data.

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

