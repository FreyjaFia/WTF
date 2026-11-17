## Multiple Branches per Shop [Planned, plan written 13 Nov 2026, decisions made 13 Nov 2026]

One shop (tenant) with several locations (branches). Each branch sells, makes, counts and closes its own day; the owner
sees one branch or all of them. This file is the plan only. Nothing is built.

It replaces "Phase 1 - Branches inside one shop" in [multiple-branches-and-tenants](multiple-branches-and-tenants.md)
(that section stays as the first draft; this file wins where they differ). Branding (Phase 2) and selling to other stores
(Phase 3, built) are not part of this file.

**This is a future plan.** The pilot decision of 7 Nov 2026 stays: **no branches for the pilot shop.** Nothing here may
change what the pilot sees. The plan is written now so the plans that are being built first (below) do not paint the
product into a corner.

### How to read this plan (what "the 5 topics" means)

Pogi asked for a plan that "takes consideration of the 5 topics". Reading used here: the **Senior/PWD discount group**,
the five plans that are in flight and touch orders:

1. [Senior/PWD discount](senior-pwd-discount.md)
2. [Offline Phase 7](offline.md) (judge at sale time, stock, held-order review)
3. [Customer address on orders](customer-address-on-orders.md) (nullable last name, address copy on the order)
4. [Plan gating](block-features-by-plan.md) (feature catalog, plans, caps)
5. [Kitchen orders view](kitchen-orders-view.md) (kitchen board)

Each has its own section below ("How each plan behaves with branches"). Pogi's other topics (pilot onboarding, prod-to-UAT
refresh, Android app, billing, opening counts) get a short section at the end, because they are affected too. If the
reading is wrong, only that section and the order of work need to change; the data design does not.

Those five plans live on the `plans-all` branch until it is merged; the links above work once it is.

### Words used

- **Shop (tenant):** the business that pays for the app. Owns users, the catalog, customers, promotions, settings, plan.
- **Branch:** one location of a shop (for example "Makati" and "Cebu"). Owns its own stock, orders, kitchen board, cash,
  receipts header and staff assignments.
- **Main:** the first branch. Every shop gets one automatically, even a shop with a single location, so the code never
  has to ask "does this shop have branches?".
- **One-branch mode:** a shop with exactly one active branch. It looks and behaves exactly as today. Nothing about
  branches is shown (no picker, no branch column, no prefix on order numbers).

### The big idea (for the owner)

Two locks, not one:

1. **Shop lock (exists, built):** a shop can never see another shop's data. Hard wall.
2. **Branch lock (new):** a staff member only sees and sells in the branches they are assigned to. An Owner sees every
   branch.

The catalog (products, prices, categories, add-ons, promotions, customers) is **shared**: edit once, every branch has it.
What a branch makes and counts on its own (orders, stock, kitchen, day close) is **separate**.

### What is shared and what is per branch

| Thing | Shared by the shop or per branch | Notes |
| ----- | -------------------------------- | ----- |
| Products, categories, add-ons, temperature, recipes | Shared | One catalog. A "not sold at this branch" switch is a later option (see decisions) |
| Which branches sell a product ("Sold at") | Per product | Default: every branch. A product can be limited to chosen branches, so a branch-only product is just "sold at one branch". See "Products and branches" |
| Prices and promotions | Shared | Same price everywhere in the first cut. Per-branch prices are a later option and change the offline catalog, so they are not built first |
| Customers and their saved address | Shared | A regular can order at any branch. The address on an order is a copy kept on that order (customer-address plan) |
| Users and roles | Shared accounts, **scope: All or selected branches** | Role says what, scope says where. See "Roles, scope and oversight" |
| Orders, order lines, payments | Per branch | `Orders.BranchId`, set once when the order is created, never edited |
| Order numbers | Per branch | Each branch counts from 1; shown as `MKT-0042` (see decision) |
| Stock quantities, counts, waste, receiving, purchase orders, par levels, reorder | Per branch | Items (the definition) and suppliers are shared |
| Stock transfer between branches | New | Out of one branch, into another, in one step |
| Kitchen board | Per branch | A branch's kitchen sees only its own orders |
| Daily Close (Z-report), cash drawer | Per branch | Plus an "all branches" total for the owner |
| Reports and dashboard | Both | A branch picker: All branches, or one. Plus a "by branch" comparison |
| Receipt header (address, phone, TIN line) | Per branch, with shop default | Branch address and phone print on receipts |
| Customer ordering links | Per branch | A link names the branch where the customer picks up |
| Chat | Follows the order | A conversation belongs to an order, so to a branch |
| Expenses | Per branch (optional) | Branch column, empty means "whole shop" |
| Audit log | One log | Gets a branch column, filterable |
| Time zone and currency | Fixed (Asia/Manila, PHP) | Branch time zone stays a column but is not editable until a shop outside this zone exists |
| Shop settings | Mostly shop, a few per branch | See "Settings: shop level or branch level" |

### Data model

New script under `tools/sql` (idempotent, run on the real `WTF` database first, then `tools/dbsync.bat`; scaffold output
kept as generated, per the project rules). Built in the same three steps as the tenant work: add nullable, backfill, enforce.

- `Branches`: `Id`, `TenantId`, `Name`, `Code` (2 to 5 letters, unique within the shop, used on order numbers), `Address`,
  `Phone`, `IsActive`, `IsMain`, audit columns. Soft delete like the rest of the app. Exactly one `IsMain` per shop.
- `UserBranches`: user to branch, many to many. Plus `Users.DefaultBranchId`.
- `BranchId` on: `Orders` (and through it lines, payments), `OrderSeniorPwdDiscounts` (copied from the order, so branch
  reports do not need a join), `StockMovements`, `ItemBranchStock` (new, replaces the single quantity on `Items`),
  `StockCounts`, `StockWaste`, `StockReceipts`, `PurchaseOrders`, `Expenses`, `OrderLinks`, `AuditLog`, and the
  offline queue records on the device.
