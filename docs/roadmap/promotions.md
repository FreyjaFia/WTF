## Promotions / Bundles Feature [Phase 1 Completed]

### Implemented Scope

| Promo Type | Phase | Status |
| ---------- | ----- | ------ |
| Fixed Bundle (Preset Combo) | Phase 1 | [Completed] |
| Mix & Match (Choose from category) | Phase 1 | [Completed] |
| Buy X Get Y (BXGY) | Phase 1 (legacy) | Replaced by Mix & Match |
| Percentage Discount (Category-based) | Phase 2+ | Future |
| Time-Based Promo | Phase 2+ | Future |
| Order Amount Discount (Spend X Get Y Off) | Phase 2+ | Future |
| Add-On Upsell Promo | Phase 2+ | Future |
| Free Size Upgrade | Phase 2+ | Future |
| Limited Quantity Promo | Phase 2+ | Future |

### Implemented Database

- `Promotions` base table implemented with:
  - `TypeId`, `IsActive`, `StartDate`, `EndDate`
  - audit columns: `CreatedAt`, `CreatedBy`, `UpdatedAt`, `UpdatedBy`
- Promotion image mapping implemented using centralized image table:
  - `PromotionImages` -> `Images`
- Type tables implemented:
  - `FixedBundlePromotions`, `FixedBundlePromotionItems`, add-on mappings
  - `MixMatchPromotions`, `MixMatchPromotionProducts`, add-on mappings
- Order-level bundle tracking implemented:
  - `OrderItems.BundlePromotionId`
  - `OrderBundlePromotions` for sold bundle header rows (qty + unit price)

### Implemented API (Vertical Slices)

- Admin fixed bundle:
  - `POST/GET/PUT/DELETE /api/management/promotions/fixed-bundles`
- Admin mix & match:
  - `POST/GET/PUT/DELETE /api/management/promotions/mix-match`
- POS promotions:
  - `POST /api/pos/promotions/evaluate` (not called by the app; see Sales Reporting Phase 3, "Still open")
- Promotion image endpoints implemented under management promotions.

### Implemented Domain Logic

- Explicit type-based logic (no generic rule engine yet).
- Idempotent promotion evaluation flow.
- Loop prevention rules for promo-produced lines.
- Validation added for:
  - inactive/expired promotions (timezone-aware)
  - inactive/missing products and add-ons
- Global API exception mapping added:
  - `InvalidOperationException` and `ArgumentException` return `400` with user-facing message.

### Implemented Frontend (Management + POS)

- Promotions management list/details/editor implemented and aligned to existing management design language.
- Typed promotion routes implemented:
  - `/management/promotions/fixed-bundles/:id`
  - `/management/promotions/mix-match/:id`
- Promotion images supported in details/editor using centralized image flow.
- Date UX uses local timezone display while persisted values remain UTC.
- Bundle item selector supports linked add-on constraints and required rules.

### Implemented Order Flow Integration

- New bundles tab added in order editor.
- Bundle promotions render as product-like cards (image/name/price).
- Selected bundles are represented as a grouped bundle line with child items in cart, checkout summary, and order summaries.
- Bundle quantity editing supports reopen/reselect behavior and max-selection rules for mix & match.
- Grouped item/add-on display and sorting standardized across cart, order details, and generated summaries.
- Mobile cart includes collapsible order-actions/details section (notes, totals, actions).
- Discounted-product promotions are captured on the order line when the price is saved (`OrderItems.OriginalPrice` and `PromoLabel`, added by `tools/sql/20261010_add_order_item_promo_details.sql`). The discount is `OriginalPrice - Price`, and the server writes the label, so new promotion types need no new columns. Order details, the downloadable summary, and the Payment Summary total discount read the stored values, so percent promotions, promotions larger than the price (free items), and ended promotions display correctly. Orders saved before this keep the previous best-effort display from the promotions active today. Bundle promotions are not included in the total discount.
- A final unit price of zero is allowed for products and bundles (for example a promotion that covers the whole price); only negative prices are rejected, in the product selector, the editor cart, and the server.

