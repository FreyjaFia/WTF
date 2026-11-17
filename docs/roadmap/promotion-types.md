## More Promotion Types [Planned, plan only, no code]

Plan written 17 Nov 2026. It builds on "Promotion Ideas for Later" in [promotions](promotions.md) (that list and its
Decisions of 20 Oct still stand: coupon codes are a requirement on any promotion, combo slots are a multi-slot Mix & Match,
loyalty rewards are their own feature). This file turns the list into a build plan: how each type maps onto what exists, what
changes, how it stacks, and the order to build.

### What exists today (the structure to reuse)

| Piece | Where | What it gives a new type |
| ----- | ----- | ------------------------ |
| `Promotions` base row | `Promotion.cs` | `TypeId`, `IsActive`, `StartDate`/`EndDate`, **schedule** (`DaysOfWeek`, `StartTime`, `EndTime`), `MaxRedemptions`, `MaxPerOrder`, `TenantId`, image. All shared by every type |
| Type table keyed by `PromotionId` | `DiscountedProductPromotion`, `FixedBundlePromotion`, `MixMatchPromotion` (+ item and add-on child tables) | The pattern for a new type: one table (or two) with `TenantId` and a tenant filter |
| Line price rule | `PromotionPricing.GetDiscountedUnitPrice`, `DiscountBudget` | Best saving wins per line; a limit can cover only part of a line (the line is split); exact add-on matching |
| Saved on the line | `OrderItems.OriginalPrice`, `Price`, `PromoLabel`, `DiscountPromotionId` | Discount = `OriginalPrice - Price`. **A new line-price type needs no new order columns** |
| Bundle machinery | `BundleRules`, `BundlePromotionResolver`, `OrderBundlePromotions`, `OrderItems.BundlePromotionId` | Header row with qty and unit price, child lines, add-on rules, checked when an order is saved |
| Schedule and limits | `PromotionSchedule`, `PromotionLimitGate`, `PromotionUsage`, voids give uses back | Happy hour windows, weekdays, "first 50 uses", per-order cap: already done for every type |
| Price agreement | `expectedTotal`, `OrderTotalCheck`, `OfflineOrderReview`, `PendingOrderPreview` | The POS quote must equal the server total; a mismatch refuses online sales and holds offline ones for review |
| Display | `PromotionLabelFormatter`, `buildDeals` (Promos tab, customer link `Deals`), `PromotionPerformanceReport` | Labels, cards, per-promotion report |
| Gating | `PlanFeatures.Promotions`, `PromotionsGate` | One plan feature switches all promotions |
| Senior/PWD | `SeniorPwdRules.IsEligibleLine(productEligible, hasPromotion, isBundle)`, `OrderSeniorPwdDiscounts` | A line with a promotion or a bundle is **not** covered (today's rule: never both) |

### The three ways a promotion can change a price

Every idea below fits one of three mechanisms. Naming them keeps the work small: most new types are a new *rule shape* on a
mechanism that already prices, saves, reports and works offline.

- **A. Line price rule** (exists as Discounted Product). A rule decides a unit price for one cart line. Output: the line's
  `Price`, `OriginalPrice`, `PromoLabel`, `DiscountPromotionId`. No new order columns.
- **B. Bundle** (exists as Fixed Bundle and Mix & Match). The customer picks child items, the shop charges a bundle price.
  Output: `OrderBundlePromotions` plus child lines.
- **C. Order-level adjustment** (new, needed only by spend-threshold and a few later types). A discount that belongs to the
  whole order, not a line. Output: a new `OrderPromotionDiscounts` table (`OrderId`, `PromotionId`, `Amount`, `Label`,
  `TenantId`), shaped like `OrderSeniorPwdDiscounts`. Reports show it as its own deduction next to the Senior/PWD one.

Multi-buy ("buy 2 get the cheapest free") is **not** a fourth mechanism: it is mechanism A with a rule that looks across lines
(it picks which units are discounted, then splits lines exactly like a part-covered line today).

### Stacking rules (decide once, applies to every type)

Build these first as a small `PromotionEngine` in `WTF.Calculations` (it replaces the "best saving per line" loop being
copied into create, update, preview and the POS). Order of evaluation:

1. **Bundles** are priced by their header and are not touched by line or order rules (as today).
2. **Line rules (A)**: per unit, the rule that saves the most wins; same saving: lower price, then older promotion. A unit
   takes **one** line rule. (Default "best single discount per line"; a per-promotion `CanCombine` flag stays out of the first
   version. Keep it a future option, not a launch feature.)
3. **Cross-line rules (multi-buy)** choose units among those not already discounted by another rule, unless the owner marked
   the promotion as allowed to replace a smaller one (the saving decides, never both).
4. **Order rules (C)** run last, on the subtotal **after** steps 1 to 3, and never on tips, Senior/PWD-covered lines or
   bundle-only totals unless the owner ticks "count bundles". Several order rules: only the best one applies.
5. **Coupon code** is a gate on any promotion (not a step): without the code the promotion is off.
6. **Senior/PWD** keeps today's rule: a covered line has no promotion. The cashier picks which lines are covered, and the
   cart shows the saving of each choice. A later setting "give the better of the two" is a small change to
   `IsEligibleLine`; confirm with the accountant first (see senior-pwd-discount).
7. **Manual discount with reason** (promotions idea #10, its own plan) is applied after the above and never on a line that
   already has a rule unless a manager confirms.
8. **Floors**: a unit never goes below 0, an order never below 0, and an optional per-promotion `MaxDiscountPerOrder`
   (PHP) caps cross-line and order rules.

Why not stack by default: a cafe owner reading "Happy Hour -20%" plus "Buy 2 Take 1" on one latte cannot predict the price,
and the Senior/PWD law already says the person takes one benefit. The simulator below lets an owner see the winner.

### Promotion types

Size: **S** = about 2 days, **M** = about a week, **L** = more than a week (one developer, including shared calculation
cases, validation, order save paths, offline, UI, seed and tests). Every type also brings the checklist in
[promotions](promotions.md) ("What every new type must bring").

#### 1. Category / sub-category discount, and happy hour [Mechanism A, size S to M] **Build first**

- **What**: 20% off all iced coffee 3 to 6 PM weekdays; PHP 20 off any pastry on Fridays; 10% off Non-Coffee. "Happy hour"
  is this type plus the schedule that already exists (`DaysOfWeek`, `StartTime`, `EndTime`), so no time code is new.
- **Maps to**: Discounted Product with a different **target**. Today the rule row holds one `ProductId`.
- **Changes**:
  - Schema: `DiscountedProductPromotions` gets `TargetKind` (Product / Category / SubCategory), nullable `CategoryId` /
    `SubCategoryId`, `ProductId` becomes nullable (script under `tools/sql`, rescaffold with dbsync). Optional excluded
    products table (`PromotionExcludedProducts`) so "all drinks except bottled water" is possible.
  - Calculations: `PromotionPricing` resolves a product's rules from its own id **and** its category and sub-category (the
    rule list per product becomes a lookup that includes category rules). Same exact-add-on matching: a category rule lists
    no add-ons, so it applies to plain items; allow a "any add-ons" switch for category rules (decide; most shops want it).
  - API: save validation (category exists and is active), handlers for the list and details, the POS evaluate and `GET`
    bundles/promotions DTO get the target.
  - POS: the catalog cache already stores discount rules; add category lookup. The Promos tab (`buildDeals`) cannot make one
    card per product for a category rule: show **one banner card** ("Iced coffee 20% off until 6 PM") and the label on each
    product tile in the picker. Cart label unchanged.
  - Order details, receipts, reports: nothing new (line columns), the promotion report groups by promotion.
- **Stacking**: normal line rule. Competes with a product-specific rule by saving.
- **Plan gating**: `promotions` feature, no new key.
- **Multi-tenancy**: category ids are per tenant already; rule rows carry `TenantId`.
- **Offline**: works from the cached catalog (add category ids to the cached rule). Checked at sale time against the cached
  schedule. A menu change (product moved to another category) is caught by the existing quote-mismatch hold.
- **Risk**: a category rule covers products added later (intended) and may sell below cost; the planned cost warning handles it.

#### 2. Multi-buy and Buy X Get Y [cross-line, mechanism A, size M] **Build second**

- **What**: Buy 1 Take 1 (B1T1, very common in Philippine cafes), 2nd drink 50% off, buy 3 get the cheapest free, 3 pastries
  for PHP 200, buy 5 get the 6th free. Same product, or any product in a category/sub-category ("any 3 pastries").
- **Maps to**: Discounted Product plus the part-covered line splitting (a limit already covers 2 of 3 items and charges the
  rest at list). The new part is *which units* are discounted.
- **Changes**:
  - Schema: new `MultiBuyPromotions` (`PromotionId`, `TargetKind`/`ProductId`/`CategoryId`/`SubCategoryId`, `BuyQuantity`,
    `RewardQuantity`, `RewardKind` = Free / PercentOff / AmountOff / FixedPrice, `RewardValue`, `RewardPick` = Cheapest /
    SameProduct, `Repeat` yes/no). "3 for 200" is `BuyQuantity` 3, `RewardKind` FixedPrice on the group (spread across the 3
    units as whole-cent prices, the last unit takes the remainder so the group sums exactly).
  - Calculations: `MultiBuyRules` takes the cart's eligible units sorted by price and returns the discounted units; lines are
    split by quantity like a limited promotion. Whole-cent allocation, shared cases in `calculation-cases.json` for: 2 for 1,
    odd quantities, different prices (cheapest free), 3 for 200 with 4 items, a limit that stops a repeat.
  - The saved order uses existing line columns; the label reads "Buy 1 Take 1" or "Cheapest free". `MaxPerOrder` and
    `MaxRedemptions` count **rewards given**, not items bought.
  - POS: the cart shows the label on the reward line; a nudge when the cart is one item short ("Add 1 more Latte to get 1
    free"), which sells more and is cheap to add.
- **Stacking**: step 3. Units already discounted by a better line rule are skipped. Add-ons on the free unit are charged
  (decision: the reward covers the base price only, like today's rules), unless the owner ticks "includes add-ons".
- **Plan gating**: `promotions`. **Tenancy**: new table with `TenantId`. **Offline**: pure arithmetic over the cart and cached
  rule, no server needed; same hold on mismatch.
- **Risk**: a cart edit can change which unit is "cheapest"; the cart must recompute, and a void of one line recomputes the
  rest on override (see order-override).

#### 3. Combo slots (multi-slot Mix & Match) [mechanism B, size M] **Build third**

**Update 18 Nov (Pogi):** build this as "Any" on Fixed Bundle items instead: each bundle item is either one product or "any of" a product list, category or sub-category (a slot with its own count). Mix & Match stays as is. Same bundle machinery and `BundleRules` per item; the size and dependencies below do not change. The slot table and the migration script below then belong to `FixedBundlePromotionItems`, and no existing Mix & Match is converted.

- **What**: any drink + any pastry for PHP 199; a "Barkada" set of 4 drinks for PHP 500; a breakfast set until 10 AM
  (combo plus the existing schedule). Already decided in [promotions](promotions.md) (Decision of 20 Oct); listed here for the
  order and size.
- **Changes**: `MixMatchPromotionSlots` (`PromotionId`, `SlotNo`, `Quantity`, source = product list / category /
  sub-category), `MixMatchPromotionProducts` gets a slot id (a script turns each existing promotion into one slot), the
  `BundleRules.CheckMixMatch` check per slot, the picker and editor with slots, and a category source that follows the menu.
- **Stacking, plan, tenancy, offline**: identical to Mix & Match today (bundle header, no line rules inside, cached catalog).
- **Dependency**: none. It can be built in parallel with 2 by a different thread (different files except `BundleRules`).

#### 4. Order spend discount, optionally with a free item [mechanism C, size M]

- **What**: spend PHP 500 get PHP 50 off; spend 400 get 10% off; spend 350 get a free drink of the owner's pick.
- **Changes**:
  - Schema: `SpendPromotions` (`PromotionId`, `MinimumSpend`, `RewardKind` = AmountOff / PercentOff / FreeItem, `RewardValue`,
    `RewardProductId` + add-ons for FreeItem, `CountsBundles`), and `OrderPromotionDiscounts` (mechanism C) for the amount
    off. A **free item** needs no mechanism C: the cashier (or the customer on the link) adds it as a line priced by a
    hidden 100% line rule (`DiscountPromotionId` = this promotion), reusing mechanism A, labels and reports.
  - Calculations: `SpendRules.Evaluate(subtotalAfterLineRules, rules)` on whole cents; the subtotal excludes tips,
    Senior/PWD-covered lines and (by default) bundle lines. The best qualifying rule wins; the cart shows "Spend PHP 120 more
    to get PHP 50 off" (a nudge).
  - Order save: create, update, override, pending preview and the customer submit all call the same rule (they share
    `OrderMetrics`); `OrderMetrics.ExpectedTotal` gains the order discount term next to the Senior/PWD reduction.
  - Reports: new deduction column in daily close, sales summary (`SalesRules`) and the monthly workbook; the promotion
    report counts it under its promotion. A void or refund returns the whole discount, a **partial refund** of a line must
    reduce the discount in proportion (decide: refund at the net price paid, allocate the order discount across lines by
    share when the order is saved, store the allocation per line so reports by product stay true).
  - Customer link: shows the threshold as a banner; the discount line appears in the cart and "My orders".
- **Stacking**: step 4. Never on the Senior/PWD covered portion.
- **Plan gating**: `promotions`. **Tenancy**: new tables with `TenantId`.
- **Offline**: local arithmetic. A sale that crosses the threshold offline is checked at sync (a changed price elsewhere in
  the cart moves the subtotal and the quote then mismatches, so it is held like any other price change).
- **Risk**: rounding of the allocation and refunds; this is the one type that touches the totals pipeline everywhere, so it
  waits for the engine and the Senior/PWD review.

#### 5. Free add-on and size upgrade [mechanism A, size S]

- **What**: free oat milk with a pastry, "Large for the price of Regular", free extra shot on Mondays, PHP 10 off with your
  own cup (reusable cup, add-on style).
- **Maps to**: a Discounted Product rule that already matches exact add-ons (the rule says "Latte + Large + Oat").
- **Changes**: small. Add an **add-on price override** on the rule's add-on rows (`DiscountedProductPromotionAddOns.PriceOverride`,
  nullable) so the rule can make an add-on free or cheaper, instead of an amount off the base price that drifts when prices
  change. `OriginalPrice` then includes the list add-on cost, so the discount shown is the real saving. The editor gets a
  preset ("Free add-on", "Size upgrade", "Own cup") that fills the rule. A per-day limit for the cup type needs
  `MaxPerDay` (nullable, generic, also useful for "first 30 drinks each day"); it goes through `PromotionLimitGate`/`PromotionUsage`.
- **Stacking**: normal line rule. **Plan, tenancy, offline**: as type 1.
- **Check first**: add-on prices are per product (`addOnOverridePrices` in `OrderMetrics`); make sure the override takes
  precedence only inside a matched rule.

#### 6. Coupon codes [gate on any promotion, size M to L]

- **What**: a typed code (WTF10, a flyer code, a one-per-customer birthday code) that unlocks a promotion.
- **Design** (decided 20 Oct, restated): `Promotions.RequiresCode`, `PromotionCodes` (code, uses allowed, per customer,
  expiry), `PromotionCodeRedemptions` (held at save, returned on cancel/refund like `DiscountBudget`). Per-tenant unique code
  (`TenantId` + code). The POS and link send the typed code; the server decides.
- **Order saving**: the code is stored on the order (`Orders.PromotionCode`), so reports can show uses per code. A code
  without a promotion left or a used-up code returns the same message as a wrong code.
- **Public page**: rate limited per address and per link (the login limiter is the model, and the audit still lists login
  rate limiting as open: build one shared limiter).
- **Stacking**: a code unlocks one promotion; whether it also stops other rules (exclusive code) is a flag on the code.
- **Plan gating**: its own feature key `coupons` that needs `promotions` (`PlanFeatures.Catalog` already supports `Needs`),
  because it adds a public input and support load; a cheap plan can keep plain promotions.
- **Offline**: **the POS refuses codes while offline** (recommended; simplest and safest). The alternative, holding the sale
  at sync, creates review work for a feature people use for marketing, not for rush hour.

#### 7. Customer-based promotions: first order, returning, birthday, staff [size S to M]

- **What**: first order on the customer link PHP 50 off; returning customer deal; birthday-month drink; staff price.
- **Changes**: `Promotions.Audience` (Everyone / NewCustomer / Returning / ListedCustomers / Staff) plus a customer list
  table for "listed". The server decides from order history (`NewCustomer` = no completed order), staff by user/role. Any
  promotion type can have an audience, so this is a setting on the base row, not a type.
- **Stacking**: normal. **Privacy**: show only the label to the customer, never "you are new".
- **Offline**: the POS only has cached customers; "new/returning" is decided from a cached order count flag. The server
  re-checks at sync (a mismatch holds the sale as a price change).
- **Risk**: a walk-in has no customer record, so these only fire for identified customers; document it.

#### 8. Payment-method promotion [size S, after Cashless Payments]

5% off when paying by GCash/QR. Decided at checkout (the price depends on the tender), so it is a mechanism C row, and the
customer link must not show it (the payment is chosen later). Do not offer it for the unverified GCash fallback. Wait for
[cashless-payments](cashless-payments.md).

#### 9. Loyalty rewards and stamp cards [own feature, size L]

Stays as decided: spends points, reuses promotion pricing through a hidden rule. Needs the engine and coupon redemption
patterns first (a reward is a single-use code in effect). Plan it as its own file when started. A stamp card ("buy 9,
10th free") is multi-buy over time per customer.

#### Other ideas, later or not recommended now

| Idea | Verdict |
| ---- | ------- |
| Bring-a-friend / "barkada" price | Multi-buy (2) or combo slots (3); no new type |
| Meryenda set (drink + pastry 2 to 5 PM) | Combo slots (3) with the existing schedule |
| Product of the day / slow-day special | Discounted Product with a weekday mask: already possible, only needs a "Today's deals" card order on the Promos tab |
| Limited stock "last 10 slices" | `MaxRedemptions` already does it; add a "left today" badge |
| Pre-order / pickup discount, free delivery over X | Customer link only; wait until a delivery fee exists (see customer-ordering-links) |
| Clearance by stock or near expiry | Needs expiry dates and order-time stock deduction first |
| Gift cards, prepaid credit | A payment method with a ledger, not a promotion |
| Referral | Needs coupons and customer identity first |
| Student discount | An ID-checked audience, like Senior/PWD; ask the owner if wanted before building anything |

### Cross-cutting changes

- **`PromotionEngine`** (`WTF.Calculations/Orders`): one function from `(cart lines, active rules, customer facts, budget,
  time)` to `(line prices, labels, order adjustments)`, mirrored in `shared/calculations`, with new sections in
  `calculation-cases.json` (tests in `WTF.Tests/Calculations`, Angular specs load the same file). Create, update, override,
  pending preview, offline review and the customer link all call it; today they each copy the loop.
- **Type ids**: `PromotionTypeIds` gets `MultiBuy = 4`, `Spend = 5` (category and add-on variants reuse type 3; combo slots
  reuse type 2). Add a registry so the list, editor routes and validation do not switch on ids in many places.
- **Editor**: one "New promotion" chooser with plain language ("Discount a product or category", "Buy X get Y", "Combo",
  "Spend and save") and presets (Happy hour, Buy 1 Take 1, Free add-on). Keep the existing type routes.
- **Simulator and draft state** (from the guardrails): pick a cart and see each promotion's price and the winner; a `Draft`
  status shown to staff before going live. Build the simulator with the engine, since it is the engine run on a fake cart.
- **Reports**: promotion performance gets discount given (line and order level), uses, revenue on promoted lines, and a "cost
  vs list" column; daily close and workbook get the order-level deduction. Gross stays at list price.
- **Audit** entries for promotion create, update, delete, restore (still open from the audit); do them once for all types.
- **Plan gating**: new types sit under `promotions`; only coupons (and later loyalty) get their own keys. Pricing paths
  check `PromotionsGate`, so a downgraded tenant stops getting discounts on new orders but keeps saved ones. Saving a new
  promotion of any type returns the existing "Not in your plan" response.
- **Multi-tenancy**: every new table has `TenantId`, a global query filter and the `TenantOwnedEntities` registration, unique
  indexes include `TenantId` (codes), public endpoints resolve the tenant from the link and never from the code.
  Promotions are shop-wide today; when multiple branches land, add an optional branch scope list per promotion (default all
  branches). Coordinate with [multiple-branches-and-tenants](multiple-branches-and-tenants.md).
- **Offline**: the catalog cache gains the new rule shapes (version the cache), the POS evaluates with the shared
  calculations, `OfflineOrderReview` already holds a sale whose quote the server cannot reproduce; add reason codes only for
  coupons (refused offline) and audience checks. Phase 7 (offline sync policy) must be merged first or built against: its
  `AllowOffline` flag applies to every new type, default off for limited promotions.
- **SQL and dbsync**: each type is a script in `tools/sql` run on `.\SQLEXPRESS`, then `tools\dbsync.bat`, with data scripts
  idempotent. Dates must not collide with the other open branches' scripts.
- **Staging seed** (`src/WTF.StagingSeed`): each type ships with believable data in the same task, for example "Iced Coffee
  Happy Hour, 20% off 3 to 6 PM", "Buy 1 Take 1 Croissant on Fridays", "Merienda Combo: any drink + any pastry for 199",
  "Spend 500, save 50". Totals come from `WTF.Calculations`; no passwords, no "test" text.
- **Tests**: shared cases for every rule, handler tests for save validation and the saved totals, offline review tests, and a
  Playwright run on a throwaway database for the cart, label and order details at 375, 820 and 1440.

### Recommended build order

| Step | Work | Size | Why here |
| ---- | ---- | ---- | -------- |
| 0 | Engine, stacking rules, type registry, simulator, promotion audit entries | M | Everything after plugs into it; avoids four copies of the loop |
| 1 | Category / sub-category discount and happy hour presets (type 1) | S to M | Biggest cafe value for the least change; reuses line rules, schedule and offline cache |
| 2 | Multi-buy / B1T1 (type 2) | M | The most requested cafe promotion; no new order columns |
| 3 | Combo slots (type 3) | M | Reuses bundles; can run in parallel with step 2 |
| 4 | Free add-on / upgrade presets and per-day limit (type 5) | S | Cheap once rules and presets exist |
| 5 | Order spend discount and free item (type 4) | M | Touches totals and reports everywhere; do it after the engine is proven |
| 6 | Coupon codes (type 6) | M to L | Needs the shared rate limiter; unlocks campaigns for every type |
| 7 | Customer audiences (type 7) | S to M | A setting on the base row |
| 8 | Payment-method promo (type 8) | S | After Cashless Payments |
| 9 | Loyalty rewards and stamp cards (type 9) | L | Own plan, builds on coupons and the engine |

Recommended first batch: **0, 1, 2 and 3** (with 3 parallel to 2). Each step is its own branch off latest main, replayed
linear, shipped on its own.

### Open questions for Pogi

1. Is "best single discount per line, never stacked" acceptable as the permanent default? (Recommended: yes.)
2. For Buy 1 Take 1, should the free item's add-ons be charged? (Recommended: yes, the reward covers the base price.)
3. Should coupon codes work offline? (Recommended: no, refuse at the POS.)
4. Should an order spend discount apply to bundles, and to the Senior/PWD-covered part? (Recommended: no to both, and ask
   the accountant for the Senior/PWD side.)
5. Do pilot shops already run a paper promotion (stamp cards, "B1T1 Mondays")? That decides the first preset to ship.
6. Should promotions be scoped per branch when branches arrive, or stay shop-wide?

### More ideas, round 2 (18 Nov 2026)

All fit the engine from step 0, so they stay consistent with the rest. "Fits" names the mechanism it reuses.

| # | Idea | Example | Fits | Size | Value |
| - | ---- | ------- | ---- | ---- | ----- |
| A | **Add-on bundle price** | Any 2 add-ons for PHP 30, extra shot + syrup PHP 25 | Multi-buy on add-ons (A) | S once multi-buy exists | Medium |
| B | **Upsell nudge price** | Add a croissant to any drink for PHP 60 (instead of 95) | Line rule with a trigger product in the cart | M | High |
| C | **Time-limited flash price** | Today only: PHP 99 Iced Latte until sold out | Discounted Product + `MaxRedemptions` (exists), add a "Today" preset | S | Medium |
| D | **Tiered quantity pricing** | Buy 3 pay 90 each, buy 6 pay 80 each | Multi-buy with tiers | S to M | Medium |
| E | **Spend tiers** | 500 save 50, 1000 save 150 | Spend rule with several tiers, best tier wins | S on top of spend | Medium |
| F | **Cash / pickup incentive** | Pre-order and pick up before 9 AM: 10% off | Order rule (C) with a pickup-time condition, customer link | M | Medium |
| G | **Loyalty tier price** | Regular customers (10+ orders) get PHP 10 off drinks | Audience (type 7) on a line rule | S after audiences | Medium |
| H | **Bulk / catering price** | 20+ cups: PHP 75 each, set a pickup date | Tiered quantity pricing with a minimum order | S to M | Medium (offices) |
| I | **Off-peak boost** | Auto 10% off in slow hours, from the hourly sales report | Happy hour preset fed by the hourly report | S (just a preset and a suggestion) | Medium |
| J | **Bundle upgrade at checkout** | Make it a combo: add fries and a drink for PHP 80 | Combo slots started from a cart item | M | High |
| K | **Happy-hour for a group of staff or students** | ID-checked student price | Audience, ID capture like Senior/PWD; ask first | M | Low to medium |
| L | **Seasonal / holiday campaigns** | Christmas set, Valentine's pair | Any type plus a start and end date and an image (exists) | none | Medium |
| M | **Donation or round-up** | Round up to the next PHP 10 for a cause | Not a discount; a charge line, needs accounting | M | Low |

**My picks from this list:** B (upsell nudge) and J (make it a combo) raise the average order, not just give discounts, and
E/D are cheap once spend and multi-buy exist. I would skip K and M until a shop asks.

Consistency note: A to H and L reuse the same rule shape and engine, so they add rows and editor presets rather than new
order columns. Only B and J need a "trigger" idea (a rule that fires because another item is in the cart); build that once
inside the engine so multi-buy, spend and these share it.

### Conditions on any promotion (Pogi, 18 Nov)

Instead of a separate type for each trigger, any promotion can carry optional **conditions** that must hold before it applies:
a **trigger item** in the cart (a product, category or sub-category, with a count), a **minimum spend**, a **customer
audience**, a **coupon code**, a **payment method**. A promotion with no conditions behaves exactly as today. This folds
the upsell nudge, the spend threshold's "minimum", audiences and coupons into one idea, with one editor section
("Applies when...") and one `PromotionConditions` table (`PromotionId`, `Kind`, target ids, value, `TenantId`).

- The engine checks conditions before pricing a rule; all conditions must hold (AND, no OR in the first version).
- A trigger item is not discounted by the rule unless it is also the target; a unit can count as a trigger for one
  promotion and a target for another.
- The cart shows what is missing ("Add any drink to get the croissant for ₱60"), the same nudge as spend.
- Offline: item and spend conditions are local arithmetic; code and audience keep the offline rules above.
- Build order: the condition model goes into step 0 (engine) with trigger item and minimum spend; code, audience and
  payment method join as their steps arrive, so no step needs its own special case.

### Clash prevention: scenarios and tests (Pogi, 18 Nov)

Rule: a new promotion type is not done until it passes every scenario below with the types that already exist. The
scenarios are rows in `calculation-cases.json` (both the API and Angular tests run them), plus handler tests for the saved
order and Playwright runs for the cart. Expected prices are worked by hand in the case file, never copied from output.

**Properties checked on random carts (property tests, like `senior-pwd.property.spec.ts`)**

- A unit is discounted by at most one line rule; total discount never exceeds the list price; no line or order below 0.
- Result does not depend on the order lines were added or on how the rules are listed (permute both, same totals).
- Adding a promotion never raises any price; ending a promotion returns the list price.
- The POS (Angular) total equals the API total for the same cart, with and without Senior/PWD, offline quote included.
- Whole-cent sums: line prices plus order adjustments equal the order total exactly.
- Usage limits: concurrent orders never use more than the limit (the existing ten-register test), and voids give back
  exactly the uses taken, including split lines and order-level rules.

**Scenario matrix (every pair, at least the ones in bold)**

| Scenario | Expected |
| -------- | -------- |
| **Product rule and category rule on one latte** | Bigger saving wins; same saving: lower price, then older promotion; one label |
| **Happy hour window and a weekday rule overlap** | Both are "line rules"; best wins; outside the window only the other applies |
| **Multi-buy over units one rule already discounted** | Those units are skipped; the rest count toward buy-X |
| **Multi-buy with a limit smaller than the reward** | Line split into discounted and full-price parts; limit counts rewards, not items |
| **Bundle with any-of items and a category rule on the same drink** | The drink inside the bundle gets no line rule; the bundle price stands |
| **Two bundles that can both claim the same cart items** | Deterministic: the cheaper result for the customer, the bundle choice is stored on the order; picking is by the cashier, so no double claim |
| **Spend discount with a rule-discounted cart** | The threshold uses the subtotal after line rules; crossing the line only because of a list price does not qualify |
| **Spend discount and Senior/PWD** | Covered lines and tips are excluded from the spend subtotal and from the discount |
| **Trigger item is also the target** | One unit cannot be both unless the cart has two (explicit count rule) |
| **Trigger removed after the discount applied** | Cart reprices at once; on an open order edit the discount is removed |
| **Coupon on a promotion that another rule also covers** | The code unlocks its promotion; best saving still wins unless the code is marked exclusive |
| **Two coupons on one order** | Only the best one applies, the other is refused with the same wording as a wrong code |
| **Audience rule (first order) after the first order is a pending order** | A pending or held order counts as the first order; a cancelled one does not |
| **Order override of a completed order** | Existing lines keep the price they were sold at; only new lines are priced today; an ended promotion is not re-applied |
| **Partial refund / void line** | Order-level discounts are re-spread by the stored allocation; refund equals what was paid for that line |
| **Offline sale, promotion ended or limit used before sync** | Same holds as today (quote mismatch), plus a new check for each new rule shape |
| **Plan downgrade while promotions exist** | New orders get no discounts, saved orders keep theirs, the editor shows "Not in your plan" |
| **Another shop's promotion** | Never applied, never listed (tenant filter), checked per new table |
| **Timezone** | Windows follow Asia/Manila, including a window past midnight and the day-of-week of the part after midnight |
| **Price change between cart and save** | `expectedTotal` mismatch is refused with the new total; works for all new rule shapes |

**Conflict check at save time.** When an owner saves an active promotion, the editor lists other active promotions that
cover the same products or categories at the same time ("Overlaps with Happy Hour, which would win for Iced Latte"), using
the simulator. It warns but does not block; a rule that can never win (always beaten) is flagged as useless.

**Process.** Step 0 ships the scenario matrix with the three existing types first (so the engine is proven against today's
behaviour with no price changes), then every later step adds its rows. Run the full matrix in CI on each promotion change.