- `ItemBranchStock`: `ItemId`, `BranchId`, `CurrentQuantity`, warning and critical levels, par level,
  `AllowNegativeStock`. The item keeps its name, unit and cost. Quantities and levels become per branch.
- `StockTransfers`: `Id`, `FromBranchId`, `ToBranchId`, status, lines, who and when. Posts a `TransferOut` and a
  `TransferIn` movement with one reference, in one transaction.
- `BranchSettings`: per branch overrides (see below). A missing row means "use the shop value".
- Order numbers: the existing per-shop counter table (`TenantCounters`, one row per shop and counter name) gets a row per
  branch (counter name `OrderNumber:{branchId}`). A unique index on `(TenantId, BranchId, OrderNumber)` replaces the
  per-shop one. `OfflineLocalId` stays unique per shop and device.

**The branch lock in code (two parts, so a forgotten filter cannot leak).**

1. **Wall (global filter):** every branch-owned entity gets `IBranchOwned` and an EF filter "this branch is one the caller
   may see", with the caller's allowed branches read from the token the same way `TenantId` is today. Users with scope All (Owner, and anyone the Owner sets to All) get all branches; see "Roles, scope and oversight". A user cannot read another branch's rows even if a handler forgets to filter.
2. **Choice (the picker):** the branch the person is *working in* (header `X-Branch-Id`, chosen at login, switchable in
   the header menu) is checked against the wall and used for **writes** through an `ICurrentBranch` service. Handlers never
   take a branch id from the request body to write. "All branches" is only allowed for reads, for users who may see more
   than one.
3. **Safety net, like the tenant one:** a test fails if an entity with `BranchId` is missing the filter or the stamp; a
   database test proves a Makati cashier never reads Cebu orders, stock, kitchen or reports; the endpoint coverage test
   from plan gating also lists, for each route, whether it needs a branch.

**Order numbers (decision, recommended per branch).** Per branch counters give the kitchen short numbers it can shout, and
each branch's day starts at a clean range. The screen and receipt show `Code-Number` (for example `MKT-0042`) so two
branches never collide in conversation or in the shop's totals. The stored unique key is the pair (branch, number). In
one-branch mode the number shows as today, with no prefix. Alternative: one shop-wide counter plus a prefix; simpler but
numbers climb for everyone and a quiet branch sees jumps. Changing later is a counter change only.

### Products and branches

Pogi's question: should a branch be able to have its own products? Recommendation: **yes, but as a "Sold at" list on a
shared catalog, not as separate catalogs.**

| Option | What it means | Verdict |
| ------ | ------------- | ------- |
| Fully shared | Every branch sells every product | Too stiff: a kiosk without a grill cannot hide the sandwiches |
| **Shared catalog + "Sold at" (recommended)** | Each product has a list of branches that sell it. Default is all. A branch-only product is a product sold at one branch | One product list to maintain, reports compare the same product across branches, and a branch special is easy |
| Separate catalog per branch | Every branch copies and edits its own products | Duplicates everywhere, reports cannot compare, a price change is N edits, recipes and stock links multiply. Not recommended |

How it works:

- `ProductBranches` (`ProductId`, `BranchId`, `IsAvailable`, later a nullable `PriceOverride`). No row means "sold at every
  branch", so nothing changes for one-branch shops and a new branch gets the full menu automatically (the owner can then
  untick what it does not sell). A product can also be marked **new products start as: all branches / only the branch that
  created it** (default: only that branch for a Branch Manager, all for the Owner).
- The POS, the customer link and the offline catalog list only the products sold at the active branch. A branch sees the
  menu it can sell, which also keeps the offline download small.
- **Who may create or edit:** `products.write` stays shop-wide (shared products, prices, categories). A Branch Manager
  may **create and edit branch-only products for their own branch** through a small new key, `products.write.branch`
  (shop-wide products stay read-only to them). A branch-only product can be promoted to all branches by the Owner or
  Area Manager. This keeps the Branch Manager useful (a local special) without letting them change what every branch sells.
- Names stay unique in the shop, so two branches cannot each make "Matcha Latte" as different products by accident; the
  editor suggests using the existing one and ticking the branch.
- **Categories, add-ons and temperature** stay shared (they are labels and options); an empty category simply does not show
  at a branch that sells nothing in it.
- **Recipes and stock:** recipes are shared with the product; deduction uses the order's branch stock. A branch-only product
  can use branch-only items, which are just items with no stock row elsewhere.
- **Promotions** can be limited to branches the same way (default all). Limits stay a shop-wide pool.
- **Reports:** product reports across branches still work (a product sold at one branch shows only there).
- **Offline Phase 7:** a product no longer sold at the branch counts like an inactive product at sync (the sale was
  honored, a note is added). When `PriceOverride` arrives, `CatalogChangeLog` gets a nullable `BranchId`.
- **Plan gating:** branch-only products and "Sold at" are part of the `branches` feature. A shop without it sells every
  product everywhere, as today.
- **Switching off:** closing a branch keeps its branch-only products (hidden, not deleted); on reopening they return. If
  the owner wants one in another branch, they tick it there.
- **Later, not first cut:** per-branch price (`PriceOverride`; changes the offline catalog and the order total check, so it
  needs its own plan), scheduled availability (a seasonal item), stock-driven "sold out here".

### Settings: shop level or branch level

| Setting | Level | Why |
| ------- | ----- | --- |
| Shop name, logo, colors, plan, billing | Shop | One business |
| `SeniorPwdEnabled`, discount rate (20%), per-person limit | Shop | Same law, same policy everywhere |
| `VatRegistered`, TIN, business address on the receipt | **Branch** (shop value is the default) | In the Philippines each branch is registered as its own business location with the BIR, so a branch can be VAT-registered or not and prints its own registered address. **To confirm with the accountant before build.** The default keeps single-branch shops unchanged |
| "Use kitchen board" | **Branch** (shop default) | A coffee kiosk may not have a kitchen; the flagship does |
| Kitchen age colors (later) | Shop | Same rule everywhere |
| Offline sync policy (hold or note, tolerance, auto-approve, aging days) | Shop | A rule about money, not a place. Branch override is a possible later step |
| Stock alert levels, par levels | Branch | Each branch holds its own stock |
| Receipt header and footer | Branch (shop default) | Own address and phone |
| Customer link on or off | Shop, with the link naming a branch | |

