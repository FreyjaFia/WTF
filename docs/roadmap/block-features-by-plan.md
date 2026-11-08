## Block Features by Subscription Plan [Planned, decisions open]

Status: plan only, nothing built (9 Nov 2026). Written from the code as it is: the sidebar and routes in `wtf-pos`, the
endpoint groups in `WTF.Api/Endpoints`, and the plan tables from `tools/sql/20261112_add_subscriptions.sql`. It replaces
the short draft in [multiple-branches-and-tenants](multiple-branches-and-tenants.md) ("Plan: block features by
subscription plan"); the build status and the other multi-tenant notes stay there.

### Where things stand

- `Plans.Features` (comma list, for example `pos,orders,reports,offline,inventory,...`) and `Plans.MaxUsers` are stored,
  sent in `GET /api/subscription` and editable on `/platform/plans` (features as free text, one per line).
- Nothing reads them. A lapsed shop is a separate rule (reads work, writes get 402) and stays as it is.
- Both seeded plans exist (Starter 1500, Pro 2500 per month). The pilot shop is on Pro, so turning enforcement on does not
  change what the pilot sees.

### Recommendation: hybrid (feature keys in code, plan contents editable)

| Option | What it means | Verdict |
| --- | --- | --- |
| Hard-coded | Starter and Pro are fixed in code; changing a plan needs a deploy | Too stiff. Plans already live in a table, and prices and bundles will change after the first sales |
| Fully dynamic | Pogi invents features and attaches them to plans at runtime | Not possible. A "feature" is only real if code checks it; a key typed into a screen blocks nothing |
| **Hybrid (recommended)** | The list of feature keys is hard-coded (a catalog in code, each key tied to specific endpoints and screens). Which keys a plan holds is data, edited by Pogi in platform admin | Plans can change any time without a release; new features still need code, which is true anyway |

What Pogi controls without a developer: create a plan, retire a plan, tick which catalog features it includes, set the user
cap, set the price, move a shop to another plan. What needs a release: a brand new gateable feature.

Two supporting rules:

- **The catalog is the only source of valid keys.** The platform Plans page shows a checklist built from the catalog
  (label, one-line description, group) instead of today's free text. A typo such as `inventroy` today would silently
  switch a feature off; the checklist makes that impossible, and the API rejects unknown keys on save.
- **Per-shop exceptions are a later, optional step** (a `TenantFeatureOverrides` table: shop, key, granted yes/no). They
  cover "give the pilot Inventory free for 3 months" without making a one-shop plan. Not needed for the first release.

### How to group the features

The grouping below is by what a shop owner would pay extra for and by what depends on what, not by menu position. Screens
are from the current sidebar and `app.routes.ts`.

**Always on, never gated (not in the catalog):** order taking (POS, new order, order list, details), offline mode and sync,
products and categories, customers (list, details, addresses), users and roles (limited only by `MaxUsers`), Setup
(except the parts listed below), Shop (branding, plan), notifications, my profile. A shop that cannot take an order has
nothing to pay for, and offline sync must keep working during a downgrade.

**Gateable features (the catalog):**

| Key | Group | Screens | API routes it guards | Needs | Draft |
| --- | --- | --- | --- | --- | --- |
| `reports` | Insight | Dashboard, Reports | `/api/dashboard`, `/api/reports` | none | Starter and Pro |
| `workbook` | Insight | Excel/PDF export buttons on Reports | the export routes in `ReportEndpoints` | `reports` | Pro |
| `expenses` | Insight | Expenses | `/api/expenses` | none | Pro (new key; today it has none) |
| `inventory` | Stock | Items, Ingredients and Cost (recipes), Stock In, Needs Attention, Counts, Waste, waste reasons in Setup | `/api/items` (including `/{id}/stock`, waste, adjust, movements), `/api/pos/stock-limits`, `/api/stock-waste`, `/api/waste-reasons`, `/api/stock-counts` | none | Pro |
| `purchasing` | Stock | Reorder, Purchasing (purchase orders), Receiving, Suppliers | `/api/reorder`, `/api/purchase-orders`, `/api/stock-receipts`, `/api/suppliers`, `/api/items/{id}/suppliers` | `inventory` | Pro (new key, split out of `inventory`) |
| `promotions` | Sell more | Promotions (bundles, mix and match, discounted products) | `/api/management/promotions/*`, `/api/pos/promotions` | none | Pro |
| `orderlinks` | Customer ordering | Customer ordering links, the public `/shop/:token` page | `/api/customers/{id}/...` link routes, `/api/public/order-links/{token}`, the customer hub | none | Pro |
| `chat` | Customer ordering | Order chat envelope and drawer | `/api/conversations`, staff and customer chat hubs | `orderlinks` | Pro (kept apart because the seed already has it) |
| `audit` | Control | Audit Logs | `/api/audit-logs` | none | Pro (optional; decide) |

Later keys that should reuse this mechanism rather than invent another: `whitelabel` (remove "Powered by"), `branches`
(Phase 1 of the branches plan), `api` (integrations). Reserve the names now; add them when the feature exists.

Notes on the draft:

- `purchasing` is a split from `inventory`. Buying and receiving is a clear second step (a small shop counts stock but
  does not run purchase orders), and gives a natural middle option if Pogi later wants three plans. If one bundle is
  preferred, merge it back into `inventory`; nothing else changes.
- `reports` is in Starter because an owner who cannot see sales will not stay. The Dashboard's stock cards (Needs
  Attention) must hide when `inventory` is off.
