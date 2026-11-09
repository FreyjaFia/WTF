## Temperature (Hot / Iced) as an add-on type [First cut built on branch `temperature-addon`, 9 Nov 2026; not merged]

**Built (first cut; script `tools/sql/20261118_add_temperature_addon.sql`, then `tools/dbsync.bat`).**

- **Type.** The script gives every shop a `Temperature` add-on type (required, pick exactly one, sort order 0 so a line reads "Latte, Iced, Large") unless it already has one with that name. It creates no Hot or Iced products: the owner creates them as add-ons (price 0 and +10, say) and links them in the product editor, as with Size. Everything else (required rule on orders, promotions, stock Coverage, receipts, reports, customer link) already follows the type's own rules.
- **Pre-selected option.** `ProductAddOns.IsDefault` (bit, default 0): at most one per product and type, only on a required type, cleared when the link is removed or its type changes. `PUT /api/products/{id}/addons/{addOnId}/default` (`ProductsWrite`) sets or clears it; the add-on groups of the product and of the POS catalog carry `defaultAddOnId`. Product editor: a "Pre-select" button per option in a required pick-one group with more than one option.
- **Register.** The add-on selector pre-selects the group's default on a new item, and selects the only option of a required pick-one group; editing an item never changes its choices. `presetSelections` in `shared/calculations/addon-selection.ts`. The customer link does not pre-select (POS only, as decided).
- **Not built yet.** Bulk-link Hot/Iced to many drinks, "any temperature" in promotions, hiding a single-option group in the selector (it shows already selected), the by-temperature report, the "Iced X" merge helper, a size x temperature recipe grid.
- **Tests.** Handler tests for the flag (set, clear, one per type, required type only, cleared on remove or retype), the group default in `GetProductAddOns`, a Coverage case for "Hot linked, Iced not", the route table; Angular specs for `presetSelections`, the selector and the service call.

Original plan:


A drink is often sold hot or iced, and today the only ways to say so are two separate products ("Latte" and "Iced Latte") or
a Flavor/Size trick. Two products split the sales report, the stock links and the promotions in half, and make the menu long.
Idea: a **Temperature** add-on type (Hot, Iced, maybe Blended later) that works like Size: the cashier picks one on the drink,
and everything that already follows add-ons (price, stock, cost, promotions, reports, the customer link) follows it too. No new
"variant" concept is built; the add-on machinery is the variant machinery.

**Why an add-on and not a separate variant feature**

- Price differences already exist as add-on prices and per-product overrides (`ProductAddOns` price override): Iced +PHP 10 on
  one drink, +0 on another.
- Stock and cost already follow add-ons: a link on the Iced add-on takes ice, a plastic cup and a dome lid; the Hot add-on takes a
  paper cup and a sleeve. Per-size amounts (`ProductSizeAmounts`) and Replace mode (`ReplacesItemId`) cover "Iced uses a plastic
  cup *instead of* the paper cup".
- Promotions already match exact add-ons ("Iced Latte, Large" for PHP 120), the receipt, the order details breakdown, the
  Promos tab and the customer link menu all show add-ons.
- Offline, sync review and reports already carry add-ons.

**Decisions to make first**

- **A new add-on type, or a rule on an existing one?** Recommended: a real `Temperature` type created through Dynamic Catalog
  Management (add-on types with `IsRequired`, `MinSelect`, `MaxSelect`), single select, required for the products that offer it.
  Today Size, Flavor and Sauce are hard-wired in places (`PickOneAddOnRule`, `PromotionAddOnRules`, `StockCoverageRules`, the
  "required group" logic, `AddOnTypeEnum`). Temperature should not add a fourth hard-wired copy; do it after, or together with,
  the dynamic add-on type work so "pick exactly one" and "required" come from the type's own rules.
- **Required, pick one (decided).** Like Size: a product that offers Temperature must have exactly one option on every sale. A pastry
  has no temperature and a bottled drink none; the type is required only on the products it is linked to, so linking it to a
  product is what makes it a choice. Each option can carry a price (Iced +10).
- **Default.** A product may mark one option as the default (usually Hot, or Iced for cold-only drinks), pre-selected in the
  selector so a cashier on a rush taps once. Only meaningful with a required type; needs a small `IsDefault` on the product's
  add-on link.
- **Cold-only and hot-only drinks.** Link only the options that apply (a cold brew offers Iced only, so the choice is skipped
  or locked). The selector hides a type with a single option and selects it.