### How each plan behaves with branches

#### 1. Senior/PWD discount

- **Calculation does not change.** `SeniorPwdDiscount` rules in `WTF.Calculations` take the VAT flag as an input; the
  caller passes the flag of the order's branch (branch value, else shop value). Same worked examples, same shared cases.
  Add one shared case per mode so both sides keep agreeing.
- **Data:** `OrderSeniorPwdDiscounts.BranchId` (copied from the order). The product flag `IsSeniorPwdEligible` stays shared.
- **Same-ID warning stays shop-wide.** "This ID was already used on another order today" must also fire when the other order
  was at another branch, otherwise the warning is easy to defeat. The index stays `(TenantId, IdNumber, CreatedAt)`; the
  warning text names the branch.
- **Report and claim export:** the Senior/PWD report gets the branch filter and a branch column; the claim export per branch
  is the useful one for the accountant (each branch files its own). Daily Close shows the day's Senior/PWD discount and
  VAT-exempt sales **per branch**.
- **Receipt block** prints the branch's TIN and address when the branch has them.
- **Permission** `orders.seniorpwd.apply` is a role permission; being assigned to the branch is what allows using it there.
- **Privacy:** full ID numbers are visible to people who can apply or export the discount, **within their branches**.
- **Changing `VatRegistered` on one branch** changes new orders of that branch only (history never changes, as in the plan).
- **Build order effect:** Senior/PWD is built first. It must read `VatRegistered` through one small "effective settings for
  this order" function (shop value today), so the branch override is a one-place change later.

#### 2. Offline Phase 7

- **A queued order carries its branch and syncs into it**, even if the user switched branch or the branch was deactivated
  meanwhile (a deactivated branch still accepts what was sold before; the review gets a note). The device keeps the branch
  in the queue record; the branch id is added to the queued-order shape with the same version field the Senior/PWD fields
  use.
- **Review uses the wall:** an Admin assigned to Makati sees Makati's held orders only; the Owner sees all. The
  "bulk approve" filter by branch that Phase 7 had dropped comes back (it was dropped only because branches were out).
- **Judge at sale time:** the catalog is shared, so `CatalogChangeLog` stays per shop with no branch column. If per-branch
  prices ever arrive, the log gets a nullable `BranchId` ("applies to branch X").
- **Stock shortfall** is judged against **that branch's** stock (`ItemBranchStock`), and the note appears on that branch's
  item history. Offline sales never block, as in the plan.
- **Promotion limits are shop-wide pools** (`MaxRedemptions`). A limited promotion used up at Cebu while Makati was offline
  is honored and counted over limit, as the plan already says. Say so on the promotion page: "limit counts all branches".
- **Aging alerts and "Offline sales held for review" on the Daily Close** are per branch, plus a shop total on the dashboard.
- **Unsynced orders screen** shows the branch. Needs `orders.override` in that branch.
- **Policy** (`OfflineSyncPolicy`) is per shop first; a branch override is a later option.
- **The device lease** (permissions and plan features stored for offline) also stores the user's allowed branches and the
  active one, so the register opens in the right branch with no connection.
- **Order numbers offline:** `OFF-YYMMDD-###` gains the branch code (`OFF-MKT-261113-007`). `OfflineLocalId` is unchanged.

#### 3. Customer address

- **Customers are shared** across branches. The quick "New customer" dialog and checkout work as planned. The order's
  address copy (`Orders.CustomerAddress`) is a copy on the order and has nothing to do with the branch, so nothing changes.
- **Delivery:** the order belongs to the branch that took it. The branch's own address and phone print on the receipt as
  the "from" side; the customer's address is the "to" side. The delivery address search on the order list stays shop-wide
  for people who see all branches and branch-wide for the others.
- **Order list:** gets a branch filter in the filters drawer and a branch chip (hidden in one-branch mode). The customer's
  saved address is never filtered by branch.
- **Customer link:** the link names the branch where the customer picks up. At creation the link takes the creator's active
  branch; a customer of a multi-branch shop who needs another branch gets another link, or (decision below) picks a branch
  at checkout.
- **Privacy:** a branch cashier can search every customer of the shop (they are shared). If the owner wants customers per
  branch, that is a decision below; the data design does not prevent it.
- **Last name optional** (nullable) has no branch effect.

#### 4. Plan gating

- **Plans stay per shop, not per branch.** A shop's plan decides features for all its branches. Per-branch features are not
  a thing: a Pro shop's second branch is Pro too.
- **New catalog key `branches`** (reserved in the gating plan). Needs none. Carries new permissions `branches.read` and
  `branches.manage`. Suggested layout: Starter no, Pro no, **Business yes**. Plans page already lets Pogi move a key.
- **New cap `MaxBranches` on the plan** (like `MaxUsers`; empty means unlimited, `1` means branches off). Checked in the
  create-branch and re-activate-branch handlers, the only two ways to add a branch. Recommended layout: Starter 1, Pro 1,
  Business 3, and an **extra branch fee** (price per additional branch) when billing needs it. Which layout is only data.
- **Without the `branches` key** the branch lock still exists (Main), but no branch screens, no picker, no `X-Branch-Id`
  switching. A shop that is downgraded keeps all its branch data (see switch-off scenarios).
- **`MaxUsers`** counts users of the whole shop, not per branch.
- **Downgrade over the branch cap:** same rule as the user cap that Pogi decided: allow the change, warn in the change-plan
  dialog, only block adding or re-activating a branch. Existing branches keep working (recommended). The stricter
  alternative (read-only newest branches) is a decision below.
