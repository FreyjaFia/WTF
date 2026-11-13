## POS Checkout Discounts: Senior Citizen / PWD [Planned, confirm the rules first]

**Status (13 Nov 2026, branch senior-pwd-discount):** Phase 1 (calculation) and Phase 2 (data and API) are built; Phase 3 (POS UI) is in progress. Not built yet: receipt block (4), reports and Z-report columns (5), offline queue shape and Phase 7 judging (6, beyond the review holds below), hardening (7).
Built in Phase 2: script `tools/sql/20261121_add_senior_pwd_discount.sql` (run on .\SQLEXPRESS, then `tools\dbsync.bat`); permission `orders.seniorpwd.apply`; shop switches `SeniorPwdEnabled` and `VatRegistered` (brand settings, `brand.manage`, also in the POS catalog sync); product flag `IsSeniorPwdEligible`; create/update/void recompute and refusal rules; audit actions; `GET /api/orders/senior-pwd/id-check`; offline sync holds a queued sale whose person lacks an ID or name, or whose discount differs from the current settings. Settings still fixed in code: rate 20%, VAT 12%; no per-person limit, TIN or business address yet. Online-order "I checked the ID" is enforced on update only (`idChecked`).

Moved here from the promotion ideas. A senior citizen / person-with-disability discount is **not a promotion**: it is set by
law, it belongs to a person (not to a product or a date), the cashier applies it at the register after checking an ID, and the
shop must keep records of it. So it is a checkout discount type with its own rules, ID capture, receipt wording and report.

**Check before building (written from memory of the Philippine rules, not verified).** Ask the shop's accountant or the BIR
for the current rules on: the rate (20%), the VAT exemption for VAT-registered shops, which purchases qualify (food and
drinks for the person's own use), whether a group order is discounted only for the senior/PWD's own items, whether it may be
combined with a store promotion (usually the person takes the better of the two, not both), what the receipt and the sales
record must show, and how the shop claims the discount back as a deduction. The design below is made so each of these is a
setting or a small rule, not a rewrite.

### How it works at the register

1. In the cart, the cashier chooses **Senior / PWD discount** and picks which lines (and how many of a line) are for the
   senior or PWD. Splitting a line works like the part-covered promotion lines: 3 Lattes, 1 for the senior, becomes a
   discounted line of 1 and a normal line of 2. The default is "all items" for a one-person order.
2. The cashier enters the type (Senior / PWD), the ID number and the name on the ID (the ID is shown, not photographed).
   Both are required; the screen reminds the cashier to check the ID.
3. The cart shows the discount as its own row, separate from promotions, and the totals update live (it must also work
   offline: the arithmetic is local).
4. The order is saved with the discount; the server recomputes it (the API is the authority) and refuses a missing ID.

### Calculation (in `WTF.Calculations`, mirrored in `shared/calculations`, shared cases in `calculation-cases.json`)

- New `SeniorPwdDiscount` rule class with whole-cent maths like the rest. Settings: the discount rate (default 20%), the VAT
  rate (12%), and whether the branch/shop is **VAT-registered**.
- VAT-registered shop (as commonly applied): VAT is removed from the covered amount first, then the discount is taken on
  the VAT-exclusive amount: `net = amount / 1.12`, `discount = net x 20%`, `amount due = net - discount`. Non-VAT shop: the
  discount is taken on the price as charged (`discount = amount x 20%`). Round half up to the centavo, per line, and the
  lines must add up to the order total.
- Combining with promotions: the line gets the better of the promotion or the senior/PWD discount for the covered items,
  never both, unless the accountant says otherwise (a setting). This is one of the stacking rules (see "Promotion Ideas
  for Later").
- Tips and add-ons: add-ons on a covered item are covered; tips never are. Bundles: covered only if the rule is confirmed
  for bundles (otherwise block it and say why).
- Reports keep the statutory discount **separate** from promotion discounts (their own column), so the existing gross -
  discount - refunded = net table stays honest, and the VAT-exempt amount can be shown.

### Data (script under `tools/sql`, then rescaffold)

- `OrderSeniorPwdDiscounts`: `OrderId`, `Type` (Senior/PWD), `IdNumber`, `CustomerName`, `CoveredAmount`, `VatExemptAmount`,
  `DiscountAmount`, `RecordedBy`, `CreatedAt`; and a nullable `OrderItems.SeniorPwdDiscountId` so covered lines are known.
  Append-only, like audit data: a correction is a new order override with a reason.
- Settings (until Branding Phase 2 exists, plain app settings): discount rate, VAT rate, VAT-registered yes/no, TIN and
  business address for the receipt. With branches/tenants these become per-branch/tenant settings.
- Privacy: an ID number and name are personal data. Store only these two fields, show the ID masked in lists (last 4
  characters) and in reports shown on screen, show it in full only on the receipt copy and the claim export, restrict the
  export to Admin and above, and include it in the retention rules (it is tax-record data, so it may need to be kept for
  years; ask the accountant).

### Receipt, reports and audit

- **Receipt and order summary:** a Senior/PWD block with the type, name, ID number, the VAT-exempt amount, the discount, and
  a signature line, as the rules require (confirm the exact wording).
- **Senior/PWD report** (Reports > Sales): per day or month, one row per order: date, order number, type, name, ID number,
  gross covered amount, VAT-exempt amount, discount, net; totals row; Excel, PDF and CSV like the others, and a sheet in
  the monthly workbook. It is what the accountant needs to claim the discount.
- **Daily Close (Z-report)** gets a line for the day's senior/PWD discounts and VAT-exempt sales.
- **Audit:** `SeniorPwdDiscountApplied` with the order, type and amount (ID number masked in the audit text); voiding or
  refunding the order reverses the discount in reports.
- **Roles:** Cashier and above can apply it (policy to be added to `PolicyMatrixTests`); removing or editing it on a
  completed order needs the existing Admin override with a reason. AdminViewer cannot.

### Not in the first version

- Online (customer link) orders: the ID must be checked in person, so the discount is not offered on the link. An order
  placed online can have it applied at pickup by staff before completing, if the shop wants (it goes through the same
  cashier action).
- Other statutory or ID-based discounts (solo parent, national athletes, others the law may add): the same design works with
  a new "type" and rate; add them only when asked, with the legal check.
- Tax invoices and VAT reporting beyond the exempt amount: the app still stores no tax (see the Reporting notes). This
  feature adds the minimum, the VAT-exempt amount per covered sale; a full VAT split needs its own decision.

### Tests

- Shared cases for both sides: VAT-registered and non-VAT, one item, several items, a part-covered line, an add-on, a
  tip, a promotion on the same line (better one wins), rounding to the centavo, lines adding up to the total.
- A missing or blank ID is refused; the server recomputes a total the POS got wrong (`expectedTotal` check); a covered line
  voided or refunded reverses the amounts; the offline queue stores the discount and the sync saves the same numbers.
- The report: totals equal the sum of rows on screen, Excel and CSV; ID masked where it should be; Cashier cannot export.
- Check by hand on a throwaway database with a worked example before release (for instance a 100.00 item for a VAT-registered
  shop: net 89.29, discount 17.86, amount due 71.43), plus a screen check of the receipt and the report.

### Open questions

- Is the shop VAT-registered (changes the formula and the receipt), and does it issue official receipts?
- Does the accountant want the ID number on the receipt, on the report only, or both?
- Is the discount allowed on bundles, and may it combine with a store promotion?
- Does the shop want a daily cap or a per-customer limit on its own (some shops add one)?

---

