## Kitchen Orders View (Kitchen Board) [Planned, decisions open]

Added 11 Nov 2026. A screen only for the people who make the food and drinks. It lists the orders that still need making,
with every product, its add-ons, temperature (Hot / Iced) and notes, and nothing else (no prices, no payment). The kitchen
moves each order through its own steps. Those steps are **separate from payment**, because a drink is often handed over
before the order is paid (paid later, or the next day). An order that has been handed over must leave the kitchen view even
though it is still Pending for payment.

This file is the plan only. Nothing is built.

### Where things stand

- `Orders.StatusId` is about the order's life and money: Pending, Completed, Cancelled, Refunded, PendingApproval,
  PendingReview. Nothing says "the kitchen is making it" or "it was handed over". That is the gap.
- Customer-link orders already have `AcceptedAt` and `ReadyAt` (`MarkOrderReadyHandler`, customer sees "ready" on the
  public page). So a "ready" step exists, but only for link orders and only as a timestamp. The board reuses it.
- `StaffOrderHub` (SignalR, policy `OrdersRead`) already pushes "something changed" to the shop's staff group and the order
  list already refreshes from it. The board reuses it.
- `UpdateOrderHandler` edits a Pending order by **deleting and re-creating all its lines** (new line ids each save). So any
  state stored per line would be lost on every edit. This is the main reason for the order-level design below.
- `receipt-and-kitchen-printing.md` plans a printed kitchen ticket. The board is the screen version of the same idea; they
  share the same line layout and the "MODIFIED" idea, and neither needs the other.

### Recommendation: a kitchen state on the order, separate from the order status

| Option | What it means | Verdict |
| ------ | ------------- | ------- |
| Reuse `StatusId` (add "Preparing", "Served") | One field for payment and kitchen | No. The two move independently (served but unpaid; paid but not made). Every report and rule that reads `StatusId` (sales, "what counts as a sale", offline, refunds) would have to learn the new values |
| **Separate kitchen state on the order (recommended)** | A new column next to `StatusId`; the board filters on it; payment code never reads it | Matches Pogi's idea. Existing reports and sale rules stay untouched |
| Kitchen state per product line | Each line has New/Preparing/Ready | Not for the first version. Lines are re-created on every edit (see above), and a small shop moves a whole order at once. Revisit later (see "Later") |
| Hide old orders by date only | Board shows today's Pending orders | No. Cannot tell "handed over, unpaid" from "not made yet" |

### State model

`Orders.KitchenStatus` (nullable tinyint, a code enum like `Source`, no lookup table):

| Value | Name | Meaning | On the board? |
| ----- | ---- | ------- | ------------- |
| NULL | Not tracked | Old orders, orders made while the shop has the board off | Never |
| 0 | New | Order is in, kitchen has not started | Yes, column "New" |
| 1 | Preparing | Someone is making it | Yes, column "Preparing" |
| 2 | Ready | Made, waiting to be handed over | Yes, column "Ready" |
| 3 | Served | Handed over to the customer (or runner) | No (visible only under the "Served" filter) |

New columns on `Orders` (all nullable): `KitchenStatus`, `KitchenStartedAt`, `KitchenServedAt`, `KitchenUpdatedBy`, and
`KitchenChangeNote` / `KitchenChangedAt` (explained under "Editing"). **`ReadyAt` is reused as the Ready time for every
order** (today it is set only for link orders), so one timestamp means one thing. Prep time = `ReadyAt - CreatedAt` (or
`AcceptedAt` for link orders), the same arithmetic the customer-link report already does.

Why Served is a state and not "payment done": Pogi's case. The cashier or the kitchen taps **Served** the moment the drink
leaves the counter. The order may stay Pending for payment for days; it no longer shows in the kitchen. The reverse also
works: a prepaid order (Completed) stays on the board until it is Served. **Completing, paying or reopening an order never
changes the kitchen state.**

### When an order appears on, and leaves, the board

Appears: kitchen board is on for the shop, order `StatusId` is Pending, and `KitchenStatus` is 0 to 2.

- A POS order is saved with `KitchenStatus = New` (only if the shop turned the board on).
- A customer-link order gets `New` when staff **accept** it (`PendingApproval -> Pending`), not before.
- An offline order gets `New` when it reaches the server (sync). A held offline order (`PendingReview`) gets it when
  approved. See "Offline" below.

Leaves: `Served`; or the order is Cancelled / Refunded / voided (see "Cancel"); or it is **stale**.