- **Gated features inside a branch:** kitchen, inventory, promotions and the rest are shop features. If `inventory` is off
  the branch stock screens are hidden and stock freezes in every branch; transfers need `inventory` and `branches`.
- **Coverage test:** every new branch route is gated by `branches` or on the allow-list; the new `branches.*` keys go into
  the same role-bundle release script as the other new keys, not a separate one.
- **Platform admin:** the shop detail page shows branch count against the cap; the Billing tab shows the extra-branch line
  when billing exists. The platform admin sees no branch data.

#### 5. Kitchen orders view

- **One board per branch.** The state lives on the order (`KitchenStatus`), so a branch board is the same query with a
  branch filter. The index becomes `(TenantId, BranchId, KitchenStatus) INCLUDE (CreatedAt) WHERE KitchenStatus < 3`. Build
  the kitchen plan with this index shape from the start, so there is no second index change later.
- **Live updates:** the staff hub's groups become per shop **and branch** (`{tenant}:{branch}`); a client joins the groups of
  the branches it may see. Cebu's kitchen tablet never buzzes for Makati's orders.
- **Kitchen role:** a Kitchen user is assigned to one branch (or several) and lands on that branch's board. A kitchen tablet
  remembers its branch like the large-text toggle (browser storage), but the server decides what it may see.
- **"Use kitchen board"** is a branch setting with a shop default (above). The pilot shop keeps it off until they say yes.
- **Orders made offline** reach the board of the branch where they were sold, after sync (existing limit, the register
  still shows "Offline: tell the kitchen").
- **Link orders** appear on the board of the branch the link names, when staff of that branch accept it.
- **"Clear old"** and "From yesterday" are per branch. The Owner can open any branch's board from a branch switcher.
- **Order numbers on cards** are the short per-branch ones, one more reason they are per branch.
- **Owner overview (later):** a small "waiting orders per branch" count on the dashboard, from the same query.
- **Prep-time report (later)** gets the branch column.

### Reports, dashboard and calculations

- **Picker:** "All branches / one branch" on the dashboard and every report, remembered like the other filters. Only shown
  when the person can see more than one branch.
- **New "by branch" report:** sales, orders, average order, voids, Senior/PWD discount, held offline sales, low stock per
  branch, with a total row.
- **Calculations** (`WTF.Calculations`, mirrored in `shared/calculations`, shared cases in `calculation-cases.json`): new
  rules go there, never in a handler. Needed: sales per branch and share of the total, transfers in and out, stock by
  branch. The proof test: the branch rows added together equal "All branches".
- **Shop day:** `ReportPeriods` already takes a time zone; it takes the branch's zone (all Asia/Manila today).
- **Daily Close** is per branch; the workbook has a branch option (own file per branch, plus a whole-shop file).

### Switching on: from one branch to several

**How easy is it?** Easy by design, because the shop already has Main from the day the branch tables are created. Turning
it on is *adding a second branch*, not converting the shop. Nothing migrates and no data is rewritten.

What the owner does: Management > Branches (visible when the plan has `branches`) > "Add branch", name and code, address,
phone > assign staff > optionally copy stock levels. What the app does at that moment: from one active branch to two, the
branch picker, branch columns, filters and the `MKT-` prefix start to show (the prefix is applied to numbers by display, so
old orders show `MAIN-0001` style codes too; see the scenarios).

| # | Scenario | What happens | Recommendation |
| - | -------- | ------------ | -------------- |
| ON-1 | Pilot shop, no `branches` key, one branch (Main) | Nothing visible. Branch tables exist, everyone is assigned to Main, all orders and stock sit in Main | Default for everyone until they buy the feature |
| ON-2 | Owner adds the second branch (plan allows it) | The new branch starts with **zero stock** and order numbers at 1. Main keeps its history and numbers. Picker, branch chips and filters appear for everyone with 2+ branches | Yes. Ask the owner for the branch code first; renaming Main's code later is allowed (only display changes) |
| ON-3 | Owner wants the new branch to start with some stock | "Copy levels from Main" sets warning, critical and par levels (not quantities). Real quantities come from an opening count or a transfer from Main | Levels copied, quantities never copied silently. A transfer is the honest way to move goods |
| ON-4 | Existing staff | Cashiers, Stock Managers and Item Managers stay on Main only. Owner, Admin and Admin Viewer already have scope All, so they see the new branch automatically. Nobody limited is assigned to the new branch until the owner does it | Yes. Safe default; a cashier never lands in a branch by accident |
| ON-5 | Cashier signed in on a register when the branch is added | The register keeps working in Main. The picker appears at the next login or refresh. A cashier with one assigned branch never sees a picker | Fine |
| ON-6 | Registers offline while the second branch is added | Their queued orders were made in Main and sync into Main (the branch id is in the queue record; an old queue record without one is treated as Main) | Yes. Old app versions must default a missing branch to the shop's Main |
| ON-7 | Open kitchen cards and customer links at the time | They belong to Main and stay there. Links still point to Main for pickup | Yes. A link names its branch; the owner can recreate links for the new branch |
| ON-8 | Reports the day the branch is added | "All branches" equals old numbers plus the new branch; Main alone equals the old numbers. No history is changed | Yes |
| ON-9 | The plan does not allow it (cap reached) | The add button explains the cap and offers the upgrade text, the same style as the user cap | Yes |
| ON-10 | Owner wants Main renamed (for example "Main" to "Makati") | Name and code are editable at any time. Old orders show the new code because the code is read from the branch, not stored on the order | Yes. Order numbers stay unique because the stored key is (branch, number), not the code |
| ON-11 | Second branch needs its own VAT status | Branch override of `VatRegistered`, TIN and address (accountant to confirm) | Yes |

