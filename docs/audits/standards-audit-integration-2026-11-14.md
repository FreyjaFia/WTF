# Standards audit: Senior/PWD, customer address, plan gating

Branch audited: `integration-senior-pwd-address` (34 commits on main 3367a2a), only the changes against origin/main
(241 files). Method: four parallel read-only reviews (backend orders and calculations, backend gating and reports,
Angular app, tests and e2e) by reading and grepping. **Nothing was built or run** (no dotnet on the audit machine), so
the unused-usings check (IDE0005) still needs the cleanup skill. Line numbers were checked against the branch. Findings
marked "pre-existing, worsened" come from the earlier full-repo audit (`audits/code-audit-2026-11-14.md`) and are
made bigger by the new code. Generated dbsync scaffold is not reported. No code was changed.

## Summary

| Area | Findings | P1 | P2 | P3 |
| --- | --- | --- | --- | --- |
| Backend orders, calculations (BO) | 19 | 3 | 8 | 8 |
| Backend gating, reports, SQL (BX) | 19 | 0 | 7 | 12 |
| Angular app (FE) | 18 | 3 | 9 | 6 |
| Tests and e2e (T) | 19 | 0 | 6 | 13 |

Fix before the release tag (P1 plus the correctness items hidden in P2):

1. **BO-1, BO-2, BO-3, BO-4**: order totals and the Senior/PWD amount are computed in handlers, not in `WTF.Calculations`.
   Update prices a covered row from a different source than the row it saves, so the total check and stored values can disagree.
2. **BO-11**: `LastName` is now optional, but name concatenation in SQL gives NULL, so customers without a last name
   are missing from paged order search and push text.
3. **BX-3**: the Senior/PWD report filters on `Completed` instead of `SalesRules.IsSale`, so it will not reconcile with other reports.
4. **BX-6**: `BrandDto` defaults turn Senior/PWD and VAT off when a client omits them.
5. **FE-1 to FE-3** (P1): `featureGuard` is never used, `PlanStore.clear()` is never called (a previous shop's
   features can survive logout), and `role.guard.ts` makes its own HTTP call with the development environment import.
6. **BX-7**: the Senior/PWD SQL re-grants a permission to custom roles on every re-run (breaks the idempotent rule).

Everything else is cleanup and can be batched after the release. The test suite is in good shape: no skipped or focused
tests, no committed credentials, workers set to 3 or more, throwaway DB, and the shared cases file is used by both sides.

Items by effort that give the most value: extract `OrderMapping` (BO-6, L), move totals into `WTF.Calculations`
(BO-1 to BO-4, M), one `PlanFeatures` key constant list plus a drift test across C#, TS and SQL (BX-1, BX-10, FE-9, S to M).

---

## Backend orders / customers / products / promotions / sync / calculations: standards audit

Scope: `git diff origin/main` in the listed paths. Line numbers verified against the checked-out files.
Generated scaffold (WTFDbContext, entity scaffolds) is not reported.

- **BO-1**
  - Priority: P1
  - Location: src/WTF.Api/Features/Orders/UpdateOrderHandler.cs:286-304 (also CreateOrderHandler.cs:486 uses a different path)
  - What is wrong: The Senior/PWD reduction is subtracted from an inline `serverTotal` built in the handler: `serverTotal -= pricedItems...Sum(AmountsFor(...).Reduction)`. This is order-total arithmetic outside WTF.Calculations. It is the third separate way to compute an order total. Create goes through `OrderMetrics.ComputeOrderTotal`, Update uses the inline sum, and OfflineOrderReview.cs:105-112 has its own. Pre-existing, worsened: the inline total was already there and now carries a second rule.
  - Fix: Add `OrderMetrics`/`OrderPricing` methods in WTF.Calculations that take priced lines and the Senior/PWD amounts and return the expected total. Call them from Update and OfflineOrderReview, and add cases to `calculation-cases.json`.
  - Effort: M

- **BO-2**
  - Priority: P1
  - Location: src/WTF.Api/Features/Orders/OfflineOrderReview.cs:105-115
  - What is wrong: `quotedTotal`, `shownReduction` and `currentReduction` are computed inline in the review class: `(price + addOns * qty) * quantity`, bundles `* quantity`, and the difference to `ExpectedTotal`. This is a total and a discount rule outside WTF.Calculations and breaks the CLAUDE.md rule. The quoted-row formula is also repeated twice on adjacent lines.
  - Fix: Move it to `SeniorPwdRules` or `OrderMetrics` as `QuotedTotal(items, bundles)` and `ReductionFor(items, vatRegistered)`. Test them in WTF.Tests against the shared cases file.
  - Effort: M

- **BO-3**
  - Priority: P2
  - Location: src/WTF.Api/Features/Orders/SeniorPwdOrders.cs:172-173
  - What is wrong: `AmountsFor` computes `(unitPrice + addOnsPerUnit) * quantity` inline. This is the line-covered-amount rule, and it sits in an API-side class instead of WTF.Calculations. Its callers also each build `addOnsPerUnit` themselves: CreateOrderHandler.cs:384-386 and UpdateOrderHandler.cs:299-303 and 477-482. The Update override path swaps in paid add-on snapshot prices.
  - Fix: Add `SeniorPwdRules.ForLine(unitPrice, addOnsPerUnit, quantity, vatRegistered)` in WTF.Calculations. Have the callers pass already-priced add-ons, with one shared helper for the snapshot lookup. Keep `SeniorPwdOrders` for state only (rows, persons, permissions).
  - Effort: S

- **BO-4**
  - Priority: P1
  - Location: src/WTF.Api/Features/Orders/UpdateOrderHandler.cs:299-304 vs :472-486
  - What is wrong: The expected total prices a Senior/PWD row from `p.Product.Price` (the list price) with current add-on prices. The row that is saved uses `newItem.Price ?? product.Price` with add-on snapshot prices in override mode. The two paths can disagree, for example when the item has a saved price or an add-on override. The pre-check can then pass or fail on a different number than the one stored.
  - Fix: Compute the covered amount once per line (see BO-3), store it, and use that single value for both the total check and the saved columns.
  - Effort: M

- **BO-5**
  - Priority: P2
  - Location: Create 311-315 and 381-387; Update 256-260 and 472-486 (all under src/WTF.Api/Features/Orders/)
  - What is wrong: The eligibility rule (`EnsureLineAllowed`) is invoked at two points in Update. The first is `!isOverride && appliedDiscount is not null`. The second, in the override branch, is a hard-coded `EnsureLineAllowed(product.Name, true, true, false)` that passes made-up arguments just to trigger the "promotion" message. Create and Update then each repeat the same `if (seniorPwd is not null && item.SeniorPwdPersonIndex...)` plumbing in a handler that is already 600-730 lines. This worsens the pre-existing size and duplication problem.
  - Fix: Give `SeniorPwdOrders` one method, `CoverLine(item, product, orderItem, pricing, ...)`, that does the check and the cover. Have both handlers call it once per saved line. Pass real flags instead of literal `true, true, false`.
  - Effort: M

- **BO-6**
  - Priority: P2
  - Location: Create 450-457 and 614-615; Update 547-553 and 679-680; Void 179-185 and 253-256; Get 102-108 and 154-155; GetPaged 134-140 and 185-186; GetById 76-82 and 131-132 (under src/WTF.Api/Features/Orders/)
  - What is wrong: The OrderItemDto and OrderDto construction is copy-pasted in six handlers. Each one had to gain three Senior/PWD item fields, plus `SeniorPwdPersons` and `CustomerAddress`, and the fields have to stay in sync by hand. Pre-existing, worsened: the diff touches every copy. Mask flags are inconsistent too: Create and Update pass `false`, Void and the list handlers pass `true`, and GetById computes it.
  - Fix: Extract `OrderMapping.ToDto(order, ...)` and `ToItemDto(oi, ...)` into Features/Orders. Decide the mask rule in one place (`CanSeeFullId`).
  - Effort: L

- **BO-7**
  - Priority: P2
  - Location: src/WTF.Api/Features/Orders/VoidOrderHandler.cs:253-255
  - What is wrong: An extra query (`db.OrderSeniorPwdDiscounts...ToListAsync`) is awaited inline inside the DTO constructor call. It is an unnamed extra round trip, and the order is already loaded. `LoadAsync` on other handlers uses Include instead.
  - Fix: Include `OrderSeniorPwdDiscounts` when the order is loaded, or load it into a named local before building the DTO.
  - Effort: S