**Stale rule (so nothing lingers forever).** An order still New/Preparing/Ready after the shop's local day ended (Asia/Manila,
same day logic the reports use) moves to a "From yesterday" strip at the top of the board, with a single **Clear old** button
(marks them Served). Nothing is cleared automatically: silently marking an unmade order Served would hide it from the
kitchen for good. The rule ("is this order on the board, is it stale") lives in `WTF.Calculations` as a small
`KitchenBoardRules` class, with its tests in `WTF.Tests`. The Angular side only displays what the API returns (the board
needs the network), so no mirrored copy and no shared-cases file entry is needed.

### Transitions and who may make them

- Forward: New -> Preparing -> Ready -> Served. One tap on the card's main button moves one step. **Skipping is allowed**
  (New -> Ready, New -> Served, Preparing -> Served) because a small shop has one person doing everything; the confirm is
  the tap itself.
- Back one step (undo a mistaken tap): allowed, one step at a time, any time before Served. Served -> Ready ("Bring back")
  is allowed from the Served filter only, for someone who tapped the wrong card.
- Forward taps are idempotent (tapping Ready on an order already Ready or Served does nothing and is not an error), so two
  tablets tapping at once never fight.
- Every change writes the audit log (`OrderKitchenStatusChanged`: from, to, user) and, for Ready, the link-order chat
  message and customer notification that `MarkOrderReady` already sends. Kitchen "Ready" on a link order **is** the existing
  mark-ready action (same code path, no second button).
- The API checks the state change on the server; the board never trusts its own copy.

### Where to change it

- **Kitchen board cards** (main place).
- **Order details and order list** (cashier): a small kitchen chip next to the order status, and a "Mark served" action on
  the details page, so the cashier can say "handed over" without opening the board. The order list gets a kitchen filter
  (Open / Served) in its existing filters drawer.
- Not from the checkout modal or the payment step. Paying does not touch the kitchen.

### Editing an order that the kitchen already has

Only Pending orders can be edited (existing rule). Because lines are re-created, the edit handler compares the **old and new
lines** (product, size, add-ons incl. temperature, quantity, notes) before replacing them, and does this:

| Edit | Kitchen state before | After | Board shows |
| ---- | -------------------- | ----- | ----------- |
| Payment, tips, customer or note only (no line change) | any | unchanged | nothing |
| Lines unchanged | any | unchanged | nothing |
| Lines changed or removed | New / Preparing | unchanged | red "CHANGED" tag and a one-line note ("-1 Mocha, Latte now Iced") until the kitchen taps "Seen" |
| Lines changed or removed | Ready | back to Preparing | same tag and note |
| Lines **added** | New / Preparing | unchanged | "ADDED" tag, added lines highlighted |
| Lines **added** | Ready or Served | back to New | "ADDED" tag; the card shows only the added lines big, with the earlier lines greyed and collapsed ("Already served: 2 items") |

The last row is the "running tab" case (a customer orders another coffee after the first was served). The kitchen must see
only what is new, and the earlier lines must not be made twice. The diff text is built in the edit handler and stored in
`KitchenChangeNote` (short, plain text, cleared by "Seen" or when the order is Served). If the shop has the board off, the
diff is not computed.

### Cancel, reject, void, refund

- Cancel / reject / void while New: the card disappears from the board.
- Cancel / void while Preparing or Ready: the card turns into a red **"Cancelled, stop making"** card that stays until
  someone taps Dismiss (the kitchen may already have started; a silent disappearance wastes product and confuses people).
  Dismiss is a normal Served-like exit for that card; `KitchenStatus` stays as it was and the card is hidden by the Cancelled
  status plus a dismissed flag, not by changing the state.
- Refund after Served: no effect on the board (already gone).
- Order override on a Completed order (existing feature): lines can change after Served; no kitchen action. Override of an
  order that is not yet Served follows the "Editing" table.

### Who sees it: RBAC, plans, shop setting

- **Permissions** (new keys in the RBAC catalog, `role-based-access.md`): `kitchen.read` (see the board) and
  `kitchen.update` (move states, needs `kitchen.read`). Defaults: Owner, Admin, Manager, Cashier get both (the cashier marks
  Served at the counter); Stock Manager gets neither. A new system role **Kitchen** (name to confirm: Kitchen / Barista)
  holds only `kitchen.read` + `kitchen.update` and lands on the board after login. A kitchen account must not need
  `orders.read`, so the board has its own endpoints (`/api/kitchen/...`) and its DTO carries **no prices, totals, payment
  data or customer contact details** (a first name or order label only), so a shared kitchen tablet leaks nothing.