**Risk to avoid:** the **first** time branches are turned on in production is the first time the branch lock and the new
per-branch stock tables run on real data. So build phase 1 (the tables and the lock, Main only, no visible change) ships and
runs on the pilot **before** any branch screen exists. See phases.

### Switching off: from several branches back to one

This is the hard direction, so the rule is: **turning branches off never deletes or merges data on its own, and it never
hides history.** What it does is *stop using* branches, one branch at a time, until one is left.

The word "off" means two different things. Keep them apart:

- **Closing a branch** (the owner closes a location): the branch is deactivated.
- **Losing the feature** (a plan downgrade, or non-payment): the `branches` key goes away. Nothing is closed.

**Closing a branch (owner action, step by step, each step checked by the app):**

| # | Scenario | What happens | Recommendation |
| - | -------- | ------------ | -------------- |
| OFF-1 | Branch has orders still Pending (kitchen cards, unpaid tabs) | Close is refused with a list: "12 orders are still open at Cebu." The owner finishes, cancels or moves them | Refuse. Never auto-close an order. Moving an open order to another branch is a later, audited action |
| OFF-2 | Branch has **held offline orders** (waiting for review) | Close is refused until each is approved or rejected. A register that is still offline may sync later | Refuse for held orders. For registers still offline, a closed branch **still accepts late syncs** into itself (note on the order) |
| OFF-3 | Branch has **stock** | Close is refused until quantity is zero or moved: the owner transfers it to another branch, writes it off as waste, or ticks "count as written off" with a reason. All of it audited | Offer the transfer first. Never delete stock rows |
| OFF-4 | Branch has open purchase orders | Close refused until they are received or cancelled | Same style as stock |
| OFF-5 | Branch has open stock counts or a Daily Close not done | Warn and require the Daily Close for the last open day | Warn, then allow |
| OFF-6 | Staff assigned to the branch | Assignments are removed from that branch. A person left with **no** branch is reassigned to a chosen branch in the same dialog, otherwise they cannot sign in with a clear message ("ask the owner to assign you to a branch") | Force the owner to choose where each person goes. Users with an Owner or Admin role are never locked out |
| OFF-7 | Customer links of that branch | Links stay valid but the public page says the branch is closed and shows the shop phone. The owner may point a link to another branch | Yes |
| OFF-8 | Old orders, reports, receipts of that branch | Stay as they were. Reports can still show the closed branch (filter "include closed"). Receipts reprint with the branch's old address | Yes. Closed is not deleted |
| OFF-9 | Order numbers | The closed branch keeps its numbers. If it is **re-opened** it continues where it stopped | Yes |
| OFF-10 | Owner wants to **merge** Cebu into Main (all history under Main) | **Not offered in the first cut.** History keeps its branch. "All branches" already adds everything up | Decided: do not merge. Merging rewrites history and makes order numbers collide (two orders numbered 42). If a merge is demanded, it is a platform admin script run per request with a backup, not a button |
| OFF-11 | Owner wants to **delete** a branch | Only possible when it never had an order, stock movement, count or link (a mistake). Otherwise close only | Yes. Matches soft delete elsewhere |
| OFF-12 | Close Main | Another branch must be made Main first (exactly one Main per shop) | Yes |
| OFF-13 | Last active branch | Cannot be closed. A shop always has one active branch | Yes |

**Back to one-branch mode:** when only one branch is active, the app returns to one-branch mode: picker, branch chips, the
prefix on order numbers and branch columns disappear again. Closed branches stay available under "include closed" in
reports. Re-adding a branch is ON-2. Order numbers keep the unique key, so history is safe both ways.

**Losing the feature (plan downgrade or lapse):**