- Three plans instead of two would be: **Starter** (sell and see: reports), **Pro** (adds inventory, promotions,
  customer links, chat, expenses), **Business** (adds purchasing, workbook, audit, white label, branches). Not
  recommended before the pilot gives real buying signals; the mechanism does not care how many plans there are.

### What happens to data and screens when a feature is off

The rule: **a gate stops using a feature, never reading or deleting the shop's own history.** Nothing is deleted on a
downgrade, so an upgrade brings everything back exactly as it was.

| Feature off | Behaviour |
| --- | --- |
| `inventory` | Stock screens and routes refused. Orders still save; the order handler skips stock deduction (`IOrderStockService`) and balances freeze. Old orders keep showing their lines |
| `purchasing` | Its screens and routes refused; open purchase orders stay in the database |
| `promotions` | `GET /api/pos/promotions` returns an empty list (not an error, so the POS does not break), the editor routes are refused. Old orders keep their promotion lines. An offline order that was sold with a promotion before the downgrade is still accepted on sync, like stock already is (`HonorStock`) |
| `orderlinks` | Management of links refused. A customer opening an existing link gets the same "can't take orders right now" page as a lapsed shop (503 with shop name and phone); the link stays valid for when the plan comes back |
| `chat` | Chat routes refused; the order screens hide the chat button |
| `reports` / `workbook` / `expenses` / `audit` | Routes refused, screens hidden. The data stays |

Background work must respect the same keys: the daily jobs that loop over tenants (low-stock alerts, reorder
suggestions, push notifications about stock) skip a shop that does not have `inventory`, otherwise a Starter shop would
get notifications for a screen it cannot open.

### Enforcement points

The server is the real gate; the app only hides things.

1. **API (one place).** An extension on route groups, for example `.RequireFeature(PlanFeature.Inventory)`, adds endpoint
   metadata. The existing `TenantRequestGuardMiddleware` (or a sibling placed right after it) reads that metadata from
   `context.GetEndpoint()` and checks the shop's features, so no handler contains a plan check. Answer: **403** with
   `{ code: "feature_not_in_plan", feature, requiredPlan, message }`. The app's `authInterceptor` signs a user out only when
   a 403 message matches the suspended text, so a different message is safe; the new `code` makes the app's handling
   explicit.
   - Public routes (customer links) have no JWT; the shop comes from the token, and the check runs in that endpoint filter.
   - SignalR hubs: gate the hub connection or the group join the same way (`customer-orders`, chat).
   - The offline sync routes (`/api/orders/sync`, `/batch`) are never feature-gated.
   - Platform admin routes sit outside shops and are never gated.
2. **Coverage test (the safety net).** A .NET test walks `EndpointDataSource`, and every route must be either in a gated
   group or on an explicit "core" allow-list. A new endpoint added later without a decision fails the test, so a feature
   cannot leak because someone forgot a line. The Angular twin checks that every route under `LayoutComponent` is either
   core or has `data.feature`.
3. **App menu.** A `PlanFeatures` signal (fed by `GET /api/subscription`, also stored in the offline lease so the menu is
   right with no connection) is combined with the existing role checks: `authService.canReadItems() &&
   plan.has('inventory')`. Sidebar, mobile dock, Management menu, Setup hub tiles and Dashboard cards all read it.
   Before the features have loaded the UI shows everything (the server still enforces), and a shop with no subscription
   row or a single-shop install is never limited.
4. **Direct URLs.** A `featureGuard` reads `data: { feature: 'inventory' }` on the parent routes (`inventory`,
   `management/promotions`, `management/reports`, `management/expenses`, `management/audit-logs`) and redirects to a
   "Not in your plan" screen that says which plan has it and, for SuperAdmin and Admin, how to upgrade; others see "ask
   the owner". Bookmarks, pushed notification links and old customer links all land there instead of an error page.
5. **MaxUsers.** Checked in the create-user and re-activate-user handlers (the only two ways to add a seat), with the
   same style of message. Existing users are never disabled by a lower cap.

### How it meets the tenant filters

- Plans and features are not shop data: `Plans` is a global table, and a shop's plan comes from its `TenantSubscriptions`
  row. `ITenantFeatures` therefore takes the shop id explicitly (from the `tenant_id` claim, or the link token) and reads
  without the ambient tenant filter, the same way `TenantStatusCache` already does. It must not depend on the request
  already having a tenant, because the guard runs before handlers.