- **BO-8**
  - Priority: P2
  - Location: GetOrdersHandler.cs:20-30, GetPagedOrdersHandler.cs:78-90 (under src/WTF.Api/Features/Orders/)
  - What is wrong: Read-only list queries gained a fourth collection Include (`OrderSeniorPwdDiscounts`) on top of the deep chain, still without `AsNoTracking()` or `AsSplitQuery()`. This is the prior audit's #6, worsened. The Include adds another cartesian multiplier per order.
  - Fix: Add `.AsNoTracking().AsSplitQuery()`. As a better option, load the person rows in one `Where(OrderId in ids)` query (the same approach as `AddOnPriceLookup`).
  - Effort: S

- **BO-9**
  - Priority: P2
  - Location: src/WTF.Api/Features/Orders/UpdateOrderHandler.cs:373-377 and 603-613
  - What is wrong: Every update deletes all Senior/PWD rows and recreates them with new GUIDs, even when the persons are unchanged. The saved `RecordedBy` becomes the editor and `CreatedAt` is copied from the order, so the original recorder is lost. Line 377 also uses `HttpContext!.User.GetUserId()` while lines 507 and 613 use `?.GetUserId() ?? order.CreatedBy`, so a null HttpContext (for example a background caller) would throw at 377 only.
  - Fix: Diff the rows by signature and keep unchanged ones (keeping `RecordedBy`). Compute one `actorUserId` at the top of Handle and use it everywhere.
  - Effort: M

- **BO-10**
  - Priority: P2
  - Location: Create 137-148 vs src/WTF.Api/Features/Customers/CustomerValidation.cs:35-49 and OrderInputValidation.cs:54-64
  - What is wrong: Address normalization and the 150-character limit are implemented twice (`CustomerValidation.NormalizeAddress` with `MaxAddressLength`, and `OrderInputValidation.NormalizeCustomerAddress` with `AddressMaxLength`). Create also runs an extra customer query and an inline truncation to fall back to the saved address. The two limits can drift, and the code needs a comment about "addresses saved before the limit was lowered".
  - Fix: Keep a single address rule (one constant, one method) and call it from both. Move the "saved address fallback" into `OrderInputValidation` (`ResolveCustomerAddressAsync`).
  - Effort: S

- **BO-11**
  - Priority: P2
  - Location: Orders/CreateOrderHandler.cs:560 and 572; Orders/GetPagedOrdersHandler.cs:66-67; Orders/OfflineOrderReview.cs:57; Orders/GetOrdersHandler.cs:140; GetOrderByIdHandler.cs:116
  - What is wrong: Customer `LastName` became nullable (CustomerDto, CreateCustomerCommand) and `CustomerName.Join` was added, but only the image handler and loyalty DTOs use it. The other sites still build the name by concatenation. In SQL (`c.FirstName + " " + c.LastName`) a null last name makes the whole string NULL, so the push-notification customer name (Create 560/572) is lost and the paged search (GetPaged 66-67) cannot match such customers by name. In memory they produce a name with a trailing space, or `"Customer Ann  is inactive."` (OfflineOrderReview 57).
  - Fix: Use `CustomerName.Join` (in memory) and `(FirstName + " " + (LastName ?? ""))` in queries. Better, add a computed `FullName` expression in one place. Add tests for a customer with no last name.
  - Effort: M

- **BO-12**
  - Priority: P3
  - Location: src/WTF.Api/Features/Sync/GetPosCatalogHandler.cs:24-27, SeniorPwdOrders.cs:63-66, OfflineOrderReview.cs:88-91
  - What is wrong: The same `TenantSettings ... Select(SeniorPwdEnabled, VatRegistered).FirstOrDefaultAsync` query is written three times. Each order create or update with a Senior/PWD person and each offline review runs it again, besides the plan lookup.
  - Fix: Add `TenantSettingsLookup.LoadSeniorPwdAsync(db, ct)` returning a small record (the same pattern as `TenantPlanLookup`), and use it in all three.
  - Effort: S

- **BO-13**
  - Priority: P3
  - Location: src/WTF.Api/Features/Orders/OfflineOrderReview.cs:39 and 127-132
  - What is wrong: `AddSeniorPwdLineReasonsAsync` and `FindReasonsAsync` both load Products and Customers for the same ids with separate queries (`products` is loaded at line 39 and again at 129). The reason strings ("is not food or drink...", "is part of a bundle...") also duplicate the messages in `SeniorPwdOrders.EnsureLineAllowed` (lines 182-187). The two copies must be edited together. Reads are not `AsNoTracking`.
  - Fix: Pass the already-loaded product dictionary (add `IsSeniorPwdEligible` to its projection). Move the message text to one `SeniorPwdRules.IneligibleReason(...)`. Projections (Select) are already untracked, so only the sharing is needed.
  - Effort: S

- **BO-14**
  - Priority: P3
  - Location: src/WTF.Calculations/Subscriptions/PlanFeatures.cs:1-80 (new Catalog) and src/WTF.Calculations/Sales/SalesRules.cs:88-103
  - What is wrong: `PlanFeatures` now holds display text (Label, Description, Group) in a "pure calculations" project, so it is feature metadata, not arithmetic. `SalesSummary.GrossSales` now adds `SeniorPwdDiscounts + VatExemptSales` and `SeniorPwdReduction` duplicates part of that sum. `OrderMetrics.SeniorPwdAmountsOf` filters parent rows with the same `ParentOrderItemId == null && BundlePromotionId == null` expression already in `ComputeOrderBreakdown` (OrderMetrics.cs:~85), and `SeniorPwdReduction` is public on the static class beside it.
  - Fix: Keep the catalog, but move the labels/descriptions to the API (or a Catalog class outside Calculations). Add one `OrderMetrics.ParentRows(order)` helper and use it in both places.
  - Effort: S

- **BO-15**
  - Priority: P3
  - Location: src/WTF.Api/Features/Orders/SeniorPwdOrders.cs:34-35, :217; OfflineOrderReview.cs:68-69, 119-120; SeniorPwdRules.cs:16-17, 33
  - What is wrong: Several new members have `//` comments above them that describe what the method does or the rule in general (for example "The person rows are saved with their final amounts, then the covered lines point at them", and "A promotion price and a bundle are never covered"). Per the repo rule, comments are only for why-not-what, with no descriptions above members. Several are acceptable, but the ones that restate the code should go.
  - Fix: Remove the restating comments. Keep only the comment on why held orders skip the rules.
  - Effort: S

- **BO-16**
  - Priority: P3
  - Location: src/WTF.Api/Features/Orders/SeniorPwdOrders.cs:13-283 (class design)
  - What is wrong: One `internal sealed class` mixes four jobs: validation/loading (`LoadAsync`, `Validate`, `Clean`), masking/DTO mapping (`MaskId`, `ToDtos`, `CanSeeFullId`), audit (`AuditValues`, `Signature`, `LogChangesAsync`) and per-order state (`Cover`, `Complete`, `Rows`). `LoadAsync` takes 8 parameters, throws `InvalidOperationException` for permission failures (the app maps these to a generic 400, not 403), and queries the database and reads `HttpContext`, so it is hard to unit test. `ApplyPermission` is duplicated as the string literal `"orders.seniorpwd.apply"` in the catalog and role lists.
  - Fix: Split into `SeniorPwdValidator`, `SeniorPwdMapping` and `SeniorPwdAudit` (static, in the same folder) and keep the state class small. Reference the permission by a constant defined next to `PermissionCatalog`. Return a 403 for the permission failure.
  - Effort: M

- **BO-17**
  - Priority: P3
  - Location: src/WTF.Api/Features/Orders/SeniorPwdIdCheckHandler.cs:28-38; src/WTF.Api/Endpoints/OrderEndpoints.cs:61-72
  - What is wrong: The permission check sits in the endpoint lambda (the prior audit flagged this pattern at OrderEndpoints.cs:72) instead of the handler or a policy. The handler does not validate `IdNumber` length, so any caller with `OrdersWrite` and the permission can probe arbitrary strings. The "today" boundary is computed in the handler instead of a shared time helper. The `OrderSeniorPwdDiscount.IdNumber` is stored and compared in clear text and is searchable.
  - Fix: Use a permission policy on the route (or check in the handler), cap the id length, and move the start-of-day to `RequestTimeZone`. Consider hashing the ID number for the lookup column if policy allows.
  - Effort: S