| # | Scenario | What happens | Recommendation |
| - | -------- | ------------ | -------------- |
| LOSS-1 | Plan loses the `branches` key (or cap goes down) | **Nothing is closed or deleted.** All existing branches keep working and keep their staff, stock and kitchen. Only adding or re-activating a branch is refused, and the change-plan dialog warns. Same rule as the user cap | Yes (matches Pogi's user-cap decision). Strict alternative: the newest branches turn read-only until the owner picks which to keep; more disruptive, listed as a decision |
| LOSS-2 | Payment lapses (existing lapsed-shop rule) | Reads work, writes get 402, for all branches. Branch data is untouched | Existing behavior |
| LOSS-3 | Shop cancelled | The 90-day data keeping rule of the multi-tenant plan covers branches; the typed-slug delete removes them with the shop | Existing behavior |
| LOSS-4 | Shop upgrades again | Everything is as left. Nothing to restore | Yes |
| LOSS-5 | The `inventory` key is lost while there are several branches | Stock freezes in every branch; transfers are unavailable; orders still save | Same as the single-branch rule |
| LOSS-6 | The `kitchen` key is lost | Boards hide in every branch; kitchen state stays on orders | Same as the single-branch rule |

### Migration of existing data (what the first script does)

One script, three steps, run on the real `WTF` database first (and on the cloud test database for a cloud thread, saying
which one), then `tools/dbsync.bat`:

1. **Add.** `Branches`, `UserBranches`, `ItemBranchStock`, `StockTransfers`, `BranchSettings` and a nullable `BranchId` on
   the tables above.
2. **Backfill.** For each shop: one branch "Main" (`IsMain`, code from the shop name's first letters, editable), every user
   assigned to it, every existing row's `BranchId` set to it, each item's current quantity copied into `ItemBranchStock` for
   Main (levels and par levels too), and the order counter row copied as Main's counter. The old per-shop order numbers
   stay exactly as printed on old receipts.
3. **Enforce.** `BranchId` becomes required, per-branch unique indexes replace the per-shop ones, and the old quantity
   column on `Items` is **kept as a read-only mirror for one release** (so a mid-deploy old API still works), then dropped
   by a later script.

Never edits old scripts. Idempotent. A run twice changes nothing. Rollback: the old columns stay for one release, so the
previous API version still runs against the new schema.

### What each part of the app does when a branch is added (user interface)

- **Header menu:** branch switcher (a bottom sheet on 375, a menu on 820 and 1440), shown only when the person can use more
  than one branch.
- **Management > Branches:** list with sortable columns and a filters drawer, editor, close dialog (the OFF scenarios as a
  checklist with counts), staff assignment. Uses the shared components, dialogs and the mobile bottom bar, like the other
  management screens.
- **Inventory:** every stock screen follows the active branch; a "Transfers" tab. The all-branch stock overview is read
  only.
- **Order screens:** branch chip and filter (hidden in one-branch mode).
- **Check at 375, 820 and 1440** in the browser with the `playwright-skill` against a throwaway database, at least 3
  workers, own tag, ports and stop file.

### Roles, scope and oversight

The role system (RBAC, [role-based-access](role-based-access.md)) stays as designed: **a user has exactly one role, a role
is a bundle of permission keys, and there are no per-user exceptions.** Branches add one more question, and it is kept
**separate from the role**:

- The **role** says *what* you may do (take orders, count stock, see reports).
- The **scope** says *where*: **All branches**, or **Selected branches** (one or several).

Why separate: otherwise every role would need a copy per branch ("Cashier Makati", "Cashier Cebu"). With scope on the
person, the same Cashier role works in any branch and adding a branch adds no roles.

#### Scope on the person

- `Users.BranchScope` (All or Selected) plus the `UserBranches` rows (used when Selected) and `DefaultBranchId`.
- **Owner is always All** and cannot be limited. Everyone else is set by whoever has the right (below).
- A person with **Selected** scope who is assigned to exactly one branch never sees a picker. Assigned to several, they get
  the picker for those only. **All** gets the picker plus "All branches" (read views).
- **Effective permissions** become: `role keys ∩ plan features ∩ scope`. The scope part removes the *shop-wide* keys from
  anyone limited to selected branches (see the next table), the same way the plan removes out-of-plan keys. The role
  editor shows those rows greyed: "Shop-wide. Needs all branches."
- **Migration:** existing Owner, Admin and Admin Viewer users become **All** (they see everything today, so nothing
  changes); Cashier, Stock Manager and Item Manager users become **Selected: Main**. The first extra branch is therefore
  invisible to a Cashier until someone assigns it.

#### Which permissions are shop-wide and which are per branch

| Kind | Keys (from the RBAC catalog) | Rule |
| ---- | ---------------------------- | ---- |
| **Per branch** (follow the person's scope) | `orders.read/write/override`, `orderlinks.manage`, `stock.read/write`, `stock.waste.record/review`, `stock.transfer` (new), purchasing and receiving keys, `expenses.read/write`, `dashboard.read`, `reports.read`, `reports.generate`, `kitchen.read/update`, `users.read` (for people of those branches) | Only the branches in scope. A record outside the scope answers "not found" |
| **Shop-wide** (need All branches) | `products.write`, `promotions.write`, `items.write`, `inventory.costs.write`, `suppliers.write`, `wastereasons.manage`, `brand.manage`, `subscription.billing`, `roles.manage`, `branches.manage`, `users.write` for All-scope roles, `audit.read` (all branches) | These change things every branch shares (a price, an item, a role). A branch-limited person never gets them, whatever the role says |
| **Shop-wide reads** (allowed to a limited person, read only) | `products.read`, `customers.read/write`, `promotions.read`, `items.read`, `wastereasons.read`, `suppliers.read` | The catalog and customers are shared, so a branch cashier can read them. A cashier may still add a customer (`customers.write`), as today |

`users.write` has a special rule: a person with Selected scope who holds it (the Branch Manager) may create and edit users
**only inside their own branches**, only with roles whose keys they hold themselves, and only with Selected scope. Giving
All scope needs All scope. This is the existing escalation rule ("only grant what you hold") extended to places.

#### Roles that make sense with branches

Two new **system roles** (read-only templates that a release script keeps, like the six today; custom roles still
duplicate them). The Owner role is unchanged.

| Role | New? | Scope normally | Can do | Cannot do |
| ---- | ---- | -------------- | ------ | --------- |
| **Owner** | exists | All (fixed) | Everything, every branch, plus branches, plan and billing | Cannot be limited or removed (last Owner rule) |
| **Area Manager** (overseer) | **new** | All, or Selected (for example 3 of 6 branches) | Sees and runs the branches in scope: orders and overrides, stock, counts, transfers, purchasing, kitchen boards, expenses, all reports and the by-branch comparison, held offline review, staff of those branches | Shop-wide keys (catalog edits, brand, billing, roles, branch management) unless the Owner makes a custom role with All scope |
| **Branch Manager** | **new** | Selected: one branch (or a few) | Everything the Admin does for **their branch**: orders and overrides, Senior/PWD, stock, waste review, receiving, expenses, branch reports, Daily Close, kitchen board, hold review, add and edit staff of their branch | See other branches, edit the shared catalog, prices, promotions, brand, billing, roles |
| **Admin** | exists | All (today's behavior) | As today. In a multi-branch shop an Admin limited to selected branches loses the shop-wide keys and behaves like a Branch Manager | |
| **Admin Viewer** | exists | All, or Selected | Read only. All scope fits an accountant or an investor; Selected scope fits a branch supervisor who watches | Anything that writes |
| **Cashier** | exists | Selected: one branch (several for a floater) | Takes orders, Senior/PWD, customers, own device sync result | Review or override, reports, stock beyond waste |
| **Kitchen** | planned in the kitchen plan | Selected: one branch | The branch board only | Everything else (no prices, no payment) |
| **Stock Manager** | exists | Selected: usually one branch, All for a central warehouse person | Stock, suppliers, receiving, transfers in the scope | Orders, reports, catalog |
| **Item Manager** | exists | **All** only (items are shared) | Item definitions (name, unit, cost) | Stock quantities |

Not proposed: a role per branch, a separate "Accountant" role (Admin Viewer with All scope is that), a "Supervisor"
(Branch Manager or Admin Viewer with Selected scope covers it), per-user exceptions (stays out, as in RBAC).

**Roles still being added by other plans** (Kitchen) are scope-aware from the start: they use the per-branch rule above.

#### How an oversight person works across branches

- **Header switcher:** a menu (bottom sheet at 375) listing the branches in scope plus **All branches**, remembered per
  device and per person. A user opens in their default branch the first time.
- **All branches is for reading.** Dashboard, every report, the order list, stock overview, held orders and Senior/PWD
  claims show the combined view with a branch column and the branch filter in the filters drawer. The **by-branch report**
  puts branches side by side with a total row (the rows must add up to All, tested).
- **Actions follow the record, not the picker.** Opening an order from Cebu while "All branches" is selected lets an
  Area Manager use override on it: the action runs in that order's branch (checked against scope) and is audited with the
  branch.
- **Creating something needs one branch.** New order, stock in, count, transfer, expense: "All branches" is not allowed;
  the app asks the person to pick one (a one-line prompt, no silent default). Transfers name two branches the person may
  use.
- **Kitchen:** an overseer can open any branch's board from the switcher (read, and update if the role has it). The
  dashboard can show waiting counts per branch later.
- **Alerts and notifications** go by permission **and branch**: low-stock for Cebu goes to people who hold stock keys with
  Cebu in scope. An Area Manager receives them for all branches in scope, grouped by branch (a daily digest option so a
  six-branch overseer is not flooded). Held offline orders, aging alerts and waste review follow the same rule.
- **Staff management:** Owner assigns scope to anyone; Area Manager assigns branches inside their own scope; Branch
  Manager manages staff in their own branches only. A person left with no branch cannot sign in and gets a plain message;
  Owner and All-scope users are never left without one.
- **Floaters and covering:** to cover another branch for a day, add that branch to the person's scope (the picker appears
  for them). Optional later: an end date on a branch assignment, so cover expires itself.
- **Audit:** every row carries the branch. Audit shows the branches in the viewer's scope. New actions: `BranchScopeChanged`,
  `BranchAssigned`, `BranchUnassigned`, `BranchClosed`, `StockTransferred`. Switching the picker is not audited; acting is.
- **"Sign in as" from platform admin** keeps the shop user's scope; read-only sign-in strips writes, as today. Platform
  admin never sees branch data on its own.
- **Offline:** the device lease holds the person's role keys (already), their scope and allowed branches. A register
  offline can only sell in branches it knows; the server re-checks at sync, and a removed assignment makes a late sync
  fail into review, not into silence.
- **Plan gating:** `branches` feature carries `branches.read/manage` and the two new system roles. A shop without the
  `branches` feature does not see Area Manager and Branch Manager in its role list (the six built-in ones stay), and scope
  UI is hidden because everyone is on Main. Custom roles stay under the RBAC plan rule (custom roles are a paid feature,
  `customroles` key); scope applies to custom roles the same way. Downgrading keeps roles and scopes stored, they fall
  silent with the plan, so an upgrade restores them.
- **Tests:** a Branch Manager of Makati gets 404 for a Cebu order, item stock, board and report; scope drops shop-wide keys
  from a limited Admin; an Area Manager with 3 of 6 branches sees exactly 3 in "All"; a Branch Manager cannot create an
  All-scope user or grant a key they lack; a removed last branch blocks sign-in with the message; role editor shows greyed
  shop-wide keys; added to `PolicyMatrixTests` and `RouteTableTests`.

New permission keys: `branches.read`, `branches.manage` (Owner by default; Area Manager may get `branches.read`),
`stock.transfer` (Owner, Area Manager, Branch Manager, Stock Manager). All carried by the `branches` feature (transfer also
needs `inventory`). They go into the same role-bundle release script as the other new keys.

### Android and the device

- One APK for all shops and branches. The branch is not part of the install; it is the user's active branch, stored with
  the session (lease) so the register works offline.
- Shared tablets: a "this device is for branch X" setting is possible later (a locked-branch device); not in the first cut.
- Printing and the kitchen board use the device's branch.

### Build phases

Each phase can ship by itself, and phases 1 and 2 change nothing the pilot can see.

1. **Hidden foundation (no visible change).** The script, `IBranchOwned`, the branch lock, `ICurrentBranch` (always Main),
   per-branch order counters, `ItemBranchStock` read and written for Main, the leak and coverage tests. Ships and runs on
   the pilot shop for a while.
2. **Orders and offline carry the branch.** Orders, the offline queue and sync, the order number display, receipts, the
   Senior/PWD and kitchen columns, links. Still one branch only.
3. **Branch management and switcher.** Branches screen, staff assignment, picker, close checklist (OFF scenarios), the
   `branches` key and `MaxBranches`, plan screens in platform admin.
4. **Inventory by branch.** Per-branch stock screens, counts, waste, receiving, purchase orders, par levels, transfers.
5. **Reports and Daily Close by branch.** Picker, by-branch report, workbook option, calculations and shared cases.
6. **Kitchen and hub groups by branch.** Branch boards, hub groups, Kitchen role landing.
7. **Settings by branch.** `VatRegistered`, TIN, address, kitchen switch, receipt header with shop defaults.
8. **End-to-end** on a throwaway database: two shops, three branches, the full ON and OFF tables, the leak test, offline
   sync into the right branch, a closed branch accepting a late sync.
9. **Later phase, so it is not forgotten: price per branch.** `ProductBranches.PriceOverride` (and the same for add-on
   prices and promotion prices). Needs its own short plan first, because it touches money in many places:
   - **Totals:** `WTF.Calculations` takes the branch price when it prices an order line; the Angular mirror and
     `calculation-cases.json` get cases with an override (branch price, no override, override plus promotion, Senior/PWD on
     an overridden price).
   - **Offline:** the device downloads its branch's prices; Offline Phase 7's `CatalogChangeLog` gets a nullable `BranchId`
     so a price change at one branch is judged only for that branch's sales.
   - **Customer link and receipts** show the branch price; reports compare branches on revenue, not on list price.
   - **Editor:** a "Price at each branch" table on the product, empty means the shop price; who may set it (Owner and Area
     Manager, a Branch Manager only if the Owner allows it, a new key such as `products.price.branch`).
   - **Switching off:** closing a branch keeps its prices; a product moved to "all branches" at one price asks which price
     wins. Plan key: part of `branches` or a separate `branchpricing` key (decide then).
   - Open: should a promotion's price follow the branch price, or stay fixed? Decided: a promotion's own price wins.

### Order of work against the other plans

- **Before branches:** Senior/PWD, Offline Phase 7, customer address, plan gating, kitchen. Each must leave a branch-ready
  door (listed below). None needs the branch tables.
- **Plan gating** goes first of those that matter here, because `branches` and `MaxBranches` are rows in its catalog.
- **Inventory phase 8** (suppliers, receiving, purchase orders) is the biggest rework in branch phase 4. If it is merged
  first, its tables get `BranchId` in branch phase 1; if not merged yet, add `BranchId` while building it. Do not build it
  with a per-shop quantity assumption.

**Branch-ready doors to leave open in the five plans (cheap now, expensive later):**

| Plan | Do this while building it |
| ---- | ------------------------- |
| Senior/PWD | Read `VatRegistered` through one "settings for this order" function; keep `BranchId` out of the formula; add `BranchId` to `OrderSeniorPwdDiscounts` when branches arrive |
| Offline Phase 7 | Add a `Version` and a nullable `BranchId` to the queued order shape now; a missing branch means Main; keep `CatalogChangeLog` and the policy per shop |
| Customer address | Nothing needed; keep the address copy on the order |
| Plan gating | Add `MaxBranches` next to `MaxUsers` on the plan (empty means unlimited) and reserve the `branches` key with its two permissions |
| Kitchen | Index and hub group names with a branch part (one branch value today); the "Use kitchen board" setting read through the same settings function |

### Risks

- **A forgotten branch filter** is the same kind of risk as a forgotten shop filter. The wall (global filter) plus the
  leak test is the answer; the stamp on write is in one place.
- **Stock rework.** Moving a single quantity to per-branch rows touches every stock screen and job (alerts, reorder,
  counts). Phase 1 keeps it Main-only to prove the move before anything shows.
- **Order number display.** Prefixes on numbers appear on receipts, chat messages, notifications, push texts and the kitchen
  board. A list of all places is part of phase 2.
- **Offline devices on an old app version** that send no branch: default to Main, add a note.
- **VAT and BIR rules per branch** are from memory and must be confirmed by the accountant.
- **Merging branches** is a trap (number collisions, rewritten history). Refused on purpose.
- **Pricing** (extra branch fee) is a business choice; the cap is data, so changing it is a five-minute job.
- **Shared customers** can surprise an owner who thinks of each branch as separate business.

### The other topics Pogi listed earlier (secondary)

| Topic | Effect of branches |
| ----- | ------------------ |
| Pilot onboarding | Create Main automatically with the shop; assign every user to it; a shop that never adds a branch never sees one |
| Prod-to-UAT refresh | The refresh must carry `Branches`, `UserBranches`, `ItemBranchStock` together, or branch ids on orders point to nothing. Refresh scripts that mask data must keep branch names (not secret) and keep the one-Main rule. Add the leak test to the post-refresh check |
| Android app | Session lease stores the allowed and active branch (above); app id decision (`app.wtf.pos`) is unaffected; a branch picker needs the 375 layout |
| Billing | `MaxBranches` and an optional price per extra branch on the plan; invoices show branch count (manual billing for the pilot) |
| Opening stock counts | Counts are per branch (opening count per branch); the skipped pilot opening counts do not block branches, but a new branch needs its own opening count or a transfer |

### Decisions (Pogi, 13 Nov 2026: all 12 accepted as recommended)

1. **Order numbers per branch with a code prefix, or one shop counter?** Decided: per branch (short numbers for the
   kitchen, clean start per branch).
2. **VAT, TIN and address per branch or per shop?** Decided: per branch with shop default (each branch registers with the
   BIR). **Still to confirm with the accountant before build.**
3. **Products per branch (Pogi, 13 Nov 2026, asked for a suggestion).** Decided: one catalog with a "Sold at" list on
   each product (default all branches; branch-only products are one branch in the list). Same price everywhere in the first
   cut; per-branch price is build phase 9 (below). See "Products and branches".
4. **Customers shared across branches or per branch?** Decided: shared (regulars visit more than one branch).
5. **Plan layout for branches:** Decided: `branches` in Business only, `MaxBranches` 3, extra branch fee later.
6. **Downgrade over the cap:** Decided: keep all working, block adding (as for users). Alternative: newest read-only.
7. **Merging a closed branch into another:** Decided: not offered; platform admin script only on request.
8. **Closing a branch with stock:** Decided: force a transfer or a written-off reason; never silent.
9. **Items cost:** one cost per item for the shop first (transfers move at that cost). Alternative: cost per branch.
10. **Who sets up the second branch in the pilot?** Decided: Pogi from platform admin, with the owner, the first time.
11. **Locked-branch tablets** (kitchen and registers fixed to a branch): later, not in the first cut.
12. **Moving an open order to another branch:** later; audited; not in the first cut.

Only decision 2 stays conditional (accountant). Everything else is closed; reopen by editing this list.

### Docs to update when built

This file, the status in `docs/ROADMAP.md`, the Phase 1 pointer in `multiple-branches-and-tenants.md`, the five plan files
(their "branches" notes), the inventory files (the "no BranchId yet" note), the multi-tenant rollout checklist (create
Main), and the UAT refresh plan.