### Implemented Reporting/Dashboard Integration

- Dashboard and report totals updated to include bundle header sales correctly.
- Product sales breakdown supports promotions category/type filtering.
- Bundle sales treated as bundle product rows in top-selling/product breakdown contexts.
- Workbook/Excel/PDF report labels updated where subcategory/type wording applies.

### Phase 2+ Expansion Notes

- Keep explicit evaluators per promo type while scope is small.
- Introduce a shared `PromoEngine` orchestrator only when multiple additional promo types are live.
- Future candidates:
  - percentage/category discounts
  - time-window promos
  - spend-threshold promos
  - add-on upsell/upgrade promos
  - limited-quantity promos

### Post-Phase 1 Follow-up (Planned)

Enable configurable add-ons on bundled child products during order building for both:

- Fixed Bundle
- Mix & Match

Planned behavior:

- Cashier can select allowed add-ons per bundled child item in POS (not only preselected/default add-ons).
- Add-on validation still follows existing product add-on rules (`required`, `max`, add-on type constraints).
- Bundle pricing remains promo-defined at bundle header level; child add-ons are tracked per selected child item for audit/report detail.
- Cart, checkout summary, order details, and receipt rendering include selected child add-ons under each bundled child line.

Planned implementation slices:

- Admin promotion payload support for child-item add-on policy mode (`locked defaults` vs `cashier selectable`).
- POS selector enhancements for bundled child item add-on picking.
- Order persistence mapping for selected bundled child add-ons.
- Reporting review to ensure bundled child add-on selections are represented consistently where needed.


### Promotion Ideas for Later (20 Oct 2026) [Ideas, none started]

Ideas beyond the three types that exist (Fixed Bundle, Mix & Match, Discounted Product). The older "Phase 2+" table above
already lists percentage/category discounts, spend thresholds, add-on upsell, free size upgrade; they are included here with
a rough value and effort. Schedule (days and hours), usage limits (`MaxRedemptions`) and `MaxPerOrder` already exist for all
three types and are reused by every idea below.

**What every new type must bring** (the checklist from the audit, so none is half built)

1. The arithmetic in `WTF.Calculations` and in `shared/calculations`, with sample answers in `calculation-cases.json`.
2. Validation when the promotion is saved (products and add-ons exist, active, required add-ons satisfiable).
3. Pricing when an order is saved (create, update, offline sync review, pending-order preview) and the `expectedTotal` check.
4. The Promos tab, the cart label, order details, receipt, and the customer link page (`PublicCatalogDto.Deals`).
5. Offline: saved in the catalog cache; sync review holds a sale when the quote no longer matches.
6. Reports: discount given per promotion (`OrderItem.OriginalPrice` vs `Price`, `DiscountPromotionId`), uses, voids giving uses back.
7. Audit entries for create, update, delete and restore (still missing for the existing types).

**Prerequisite: stacking rules.** Today one discount per line and bundle lines are left alone. Before adding a third or
fourth type, define what happens when two apply: a priority per promotion, "best price wins" as the default, an optional
"cannot combine" flag, and an order-level cap (a discount never goes below zero and never above a set share of the order).
This is the "shared `PromoEngine` orchestrator" the notes above say to build when several types are live; do it first.

