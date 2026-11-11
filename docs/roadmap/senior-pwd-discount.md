## POS Checkout Discounts: Senior Citizen / PWD [Planned, plan written 10 Nov 2026, rules to confirm]

A senior citizen / person-with-disability (PWD) discount is **not a promotion**. It is set by law, it belongs to a person (not
a product or a date), the cashier applies it after checking an ID, and the shop must keep records of it to claim the cost
back. So it is a checkout discount with its own rules, ID capture, receipt block, report and permission. It sits beside the
promotion engine, not inside it.

**Legal basis (from memory, NOT verified; the accountant must confirm before build starts).** Senior citizens (RA 9994) and
PWDs (RA 10754) get 20% off and VAT exemption on food and drinks bought for their own use. BIR rules (RR 7-2010 and later)
say, for a VAT-registered shop, the discount is taken on the VAT-exclusive price; a non-VAT shop gives 20% on the price and
there is no VAT to exempt. The discount cannot be combined with other discounts or promotions; this plan
follows Pogi's call that promotion items are simply not eligible. The sale record and receipt show the person's name, ID number and signature. The weekly peso cap in the law applies to
basic necessities and prime commodities, not to restaurants. Every item above is a **setting or a small rule** in this
design so a correction is not a rewrite.

### What exists today (read from the code on 10 Nov 2026, v1.20.0)

- Totals: `WTF.Calculations/Orders/OrderMetrics.cs` (`ComputeOrderTotal`), prices on `OrderItem` (`Price`, `OriginalPrice`,
  `PromoLabel`, `DiscountPromotionId`, `BundlePromotionId`). One promotion per line; bundle lines are left alone; a limit can
  cover only part of a line, which is split into a discounted line and a normal line. The senior/PWD split reuses this.
- Tips are on `Order.Tips` and are never part of the covered amount. Statuses and "what is a sale" are in
  `Sales/SalesRules.cs` and `OrderStatuses.cs` (Completed counts, Refunded is shown, voids never add to revenue).
- Orders are created by `CreateOrderHandler`, which checks `expectedTotal`; offline orders arrive through
  `SyncOfflineOrdersHandler`, which prices them again on the server (Phase 6 holds a sale when the quote differs; Phase 7,
  planned, judges at sale time). The API is the authority; the POS only previews.
- Every table has `TenantId` (global filters on). Permissions live in `PermissionCatalog` / `SystemRolePermissions`
  (`orders.write`, `orders.override`, `reports.read`, `audit.read`). Audit actions are in `AuditAction`.
- Reports already treat "discount" as a promotion discount (gross - discount - refunded = net). The app stores **no tax**.

### Decisions this plan recommends

1. **Per person, per order.** An order can hold one or more Senior/PWD "persons" (a table of friends: two seniors, one
   other). Each person covers chosen lines and quantities. Default for a one-person order: all items.
