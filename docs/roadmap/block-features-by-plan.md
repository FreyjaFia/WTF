## Block Features by Subscription Plan [Planned, implementation-ready, decisions closed]

Status: plan only, nothing built. First written 9 Nov 2026; rewritten 10 Nov 2026 against current main (RBAC phases 1 to
5 included, version 1.20.0). It replaces the short draft in [multiple-branches-and-tenants](multiple-branches-and-tenants.md)
("Plan: block features by subscription plan"); build status and the other multi-tenant notes stay there. RBAC and plans
compose as described in [role-based-access](role-based-access.md) section 3.

### 1. What already exists (so we do not build it twice)

RBAC phase 4 built the core of the gate. The old draft of this plan (a separate `RequireFeature` endpoint filter) is
dropped: permissions already carry a feature code, and that is the gate.

| Piece | Where | What it does today |
| --- | --- | --- |
| Plan data | `Plans.Features` (comma list), `Plans.MaxUsers`, `Plans.IsActive`, `TenantSubscriptions` | Seeded: Starter (`pos,orders,reports,offline`) and Pro (`...,inventory,promotions,orderlinks,chat,workbook`). Editable on `/platform/plans` as free text, one word per line |
| Feature rules | `WTF.Calculations/Subscriptions/PlanFeatures.cs` | `core` is in every plan; only `inventory`, `promotions`, `orderlinks`, `chat`, `workbook` can be switched; other words (`pos`, `reports`, ...) are ignored; unknown words are not rejected on save |
| Per-shop lookup | `ITenantFeatures` / `TenantFeatureCache` (20 s cache, `Forget()` on plan edit and plan change) | Reads without the tenant filter; a shop with no subscription row keeps every feature |
| API gate | `PermissionClaimsMiddleware`, `PermissionAuthorizationHandler`, `PlanAwareAuthorizationResultHandler` | Every permission key has a feature (`PermissionCatalog`). Effective permissions = role keys intersected with the plan. Out-of-plan request: 403 `{ message: "This feature is not in your plan.", code: "not_in_plan" }` before roles are asked |
| App | `GET /api/auth/permissions` (already narrowed to the plan), `can()` and route `data.permission` | Menus, routes and buttons that use `can()` already disappear when the plan lacks the permission. Roles editor greys out-of-plan rows ("Not in your plan. Available in Pro.") |
| Platform admin | `/platform/plans`, shop detail Billing tab, `SetTenantSubscriptionHandler` | Edit price, features (free text), `MaxUsers`, active flag; change a shop's plan; both audited in `PlatformAuditLog` |

So "gating" for most screens is a data and catalog change, not new enforcement code. What is missing is listed next.

### 2. Gaps found in current main

1. **`chat` gates nothing.** No permission has feature `chat`; `/api/conversations*` use `orders.read`/`orders.write`, so a shop
   without chat still gets the envelope and drawer.
2. **Customer ordering links are only half gated.** `orderlinks.manage` is `orderlinks`, but `GET .../order-link` style reads use
   `customers.read`, the public page `/api/public/order-links/{token}` has no JWT and so no permission check, and
   `customer-orders` SignalR hub is not gated.
3. **Expenses, audit log and purchasing have no switchable feature.** `expenses.*` and `audit.read` are `core`; purchasing
   (suppliers, purchase orders, receiving, reorder) shares `inventory` through `stock.*` and `suppliers.*`.
4. **Reports leak inventory and promotion data.** One group `/api/reports` needs `reports.read` (core), but its stock-status,
   waste, gross-profit, profit-loss, stock-variance, promotions and customer-links endpoints read gated features. The Dashboard
   also shows stock cards.
5. **Behind-the-scenes work ignores plans.** The order handlers still deduct stock (`IOrderStockService`) and apply promotions
   after a downgrade; the daily catch-up jobs and push notifications for low stock and reorder run for every shop.
6. **Public and real-time paths** (hubs `staff-orders`, `notifications`, `dashboard`, `customer-orders`, public order link) are
   not under the permission handler.