- The gate adds no new data access to shop tables, so the global `TenantId` filters are untouched. A feature check can
  never reveal another shop's rows; at worst a bug blocks or allows a feature for the right shop.
- Cache: features per shop, cleared when the platform admin changes a plan's features, changes a shop's plan, or edits
  the subscription (the same invalidation points as `TenantStatusCache`). A short expiry (about a minute) is the backstop
  on a second API instance.
- "Sign in as" from platform admin keeps the shop's tenant claim, so the platform admin sees exactly what the shop sees.
- Retired plans: still valid for shops already on them, not selectable for new assignments.

### Platform admin changes

Stay in the POS style (shared components, filters drawer, dialogs, mobile bottom bar, per the style rule):

- `/platform/plans`: create plan, edit, retire; features as a grouped checklist from the catalog (with the "needs" rule:
  ticking `purchasing` also ticks `inventory`); user cap; the list shows how many shops use each plan.
- Shop detail, Billing tab: show the plan's features, the user cap and the current user count; the change-plan dialog
  warns when the new plan has a lower cap than the current user count or removes features the shop has data in.
- Catalog endpoint for the page, for example `GET /api/platform/plan-features`.

### Phased build

Each phase can ship by itself; phases 1 and 2 can go out before any screen changes.

1. **Catalog and rules.** `PlanFeatures` in `WTF.Calculations` (keys, labels, needs, parse and serialize the stored list,
   `Allows`, `PlansForFeature`) with a TypeScript twin and shared cases in `calculation-cases.json`. A SQL script
   updates the stored lists (adds `expenses`, `purchasing`, `audit`, keeps Pro as everything). `ITenantFeatures` plus cache
   and invalidation. No behaviour change yet.
2. **API gate.** `RequireFeature`, the guard, 403 contract, hubs, daily jobs, order handler skips, public-link 503, the
   coverage test. .NET tests: each group refused on Starter and allowed on Pro, offline sync untouched, downgrade keeps
   old orders readable.
3. **MaxUsers.** Create and re-activate user checks, tests, message in the user editor.
4. **App.** Plan features signal and lease storage, `featureGuard`, menu and dock hiding, the "Not in your plan" screen,
   Setup hub and Dashboard card hiding; Angular unit tests and route-coverage spec.
5. **Platform admin.** Catalog checklist, create and retire plans, limits and counts on the shop page, downgrade warnings.
6. **End-to-end on a throwaway database** (`src/wtf-e2e/run.ps1`, no skipped or flaky tests): Starter shop gets 403 on a
   gated call and no menu items; direct URL lands on the locked screen; user cap refuses the sixth user; plan change
   takes effect within the cache window; plan create, edit and retire; downgrade then upgrade restores everything.
7. **Later, only if asked:** per-shop overrides, a three-plan layout, `whitelabel` and `branches` keys.

Docs to update when built: this file, the status in `docs/ROADMAP.md`, the "Not built" line in the multi-tenant file, and
the rollout checklist (plan features must be set before the first paying shop is onboarded).

### Risks to watch

- A forgotten endpoint: covered by the coverage test above.
- Orders that touch gated features (promotions, stock) must keep saving after a downgrade; the handler skips the feature
  instead of failing the sale.
- Offline phones: the lease carries the feature list, so a phone that was offline during a plan change keeps the old
  menu until its next refresh; the server still refuses, and the app shows the "Not in your plan" screen on that 403.
- Selling a plan whose bundle is thin (for example Starter with a very low cap) is a pricing question, not a code one;
  the mechanism makes it a five-minute change.

### Decisions (Pogi, 9 Nov 2026)

1. **Hybrid**: confirmed as the direction (feature keys in code, plan contents editable in platform admin).
2. **Three plans for now.** Layout to settle when building; starting point: Starter = reports; Pro = inventory, promotions,
   customer links with chat, expenses; Business = purchasing, Excel export, audit logs (and later white label, branches).
   Which key lands in which plan is only data, so it can be moved at any time on the Plans page.
3. **No lock icons.** Gated items are simply hidden from the menu; a direct URL shows the "Not in your plan" screen.
4. **Downgrade over the user cap:** allow the change, only block adding users, and show a warning in the change-plan
   dialog that the last user over the cap will be blocked (cannot sign in or be re-activated, to be settled in the build:
   recommended is that existing users keep working and only new or re-activated seats are refused).
5. **User cap: undecided, leaning to none.** `MaxUsers` stays optional (empty = no limit). Phase 3 (MaxUsers) is
   skipped unless a cap is wanted; plans can differ on features alone.
6. **No per-shop exceptions for now.**

Still open: the exact bundle for each of the three plans, and what "block the last user" means in practice (see 4).
