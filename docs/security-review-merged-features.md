# Security review: Senior/PWD discount, customer address, plan gating

Scope: `git diff origin/main...integration-senior-pwd-address` (241 files, 34 commits on main `3367a2a`). Read-only
review; no code was changed and nothing was run. Production overrides the committed JWT key (per Pogi), so that is
out of scope. Prior review (`security-review` branch) is not repeated here.

**Result: no Critical or High findings. 5 Medium, 14 Low, several Info.** Findings that two reviewers found
independently are merged. Line numbers are approximate (`~`) where marked.

## Fix before release (Medium)

### M-1 Held offline orders skip the Senior/PWD permission check
- `src/WTF.Api/Features/Orders/SeniorPwdOrders.cs:62-90` (the `if (!held)` block), `OfflineOrderReview.cs:62-119`,
  `SyncOfflineOrdersHandler.cs:68-73`, `ReviewHeldOrderHandlers.cs:29-64`
- When an offline order has any review reason it is "held", and the switch, `orders.seniorpwd.apply` and ID
  validation are all skipped. A client can force a hold (a quoted price one cent off, or a blank ID). No reason is
  added when the caller lacks the permission.
- Exploit: a custom-role cashier with only `orders.write` posts `/api/orders/sync` with `seniorPwdPersons`. A
  PendingReview order with VAT-exempt and discount rows is saved. The Admin sees only a price or ID reason, and
  approval does no Senior/PWD re-check, so the discount lands.
- Fix: check the permission before the `held` branch, or add a hold reason "submitted by a user without Senior/PWD
  permission". Add reasons for blank or duplicate IDs. Run `EnsureLineAllowed` for held orders too.

### M-2 `CreatedAt` is client-controlled on `POST /api/orders` and `/batch`
- `Features/Orders/CreateOrderHandler.cs:48,187,260`; `OfflineSyncWindow.Check` runs only on the sync route.
- Any `orders.write` user can backdate. Discount rows copy the date, so the "ID already used today" check
  (`SeniorPwdIdCheckHandler.cs`, `CreatedAt >= startOfToday`) never fires, and sales move to another report day or
  VAT period.
- Fix: ignore or reject `CreatedAt` on non-sync create unless within minutes of now. Apply `OfflineSyncWindow` to `/`
  and `/batch` when it is supplied.

### M-3 Bundle promotions are not plan-gated on the order write path
- `src/WTF.Api/Common/Orders/BundlePromotionResolver.cs:11-48`; callers `CreateOrderHandler.cs:218-229`,
  `UpdateOrderHandler.cs:136`, `OfflineOrderReview.cs ~169`. Contrast `DiscountRuleLoader.cs:26`,
  `GetPosBundlesHandler.cs:24`.
- A downgraded shop (or a POS with a pre-downgrade offline cache) can still sell bundles at bundle price via
  `/api/orders` or `/api/orders/sync`.
- Fix: check `TenantPlanLookup.HasFeatureAsync(db, "promotions")` in the resolver; throw online, add a hold reason
  offline. Add a test beside `PlanGatingDatabaseTests:111-146`.

### M-4 Path traversal in customer image upload (pre-existing, touched by this branch)
- `Features/Customers/UploadCustomerImageHandler.cs:33-36` (name slug only replaces space and `-`),
  `Features/Customers/CustomerValidation.cs:58-66` (length only), `Services/LocalImageStorage.cs:11-14`
  (`Path.Combine`, no containment check).
- Exploit: a user with `customers.write` creates a customer named `../../../x` and uploads a valid image. The file is
  written outside the customer folder, including other tenants' image folders. The GUID suffix prevents overwrite.
- Fix: name the file `{Guid:N}{ext}` only. In `LocalImageStorage` reject `fileName != Path.GetFileName(fileName)` and
  verify the resolved path stays under the images root.

### M-5 `Plans.MaxUsers` is never enforced (pre-existing, part of plan gating)
- No use in `Features/Users/CreateUserHandler.cs` or `UpdateUserHandler.cs`; the diff adds only a platform user
  count (`PlatformBillingHandlers.cs`, `CountUsersAsync`).
- Exploit: a tenant Owner on a 3-user plan posts `/api/users` repeatedly. The plan roadmap says "downgrade over cap:
  allow, warn, block excess newest users", so the block is not built either.
- Fix: count active users against the plan on create and on reactivation, and return the `not_in_plan` style 403.

## Low