| # | Idea | What it does | Value | Effort / notes |
| - | ---- | ------------ | ----- | -------------- |
| 1 | **Multi-buy** | 3 for PHP 200, 2nd item 50% off, buy 2 get the cheapest free, buy 5 get 1 free | High | Medium. Same product (or category) across lines; pairs with `MaxPerOrder`. Lines are split like the part-covered lines already are |
| 2 | **Category / sub-category discount** | 10% off all Non-Coffee, PHP 20 off any pastry | High | Low to medium. Like Discounted Product but the rule targets a category; the list of covered products changes as the menu does |
| 3 | **Order amount discount** | Spend 500 get 50 off, or spend 400 get a free drink | High | Medium. Needs a minimum spend, which was left out of the first version on purpose; define whether it uses the total before or after other discounts, and how tips and delivery are treated |
| 4 | **Combo slots** | Any drink + any pastry for 199 (one slot per category) | High | Medium. Decided: built as a multi-slot Mix & Match, each slot with its own list, category or sub-category (see Decisions below); the bundle machinery (child lines, add-on rules) is reused |
| 5 | **Free size upgrade / add-on upsell** | Large for the price of Regular, free oat milk with a pastry | Medium | Medium. A discount on a Size or add-on line, only when the add-on matches; reuses the exact add-on matching rules |
| 6 | **Coupon codes** | Typed code, single use or limited, optional per customer or expiry; on the customer link too | High | Medium. Decided: a "requires a code" setting on any promotion, not a new type. A `PromotionCodes` table with its own redemptions; must be rate limited on the public page against guessing |
| 7 | **Loyalty rewards** | Redeem points for a free drink or a discount, stamp card (buy 9, 10th free), birthday treat, nth visit | High | Medium to high. Decided: its own feature on top of promotions (Rewards tab). Loyalty points already exist; this spends them. Needs a points ledger entry per redemption and care that a refund returns the points |
| 8 | **Customer-based pricing** | First order discount on the customer link, returning-customer deal, staff/employee price | Medium | Low. A promotion with an audience (everyone, new, returning, listed customers or a customer group); "new" uses the order history |
| 9 | **Senior citizen / PWD discount** | Moved to its own section, "POS Checkout Discounts (Senior Citizen / PWD)" below. It is a statutory discount applied at the register, not a marketing promotion | | |
| 10 | **Manual discount with reason** | A cashier or manager applies a discount to a line or the order (spoilage, complaint, goodwill) | High | Low to medium. Role-limited (cashier up to a set percent, larger needs an Admin PIN or approval), reason required, audited, shown in reports as a separate line from promotions |
| 11 | **Payment-method promo** | 5% off when paying with GCash/QR | Medium | Low once Cashless Payments exist. The discount is decided at checkout; do not offer it for the unverified GCash fallback |
| 12 | **Pickup / delivery incentives** | Free delivery over a set amount, off-peak pickup discount, pre-order discount | Medium | Low to medium. Customer link only; delivery has no fee in the app today, so a fee needs designing first |
| 13 | **Reusable cup / bring-your-own** | PHP 10 off with your own cup | Medium | Low. Already close to a negative-priced add-on; make it a labelled promo with a limit per day so it cannot be abused |
| 14 | **Clearance by stock** | Discount a product automatically when its linked item is at the warning level or near expiry | Medium | High. Needs order-time stock deduction and expiry dates first; list as a later add-on to Inventory |
| 15 | **Gift cards / prepaid credit** | Sell a card, spend the balance later | Medium | High. Not a discount but a payment method with a balance; needs a ledger, refunds and fraud checks. Consider after Cashless Payments |
| 16 | **Referral** | Customer link: share a code, both get a reward | Low to medium | High. Needs coupon codes and customer identity first |

**Decisions (20 Oct 2026)**