- `StaffOrderHub` accepts `kitchen.read` as an alternative to `orders.read` (same "any of" pattern the RBAC plan uses for the
  order editor's product and customer lookups), so the Kitchen role gets live updates without seeing orders.
- **Plan gating** (`block-features-by-plan.md`, final since 11 Nov 2026): this plan does **not** invent a gating mechanism. It
  adds one row to that plan's feature catalog (section 4) and uses the existing `PlanFeatures`, `ITenantFeatures` and
  `PlanAwareAuthorizationResultHandler`. Row: key `kitchen`, group "Customer ordering", needs none, **Starter no, Pro yes,
  Business yes**, carried by `kitchen.read` and `kitchen.update` (a one-person Starter shop does not need a board; it is a
  clear step up for a shop with staff). Moving it to another plan is only data on the Plans page. Order taking stays in `core`,
  so a downgrade only hides the board and the kitchen chips; orders keep their stored kitchen state and nothing breaks. The
  Kitchen role (below) is a system role, so on Starter it exists but its permissions fall away with the plan, as for any other
  out-of-plan key.
- **Shop setting** "Use kitchen board" (per shop, default **off** for the existing pilot shop until they say yes; on for new
  shops is a decision below). When off, new orders get `KitchenStatus = NULL` and no kitchen UI shows anywhere (no chips, no
  menu item). Turning it on affects new orders only. It lives with the other shop settings on the Shop page.
- RBAC and plan gating are built or planned on other branches. The kitchen build must wait for, or be merged after, the RBAC
  catalog; until then it can use two temporary policies (`KitchenRead`, `KitchenUpdate`) that the RBAC migration maps to the
  new keys.

### Live updates, refresh and offline

- **Live:** orders created, accepted, edited, cancelled or moved send the existing "order changed" hub message to the shop
  group; the board refetches its list (one cheap query, filtered on the new index) rather than patching local state, so a
  missed message cannot leave it wrong. Same pattern as the order list.
- **Safety nets:** refetch on reconnect, when the tab becomes visible again, and every 30 seconds if the hub is not
  connected. The card timers tick locally.
- **Offline (the kitchen tablet loses wifi):** the board is **online-first**. It keeps the last list on screen, greys it,
  shows a banner "Offline, not updating" with the time of last update, and disables the state buttons with that reason
  (no silent failures). Queuing taps for replay is a later step (forward moves are idempotent, so it is safe to add). The
  board is a shared screen across devices, so it cannot be "offline-first" the way the register is.
- **Orders made offline at the register** reach the server in sync and appear on the board then. This is a real limit:
  an offline sale is invisible to the kitchen until the register reconnects. The register shows a one-line reminder
  ("Offline: tell the kitchen") in the offline order success message. A same-device kitchen screen is out of scope.
  Offline Phase 7 (judge at sale time) does not change this.
- The register's own cart and the checkout modal remain fully offline and never wait on kitchen code.

### Screen design (tablet and large screens first)

Route `/kitchen` in the main app (role-gated, not under Management). Reuses the existing shell, page header, DaisyUI/Tailwind
classes, the shared search input and the **filters drawer**; no new look.

- **1440 (desktop / wall-mounted monitor):** three columns, **New | Preparing | Ready**, each with a count. Cards sorted
  oldest first. "From yesterday" strip on top when needed. Served is not a column.
- **820 (tablet, the likely kitchen device):** still three columns in landscape; in portrait the columns get narrower
  (about 260 px) and the text stays large. Cards must be tappable with a wet thumb: the action button spans the card's
  full width, 48 px tall at least.
- **375 (phone):** one column; the three states become segmented tabs with counts in the existing mobile bottom bar, as
  other list screens do. Same cards.
- **Card:** big order number; age ("6 min", turns amber at 5 and red at 10 as constants first, a setting later); fulfillment
  chip for link orders (Pickup / Delivery) and the customer's name or label; the lines as `2x Latte (L)` with add-ons
  indented under their line, the **temperature as a coloured chip (Hot / Iced) so it cannot be misread**; per-line notes and
  the order's special instructions in a highlighted box; CHANGED / ADDED tags; one main button ("Start", "Ready", "Served")
  and a small undo. No prices, no totals, no payment chip.
- **Filters drawer:** state (New / Preparing / Ready / Served), source (POS / Customer link), search by order number. The
  Served view is a history list for the day with "Bring back".
- **Kitchen niceties (local to the device, stored in browser storage):** large-text toggle, full screen, keep screen awake
  (Screen Wake Lock), optional chime on a new order (off by default; browsers need a tap first).
- Animations follow the app rules (chevrons 200 ms ease-out). Cards move column on tap with the same short transition as
  list rows; no spinner on tap (optimistic with rollback and a toast if the API refuses).

### Data and API

- SQL script under `tools/sql` (name with the next date, idempotent, run on the real `WTF` DB on `.\SQLEXPRESS` first, then
  `tools/dbsync.bat`; scaffold output kept as generated): add the columns above to `Orders`; **no backfill** (old orders stay
  NULL); a filtered index `(TenantId, KitchenStatus) INCLUDE (CreatedAt) WHERE KitchenStatus < 3`; add the two `kitchen.*`
  permissions and the Kitchen system role in the RBAC release script (when RBAC is merged); add a `kitchen` feature row to
  the plan seed (when plan gating is built). The shop setting is a new column on the shop settings table (check where
  branding lives before choosing).
- Endpoints (minimal API group `/api/kitchen`, handlers in `Features/Kitchen/`, vertical slice like the rest):
  - `GET /api/kitchen/orders?states=&source=&search=` -> `KitchenOrderDto` list (no prices, no payment fields)
  - `POST /api/kitchen/orders/{id}/state` with `{ to }` (forward, skip or one back; validated by `KitchenBoardRules`)
  - `POST /api/kitchen/orders/{id}/seen` clears the CHANGED/ADDED note
  - `POST /api/kitchen/orders/clear-old` marks the stale ones Served
- `OrderDto` and the paged list gain `KitchenStatus` (null when not tracked) for the chip and filter; `OrderStatusEnum` is not
  touched.
- Tenant isolation is automatic (global filters on `Orders`); tests still cover "another shop's order id returns 404".
- Audit actions added to the audit enum; Ready on a link order keeps its existing chat message and notification.
- Branches (future): the state lives on the order, so a per-branch board only needs the branch filter later.

### Fit with the other open plans (nothing duplicated)

Checked against the final plans on 11 Nov 2026 (plan gating, customer address, Senior/PWD, Offline Phase 7).

| Plan | What it adds on orders | Overlap with kitchen | How this plan avoids doubling it |
| ---- | ---------------------- | -------------------- | -------------------------------- |
| Plan gating | Feature catalog, `ITenantFeatures`, not-in-plan 403 | Kitchen needs a gate | Only adds a `kitchen` row and the two `kitchen.*` keys to that catalog; no gating code of its own. Its role-bundle release script is shared: add the kitchen keys in the same script that adds `purchasing.*` and `chat.*`, not a second one |
| Customer address | `Orders.CustomerAddress` (nvarchar 300, nullable), `Customers.LastName` nullable | Same order list, details, `OrderDto`, `GetPagedOrdersHandler` | No shared column. The kitchen DTO never carries an address (delivery address is not needed to make a drink). Both plans add fields to `OrderDto`; whoever builds second rebases the DTO and the details page, and the list filters drawer gets one combined change |
| Senior/PWD discount | `OrderItems.SeniorPwdDiscountId`, `SeniorPwdVatExempt`, `SeniorPwdDiscount`; permission `orders.discount.seniorpwd`; may split a line into a covered and a normal line | `UpdateOrderHandler` rewrites lines; line diff | No shared column (that plan touches `OrderItems`, kitchen touches `Orders`). The kitchen line diff compares product, size, add-ons, quantity and notes **only** and sums split lines of the same product, so a discount split or a price change never raises a CHANGED tag |
| Offline Phase 7 | `Orders.CatalogSyncedAt`, `OrderReviewReasons`, `OfflineSyncPolicy`, held-order review (approve / reject, bulk approve) | An offline order appears on the board after sync or approval | No shared column. Kitchen adds one hook only: when sync saves a Pending order, or review approves a held one, set `KitchenStatus = New` through the same small helper the POS create path uses. Phase 7 owns the review flow and its screens |

Shared files to coordinate when building (not duplicates, but the same lines of code): `UpdateOrderHandler` (address is locked
at creation, Senior/PWD recalculates, kitchen diff runs before the lines are replaced), `CreateOrderHandler` and
`SyncOfflineOrdersHandler` (set the initial kitchen state), `OrderDto`, the order list and details pages, the permission
catalog and the role-bundle release script. The kitchen columns are all new and unique to this plan: `KitchenStatus`,
`KitchenStartedAt`, `KitchenServedAt`, `KitchenUpdatedBy`, `KitchenChangedAt`, `KitchenChangeNote`.

### Build phases

1. **State and API.** Script, entity fields, `KitchenBoardRules` (appearance, stale, transitions, line diff) in
   `WTF.Calculations`, handlers, audit, hub message; reuse of `MarkOrderReady`. Tests in `WTF.Tests` for every table above.
2. **Board screen.** `/kitchen` with the three columns, cards, filters drawer, live refresh, offline banner. Playwright at
   375 / 820 / 1440 on the throwaway DB with at least 3 workers and its own tag, ports and stop file.
3. **Order list and details.** Kitchen chip, filter, "Mark served"; edit handler diff and the CHANGED / ADDED flow; the
   cancelled-while-making card.
4. **Access.** Shop setting, `kitchen.*` permissions, Kitchen role and landing page, plan key, hub "any of" policy.
5. **Later (not planned in detail):** per-line ticks, stations, prep-time report, queued taps offline, sound, ticket printing
   from the board, estimated wait for customers.

Phases 1 to 3 are useful on their own to the pilot shop if the setting is just switched on for them; phase 4 can follow the
RBAC and plan-gating merges.

### Later ideas (kept short on purpose)

- **Per-line progress.** Needs a stable line id across edits (match old to new lines in `UpdateOrderHandler`) before it is
  safe. Useful when one order mixes drinks and pastries made by different people.
- **Stations.** A `Station` on the category (Bar / Kitchen / None) and a station filter on the board, so the barista does not
  see the pastry line. Cheap once per-line progress exists; until then the filter would only hide lines, not state.
- **Prep-time report** (average New -> Ready, by hour), reusing `ReportRules.AverageMinutes`.
- **Customer status.** The public link page already shows "ready" from `ReadyAt`; "preparing" could come from
  `KitchenStartedAt` with no new data.
- **Printed ticket** from `receipt-and-kitchen-printing.md`, printing the same lines and the CHANGED / ADDED note.

### Risks to watch

- Cashiers forgetting to mark Served means cards pile up. Mitigation: the age colours, the "From yesterday" strip, and the
  one-tap Clear old. Do not auto-serve.
- An offline sale not reaching the kitchen. Mitigation: the reminder text; cannot be solved without a local kitchen screen.
- Reusing `ReadyAt`: stepping back from Ready on a link order clears `ReadyAt`, which the customer's page would show as "not
  ready" again. Acceptable and honest; test it.
- The edit diff must run before the lines are deleted and must ignore ordering and line ids.
- The board must never gain a price or payment field "just for convenience"; the DTO test should assert the fields.

### Decisions (open, with recommendations)

| # | Question | Recommendation |
| - | -------- | -------------- |
| 1 | Are the four states New / Preparing / Ready / Served right, or fewer (New / Ready / Served)? | Four, with skipping allowed, so a one-person shop taps once or twice |
| 2 | Does the kitchen state stay separate from payment, and does payment never change it? | Yes (this plan) |
| 3 | Who taps Served: kitchen, cashier, or both? | Both can; cashier through order details so they need not open the board |
| 4 | Board on by default for new shops, off for the existing one? | Off for the pilot until they ask; on for shops created after release. Needs your call |
| 5 | Is a separate Kitchen role wanted (and its name)? | Yes, "Kitchen", board only, lands on `/kitchen` |
| 6 | Plan: Pro and Business, not Starter? | Yes, as catalog key `kitchen` in the final gating plan (Pro and Business). Only the placement is yours to change |
| 7 | An order stays on the board when prepaid (Completed) until Served? | Yes |
| 8 | When items are added to an already-Served order, does it return as New showing only the added lines? | Yes |
| 9 | Is order-level state enough for version one, with per-line progress and stations later? | Yes |
| 10 | Is an offline register sale being invisible to the kitchen until sync acceptable for now? | Yes, with the reminder text |
| 11 | Do the age colours (amber 5 min, red 10 min) fit your drinks? | Use them as constants; make them a shop setting only if asked |
| 12 | Does the customer see "Preparing" on their link page? | Not in version one |
| 13 | Does the kitchen see the customer's name? | First name or order label only; never phone or address |