- **Name on tickets and receipts.** "Latte, Iced, Large" reads naturally if Temperature sorts before Size; set the sort order
  of the types. The cart, the receipt and the kitchen ticket show it as a plain add-on line (price shown only when not zero).

**What it touches (each is a check, not new machinery)**

1. **Catalog and editor.** Add-on type seeded and linkable in the product editor like Size; bulk-link Hot/Iced to many drinks at
   once (a bulk action beside "Manage Links").
2. **Order flow.** Add-on selector shows the group with its required marker, default option and radio style; the cart,
   order details, receipt, summary image and customer cart show it (already add-on lines). Part of `shared/calculations`
   unchanged: add-on pricing already sums by type-agnostic rules.
3. **Promotions.** Exact-add-on matching already works; the promotion editors must let the owner pick Temperature options, and
   the validation "required add-on types must be listed" (`PromotionAddOnRules`) must follow the type's rule, not a list of
   Size/Flavor. "Any temperature" for a promotion that does not care should be allowed (a way to say "this group is not part of
   the rule") and is open in the questions below.
4. **Inventory and cost.** Recipe lines linked to the Hot/Iced add-ons (cup, lid, sleeve, ice). The Coverage check
   (`StockCoverageRules`) must treat Temperature as a required group: a latte with Hot linked and Iced not is "Some options
   missing". Ingredients & Cost page: Hot and Iced columns beside the size grid (or a combined grid of size x temperature, see
   open questions) and the Preview one sale box with a Temperature choice.
5. **Reports.** The product sales report with `splitAddOns` already lists add-ons as rows. Add a "by temperature" view in the
   add-on performance report (still planned under Reporting): share of hot vs iced, by hour and by day (a rainy-day check), and
   margin per option once costs exist.
6. **Customer link.** The picker shows the group like Size. `PublicCatalogDto` already carries add-ons and types; a default and
   required flag come with the dynamic add-on types.
7. **Offline.** Add-on types and links are in the catalog cache; a changed price or removed option on Iced is judged by the
   sync review like any add-on (Offline Phase 6/7).
8. **Migration of today's menu.** Shops that already sell "Iced Latte" as a separate product: a one-time helper that merges
   "X" and "Iced X" into one product with Temperature, repointing the order history is NOT done (old orders keep their product);
   the helper only creates the add-on links and deactivates the duplicate product. Optional, ask before building.

**Data (script under `tools/sql`, then `tools/dbsync.bat`)**

- A `Temperature` row in `AddOnTypes` (when the dynamic catalog work has made that table editable) with its Hot / Iced add-ons as
  products flagged as add-ons, and `ProductAddOns.IsDefault` (bit, default 0). Nothing else new; no schema for variants.
- If the dynamic add-on type work has not landed, the first cut is only the seeded type plus the hard-wired required-group
  list gaining Temperature, then moved onto the rules later (prefer to wait).

**Tests and checks**

- Handler tests: a drink with a required Temperature refuses an order without one; two temperatures on one drink refused (pick
  one); a cold-only drink needs no choice; price override on Iced applies; the default is pre-selected by the POS only.
- Shared cases in `calculation-cases.json` for a promotion matched on "Iced + Large" and not on "Hot + Large".
- Stock: a sale of Iced Latte takes the plastic cup and ice and not the paper cup (Replace), and Coverage flags a latte with
  one temperature unlinked.
- Hand check on a throwaway database: one drink, both temperatures, a price difference, a promotion on Iced only, stock for
  each cup, the receipt, the report split and the customer link at phone width.

**Open questions**

- One **Temperature** group, or separate groups for the cases that really differ (Hot, Iced, Blended)? Blended often changes
  the recipe a lot and the price too.
- Size x Temperature amounts: is a cup per temperature enough (most shops), or does each size and temperature pair need its own
  amounts (then the size grid becomes two-dimensional)?
- ~~Is the temperature a price (Iced +10) in this shop?~~ **Decided 4 Nov 2026:** it can carry its own price, and it behaves like
  Size: **required, pick exactly one** (`IsRequired`, `MinSelect = 1`, `MaxSelect = 1`) on every product that offers it. Each option
  has an add-on price (Hot +0, Iced +10), and a per-product override (`ProductAddOns` price override) where one drink differs.
  Price rules need no new code: add-on prices already sum into the line, show on the receipt and feed promotions and reports.
- Should a promotion be able to say "any temperature"?
- Do menu photos differ per temperature (the product image is per product)?

---