- **Coupon codes (#6) are a requirement on any promotion, not a new promotion type.** A promotion gets an optional "requires
  a code" setting. A `PromotionCodes` table holds the codes (single use, limited uses, per customer, expiry) and a
  `PromotionCodeRedemptions` table records each use. A code unlocks a promotion that is otherwise hidden, so it works with
  every existing and future type and is the easiest way to run a campaign (flyers, social posts, referrals later). Rules:
  - The server checks the code when an order is saved; the POS and the customer link only send what was typed.
  - Redemptions are held from the moment an order is saved and given back when it is cancelled, rejected or refunded, like
    usage limits today (`DiscountBudget`).
  - On the public page the code box is rate limited per address and per link, with the same answer for a wrong, expired or
    used-up code, so codes cannot be guessed.
  - A code never appears in the customer's `Deals` list until it is entered.
  - Offline: a code cannot be checked offline, so an offline sale with a code is held for review by the sync, like other
    changed-catalog cases, or the POS refuses codes while offline (decide).
- **Combo slots (#4) are a multi-slot Mix & Match, not a new type.** A Mix & Match promotion gets several **slots**; each slot
  has its own source (a product list, a category or a sub-category) and a count, plus the bundle price. Example: Drink slot
  (Coffee sub-category, 1) + Pastry slot (Snacks sub-category, 1) for 199. Today's Mix & Match is the one-slot case, so
  existing promotions keep working (a script turns each into one slot). Reuses the bundle machinery (child lines, add-on
  rules, `MaxPerOrder`, usage limits, offline catalog, `BundleRules` checks). Work to do: slots in the editor and the bundle
  picker, `BundleRules` checking each slot, and a category/sub-category source that follows the menu as it changes (a product
  added to the sub-category joins the slot at once).
- **Loyalty rewards (#7) are their own feature that builds on promotions.** A promotion is a rule on products; a reward is
  something a customer spends points on. It needs a points balance, a ledger (earned, redeemed, returned) and refund handling,
  none of which belong in the promotion tables. It reuses promotion pricing: redeeming attaches a hidden discounted-product
  or bundle rule to the order, so totals, labels, receipts and reports come from code that already exists. In the UI it shows
  as a Rewards tab next to Promos; the reward rules are edited under Management > Loyalty. Includes stamp cards (buy 9, the
  10th free), a birthday treat and nth-visit rewards. Plan it as a separate section when it is started.

**Suggested order (value over effort):** stacking rules and the engine; manual discount with reason (#10); senior/PWD (own
section above, confirm the rules first); coupon codes as a promotion requirement (#6); category discount (#2); multi-buy
(#1); multi-slot Mix & Match (#4); order amount (#3); loyalty rewards (#7); the rest on demand.

**Guardrails to build once and apply to every type**

- A promotion can be saved as a draft or in "preview" and shown to staff only, before it goes live.
- A report of what each promotion cost (discount given, uses, revenue on the promoted lines) so an owner can end one that
  loses money. A warning in the editor when the discount makes a product sell below its linked item cost (when cost exists).
- A simulator on the promotion page: pick a cart, see the price each active promotion would give and which wins.
- Per-promotion audit entries and an "ended" status that the list and details actually show (still open from the audit).

**Open questions**

- Should discounts ever stack by default, or is "best single discount per line" the rule for good?
- Is the senior/PWD discount required for the shop's registration (ask the accountant), and does the shop issue VAT receipts?
- Who may give a manual discount, and up to how much without approval?
- Are coupon codes wanted on the customer link, and should one customer be able to use the same code twice?

### Promotions Audit (18 Oct 2026)

Audited the API and the screens, and reproduced each bug on a throwaway database.

**Fixed (server, checked by hand on a throwaway database and by tests)**

- **Bundle contents are checked when an order is saved** (`WTF.Calculations/Orders/BundleRules`, used through `WTF.Api/Common/Orders/BundlePromotionResolver` by both the create and the update handler, replacing two copies). A fixed bundle needs exactly its products, at its quantity times the bundle quantity, with exactly its add-ons. A mix & match needs its required count times the bundle quantity, only listed products, and no product above the per-order maximum times the bundle quantity. A mismatch is a 400 that names the bundle and the product. Before this, a "2 Lattes" bundle with one Croissant in it was billed at the bundle price.
- **A completed order can still be corrected after its bundle ends.** In the override flow a bundle already on the order keeps the price it was sold at and is not re-checked. Adding an ended bundle to an order is still refused.
- **Promotion save validation:** products and add-ons must exist (a missing one used to be a 500), be active, and an add-on cannot be the sold product; a fixed bundle cannot list a product twice (was a 500) or have a negative price; names over 100 characters give a 400 (was a 500). An inactive promotion may still list products that have been deactivated since (`PromotionProductValidation`).

**Done after the audit:** the offline flow (see Offline Phase 6).

**Review of the three promotion types (18 Oct 2026), all fixed 19 Oct 2026**

Findings, and what was done (uncommitted at the time of writing; SQL script `tools/sql/20261019_add_promotion_schedule_and_limits.sql`, run it before deploying the API):

1. **Cashiers can sell bundles.** `GET /api/pos/promotions/bundles` (`OrdersWrite`) returns the active fixed bundles and mix & match promotions with their items and uses. The POS uses it instead of the management endpoints.
2. **Bundles work offline.** The POS saves the bundles (with items) and every discounted-product promotion in the catalog cache (`CatalogCacheService.getFixedBundle/getMixMatch`), so a bundle opens without the server.
3. **No bundle that can never be sold.** Saving a Fixed Bundle, Mix & Match or Discounted Product checks each product's required add-on types (`PromotionAddOnRules`): exactly one Size and one Flavor when the product has that type, at most one Sauce.
4. **Discounted Product rule for plain products.** A rule that lists no add-ons is for the plain product only (an item with no add-ons); a rule that lists add-ons matches exactly those. Required Size/Flavor must be listed, optional add-ons may be left out. The API and the POS run the same shared cases.
5. **Schedule and usage limit for all three types** (`Promotions.DaysOfWeek` bit mask Sunday=1 to Saturday=64, `StartTime`, `EndTime`, `MaxRedemptions`; `WTF.Calculations/Orders/PromotionSchedule` and `DiscountBudget`, and `shared/calculations/promotion-schedule.ts`). Days: null means every day. Times: both or neither, the end is excluded, an end before the start runs past midnight, and the weekday is the day the moment falls on. The server uses the request `X-TimeZone`, the POS the device time. A bundle uses its quantity per sale, a discount one use per discounted item (`OrderItems.DiscountPromotionId`); cancelled and refunded orders give their uses back. A rule with fewer uses left than the line's quantity is skipped, and a bundle sold above what is left is a 400. The editor has a Schedule and limit card, and the list and details show days, hours and uses. A minimum spend was left out on purpose.
6. **Naming.** Discounted Product "Fixed Price" is now "Amount Off", and Mix & Match "Max Selections / Order" is now "Max per Product" (labels and messages only).
7. **Discounts no longer touch bundle lines.** Products inside a bundle line get no discounted-product price or label. (Done with the pricing change.)

**Checked in the running app (19 Oct 2026)** against a throwaway LocalDB database: a Cashier gets the bundles (and 403 on the management route), sees the Bundles tab, and opens a bundle with the API stopped; a latte bundle without a Size or with two Sizes is a 400; a croissant discount applies to the plain croissant (110) and not to one with oat milk (140); a bundle limit of 7 with 5 used refuses a quantity of 2 and the order after the limit; the happy hour (Monday 14:00 to 17:00 Manila) discounts at 14:00 and 16:59 but not at 13:59, at 17:00 or on Tuesday; a 3-use discount skips a quantity of 2 with 1 left; a Friday 22:00 to 02:00 window works at 22:30 and not on Saturday; voiding an order frees its use; bad schedules (usage limit 0, one time only, equal times, no days) are 400; the details page shows Days, Hours and Usage; the editor loads the saved schedule.

**Follow-ups (19 Oct 2026)**

- **Pending orders show the discounted total.** A Pending or waiting order saves no prices, so its total used to be the list price while the cart showed the discounted one (order 179: 305.00 against 185.00). `PendingOrderPreview` (API) works out each plain line's discounted unit price with the promotions on right now and `OrderMetrics.ComputeOrderTotal` takes it as an optional argument. Used by the order list, the paged list, one order, the dashboard's recent orders and the customer's My orders (total and line price). Each pending order is judged on its own, so nothing is used up before an order completes; lines saved with a price, bundle lines and finished orders are never repriced. Create and update responses for a Pending order still return the list price (the price is fixed when it completes). Line prices on the staff DTOs are unchanged, so the order details page still works out its own lines.
- **Labels and warnings.** An amount off that covers the whole price is labelled "Free" instead of the amount set on the promotion (`PromotionLabelFormatter.Format(..., basePrice)` and `formatPromoLabel(rule, basePrice)`, same shared cases); a percentage keeps its label even at 100. The add-on selector no longer shows a promo badge under the product name before the selection matches: only the label next to the total, which appears when the add-ons match a rule exactly. The promo editor warns when the amount off is the same as or more than a listed product's price.
- **Checked on a throwaway database:** pending totals in the list, paged list, one order and dashboard for a free rule, a rule blocked by an extra add-on, a plain-product percent rule, a usage limit smaller than the quantity, and several orders sharing a limit; completing the orders (saved total, price 0 and the label "Free"); the limit running out, a void giving the use back and an inactive promotion; the customer link (enable, create, open, place orders with and without a matching discount, GCash with a tip, a size left out refused, My orders totals, staff accept and complete, the customer seeing the completed total, a revoked link answering 404). The orders screen and the editor cart showed the same totals, and the editor warning appeared.
- **Promos tab and discounts in the customer's cart (19 Oct 2026).** The Bundles tab of the order editor is now **Promos**: the bundles, plus one card for each discount rule that is on (`buildDeals` in `shared/calculations/deals.ts`). A card is the product with exactly the add-ons its rule needs, with the discounted price, the list price struck through and the label ("Promo -₱40.00", "Promo -10%" or "Free"); tapping it opens the add-on selector with those add-ons already chosen, and the discount shows as long as they match. The tab also shows for discounts alone, hides rules that are closed or out of uses, and the search narrows the cards. The customer link page gets the same: `PublicCatalogDto.Deals` carries the live rules (product, add-ons, amount off or percent, uses left; no promotion id or name), a **Promos** section comes first in the menu (same tab strip and scroll sync), the add-on picker prices a choice with the discount (and starts from a card's add-ons), and the cart shows the strikethrough price, the label and the discounted total. A discount with a usage limit adds "confirmed when the shop accepts your order" under the total. The server prices the order again: the public submit works the total out with the discounts that are on and the cash must cover that (`SubmitPublicOrderHandler.ComputeTotalAsync`), and the order's change is worked out from the same discounted total (a pending order's create and update use `PendingOrderPreview` too, so the saved change, the list and the cart agree). Public bundles stay out of scope. **Label rule:** "Free" is shown only when the whole item costs nothing. When an amount off covers the product's price but add-ons are still charged, the label shows the price that really came off (a drink at 130 with a charged extra reads "Promo -₱130.00", not "Free"), on the Promos cards, the add-on selector and picker, the carts, the details and receipt, and the label saved on the order line (`AppliedDiscount.LabelWith`, `formatPromoLabel(rule, basePrice, addOnsPerUnit)`, the shared cases have the add-on amount).
- **Checked on a throwaway database (19 Oct 2026):** the customer link at desktop (1280), tablet (820) and phone (375) widths: the Promos section and cards, the picker opened from a card (Free, and the price going back when another size is chosen), the cart as the side panel and as the phone drawer (labels no longer wrap), the checkout total and amount due, My orders in every state (waiting 326.00, accepted 30.00, rejected 180.00, completed 108.00) and an order's details, the tab strip following the scroll, and a revoked link; a cash amount one centavo short of the discounted total refused and the exact amount accepted, with change saved as 0.00. The POS at desktop and phone widths: the Promos tab, the selector from a card, the cart (real amounts off, "Free"), the orders list (awaiting-approval banner, pending, completed and cancelled orders showing the same totals as the cart), and the details of a waiting online order and of a completed order (Mocha x2 free: discount -320.00, total 60.00).
- **Usage limits hold from the moment an order is saved, and races are closed (19 Oct 2026).**
  - **Reserving.** A limited discount now counts like a bundle: a Pending or waiting-for-approval order holds its uses from the moment it is saved (`OrderItems.DiscountPromotionId` is set while `Price` stays empty, `reservesDiscount` in `CreateOrderHandler` and `UpdateOrderHandler`). Cancelled, rejected and refunded orders give them back. Editing an open order moves its own uses instead of adding to them, and completing it keeps them. `PendingOrderPreview` gives an order its own held uses back before judging it (`DiscountBudget.Return`), the customer catalog hides a deal whose uses are all held, and the POS editor adds an order's own held uses to a promotion's remaining uses (`OrderItemDto.discountPromotionId`). The per-customer cap of 5 waiting orders still limits how many uses one customer can hold.
  - **One at a time.** `PromotionLimitGate` (one per process; the API runs as one instance) wraps everything from reading the uses left to saving the order: create, update, the offline sync (review and save together), the old batch, and the customer submit (total, cash check and save). Callers that already hold it pass `GateHeld` so the order handler does not wait for itself. Checked with ten registers completing a sale at once against real SQL Server: exactly the uses left are handed out, and the same tests fail with the gate switched off.
  - **Total check at checkout.** The POS sends `expectedTotal` (the total the cashier saw and collected against) with a finished sale, and the customer page sends it with the order. If the server works out another total (a price or a promotion moved, or someone took the last use) the sale or order is refused with "The total changed to PHP X ..." and nothing is saved (`OrderTotalCheck`; a refused new sale is rolled back, an update is refused before anything changes). Not applied to open orders, offline sales (the sync review holds them instead) or an Admin's correction. The POS also asks the shop again before opening checkout when the cart has a promotion or bundle, and stops with the new total if it moved; after a refusal it reloads the promotions.
  - **Offline sync, checked:** a discounted sale is saved and uses a use while one is free; after the promotion runs out the sale is held at the quoted price and takes no use; two sales in one request share the last use; a sale quoted at full price while a promotion is on is held; an open offline order reserves like any open order; a retried sync is not counted twice; and a sync racing a live sale for the last use gives it to exactly one. Known limit: a held offline sale that an Admin approves later was already given the discount, but takes no use (the quote has no promotion id).
  - **Known limits:** the gate is per process, so a second API instance would need a database lock (`sp_getapplock`); a bundle is still not checked against a placed order's total beyond its own limit check; uses held by an order that is never completed or cancelled stay held.

**Limit per order and partial coverage (19 Oct 2026).** A promotion can limit how much one order gets (`Promotions.MaxPerOrder`, script `tools/sql/20261020_add_promotion_max_per_order.sql`, run it before deploying the API). A discounted line above the limit, or above the uses the shared pool has left, is not refused or dropped: the items it covers get the discount and the rest are charged the list price. Rules: an order's allowance for a promotion is the smaller of the pool left (`MaxRedemptions` minus uses held or taken) and `MaxPerOrder`, and it is shared by all the lines of the order, in order (`DiscountBudget`, `allocateDiscounts`). A part-covered line is saved as two order lines (the discounted segment keeps the label and `DiscountPromotionId`, the rest has neither); the pool is charged only for the covered items. A bundle cannot be split, so a bundle above its `MaxPerOrder` is refused with a message naming the limit. The POS cart, the add-on selector, the customer page and its picker show the part-covered line with a note ("Promo on 2 (limit of 2 per order); the other 3 at full price."); the public submit refusal lists the same notes with the new total, and the customer page's deals carry `maxPerOrder` and an opaque `groupKey` so rules of one promotion share the limit without exposing promotion ids. An offline sale sends a part-covered line as two lines with their own quoted prices; if the shop later covers a different number of items, the sale is held for review. Shared cases (`calculation-cases.json`) cover `maxPerOrder` and `discountedQuantity`.

**Still open from the audit**

- Status on the screens: the list and details show "Active" for an expired or not-yet-started promotion and show no dates or price.
- The editor shows a blank name for a bundle product that was deactivated since.
- No audit entries for promotion create, update, delete and restore.
- Smaller: three copies of the add-on grouping method in `promotion-editor.ts`; the list subtitle leaves out discounted products; no inline check for end before start or a negative price; the date pickers use the browser's time zone while the server uses Asia/Manila.
- A product that is sold offline and deactivated before sync is held; a hard-deleted product or a product the server cannot find is still a per-order error (the order stays in the queue with the message).

---