- **BO-18**
  - Priority: P3
  - Location: src/WTF.Api/Features/Inventory/OrderStockService.cs:28, 33-37
  - What is wrong: `ITenantFeatures? tenantFeatures = null` is an optional constructor dependency, with a branch that falls back to a direct DB read. An optional service in a primary constructor hides a missing registration and makes every call take one of two code paths. The plan check also runs a database query on each deduct and restore. The same optional pattern is on `GetOrdersHandler`'s `IHttpContextAccessor?` (pre-existing).
  - Fix: Make `ITenantFeatures` required and drop the fallback; update the tests to pass a stub.
  - Effort: S

- **BO-19**
  - Priority: P3
  - Location: src/WTF.Api/Common/Orders/DiscountRuleLoader.cs:25-29, Promotions/DiscountedProductHandlers.cs:61-64, GetPosBundlesHandler.cs:24-27
  - What is wrong: The same "promotions feature is off" check was pasted into three entry points with three different empty results (and `new DiscountBudget(new Dictionary..., new Dictionary...)` built inline). `ITenantFeatures` is not used here, so each call hits the plan table again (a query per call, several per order create).
  - Fix: Use `ITenantFeatures` (cached) and add a `DiscountRuleLoader.Loaded.Empty` instance. Put the gate in one place.
  - Effort: S

---

## Backend (non-Orders/Customers/Products/Promotions/Sync) standards audit, diff vs origin/main
Paths are under /home/user/WTF. Line numbers checked against the checked-out files.

## P1
(none found)

## P2

### BX-1 P2 Feature keys are bare string literals in 20+ places (no constants)
Files: src/WTF.Api/Endpoints/ReportEndpoints.cs:180,194,215,234,253,273,287; Endpoints/OrderLinkEndpoints.cs:44; Common/Orders/DiscountRuleLoader.cs:26; Features/Dashboard/GetDashboardHandler.cs:84,136; Features/Inventory/StockAlertService.cs:24; Features/Inventory/OrderStockService.cs:36-37; Features/Inventory/StockAlertReminders.cs:230; Features/Reports/MonthlyReportWorkbookScheduler.cs:18; Features/OrderLinks/OrderLinkAccess.cs:55; Features/Conversations/PublicConversationHandlers.cs:42,64; Features/Subscriptions/PlatformPlanFeatures.cs:155-157.
Wrong: `PlanFeatures` (WTF.Calculations) is declared "the only source of valid feature keys", yet every gate repeats "inventory"/"orderlinks"/"promotions"/"workbook"/"chat" as a literal. A rename or typo compiles and silently never gates (RequireFeature("x") for a key not in Gateable has no registered policy, so it throws only at request time).
Fix: add `public const string Inventory = "inventory"` etc. to PlanFeatures (and build Catalog from them); use them everywhere. Add a unit test that every literal passed to RequireFeature is in Gateable (or give RequireFeature a guard that throws at startup).
Effort: S

### BX-2 P2 Uncached plan lookup on hot paths (extra DB round trip per call, twice on the dashboard)
Files: src/WTF.Api/Common/Tenancy/TenantPlanLookup.cs:23-26 (static overload reads DB every call); callers Features/Dashboard/GetDashboardHandler.cs:84 and :136 (two identical queries in one request), Features/Inventory/StockAlertService.cs:24, Common/Orders/DiscountRuleLoader.cs:26, Features/OrderLinks/OrderLinkAccess.cs:55 and :69 (up to two `LoadAsync` per public, unauthenticated request), Services/DailyCatchUpScheduler.cs:106.
Wrong: `TenantFeatureCache` / `ITenantFeatures` exists (20 s TTL, cleared on plan change) but only OrderStockService (optional ctor param) and the auth middleware use it. The "direct" overload is used by default, so every order save, alert evaluation, dashboard load and public order-link/chat call pays an extra query, and the public endpoints are an unauthenticated DB-amplification path.
Fix: inject `ITenantFeatures` into those handlers (make it required, drop the `= null` fallback in OrderStockService) and keep the direct overload only for the schedulers/tests; in OrderLinkAccess load the plan once and reuse it for both checks; in the dashboard compute `inventoryOn` once.
Effort: M

### BX-3 P2 Senior/PWD report handler computes the row net inline and uses its own "sale" filter
File: src/WTF.Api/Features/Reports/GetSeniorPwdReportHandler.cs:36 and :70.
Wrong: `CoveredAmount - VatExemptAmount - DiscountAmount` is a money rule in a handler (CLAUDE.md: belongs in WTF.Calculations; also needs the shared cases file). The filter `StatusId == OrderStatuses.Completed` re-states "what counts as a sale" instead of `SalesRules.IsSale`, and it leaves out Refunded orders while the daily-sales/payments/staff columns (`SalesSummary.SeniorPwdDiscounts`, SalesRules.cs:84) include "sold and refunded" orders, so the Senior/PWD report total will not reconcile with the Senior/PWD column of the other reports.
Fix: add `SeniorPwdRules.NetAmount(covered, vatExempt, discount)` in WTF.Calculations (+ case in calculation-cases.json); decide the refunded policy once (include refunded rows, with a status column, or document the difference) and share the predicate with SalesRules.
Effort: S-M

### BX-4 P2 Report handler decides PII exposure from the HTTP Accept header
File: src/WTF.Api/Features/Reports/GetSeniorPwdReportHandler.cs:75-90 (`WantsFullId`), also the `IHttpContextAccessor` ctor param.
Wrong: a MediatR handler sniffs `Accept` and re-checks the permission with a hard-coded "reports.generate" string to unmask ID numbers. Export format is the endpoint's job (ReportEndpoints.BuildReportResponse), so the two can drift (a new export type or a client sending `Accept: application/pdf` and getting JSON would see full IDs in JSON). The workbook service also depends on this implicit masking.
Fix: put `bool IncludeFullIdNumbers` on `GetSeniorPwdReportQuery`, set by the endpoint only when it is returning a file AND `PermissionChecks.Has(user, PermissionCatalog key)`; handler then has no HttpContext dependency. Use the permission constant, not a literal. Add a test that JSON never contains an unmasked ID.
Effort: S

### BX-5 P2 Senior/PWD id-check endpoint does its own permission check outside the policy catalog
File: src/WTF.Api/Endpoints/OrderEndpoints.cs:62-74 (check at :66); permission added at Common/Auth/Permissions/PermissionCatalog.cs (`orders.seniorpwd.apply`), no AppPolicies entry / PolicyPermissions mapping for it.
Wrong: every other permission has an `AppPolicies.*` + `PermissionCatalog` policy mapping and `.RequireAuthorization(policy)`; this one is policy `OrdersWrite` plus an inline `PermissionChecks.Has` that returns `Results.Forbid()` (no scheme, no `not_in_plan` body, not visible to the policy-coverage test if there is one). Same likely for the apply path in Features/Orders (other agent).
Fix: add `AppPolicies.SeniorPwdApply` mapped to ["orders.seniorpwd.apply"] and use `.RequireAuthorization(AppPolicies.SeniorPwdApply)`; delete the inline check.
Effort: S

### BX-6 P2 Brand update silently turns Senior/PWD and VAT off when a client omits the fields
Files: src/WTF.Api/Features/Branding/BrandHandlers.cs:25-26 (`bool SeniorPwdEnabled = false, bool VatRegistered = false` defaults on the request DTO), :118/:134-138 (`saveTaxSettings`), :178 (`saveTaxSettings: true`).
Wrong: `BrandDto` is both the response and the PUT body. A PUT from an older cached POS bundle (or any client that does not send the two new fields) deserializes to false and overwrites the shop's tax settings; this changes what customers are charged at checkout. The boolean flag parameter on `SaveAsync` is also a flag-argument smell.
Fix: make the two fields nullable on the request (`bool?`, null = leave unchanged) or move them to their own `UpdateTaxSettingsCommand` + endpoint + audit entry (they are tax config, arguably not "brand"). Remove `saveTaxSettings`.
Effort: S-M