| ID | Finding | Where | Fix |
|---|---|---|---|
| L-1 | Legacy token with no tenant claim skips plan gating (fail-open); data layer maps it to the default tenant | `PermissionClaimsMiddleware.cs:55-60`, `FeatureRequirement.cs:27-30`, `CurrentTenant.cs:38`, `TenancyOptions.cs:7` | Resolve the tenant the same way in the middleware, or fail closed. Turn off `LegacyTokensAreDefaultTenant` once tokens rotate. |
| L-2 | Monthly workbook status and download routes not gated by `workbook` | `Endpoints/ReportEndpoints.cs:289-304, 328-350` | Add the feature policy to both. |
| L-3 | Item-supplier routes use stock permissions, not purchasing | `Endpoints/SupplierEndpoints.cs:60-87` | Use Suppliers/Purchasing permissions. |
| L-4 | Profit/loss exposes expenses under the `inventory` gate; `/api/pos/stock-limits` has no inventory gate | `ReportEndpoints.cs:255-273`, `ItemEndpoints.cs:174-180`, `GetPosStockLimitsHandler.cs:18-39` | Require `expenses` on profit-loss; return empty stock limits when inventory is off. |
| L-5 | Senior/PWD SQL re-run re-grants `orders.seniorpwd.apply` to roles that had it removed (no run marker) | `tools/sql/20261121_add_senior_pwd_discount.sql:105-113` | Guard with a PlatformAuditLog marker as 20261130 does. |
| L-6 | Same script auto-grants the permission (and so full-ID view) to every custom role with `orders.write` | same lines | Grant only to roles with `orders.override`, or note in release notes. |
| L-7 | 20261130 role copy and its audit marker are not in one transaction | `tools/sql/20261130_plan_feature_catalog.sql ~40-65` | `SET XACT_ABORT ON` plus `BEGIN TRAN`. |
| L-8 | "ID already used today" is advisory only; IDs not normalized; id-check not rate limited; same ID can repeat on one order | `SeniorPwdIdCheckHandler.cs:25-40`, `SeniorPwdOrders.cs:68-90` | Normalize on save and compare normalized, reject duplicates per request, rate limit the route. |
| L-9 | Full IDs in report export or `GET /orders/{id}` are not audited; `WantsFullId` checks `Accept` more loosely than the export builder | `GetSeniorPwdReportHandler.cs ~76-90`, `GetOrderByIdHandler.cs:131` | Audit full-ID exports; one shared "is export" helper. |
| L-10 | ID number sent in a GET query string (proxy and access logs) | `OrderEndpoints.cs` id-check, `order.service.ts:196` | Use POST with a body. |
| L-11 | IDs plaintext in IndexedDB; `pendingOrders` not cleared on logout | `core/services/db.ts`, `auth.service.ts:225,239` | Purge pending and failed orders on logout and after N days. |
| L-12 | Update rewrites `RecordedBy`; a user without the permission can remove discount rows by omitting persons | `UpdateOrderHandler.cs:373-377`, `SeniorPwdOrders.cs:48-51` | Keep rows when unchanged; require permission to remove. |
| L-13 | Update has no quantity validation (can 500, and aborts a sync batch); pre-existing | `UpdateOrderHandler.cs:91-100`, `SyncOfflineOrdersHandler.cs:85-90` | Copy Create's checks, add a max, add a CHECK. |
| L-14 | Public order "save my address" allows 300 chars but the new CHECK is 150, so the save fails silently and the contact save is lost with it | `SubmitPublicOrderHandler.cs:62,99-108,242-267` | Cap at 150 and tell the customer. |

## Info
- Any role with `orders.read` sees and can search `CustomerAddress`; there is no separate address permission (`GetPagedOrdersHandler.cs:63`). Decide policy or hide it without `customers.read`.
- `UpdateOrderHandler.cs:345-349` clears the order address when a request omits it (data loss, not security).
- Plan lookup fails open: a tenant with no subscription row gets every feature (`TenantPlanLookup.cs:12-26`).
- Plan cache is per process, 20 s TTL; a downgrade can take that long on a second instance (`TenantFeatureCache.cs:28-35`).
- `PlanGatingTests.EveryRoute_HasAPlanDecision` counts any core permission as a decision, so it cannot catch L-2, L-3, L-4.
- `idChecked` is never sent by the Angular app, so Senior/PWD on customer-link orders always fails on the server (functional gap).
- Client gating (guards, interceptor, `PlanStore` in localStorage) is UX only and the API enforces.
- E2E database tool concatenates `E2E_DB_TAG` into SQL; dev-only, drop limited to `WTF_E2E_*` names, no hardcoded credentials.
- New table TenantId defaults to the default tenant; matches convention, stamped on save.

## Checked and found OK
- Server authority on online create/update: prices, 20% rate, VAT rate, eligibility and covered amounts come from the DB or constants; client `ExpectedTotal` is only a guard. Negative and overflow amounts are handled; rounding gains at most about 0.001 per line.
- Every endpoint added or changed has authorization; stacked feature and permission policies combine as AND. Public order-link, chat routes and the anonymous hub are plan-checked.
- Platform separation: all `/api/platform` routes require the PlatformAdmin role, a reserved name tenants cannot take; inputs validated; plan and subscription changes audited with admin id and IP.
- Tenant isolation: `OrderSeniorPwdDiscount` is tenant owned with a global filter and stamped on save; every new `IgnoreQueryFilters` carries an explicit tenant predicate; no new raw SQL; schedulers use one scope per tenant and `UseTenant` first; plan cache keyed by tenant.
- Senior/PWD IDs are masked in lists, reports, workbook, audit values, receipts, chat, public DTOs. Void and cancel are excluded from reports.
- Address: trimmed and capped at 150 in code and model; no raw HTML rendering in Angular; ClosedXML stores strings as text so no formula injection (by library version, not tested); no PII in logs; public DTOs exclude order address and staff names; image content is re-encoded (only the file name is the issue, M-4).
- New SQL scripts are idempotent and data safe, with no destructive or dynamic SQL.

## Limits
Code was read, not run; no runtime exploit was attempted. Rated against the merged diff only.