2. **Never on promotions (decided by Pogi, 11 Nov 2026).** An item that already has a promotion price, and any bundle, is not
   eligible for the Senior/PWD discount. The cart shows those lines as "Promotion item, not eligible" and the person pays the
   promotion price. No better-of rule and no stacking setting. (Pogi's reading of the law, to be confirmed by the accountant.)
3. **Two switches, both per tenant, both in shop settings.** `SeniorPwdEnabled` (off by default: the button, report and
   receipt block are hidden and the API refuses it) and `VatRegistered` (off by default, because the pilot shop is not
   VAT-registered yet). Turning `VatRegistered` on later changes the formula for new orders only; saved orders keep the
   numbers they were saved with, so history never changes.
4. **Add-ons on a covered item are covered; tips never are.**
5. **Store line amounts, not a unit price.** Rounding to the centavo per unit does not always add up. The covered row keeps
   its list `Price` and gets `SeniorPwdVatExempt` and `SeniorPwdDiscount` amounts (whole centavos, per row, parent plus its
   add-ons). Order total = sum of rows - discounts + tips. This keeps existing price and promo meaning untouched.
6. **Online orders: staff apply it at pickup, never the customer.** The customer link has no field for it. Staff apply it on
   the order before completing it, and the dialog needs an "I checked the ID" tick before it can be applied; an online order
   with a Senior/PWD request cannot be completed until the ID is checked (decided by Pogi).
7. **Always on for every plan** (it is a legal requirement for the shop, not an upsell). Revisit with the plan-gating work.

### How it works at the register

1. In the cart the cashier taps **Senior / PWD** (needs permission, see below). A dialog opens (bottom sheet on 375, centered
   dialog on 820 and 1440, same shared dialog and footer buttons as the other dialogs).
2. The cashier picks **Senior** or **PWD** (segmented control), types the **ID number** and the **name on the ID**, and picks
   which lines and how many of each (steppers; splitting works like the part-covered promotion lines: 3 Lattes, 1 for the
   senior, becomes 1 covered and 2 normal). **Add another person** repeats this block.
3. A reminder reads "Check the ID before applying". Both fields are required; ID format is only length and characters
   checked (formats differ by city), never rejected for style.
4. The cart shows a **Senior/PWD** row separate from promotions (VAT-exempt amount and discount) and totals update live.
5. Soft warnings, never blockers: the same ID already used on another order today; more covered items than a per-person limit
   the shop sets (default no limit); a covered item that already has a promotion (shows which one wins).
6. Saved with the order; the server recomputes everything and refuses a missing ID or name.

Mockups to make before building (375 / 820 / 1440): the dialog (empty, one person, two persons, error), the cart with the
row, order details and the receipt block. Check against the existing cart, checkout dialog and shared button classes.

### Calculation (`WTF.Calculations`, mirrored in `shared/calculations`, cases in `calculation-cases.json`)

New `SeniorPwdDiscount` rules (Angular side in whole cents through `money.ts`). Settings: discount rate (20%), VAT rate
(12%), `VatRegistered`, `SeniorPwdEnabled`.

- Covered amount `G` = the VAT-inclusive list price of the covered rows including their add-ons. Rows with a promotion or in a bundle are never covered.
- VAT-registered: `net = G / 1.12`, `vatExempt = G - net`, `discount = net x 20%`, `amount due = net - discount`.
  Worked example: 100.00 gives net 89.29, VAT exempt 10.71, discount 17.86, due 71.43.
- Non-VAT (the pilot shop today): `discount = G x 20%`, `vatExempt = 0`, `due = G - discount`. Worked example: 100.00 gives 20.00 and 80.00.
- Round half up to the centavo per covered row; the rows must add up to the order totals (tested).
- Sales rules: add `SeniorPwdDiscount` and `VatExemptSales` to the sale summary in `SalesRules`, so the dashboard and every
  report use one definition. Only Completed orders count; Refunded orders reverse them; voids never count.

### Data (script in `tools/sql`, run on `.\SQLEXPRESS`, then `tools/dbsync.bat`; idempotent, never edits old scripts)

- `OrderSeniorPwdDiscounts`: `Id`, `TenantId`, `OrderId`, `Type` (1 Senior, 2 PWD), `IdNumber`, `CustomerName`,
  `CoveredAmount`, `VatExemptAmount`, `DiscountAmount`, `RecordedBy`, `CreatedAt`. Index on `(TenantId, IdNumber, CreatedAt)`
  for the same-ID warning. Append-only.
- `OrderItems`: nullable `SeniorPwdDiscountId`, `SeniorPwdVatExempt`, `SeniorPwdDiscount`.
- `Products`: `IsSeniorPwdEligible` bit, default 1; the script sets it to 0 only for products in categories the owner marks non-food (none by default, so nothing changes silently).
- `Orders`: no new column needed (totals are derived); optionally a denormalized `SeniorPwdDiscountTotal` if reports prove
  slow (decide when measuring).
- Settings per tenant (fixed Asia/Manila and PHP stay): `VatRegistered`, `TIN`, `BusinessAddress`, discount rate, per-person
  limit. They live with the shop brand / receipt details (`brand.manage`), not a new screen. The tenant row from the
  migration is the pilot tenant; the script seeds defaults (non-VAT, 20%, no limit) so nothing changes until the owner edits.
- New permission rows are added by the same script to the role tables for existing tenants (see RBAC).
- **DBSYNC RULE:** the scaffold output is kept as generated; only true duplicates are deleted if the build needs it, and that
  is said in the commit. The cloud scaffold is not the source of truth; the real rescaffold runs on the laptop.
- Privacy (RA 10173): store only the ID number and name. Mask the ID (last 4) in lists and on-screen reports; show it in full
  on the receipt, order details for those who can apply the discount, and the claim export. The ID number is on both the receipt and the report (Pogi: for tracking). Retention (decided: Claude's pick, accountant to confirm): keep ID records 10 years, the usual period for tax records, never auto-delete, and do not hard-delete on request without the accountant's say.

### Receipt, order details, reports, audit

- **Receipt / summary image / order details:** a Senior/PWD block: type, name, ID number, VAT-exempt amount, discount, and a
  signature line. kitchen tickets do not show the ID. Printing follows the receipt-and-kitchen-printing plan.
- **Senior/PWD report** (Reports > Sales, same filters drawer and sortable columns as the others): one row per person per
  order: date, order number, type, name, ID (masked on screen), gross covered, VAT exempt, discount, net; totals row; Excel,
  PDF and CSV; a sheet in the monthly workbook. This is what the accountant needs.
- **Existing reports** gain a separate **Senior/PWD discount** column; promotion discount stays its own column so promotion
  performance remains honest. Daily Close (Z-report) shows the day's Senior/PWD discount and VAT-exempt sales.
- **Audit:** new actions `SeniorPwdDiscountApplied`, `SeniorPwdDiscountRemoved` (ID masked in the text). Voiding or refunding
  reverses it in reports. Removing or changing it on a completed order needs the existing Admin override with a reason.

### Roles (RBAC)

- New permission `orders.seniorpwd.apply` ("Apply Senior/PWD discount"), requires `orders.write`. In the Cashier, Admin and
  Owner bundles; not AdminViewer. Add to `PolicyMatrixTests`.
- Full ID in the export: `reports.read` sees masked IDs; the full-ID export needs `reports.generate`.
- Custom roles (role management exists) do not get it automatically: the script grants it to roles that hold `orders.write`
  today, and the role editor shows it like any other permission.

### Offline

- The arithmetic is local, so the cart works offline. The offline queue stores the persons and per-row amounts. Settings and
  permissions come from the cached catalog / login claims.
- At sync the server recomputes. Phase 6 holds a sale when the quote differs, so a **settings change while the device was
  offline** (VAT flag, rate) would hold it; with Offline Phase 7 the tenant settings go in the change log and are judged at
  sale time. Until then the hold is the safe behavior. A missing ID or name on a queued order is held for review, not
  dropped. The same-ID warning cannot run offline (shown at sync as a review note instead).
- Add the discount fields to the queued-order shape together with a version, so older queued orders still sync.

### Multi-tenant

All new tables carry `TenantId` with the global filter and tenant-scoped indexes; the platform admin sees nothing from them.
Settings are per tenant; two tenants can have different VAT status. The same ID number may appear in two tenants (that is
expected). No branch concept yet; when branches arrive the settings can move to the branch.

### Phases

0. **Confirm the rules** with the accountant (open items below). The two switches mean the build can start before the shop's VAT status is known.
1. **Calculation:** rules in `WTF.Calculations`, Angular mirror, shared cases, unit tests. Hand-worked examples first.
2. **Data and API:** SQL script, rescaffold on the laptop, settings, create/update/sync handlers recompute and validate,
   void/refund reversal, audit, permission and policy test.
3. **POS UI:** dialog, cart row, order details; split lines; warnings; 375/820/1440 checked in Playwright.
4. **Receipt and printing block;** summary image.
5. **Reports:** Senior/PWD report, new columns, Z-report, workbook sheet, exports.
6. **Offline:** queue shape, sync recompute, review notes; folds into Offline Phase 7 for judging at sale time.
7. **Hardening:** privacy masking review, retention, throwaway-DB end-to-end run, docs and ROADMAP status.

### Not in the first version

- Customer-link orders; other ID-based discounts (solo parent, athletes) - the design takes a new type and rate when asked,
  with a legal check; a full VAT/tax invoice split (the app still stores no tax; this adds only the VAT-exempt amount).
- Automatic ID validation or ID photos (the ID is shown, not photographed).

### Test plan

- **Shared cases** (both sides, same file): VAT and non-VAT; one item; several items; part-covered line; add-on; tip not
  covered; promotion row and bundle row not eligible (full price rows only); feature off and VAT toggle on/off; two persons on one
  order; rounding to the centavo; rows add up to the order total.
- **API:** blank or missing ID/name refused; server recomputes a wrong `expectedTotal`; permission matrix (Cashier yes,
  AdminViewer no, custom role); void and refund reverse amounts; tenant isolation; audit entry written with masked ID.
- **Offline:** queued order keeps the persons; sync saves the same numbers; settings change causes a review note; missing ID
  held.
- **Reports:** totals equal the sum of rows on screen, Excel, PDF and CSV; ID masked where it should be; Cashier cannot export.
- **Browser (Playwright, throwaway DB, 3+ workers, 375/820/1440, Asia/Manila):** apply, remove, two persons, receipt block,
  report, Z-report, with a worked answer for each number on screen (e.g. 100.00 VAT-registered: 71.43 due).

### Decisions (Pogi, 11 Nov 2026)

1. The shop is not VAT-registered yet: both `SeniorPwdEnabled` and `VatRegistered` are toggles, the calculation follows them (non-VAT: 20% off the price, no VAT-exempt amount).
2. Promotions and bundles are not eligible for the discount.
3. The ID number is on both the receipt and the report.
4. Retention: 10 years, never auto-deleted. Full ID export needs `reports.generate` (Admin and Owner). Accountant to confirm.
5. Online orders: staff apply it at pickup after checking the ID; an "I checked the ID" tick is required.
6. On for every plan (not gated), unless Pogi says otherwise.

### Per-person rule and order of work (Pogi, 11 Nov 2026)

- Pogi is not sure of the exact per-person rule; his working idea is that a person's covered purchase is a full meal of food and drinks only. The plan therefore does not enforce a cap: the cashier picks the lines for each person, and only **food and drinks** can be covered. A product gets an `IsSeniorPwdEligible` flag (default on; off for non-food such as merchandise or retail items), editable in the product editor and shown as "Not eligible" in the dialog. The optional per-person item limit setting stays available (default none) as a soft warning, so the shop can tighten it once the accountant gives the exact rule.
- **Order of work:** build this before Offline Phase 7. Phase 7 then includes it: the tenant settings (`SeniorPwdEnabled`, `VatRegistered`, rate) and the product eligibility flag go in the Phase 7 change log so an offline sale is judged with the rules that applied at sale time, and the discount fields ride in the same queued-order shape and sync recompute. Add a line about it to the Phase 7 section of `offline.md` when this is built.

### Still open

- The accountant should confirm the legal items at the top of this file (promotion rule, per-person rule, receipt wording, retention).

---