### BX-7 P2 SQL: Senior/PWD script re-grants the permission on every run
File: tools/sql/20261121_add_senior_pwd_discount.sql (final INSERT, from "INSERT INTO dbo.RolePermissions" to end of file). Header says "Safe to run twice; it never changes an existing row except to add the permission".
Wrong: the only guard is NOT EXISTS on the (RoleId, key) pair, so if a shop owner later removes `orders.seniorpwd.apply` from a custom role, a re-run of the script gives it back (granting discount authority). Contrast 20261130_plan_feature_catalog.sql, which records a once-only marker in PlatformAuditLog.
Fix: guard the block with a PlatformAuditLog marker (same pattern as 'PlanFeatureCatalogRoleCopy') and insert the marker row after the copy.
Effort: S

## P3

### BX-8 P3 `static readonly string` for a constant; prefix/policy name built by hand
File: src/WTF.Api/Common/Auth/AppPolicies.cs:5-7. `FeaturePrefix` should be `public const`, and declared with the other constants (member order: constants first, methods last). `AddAppAuthorization` and `RequireFeature` are the only two users; keep the prefix private.
Effort: S

### BX-9 P3 Unsorted usings
File: src/WTF.Api/Features/Inventory/StockAlertService.cs:2-3: `WTF.Api.Common.Tenancy` is before `WTF.Api.Common.Auth.Permissions` (violates single A-Z list; the dotnet-cs-cleanup step was skipped). Check the other touched files too (Services/DailyCatchUpScheduler.cs, Common/Orders/DiscountRuleLoader.cs look fine).
Effort: S

### BX-10 P3 Plan feature lists duplicated across C#, SQL, E2E seed and Angular with no drift check
Files: src/WTF.Calculations/Subscriptions/PlanFeatures.cs (Catalog), src/wtf-pos/src/app/shared/calculations/plan-features.ts (hand-copied catalog incl. label/description text), tools/sql/20261130_plan_feature_catalog.sql (plan feature strings, Business plan insert), src/WTF.E2E.Database/Program.cs:116-117 (plan strings, still with legacy words "pos,orders,reports,offline").
Wrong: four copies of the same data. The Angular file is a copy, not generated. E2E seeds Business with IsActive = true whereas the SQL inserts it inactive (Program.cs:117 vs SQL), and uses a long comment line (>120 chars) at Program.cs:114.
Fix: add a test comparing plan-features.ts to GET /api/platform/plan-features (or to a shared JSON like calculation-cases.json) and have the E2E seed build the Pro/Business strings from `PlanFeatures.Gateable` / a small named constant set. The SQL copy is acceptable (data) but note it in the roadmap file.
Effort: M

### BX-11 P3 Plan-change preview only counts three features; the rest answer "nothing lost"
File: src/WTF.Api/Features/Subscriptions/PlatformPlanFeatures.cs:150-160 (`CountDataAsync`, default arm `_ => (0, null)`).
Wrong: dropping purchasing (purchase orders, suppliers), expenses, chat, audit or custom roles shows no warning although data exists and becomes unreachable. Also string switch on feature keys (see BX-1), `DateTime.UtcNow` at :152 instead of the injected `TimeProvider` used by the neighbouring handlers (untestable), and one query per lost feature (N small queries, acceptable but sequential).
Fix: add counts for purchasing (PurchaseOrders, Suppliers), expenses, custom roles (non-system UserRoles), chat conversations; inject TimeProvider.
Effort: M

### BX-12 P3 Create/Update plan handlers duplicate validation; code uniqueness is check-then-insert
File: src/WTF.Api/Features/Subscriptions/PlatformPlanFeatures.cs:58-80 vs Features/Subscriptions/PlatformBillingHandlers.cs:99-115 (name length, price range, MaxUsers rules copied). `AnyAsync(code)` then `Add` at PlatformPlanFeatures.cs:79,98 races under concurrent creates (a DbUpdateException surfaces as 500 unless a unique index on Plans.Code exists; none is declared in the new scripts).
Fix: extract `PlanInput.Validate(name, price, maxUsers)`; add unique index on Plans.Code (idempotent script) and map the violation to the same message.
Effort: S

### BX-13 P3 `SetTenantSubscriptionHandler` loads the plan twice and re-normalises
File: src/WTF.Api/Features/Subscriptions/PlatformBillingHandlers.cs:153-157 and :187: `Include(s => s.Plan)` plus a separate `db.Plans...FirstOrDefaultAsync` for the new plan; the audit summary then does `Diff(sub.Plan.Features, PlanFeatures.Serialize(PlanFeatures.Split(newPlan.Features)))` although `Diff` already normalises both sides. Also the summary is a 300+ char single line.
Fix: load the old plan only when PlanId changes; pass raw strings to Diff; break the summary into parts.
Effort: S

### BX-14 P3 TenantFeatureCache invalidation is process-local, global, and racy
File: src/WTF.Api/Common/Tenancy/TenantFeatureCache.cs:30-38; callers PlatformBillingHandlers.cs:124, :195.
Wrong: (a) `Forget()` clears every tenant although only one changed (the interface has no `Forget(tenantId)`; TenantStatusCache has one, :194); (b) a request that read the old plan before SaveChanges can write its stale entry after `Forget()` and keep it for 20 s; (c) with more than one API instance the other nodes only converge after the TTL, which the "Plan edits ... clear it at once" comment does not say. Entries are never evicted (dictionary grows with tenants, minor).
Fix: add `Forget(Guid tenantId)` and call it for the one shop (UpdatePlan: the tenants on that plan); on set, only store if no Forget happened since the read (version counter) or use `GetOrAdd` with expiry; document the multi-node limit in the roadmap.
Effort: S-M

### BX-15 P3 Scheduler feature gate fails open and resolves the DbContext twice
File: src/WTF.Api/Services/DailyCatchUpScheduler.cs:104-110. `GetService<WTFDbContext>()` (not Required) is called twice; if it returned null the gate is skipped and the job runs for a shop without the feature. Also `StockReminderScheduler`/workbook gate runs a plan query per shop per tick with no cache.
Fix: `var tenantDb = scope.ServiceProvider.GetRequiredService<WTFDbContext>(); tenantDb.UseTenant(tenantId);` once, then use the cached `ITenantFeatures` overload.
Effort: S

### BX-16 P3 Daily-close Senior/PWD rows mix populations and put calculation in the handler
File: src/WTF.Api/Features/Reports/GetDailyCloseReportHandler.cs:70-74. The amount is `summary.SeniorPwdDiscounts` (sold + refunded orders) but the count is `sales.Count(o => SeniorPwdAmountsOf(o).Discount > 0)` (completed only), so the row can read "2 orders, 300.00" for 3 orders. The count and hard-coded index inserts (`Insert(1)`, `Insert(2)`, VAT row with count 0) belong in a Calculations summary field (`SalesSummary.SeniorPwdOrderCount`).
Fix: add the count to SalesSummary using the same status set as the amount; build the rows in order instead of inserting by index.
Effort: S

### BX-17 P3 Naming inconsistency for the same number
Files: Features/Reports/GetDailySalesReportHandler.cs, GetHourlySalesReportHandler.cs, GetPaymentsReportHandler.cs, GetStaffPerformanceReportHandler.cs map `summary.SeniorPwdReduction` (discount + VAT exempt) into DTO fields named `SeniorPwdDiscounts`, while the daily-close report and the Senior/PWD report use `SeniorPwdDiscounts` for the 20% part only. The "Senior/PWD" column in ReportTables.cs therefore means "discount + VAT removed" in one report and "discount only" in another.
Fix: name the DTO field `SeniorPwdReduction` (or split into two columns) and use one label ("Senior/PWD relief") everywhere.
Effort: S

### BX-18 P3 ReportTables Senior/PWD column copy-pasted 4 times
File: src/WTF.Api/Endpoints/ReportTables.cs (~lines 19, 141, 165, 186 plus matching summary lines). The `new("seniorPwdDiscounts", ...)` column and `rows.Sum(...)` summary line are repeated per table, like the other money columns (pre-existing pattern, but worsened). Fix: a small `MoneyColumn<T>(key, label, selector, width)` helper.
Effort: S

