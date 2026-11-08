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