7. **Platform Plans page** accepts any text as a feature; a typo silently removes a feature.
8. **`MaxUsers` is stored and shown, never enforced.**
9. **No safety net**: nothing fails if a new endpoint is added without a plan decision.
10. **App**: the "Not in your plan" page does not exist (a direct URL to a hidden screen goes to the role guard's fallback), the
    `not_in_plan` 403 has no explicit handling, and Dashboard stock cards, Setup tiles and the order screen's chat button need
    their own checks.

### 3. Decisions made (Pogi, 9 to 10 Nov 2026)

1. **Hybrid.** Feature keys live in code (the catalog); which keys a plan holds is data, edited in platform admin.
2. **Three plans.** Starting layout below; moving a key between plans is only data.
3. **No lock icons.** Gated items are hidden from menus; a direct URL shows a "Not in your plan" page.
4. **Downgrade over the user cap:** allow the change, warn in the change-plan dialog, block only adding or re-activating users.
5. **User cap: undecided, leaning to none.** `MaxUsers` stays optional (empty = unlimited).
6. **No per-shop exceptions for now.**
7. **RBAC first** (done), so plans reuse its catalog and `ITenantFeatures`.

### 4. Feature catalog (proposed final)

The catalog is the only source of valid keys. It stays in `PlanFeatures` (C#) with a TypeScript twin and shared cases in
`calculation-cases.json`. Each key gets a label, a one-line description, a group and a "needs" list.

| Key | Group | Needs | Starter | Pro | Business | Permission keys that carry it |
| --- | --- | --- | --- | --- | --- | --- |
| `core` (not switchable) | | | yes | yes | yes | orders, customers, products, users, roles, brand, billing, dashboard, `reports.read`, offline sync, notifications |
| `expenses` (new) | Money | none | no | yes | yes | `expenses.read/write` (move from core) |
| `inventory` | Stock | none | no | yes | yes | `items.*`, `inventory.costs.*`, `stock.read/write` (movements, counts, waste, waste reasons), `stock.waste.*`, `wastereasons.*` |
| `purchasing` (new, split) | Stock | `inventory` | no | no | yes | `suppliers.*`, and new `purchasing.read/write` split out of `stock.*` for reorder, purchase orders, receiving |
| `kitchen` (new, defined in [kitchen-orders-view](kitchen-orders-view.md)) | Sell more | none | no | yes | yes | `kitchen.read/update` (defined by the kitchen plan, not here); kitchen endpoints and hub access, the order chip and "Mark served" |
| `promotions` | Sell more | none | no | yes | yes | `promotions.read/write` |
| `orderlinks` | Customer ordering | none | no | yes | yes | `orderlinks.manage`, link reads, public link |
| `chat` | Customer ordering | `orderlinks` | no | yes | yes | new `chat.read/write`, taken from `orders.read/write` on conversation routes |
| `workbook` | Insight | none | no | no | yes | `reports.generate` (the monthly Excel workbook) |
| `audit` (new) | Control | none | no | no | yes | `audit.read` (move from core) |

Reserved for later, not built: `whitelabel`, `branches`, `api`, `customroles` (RBAC phase 4 left "custom roles are Pro-only"
open; decision 3 of the RBAC plan says Pro, so add `customroles` to Pro and Business, and gate `roles.manage`).

Notes:

- Reports stay in Starter as `core`, so no `reports` key is needed (Pogi's "Starter = reports" holds without a switch).
- The reports that read gated data are cut by their data feature, not by `reports.read`: each report route gets an
  `anyOf` of `reports.read` plus a feature requirement (section 5.4). The Reports page lists only the reports the shop's plan
  can run.
- If Pogi prefers fewer keys: merge `purchasing` into `inventory` and `audit` into `workbook` ("Business extras"); nothing else changes.

### 5. Design

#### 5.1 Data

- No new table for the first release. `Plans.Features` stays a comma list but is validated: the platform save handler rejects
  unknown keys and adds missing "needs" (ticking `purchasing` adds `inventory`, `chat` adds `orderlinks`).
- Script `tools/sql/YYYYMMDD_plan_feature_catalog.sql` (idempotent, never overwrites a plan Pogi edited): add a `Business` plan
  (code `business`, sort order 3, inactive until priced), and for the Starter and Pro rows only rewrite `Features` when it
  still equals the seeded text. Pro keeps everything it has plus the new keys it should hold (`expenses`, `customroles`); the
  pilot shop is on Pro so nothing changes for them. Old words (`pos`, `orders`, `reports`, `offline`) stay harmless.
- `Plans.MaxUsers` already exists. Optional later: `TenantFeatureOverrides(TenantId, Feature, Granted)`; not in this plan.
- The pilot shop and any shop with no subscription row keep everything (unchanged rule).
- dbsync rule: no new table or column, so no scaffold change unless the Business row needs one (it does not).

#### 5.2 Shared rules (WTF.Calculations and the Angular twin)

`PlanFeatures` grows from a list into the catalog: `Catalog` (key, label, description, group, needs), `Normalize(list)` (drops
unknown, adds needs), `Parse`, `Serialize`, `IsAllowed`, `PlansContaining(feature, plans)` (for the "available in Pro" text)
and `UserCapState(maxUsers, activeUsers)`. Cases go in `calculation-cases.json`; both test runs load them.

#### 5.3 Permission catalog changes

Re-map feature codes: `expenses.*` to `expenses`, `audit.read` to `audit`, suppliers and purchasing keys to `purchasing`. Add
`purchasing.read/write` (split from `stock.*`: reorder list, purchase orders, receiving) and `chat.read/write`. System role
bundles get the new keys wherever the old key sat (so no role loses anything inside a plan that has the feature), and the
golden/bundle tests are updated. Custom roles do not get new keys automatically (RBAC rule: a new permission is off until
granted), so the release script copies `stock.read/write` holders to `purchasing.*` and `orders.read/write` holders to
`chat.*` for custom roles once, with an audit entry, to keep shops working.

#### 5.4 API enforcement

1. Permissions remain the gate. Add the missing carriers listed in 5.3 and wire the conversation routes to `chat.*`.
2. **Mixed endpoints.** Add `FeatureRequirement` (policy `AppPolicies.RequireFeature(...)`) for routes whose permission is core
   but whose data is gated: stock-status, waste, gross-profit, profit-loss and stock-variance reports need `inventory`; the
   promotions report needs `promotions`; the customer-links report needs `orderlinks`; the link read in `OrderLinkEndpoints`
   needs `orderlinks`. It answers the same 403 `not_in_plan`.
3. **Public link.** The endpoint filter on `/api/public/order-links/{token}` resolves the shop from the token and, when
   `orderlinks` is off, returns the existing "can't take orders right now" 503 (shop name and phone). The link stays valid for
   when the plan returns.
4. **Hubs.** `customer-orders` checks `orderlinks`/`chat` on connect; `staff-orders` stays core; `notifications` is core, and the
   senders (below) decide what is sent; `dashboard` stays core, payloads omit gated cards.
5. **Behind the scenes.** `IOrderStockService` returns early when `inventory` is off (orders save, balances freeze, nothing
   throws); the promotion pricing step ignores promotions when `promotions` is off, and `GET /api/pos/promotions` returns an
   empty list; offline orders sold with a promotion or stock before the downgrade are still accepted on sync (like
   `HonorStock`). `DailyCatchUpScheduler` jobs, `StockAlertService`, reorder suggestions and push senders skip shops without
   the matching feature. Old orders keep showing their lines.
6. **Never gated:** offline sync (`/api/orders/sync`, `/batch`), authentication, notifications list, `/api/subscription`, the
   platform area, and reading history. Rule: a gate stops using a feature, never reading or deleting the shop's own data;
   nothing is deleted on a downgrade.
7. **Lapsed shop** (reads work, writes get 402) is unchanged and sits above the plan check.
8. **Coverage test (the safety net).** A .NET test walks `EndpointDataSource`: every route is either under a permission whose
   feature is known, has a `RequireFeature`, or is on an explicit allow-list (public, auth, platform, sync). Adding a route
   without a decision fails the test. The Angular twin checks that every route under the layout has `data.permission` or
   `data.feature`, or is on the core list.
9. **MaxUsers** (only if a cap is wanted): checked in create-user and re-activate-user; message `Your plan allows N users.`
   (403, code `user_limit`). Existing users are never disabled by a lower cap. See open question 3.

#### 5.5 Frontend

- `PlanStore` signal fed by `GET /api/subscription`, stored in the offline lease (so the menu is right with no connection);
  until it loads the app shows what the permission list allows (the server still enforces).
- `can()` already hides everything tied to a permission. Add `hasFeature(key)` for the mixed cases: report tabs, Dashboard stock
  cards, Setup hub tiles (waste reasons), order screen chat button, customer link actions, Needs Attention badge.
- `featureGuard` (route `data: { feature }`) and a handler for the `not_in_plan` 403 both land on **Not in your plan**: names
  the screen, says which plan has it (`PlansContaining`), and tells Owner and Admin how to upgrade (contact line from the
  Shop > Plan page); other roles see "Ask the owner". Bookmarks, push links and old customer links land here instead of an error.
- Roles editor locks stay as built; add the same plan name text for the new keys.
- Offline phone during a plan change keeps the old menu until the next refresh; the server refuses and the app shows the page.

#### 5.6 Platform admin

POS style (shared components, filters drawer, sortable headers, dialogs, mobile bottom bar):

- `/platform/plans`: list with shop count per plan; editor with a grouped checklist built from `GET /api/platform/plan-features`
  (replaces free text), needs enforced visibly, user cap, price, active/retired. Retired plans stay valid for shops on them and
  are not selectable for new assignments. Plan edits clear the feature cache (already does).
- Shop detail > Billing: plan features, user cap, current user count. The change-plan dialog warns when the new plan removes
  features the shop has data in (counts: items, promotions, active links) or has a lower cap than the active user count.
- Audit: plan create/edit/retire and shop plan changes are already audited; add the feature diff to the summary.
- Platform admin "Sign in as" keeps the shop's claims, so it sees exactly what the shop sees.

#### 5.7 Downgrade behaviour (summary)

| Feature off | Result |
| --- | --- |
| `inventory` | Stock screens and routes refused; sales still save with no deduction; balances freeze; stock cards, badges and alerts stop |
| `purchasing` | Screens and routes refused; open purchase orders stay |
| `promotions` | Editor refused; POS gets an empty list; old orders keep promotion lines |
| `orderlinks` / `chat` | Management refused; public page shows the 503 notice; chat button hidden |
| `expenses` / `workbook` / `audit` | Routes refused, screens hidden, data kept |
| Over user cap | Change allowed; only new or re-activated seats refused |
| Upgrade | Everything returns exactly as it was; role keys were never removed |

### 5.8 Neighbouring plans (checked 11 Nov 2026, so nothing is decided twice)

| Plan | What it owns | What this plan does with it |
| --- | --- | --- |
| [kitchen-orders-view](kitchen-orders-view.md) | Permissions `kitchen.read` and `kitchen.update`, the `Kitchen` role, the per-shop "Use kitchen board" setting, the board itself | Only adds the catalog key `kitchen` (Pro and Business, off in Starter) and maps both permissions to it. A downgrade hides the board; orders keep their stored kitchen state. The shop setting stays a setting |
| [senior-pwd-discount](senior-pwd-discount.md) | `orders.discount.seniorpwd`, `reports.seniorpwd.export`, shop switches `SeniorPwdEnabled` and `VatRegistered` | Not a plan feature: the register discount is core (a legal duty). Its report follows `reports.read` (core); its workbook sheet follows `workbook`. Switches stay shop settings |
| [offline](offline.md) Phase 7 | Judging queued orders at sale time | Sync is never gated. Its reasons for gated features (stock, promotions) switch off quietly with the feature; nothing else to build here |
| [role-based-access](role-based-access.md) | The permission catalog and `ITenantFeatures` | Reused as is; this plan only adds feature codes and the permission splits in 5.3 |

The queue patch `0001-Refresh-plans-for-Offline-Phase-7-and-queued-feature` also appends a "Refresh" section to the old
version of this file. This rewrite supersedes it (its open questions are answered in section 8), so drop that hunk and
keep the rest of that patch.

### 6. Phases (each can ship on its own)

1. **Catalog and data.** Catalog in `PlanFeatures` (C# and TS), shared cases, new feature codes and permission keys
   (`purchasing.*`, `chat.*`, re-mapped `expenses`/`audit`), system role bundles and custom-role copy script, Business plan row,
   save-time validation and needs. Behaviour change: Starter loses expenses and audit; Pro unchanged. Tests: rules, golden
   role bundles, SQL script run twice on a real SQL Server.
2. **API gaps.** `RequireFeature`, mixed report routes, public link and hubs, order handler and job skips, empty promotions
   list. .NET tests per feature (refused on Starter, allowed on Pro/Business), offline sync untouched, downgrade keeps old
   orders readable, public link 503. Plus the endpoint coverage test.
3. **App.** `PlanStore` and lease, `hasFeature`, `featureGuard`, "Not in your plan" page, `not_in_plan` handling, hidden cards,
   tabs and tiles, route-coverage spec. Angular specs.
4. **Platform admin.** Catalog endpoint, checklist editor, shop counts, Billing tab and change-plan warnings.
5. **MaxUsers** (dropped: no cap for now).
6. **End to end on a throwaway database** (`src/wtf-e2e/run.ps1`, at least 3 workers, no skipped or flaky tests, 375/820/1440):
   Starter shop: no gated menu items, 403 on gated calls, direct URL lands on the locked page, reports show only allowed tabs;
   Pro and Business as designed; plan change takes effect within the cache window; plan create, edit, retire; downgrade then
   upgrade restores everything; offline order after a downgrade still syncs; two shops on different plans never see each other.
7. **Later, only if asked:** per-shop overrides, `whitelabel`, `branches`, `api`.

Docs to update when built: this file, `docs/ROADMAP.md` status, the "Not built" line in the multi-tenant file,
[role-based-access](role-based-access.md) (custom roles Pro-only), and the rollout checklist (plan features must be set before
the first paying shop is onboarded).

### 7. Risks

- A forgotten endpoint: the coverage test.
- Moving `expenses` and `audit` out of core changes Starter shops today. There is only the pilot (on Pro), so no live shop loses
  anything, but say so in the release notes.
- Splitting `purchasing` and `chat` out of `stock.*` and `orders.*` touches system role bundles and the golden tests; keep it in
  its own commit with the bundle tests first.
- Sales must keep saving whatever the plan: every skip above returns quietly, never throws.
- Cache: 20 seconds on one instance; a second API instance would show a change up to 20 seconds late (acceptable).

### 8. Decisions on the open questions (Pogi, 11 Nov 2026)

1. **Bundles confirmed** as in section 4 (Starter = core with reports; Pro adds inventory, promotions, order links with chat,
   expenses, custom roles; Business adds purchasing, monthly Excel workbook, audit log). **Business price: placeholder 3500 per
   month, Pogi left it to us; it is data on the Plans page and the Business plan stays inactive until priced for real.**
2. **Expenses in Pro, audit log in Business:** confirmed. Starter loses both.
3. **No user cap for now** (`MaxUsers` stays empty on all three plans; recommended, because a cap before real sales data is a guess
   and the field already exists for later). Phase 5 is dropped. If a cap is added later, the rule in 5.4 item 9 applies unchanged.
4. **Custom roles in Pro and Business only:** confirmed.
5. **Stock, waste and profit reports and the Dashboard stock cards are hidden on Starter:** confirmed.

Nothing is open; the plan is ready to build, phase 1 first.