### BX-19 P3 SQL notes
- tools/sql/20261130_plan_feature_catalog.sql header says "no plan Pogi edited is changed" (a person's name in a repo script; reword to "no plan edited by the owner"). The Business plan INSERT is guarded by Code and the Pro UPDATE by exact-text match: idempotent and never overwrites edits (OK). The PlatformAuditLog marker guard for the role copy is correct.
- tools/sql/20261121_customer_last_name_optional_and_order_address.sql: idempotent and non-destructive (OK). `ALTER COLUMN LastName VARCHAR(50) NULL` hard-codes the type; if the live column is wider/other collation it narrows or changes it. Read the current max_length and keep it (or assert it is 50 first). The CustomerAddress "shrink" step runs only when no longer value exists (good); the NOCHECK constraint means the check is untrusted (documented).
- tools/sql/20261121_add_senior_pwd_discount.sql: table/index/column creation is idempotent (OK); see BX-7 for the permission copy. It does not set XACT_ABORT/transaction like the other script, so a mid-run failure leaves partial changes (re-runnable, so low risk).
Effort: S

### BX-20 P3 Comment-rule nits
- src/WTF.Api/Common/Auth/Permissions/FeatureRequirement.cs:11-12 and Common/Tenancy/TenantPlanLookup.cs:10,22, TenantFeatureCache.cs:17-18 use "what the code does" summary comments above declarations. The repo rule: no summary comments unless they explain why; the "why" parts (fail-open when no shop, no subscription row keeps everything) are worth keeping, trim the rest.
- `FeatureAuthorizationHandler.IsInPlan` fails open (returns true) when the PlanLoaded claim is absent; that is a deliberate choice (platform area, tests) but is undocumented at the call site and means any route reached before PermissionClaimsMiddleware sets claims is ungated.
Effort: S

## Checked and fine
- Endpoint/handler CQRS: new endpoints (senior-pwd report, plans, plan-features, plan-change-preview) all go through ISender with command/query records above handlers; chat/purchasing endpoints only switched policies consistently (Conversation, PurchaseOrder, Reorder, StockReceipt use ChatRead/Write, PurchasingRead/Write; suppliers moved to purchasing feature in PermissionCatalog).
- AsNoTracking present on new read queries (TenantPlanLookup, GetSeniorPwdReport, GetPlansHandler counts, PlansByFeatureAsync, CountUsersAsync); no N+1 in the new report (single projection query).
- Platform plan endpoints sit in the PlatformAdmin group (PlatformEndpoints.cs:39); CancellationToken is passed in all new async paths except the endpoint lambdas, which follow the existing pattern.
- The report endpoints that are feature-gated (stock-status, waste, gross-profit, profit-loss, stock-variance, promotions, customer-links) are covered; `/senior-pwd` correctly inherits ReportsRead only. Note profit-loss is gated on "inventory" only although it also reports expenses (feature "expenses"); confirm that is intended.

---

## Frontend standards audit (src/wtf-pos, diff vs origin/main, non-spec)
All paths under /home/user/WTF/src/wtf-pos/src/app. Read-only; nothing built or run.

## P1
FE-1 P1 core/guards/feature.guard.ts:10 - `featureGuard` is exported and has a spec, but no route uses it (grep: only feature.guard.spec.ts references it; app.routes.ts has no `data.feature`). Gating happens only through `roleGuard` mapping permission -> `PermissionCatalog.feature` (role.guard.ts:34-45). Dead code that looks like the gate. Fix: delete it, or wire it on the plan-gated routes; keep one mechanism. Effort S.

FE-2 P1 core/services/plan-store.ts:30,69 and core/services/auth.service.ts:232 - `PlanStore.clear()` is never called (logout, shop switch, `clearLocalDataWhenTheShopChanged`). The snapshot signal is read once at construction (`readSnapshot()` filters by the tenant at that moment), so after logout and login as another shop in the same session the old shop's features stay live until the next `/subscription` refresh. Fix: call `plans.clear()` in `logout()` and in the tenant-changed branch (or key the signal on `currentTenantId()`). Effort S.

FE-3 P1 core/guards/role.guard.ts:6 - core guard imports `@environments/environment.development` directly, and uses `injector.get(HttpClient)` plus a raw `http.get('/subscription')` inside a guard, bypassing `SubscriptionService`. 38 files do the same import (1 uses `@environments/environment`), so it is not new, but this adds a second path that writes the plan store. Also `denied()` is a hoisted function declared after use, and `router.navigateByUrl` result is unhandled (lines 87-93). Fix: call `inject(SubscriptionService).refresh`/a `loadPlan()` method that returns a Promise; drop HttpClient and environment from the guard. Effort S-M.

## P2
FE-4 P2 features/orders/order-editor/order-editor.ts (3350 lines, was ~3130 in the prior audit; +242 lines in this branch, e.g. 265-292, 570-574, 1790-1830, 1935-1962, 2383-2430) - the god component got bigger. Senior/PWD state (persons signal, 6 computeds, dialog open/close, prune effect, `seniorPwdBlockedReason`, `pruneSeniorPwdPersons`, `seniorPwdCommandPart`) and order-address state (`orderAddress`, `orderAddressEdited`, `fillOrderAddressFromCustomer`, `currentOrderAddress`, `canEditOrderAddress`) are all inline. No `ChangeDetectionStrategy.OnPush` here or on `SeniorPwdDialogComponent`, `NotInPlanComponent`, `OrderDetails`, `OrderReceiptComponent`, `OrderList` (OnPush exists only on platform-* and impersonation-bar). Fix: move the Senior/PWD block into a small facade class or service (e.g. `order-editor-senior-pwd.facade.ts`) and the address block into a helper; add OnPush to the new components (`SeniorPwdDialogComponent`, `NotInPlanComponent`, both signal-based so it is safe). Effort L (split), S (OnPush on new components).

FE-5 P2 features/orders/order-editor/order-editor-senior-pwd.ts:134-163 (`rowAmounts`, `reductionOf`, `totalsByPerson`; the 'amountDue' subtraction at line 158) - arithmetic on money sits in a feature file, not in `shared/calculations`. CLAUDE.md says totals and what-gets-discounted rules belong only in `shared/calculations`. The cent maths is correct (uses toCents/fromCents) but `lineTotal -> seniorPwdAmounts` composition and per-person totals are rules and are not covered by `calculation-cases.json`. Also `amountDue` duplicates `seniorPwdAmountDue()` in shared/calculations/senior-pwd.ts:53. Fix: move these three functions into `shared/calculations/senior-pwd.ts`, reuse `seniorPwdAmountDue`, add cases to `calculation-cases.json`. Effort M.

FE-6 P2 features/orders/order-editor/order-editor.ts:570-574 (`totalPrice`) and 1568-1570 (`getCartLineNetTotal`) - order total is `cartTotal - reductionOf(...)` assembled in the component with `subtractMoney`; same `net = total - reduction` is repeated in order-details/order-details.ts:487 (`getItemNetTotal`) and shared/components/order-receipt/order-receipt.ts:281 (`getItemNetTotal`). Fix: one `lineNetTotal(total, reduction)` and one `cartTotalAfterSeniorPwd(...)` in shared/calculations; components call them. Effort S-M.

FE-7 P2 duplication across order-editor/order-details/order-receipt/order-list:
 - Covered-line test `c.seniorPwdPersonIndex !== null && c.seniorPwdPersonIndex !== undefined` is inlined twice in order-details.html:366,387 although `isCoveredLine()` exists in order-editor-senior-pwd.ts:25; receipt uses `== null` (order-receipt.ts:270). Move `isCoveredLine` to `shared/calculations` (or shared/utils) and use it in all four.
 - `seniorPwdLabel` is written three times: order-editor.ts:1822, order-details.ts:479, order-receipt.ts:265, plus the unused `personLabel` in order-editor-senior-pwd.ts:165 (grep shows no caller). Use `SENIOR_PWD_TYPE_LABELS` via one shared pipe/helper.
 - The per-person block ("Covered / VAT exempt / Senior/PWD discount (20%) / amount due") is hand-written in order-editor.html (~line 944), order-details.html (~565), senior-pwd-dialog.html:207 and order-receipt.html:332. Fix: one `app-senior-pwd-summary` shared component (receipt needs inline styles, so give it a `printable` input or leave the receipt as is).
 - Hard-coded "20%" in 5 templates (order-editor.html:944, order-details.html:565, senior-pwd-dialog.html:21,207, order-receipt.html:332) instead of `SENIOR_PWD_DISCOUNT_RATE` from shared/calculations/senior-pwd.ts:8 (the rate can drift from the maths).
 - Address display: `getOrderAddress()` (order-list.ts:1009: deliveryAddress || customerAddress) is list-only; order-details.html and order-editor.html render `customerAddress` on their own and do not apply the same fallback. Fix: one `orderAddressOf(order)` in shared/utils next to `joinName`. Effort M.

FE-8 P2 shared/calculations/plan-features.ts:15-25 vs src/WTF.Calculations/Subscriptions/PlanFeatures.cs:13-23 - the feature catalog (9 keys, labels, descriptions, groups, needs) is copied verbatim in TypeScript and C#, and `normalizeFeatures` / `toggleFeature` re-implement `PlanFeatures.Normalize`. The platform pages already fetch the server catalog (`PlatformService.getPlanFeatures`, platform-plans.ts:62) but `NotInPlanComponent` (not-in-plan.ts:28) and `platform-tenant-detail.ts:88` still read the static TS copy, so one screen can show labels that differ from the other after a server change. Also `report-features.ts:5-13` and `permission-catalog.json` hold a third and fourth feature mapping. Not covered by `calculation-cases.json`. Fix: add feature-catalog cases to the shared JSON for both sides (or drop the TS catalog and serve it from `/plan-features`, cache it in `PlanStore`). Effort M.

FE-9 P2 features/orders/senior-pwd-dialog/senior-pwd-dialog.html:1-12 and .ts - hand-built modal (own backdrop, `role="dialog"`, Esc/click handling, no focus trap) with 260 lines of template; it does not use `app-confirm-dialog`/`side-drawer`, and the person form uses raw `(input)` handlers with `$any($event.target).value` (html:101,122) and a manual `PersonState` signal, not Reactive Forms (rule: always Reactive Forms). Same raw-input pattern for the new address fields: order-editor.html:1250 `$any($event.target)`, order-editor.ts:1940 `onOrderAddressInput` with a `(event.target as HTMLInputElement)` cast, and `orderAddressEdited` as an untracked plain field (ts:305). Fix: use a `FormArray` of `FormGroup`s in the dialog (validators already exist as functions), and a `FormControl` for the order address with `valueChanges`/`dirty` replacing `orderAddressEdited`. Effort M.

FE-10 P2 features/orders/senior-pwd-dialog/senior-pwd-dialog.ts:123 and features/platform/platform-plans.ts:62, platform-tenant-detail.ts:168,230,321,485, management/brand/brand-page.ts:67-137 - `.subscribe()` with no `takeUntilDestroyed`/`DestroyRef`. Dialog `checkId` callback can fire after the dialog is closed and writes `idWarnings` (guarded only by the idNumber check; a stale response for a removed person index still lands). `previewPlanChange` (tenant-detail:321) has no cancel of the previous request, so a slow response for plan A can overwrite plan B's preview. Fix: `takeUntilDestroyed(this.destroyRef)` and `switchMap` via a Subject for the preview. Effort S.

FE-11 P2 features/management/reports/reports.ts:190 - `catalog` changed from a readonly field to a `get` accessor that rebuilds and filters `REPORT_DEFINITIONS` on every change detection pass, and calls `PlanStore.hasFeature` each time. The component is not OnPush. Fix: `protected readonly catalog = computed(() => ...)` (PlanStore is a signal, so it reacts). Effort S.

FE-12 P2 core/services/db.ts:22,38,66 and core/services/offline-order.service.ts:114,156 - `PersistedCart.seniorPwdPersons?`, `CachedCatalog.settings?` and `PendingOrder.version` are added without a new Dexie `version(6)`; this is fine because none are indexed, and old rows read as undefined (restoreSavedCart:2752 and `cached.settings ?? NO_SHOP_SETTINGS` handle that). Problems: (a) `PendingOrder.version` / `QUEUE_VERSION` is written but never read anywhere in core (grep `.version` only hits update.service), so it is dead data, and the comment claims old queued orders "sync as they always did" with no code that checks it; (b) a cart saved before the shop turned Senior/PWD off still restores `seniorPwdPersons` and covered lines (restoreSavedCart does not check `shopSettings().seniorPwdEnabled`), so an offline cart can carry a discount the shop no longer allows; (c) `CatalogCacheService` keeps the legacy fallback fields `seniorPwdEnabled`/`vatRegistered` plus `settings`, so the DTO has two shapes (catalog-cache.service.ts:29-48). Fix: drop `version` or branch on it in the sync; clear covered lines on restore when the switch is off; pick one DTO shape. Effort S.

## P3
FE-13 P3 Comments: new JSDoc/summary comments against the rule (no summary comments) in shared/calculations/senior-pwd.ts:3-6,12,18,48,56,70 (`/** ... */` above exports), core/services/db.ts:38,66 (`/** ... */` above fields), and `//` restating comments above members in order-editor-senior-pwd.ts:15,29,127 and senior-pwd-dialog.ts:20. Keep only the "why" ones (the integer-maths note on senior-pwd.ts:19 is a fair why-comment, as a `//`). Effort S.

FE-14 P3 Explicit access modifiers / return types / member order:
 - senior-pwd-dialog.ts:41-50: `protected readonly SeniorPwdTypeEnum`, `types`, etc. are fine, but the private `selections` computed (line 73) is declared between protected members and is used by `totals` above no -- order: protected properties come before private properties per the rule; here `private readonly selections` (73) sits before `protected readonly totals` (79).
 - order-editor.ts:268-291: private computed `seniorPwdLineAmounts` (274) is in the middle of protected members; `private orderAddressEdited` (305) sits between protected signals.
 - order-editor.ts:570 `protected totalPrice = () =>` has no `readonly` and no return type (pre-existing arrow, but the body was changed by this branch).
 - core/services/plan-store.ts:7 exports `interface PlanSnapshot` in the service file and has module-level `readSnapshot()`; fine, but `hasFeature(key: string)` takes a bare string rather than a union type of the catalog keys, so a typo in a template (`plans.hasFeature('inventroy')`, dashboard.html:477,502,515,542) compiles and silently returns false. Fix: `type PlanFeatureKey = typeof PlanFeatureCatalog[number]['key']` with `as const`. Effort S.

FE-15 P3 Tailwind: no `z-[..]`, no leading-`!`, no `break-words`, no `order-none`, no `flex-shrink` in the added lines. The new template lines add arbitrary `text-[11px]` (order-details.html:361-368, dashboard.html 3 lines, order-editor.html 337,642,654) which the codebase already uses 40+ times (pre-existing pattern; no named equivalent in the project scale). Hard-coded `max-h-[90dvh]` in senior-pwd-dialog.html:12 could be `max-h-[90dvh]` -> keep (no standard name). Receipt uses inline `style=` by design (print). No action needed beyond noting it.

FE-16 P3 features/management/customers/customer-list/customer-list.html:175-190 - the new Address column header is another hand-written sortable `<button role="button" tabindex="0">` (with redundant `role`/`tabindex` and `(keydown.enter)` on a native button), copied from the other 4 headers; the shared `app-sort-header` component exists (shared/components/sort-header) and is not used. Fix: switch the customer list headers to `app-sort-header`. Effort M (all headers) / S (just the new one).

FE-17 P3 features/orders/order-list/order-list.html:306-309 - `@else { <span></span> }` spacer added in the chat button block to hold grid layout; use `[class.invisible]` on a placeholder or restructure the grid. Also the `canChat` computed is declared twice with the same body (order-list.ts:131 and order-details.ts:94); `AuthService.canReadChat()` is already a plain method, so templates can call it directly like staff-envelope.html:1 does. Effort S.

FE-18 P3 features/platform/platform-tenant-detail.html (+33 lines) uses `<select class="select select-bordered ...">` (daisyUI classes) for the plan picker; other app selects use `app-select-dropdown` (shared/components/select-dropdown). Check against button-conventions spec scope (it only covers `btn`), so it passes, but it is inconsistent. Effort S.

## Checked, no issue found
- Imports: new code uses `@core`, `@shared`, `@features` aliases. Relative imports only for siblings (`./order-editor-senior-pwd`, `../senior-pwd-dialog/...` from order-editor, and dialog -> `../order-editor/order-editor-senior-pwd`). The dialog importing the editor's helper file is a feature-internal two-way dependency (editor <-> dialog); moving the helpers into the dialog folder or shared/calculations (FE-5) removes it.
- No services added to `shared/`. `shared/` does not import from `features/` in the changed files. `core/` imports only from `@shared` and its own folder (role.guard.ts imports `./feature.guard`, core-internal). No feature imports another feature except order-editor -> senior-pwd-dialog (same `orders` feature) and `app.routes.ts` -> `@features/not-in-plan` (fine).
- `any`: no explicit `any` in new .ts; `$any()` appears in templates (FE-9).
- Braces and inject(): new code uses braces and `inject()` throughout (the one-liner arrow guards are expressions).
- Money: shared/calculations/senior-pwd.ts is whole-cents and matches the API (integer formulas `floor((2n+5)/10)`, `floor((50n+28)/56)`); `subtractMoney`/`sumAmounts` are used for sums. The only floating-point risk is `SENIOR_PWD_DISCOUNT_RATE = 0.2` / `VAT_RATE = 0.12`, which are exported constants not used in the maths (display only).
- subscription.interceptor.ts: 402 -> refresh, 403 `not_in_plan` -> navigate; guards against loops with the `router.url.startsWith` check. One small gap: `OFFLINE_SYNC_URL = /\/orders\/(sync|batch)$/` fails on a trailing query string (`?x=1`); minor. Order of imports in the file is not alphabetical (cleanup, not a defect).

---

## Test-code standards audit: origin/main..HEAD (Senior/PWD, customer address, plan gating)

Read-only. No dotnet SDK on this machine, so nothing was built or run; every item below comes from reading the code and grepping. Scope: 69 changed test files (src/WTF.Tests, src/wtf-e2e, *.spec.ts, calculation-cases.json).

## Clean checks (no finding)
- No skipped or focused tests: no `Skip=`, `xit`, `it.skip`, `test.skip`, `fixme`, `.only` in the diff (only hit was `GrossProfit` matching "fit").
- No credentials in the repo. The only password in the new e2e code is generated per run (`src/wtf-e2e/api/senior-pwd.ts:83`). `Tmp12345` in `platform-tenant-detail.spec.ts:33` is a mock reset-password response.
- Playwright config holds: `workers = max(3, ...)`, `timezoneId: 'Asia/Manila'`, app port 4300 and API 5290 (separate from dev 4200/5282), throwaway `WTF_E2E_*` DB per run. Tags present on every new spec (`@seniorpwd`, `@plans`, `@customer-address`, `@layout`).
- Usings are sorted A-Z in all new .cs files (the `;`-less comparison shows no drift). No braceless control flow, no missing access modifiers, no K&R braces in new C# (checked by regex over added lines). New code has no CRLF.
- Shared cases file: `seniorPwdRow`, `seniorPwdOrders`, `seniorPwdEligibility`, `planFeatureCatalog`, `planFeatures`, `plansContaining` are loaded by both `SharedCasesTests.cs` (lines 106-111, 684-729) and Angular specs (`senior-pwd.spec.ts`, `plan-features.spec.ts`). Hand-checked the half-centavo case (0.14 gives VAT 0.01, discount 0.03) against `SeniorPwdRules.ForRow`: it matches.

## Findings

### T-1  P2  Machine-specific absolute path for screenshots
- `src/wtf-e2e/tests/orders/senior-pwd/layout.spec.ts:9` (used at lines 40-41, 50, 69, 121, 154)
- `SHOTS` defaults to `/mnt/project-files/senior-pwd/v3`. On a dev Windows PC (run.ps1) that creates `C:\mnt\...`, and on CI it writes outside the workspace. It also calls `mkdirSync` in the test body.
- Fix: default to `test-results/senior-pwd` (like `customer-address.spec.ts:102`), or attach with `testInfo.attach`. Drop the env override unless needed.
- Effort: S

### T-2  P2  Fixed sleep in a Playwright test
- `src/wtf-e2e/tests/plans/plan-gating.spec.ts:233` (`await page.waitForTimeout(500);`)
- A fixed 500 ms sleep after `platform.setSubscription` before the next navigation. It is either too short on a busy machine (the config already allows 30 s expects because pages take 15+ s) or wasted time. The API call is awaited, so the sleep hides a missing wait, probably the plan cache or the PlanStore refresh.
- Fix: delete it and assert on the result (`await expect(page).toHaveURL(...)` already retries), or poll `GET subscription` until the feature appears.
- Effort: S

### T-3  P2  Test title promises an assertion that is not made
- `src/wtf-e2e/tests/plans/plan-gating.spec.ts:203-219`
- The title says "sees no gated menu items", but the body only checks the redirect to not-in-plan, the page text and overflow. Nothing looks at the sidebar or menu, so a gated menu item could show and the test would pass at all three viewports.
- Fix: assert the gated links (Inventory, Expenses, Promotions) have count 0 in the nav (open the phone drawer at 375), or rename the test.
- Effort: S

### T-4  P2  Copy-pasted helpers across the Senior/PWD order test classes
- `src/WTF.Tests/Features/Orders/SeniorPwdOrderTests.cs:19-60` and `SeniorPwdEdgeCaseTests.cs:17-60`. The same block is in both: fields, `CreateHandler`, `UpdateHandler`, `Person`, `Covered`, `Plain`, `Sale`, `ConfigureShopAsync`. `OrderCustomerAddressTests.cs:19-35` repeats the handler construction, and `Database/SeniorPwdDatabaseTests.cs:19-22` does again.
- About 40 duplicated lines per file. Handler constructor changes (seven arguments) must be edited in 4+ places.
- Fix: one `SeniorPwdTestKit` (or a base class) in `WTF.Tests/Infrastructure`, plus a `TestFakes.CreateOrderHandler(...)` factory.
- Effort: M

### T-5  P2  `ICurrentTenant` fakes re-declared per file
- New: `src/WTF.Tests/Database/PlanGatingDatabaseTests.cs:23` (`FixedTenant`) and `:230` (`SwitchableTenant`), `Database/SeniorPwdDatabaseTests.cs:235` (`FixedTenant`). Existing copies: `SubscriptionDatabaseTests.cs:30,43`, `PlatformDatabaseTests.cs:476,489`, `RoleDatabaseTests.cs:172`. That makes 7 copies of two classes.
- Fix: move both to `Infrastructure/TestTenants.cs` and delete the copies.
- Effort: S

### T-6  P2  `/// <summary>` comments in new files (forbidden by the project rules)
- `src/WTF.Tests/Database/PlanGatingDatabaseTests.cs:20`, `Database/SeniorPwdDatabaseTests.cs:13`, `Endpoints/PlanGatingTests.cs:13-16`.
- Copilot instructions say no summary comments on classes. (`SharedCasesTests.cs:11-15` and `SqlServerAvailability.cs` already carry them. The prior audit's cleanup of 123 summaries should include the test project.)
- Fix: delete the three blocks; where the "why" matters, use a plain `//` explanation.
- Effort: S

### T-7  P3  Plan-gating theory covers 3 of 9 gateable features and hard-codes a count
- `src/WTF.Tests/Endpoints/PlanGatingTests.cs:92-94` (`[InlineData("inventory"/"promotions"/"orderlinks")]`) and `:127` (`mixed.Count.ShouldBeGreaterThanOrEqualTo(8)`).
- `expenses`, `purchasing`, `chat`, `workbook`, `audit`, `customroles` get no refuse/allow check in the theory (they are only covered indirectly by the mixed-route test). The magic `8` goes stale silently.
- Fix: `[MemberData]` over `PlanFeatures.Gateable`. The Pro plan set should be built from the catalog (`needs` closure), not typed by hand. Replace `8` with a named expected list or drop it.
- Effort: S

### T-8  P3  Test mirrors the implementation
- `src/WTF.Tests/Endpoints/PlanGatingTests.cs:176-185` (`TheNewKeys_FollowTheirFeatures`)
- Six `FeatureOf("x").ShouldBe("y")` lines that restate the catalog table. The name "TheNewKeys" is time-bound and will mean nothing in a year. It also overlaps `EveryRoute_HasAPlanDecision`.
- Fix: rename to `PermissionKeys_MapToTheirPlanFeature`, or drop it in favour of one test that every permission's feature is known (`PermissionPolicyHasKnownFeature` already does most of that).
- Effort: S

### T-9  P3  Real clock in the new DB tests
- `src/WTF.Tests/Database/PlanGatingDatabaseTests.cs:48-51, 79, 81, 118, 162, 164, 206`, `Database/SeniorPwdDatabaseTests.cs:145, 163-164, 201-202, 213, 229`, `Features/Orders/OrderCustomerAddressTests.cs:41`.
- `DateTime.UtcNow.AddDays(-5/300)` for the subscription period. It works (5 days back, 300 ahead), but the audit's larger refactor recommends a clock, and `SubscriptionDatabaseTests` already passes a fixed `clock`. Plan-gating tests are the ones that depend on "is the period current", so they should use the same fixed clock.
- Fix: a `FixedClock` constant (`Today`) shared from `Infrastructure`, as `SubscriptionDatabaseTests` does.
- Effort: S

### T-10  P3  Heavy eager work in the property tests
- `src/WTF.Tests/Calculations/SeniorPwdRulesPropertyTests.cs:26-40` and `src/wtf-pos/src/app/shared/calculations/senior-pwd.property.spec.ts:30-43`.
- 1,000,000 cents x 2 modes on each side. The C# `ShouldBe(..., $"{cents} cents, vat {vat}")` builds an interpolated string on every iteration (4,000,000 allocations). The TS test runs under vitest's default 5 s timeout with no explicit timeout, so a slow CI box may time out.
- Fix: collect mismatches like the TS version does (no per-iteration message), or use a step (every cent below 10 pesos, every 7th above). Add an explicit timeout to the TS `it`.
- Effort: S

### T-11  P3  Database tests skip silently when no SQL Server is reachable
- `src/WTF.Tests/Database/PlanGatingDatabaseTests.cs:61 ff.` and `SeniorPwdDatabaseTests.cs` use `[SqlFact]`. `Infrastructure/SqlServerAvailability.cs:19-21` turns that into a skip.
- The foreign-key, default-column and tenant-filter checks for the new features are only checked where LocalDB or `WTF_TEST_SQL` exists. A green run on a machine without it looks the same as a full run. (The infrastructure existed before this branch.)
- Fix: CI should set `WTF_TEST_SQL` and fail if the count of skipped `SqlFact` is above zero (or fail when `CI=true` and unavailable).
- Effort: S

### T-12  P3  `Date.now()` used for uniqueness instead of the shared helper
- `src/wtf-e2e/tests/orders/register/customer-address.spec.ts:20-22` (`(Date.now() % 9000) + 100`), `tests/plans/plan-gating.spec.ts:151, 162` (`e2e-${Date.now().toString(36)}`).
- Two parallel workers starting in the same millisecond collide (house number or plan code), and the house number wraps every 9 s. The repo already has `unique()` (used in `api/senior-pwd.ts`).
- Fix: use `unique('e2e')`, or a counter plus worker index.
- Effort: S

### T-13  P3  `findOrder` scans the whole order list in a shared DB
- `src/wtf-e2e/tests/orders/register/customer-address.spec.ts:109-112`
- `GET orders` returns the owner's whole list and the test picks one by customer id. It works while the list is small, but all tests share one throwaway DB with 3-4 workers, so the list grows and (if the endpoint ever pages) the order can fall off it.
- Fix: capture the order id from the checkout response (`waitForResponse` as done for the customer at line 47) or filter by `customerId` server side.
- Effort: S

### T-14  P3  Weak assertions in new Angular specs
- `src/wtf-pos/src/app/features/not-in-plan/not-in-plan.spec.ts:53, 55, 61` (`querySelector(...)).toBeTruthy()`), `features/platform/platform-plans.spec.ts` (one `toBeTruthy`).
- They prove an element exists, not its text or link target (line 55 does check the `href` through the selector, which is fine). The upgrade and ask-owner cases do not check what the person reads.
- Fix: assert `textContent` for the two messages and that the other variant is absent.
- Effort: S

### T-15  P3  Weekday-dependent specs use the real clock
- `src/wtf-pos/src/app/features/orders/order-editor/order-editor.spec.ts:802, 1690, 1815` (`new Date().getDay()`), `order-list/order-list.spec.ts:507` (`Date.now()`).
- Logic is relative (today vs. tomorrow), so it passes on any day, but a run that crosses midnight, or a Sunday wrap (`(day + 1) % 7`), can flip. Other specs in this branch already use `vi.setSystemTime`.
- Fix: `vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(...)` in these tests.
- Effort: S

### T-16  P3  New e2e areas are not wired into npm scripts or README
- `src/wtf-e2e/package.json` has no `test:plans`, `test:seniorpwd` or `test:customer-address` scripts, and `src/wtf-e2e/README.md` folder list (lines 11-31) omits `tests/plans/`, `tests/orders/senior-pwd/` and `register/customer-address`.
- README rule: "One folder per section... `npm run test:<area>`". CLAUDE.md asks that docs follow the code.
- Fix: add the scripts and README rows.
- Effort: S

### T-17  P3  Viewport coverage is partial for the address UI
- `src/wtf-e2e/tests/orders/register/customer-address.spec.ts:97-103` loops 375/820/1440 only for the order list. The create-customer dialog (line 31-40) and the register's "Order address" field (line 52) are checked at 1440 only. Senior/PWD `layout.spec.ts` and plan-gating do loop all three (good).
- Fix: loop `VIEWPORTS` over the dialog and the register field with `measureOverflow`.
- Effort: M

### T-18  P3  Coverage gaps against the new rules
- Senior/PWD, shared cases (`calculation-cases.json:1716-1722`): no 0.01 or 0.02 case (VAT-exempt rounds to 0 and discount to 0), no negative or null covered. The oracle tests cover 1 cent and up on both sides, so this is documentation value, not a hole. Add the two rows so a future port (another client) is checked.
- Address: no test that an address survives offline sync (`SyncOfflineOrdersHandler` and the batch path), nor that void or refund keeps it (`VoidOrderHandler.cs:256` copies it). `SubmitPublicOrderHandlerTests` covers the public link delivery address, which is a different field. Confirm the sync path carries `CustomerAddress` and, if so, add a case in `OrderCustomerAddressTests`.
- Plan downgrade on the Angular side: `plan-store.spec.ts` and `feature.guard.spec.ts` only apply one plan. There is no case for "plan shrinks while the app is open, then the guard redirects", which is the scenario the .NET `ASaleOnAPlanWithoutInventory...ThenDeductsWhenInventoryReturns` and the e2e downgrade test cover on the API side.
- Fix: add the cases above.
- Effort: M

### T-19  P3  Setup repeated in e2e plan tests and coupled to seeded plan data
- `src/wtf-e2e/tests/plans/plan-gating.spec.ts:72-88, 124-131` hard-codes what "Pro" and "Business" hold and asserts `plansByFeature['purchasing']` equals exactly `['Business']`. A seed change to the Pro plan fails e2e with no signal that it is a data change. Line 137 asserts `status(starter,'items')` twice with nothing in between.
- Fix: read the plan's features from `platform.plans()` instead of hard-coding, and remove the duplicate assertion.
- Effort: S

## .editorconfig vs new code
- Allman braces, 4-space indent, file-scoped namespaces, usings outside the namespace, A-Z sorted usings: no violations found in the 9 new .cs files or the changed lines of the others.
- IDE0005 (unused usings) is set to `warning`, but this could not be run here. A cheap heuristic found one candidate, `using WTF.Api.Services;` in `Features/Reports/MonthlyReportWorkbookServiceTests.cs`. It may be pre-existing. Run `dotnet format style --diagnostics IDE0005` on the touched files (CLAUDE.md requires the cleanup skill).
- The `.editorconfig` has no rule for `///` summary comments, so T-6 is only caught by review. Consider a note in the file, as the project rule is stricter than the config.
- Windows line endings: new .cs and .ts files have no CRLF while CLAUDE.md says many source files do. `.gitattributes` normalizes, so this is fine.

---

