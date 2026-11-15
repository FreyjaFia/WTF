## Graceful Plan-Gating Failures [Planned, decisions open]

Status: plan only, nothing built (15 Nov 2026). Written from the code on `main` at 1.21.0. Related:
[block-features-by-plan](block-features-by-plan.md) (the gating itself, built) and
[role-based-access](role-based-access.md).

### What Pogi saw

1. The Roles editor was already open. The shop's plan was then changed so it no longer holds Custom roles.
2. Pogi saved a custom role. The API refused it (the plan gate), which is correct.
3. The app answered with the "Discard changes?" dialog instead of the "Not in your plan" page, and the usual red error
   toast may follow behind it. Expected: go straight to the "Not in your plan" page, calm, no dialog, no scary toast.

A second, technical question (no logs in the VS Code terminal) is answered at the end.

### Root cause (verified in the code)

| Step | Where | What happens |
| --- | --- | --- |
| 1 | `PermissionAuthorizationHandler` / `FeatureAuthorizationHandler` | The plan is checked before the role. A permission outside the plan fails with the reason "This feature is not in your plan." |
| 2 | `PlanAwareAuthorizationResultHandler` | Answers `403 { message: "This feature is not in your plan.", code: "not_in_plan" }`. It does **not** say which feature. |
| 3 | `subscriptionInterceptor` (`core/interceptors/subscription.interceptor.ts`) | On that 403 it calls `subscription.refresh()`, then `router.navigateByUrl('/not-in-plan')` (no `?feature=`), then rethrows the error. |
| 4 | Angular router | A navigation first runs `canDeactivate` on the screen being left. Every editor routes through `unsavedChangesGuard`, which calls the editor's `canDeactivate()`. The Role editor is dirty (the user just typed), so it opens its own Discard dialog and waits. The target route (and its `canActivate`) is never reached until the user answers. |
| 5 | Role service `handleError` + editor `error:` callback | The rethrown error is turned into `alertService.error("This feature is not in your plan.")`, so a red toast appears as well. |

So the redirect itself is right; it is blocked by a guard that was written for "the user clicked a link", and the error is
also reported a second time as a failure. Two more weaknesses sit next to it:

- **No feature in the redirect.** The interceptor goes to `/not-in-plan` with no `?feature=`, so the page says "This
  feature is not in your plan" with no name and no "Available in Pro." line, unlike the direct-URL path
  (`notInPlanPath(feature)` in `role.guard.ts`).
- **Every request can redirect.** The interceptor reacts to any `not_in_plan` 403, including background calls (the
  conversation inbox poll, notification and waste-count polls, catalog cache, dashboard widgets). A stale client that still
  thinks it holds a feature can yank a cashier off the register because a poll was refused. To confirm in phase 0 (which
  polls start for which permission).

### Design principles

- **One central fix**, in the interceptor, the unsaved-changes guard and a small gate service. No per-page patches, no change
  to the nine editors.
- **The server stays the authority.** The client reacts to the refusal; it never has to guess.
- A refusal because of the plan is **not an error the user caused**: no error toast, no discard question. A refusal because
  of the user's role is different and stays as it is today (403 with its own message, no redirect).

### Desired behaviour

#### Action types

| Action | Gated 403 means | Result |
| --- | --- | --- |
| Save (create or update), delete, any button the user pressed | The feature left the plan after the screen opened | Go to `/not-in-plan?feature=<key>`. No discard dialog, no error toast. |
| Load of the screen's own data (list, details, editor) | Same, found on arrival or on refresh | Same redirect. |
| Background request (poll, widget, cache warm-up, badge count) | Same, but the user did nothing | **No redirect and no toast.** Refresh the plan, so the menu and the widget hide themselves. |
| Report export or download | Same | Same redirect as a button press. |
| Offline sync of orders | Core, never gated (kept open after a downgrade, tested in `plan-gating.spec.ts`) | Unchanged. |

How the interceptor tells a button press from a background call: a tiny `HttpContextToken` (`BACKGROUND_REQUEST`, default
false) set by the few polling services (conversation inbox, notification counts, stock-waste count, catalog cache, dashboard
widgets). Default is "user action" so a forgotten poll fails safe in the louder direction; the phase 0 audit lists every
timer in the table above. (Alternative if Pogi prefers: redirect only for non-GET requests and for the request that
loads the current route. Simpler but a list screen refreshing itself would not redirect.)

#### Typed input

- Redirecting means the screen is destroyed and what was typed is gone. The user could not have saved it anyway, so there is
  nothing to "discard" or to keep.
- Recommended: **no draft saving** in the first build. The Not in your plan page says "Your changes were not saved." only
  when it was reached from a failed save (one line, no dialog).
- Open question 2 offers a "Go back" that keeps the draft; not recommended (the feature is gone, a draft cannot be used).

#### Who sees what

| Person | Sees |
| --- | --- |
| Owner or anyone with Plan & billing | Not in your plan page with "Plan & billing" button (today's page) |
| Everyone else (including custom roles) | Same page with "Ask the owner to upgrade the plan." (today's page) |
| A user whose **role** lacks the permission but the plan has it | Unchanged: normal "not allowed" handling, never the plan page |
| Platform admin | Not affected (platform area has no plan claims) |

The page is the existing `NotInPlanComponent`; the only change is that it now always gets `?feature=`.

#### Every gated feature and screen affected

Feature keys come from `PlanFeatureCatalog`; permission-to-feature mapping from `PermissionCatalog.cs`.

| Feature | Permissions | Screens (routes) | API groups (examples) |
| --- | --- | --- | --- |
| `customroles` | `roles.manage` | Management > Roles list, new, edit (`management/roles`) | roles endpoints |
| `expenses` | `expenses.read/write` | Management > Expenses | expenses; profit-loss report (with inventory) |
| `inventory` | `items.*`, `inventory.costs.*`, `stock.*` (read, write, waste record, waste review), `wastereasons.*` | Items (list, new, edit), stock-in, attention, counts (+detail), waste, record waste, ingredients (+detail), dashboard stock and profit widgets | items, stock, waste, `reports/stock-status`, `waste`, `gross-profit`, `stock-variance` |
| `purchasing` | `purchasing.*`, `suppliers.*` | Purchase orders (+suggestions), receiving, reorder, Setup > Suppliers (+detail) | suppliers, purchase orders, reorder |
| `promotions` | `promotions.read/write` | Management > Promotions (all editors: fixed bundle, mix and match, discounted products, edit), reports promotions | management promotions, `reports/promotions` |
| `orderlinks` | `orderlinks.manage` | Order links dialogs and lists on Orders, link reports, dashboard link widget | order link endpoints, `reports/order-links` |
| `chat` | `chat.read/write` (needs `orderlinks`) | Order chat panel, conversation inbox and badges | `conversations` |
| `workbook` | `reports.generate` | Monthly workbook generate and download on Reports | workbook report endpoints |
| `audit` | `audit.read` | Management > Audit log | audit logs |
| `core` (never gated) | everything else | Orders, register, dashboard base, customers, products, users, setup lists, plan & billing | n/a |

Editors with an unsaved-changes guard (all stop blocking this redirect once the guard is fixed): order, user, customer,
product, promotion, role, ingredient, item, record waste.

### The fix, step by step

1. **API: say which feature.** The not-in-plan failure reason carries the feature key (a small
   `NotInPlanReason(feature)` replacing the message-text match), and the 403 body becomes
   `{ message, code: "not_in_plan", feature: "customroles" }`. Both handlers know the key already
   (`PermissionCatalog.FeatureOf(...)` or the policy's feature). Old clients ignore the extra field.
2. **Client: one gate service.** `PlanGateService` (core/services) owns the redirect:
   `redirectToNotInPlan(feature)` sets a short-lived `gateRedirect` flag and calls
   `router.navigateByUrl(notInPlanPath(feature), { info: { reason: 'not_in_plan' } })`.
   It does nothing if already on the page or if a redirect is in flight.
3. **Interceptor** uses the service for user-initiated requests, only refreshes the plan for background ones, and
   returns `EMPTY` after redirecting so the service's own `handleError` and the editor's `error:` callbacks do not paint a
   toast on a screen that is being replaced. (Fallback if `EMPTY` upsets a caller that expects a value: rethrow a marked
   error and make `AlertService.error` drop it. Phase 1 decides after trying both against the existing specs.)
4. **`unsavedChangesGuard`** returns `true` without calling `canDeactivate()` when the pending navigation is the plan
   redirect (`router.getCurrentNavigation()?.extras.info?.reason === 'not_in_plan'`, or the next URL starts with the
   NotInPlan path). Central, covers every present and future editor. The editors' own in-page Discard dialog is untouched
   for normal leaving.
5. **Not in your plan page**: reads `?feature=` as today; add the "Your changes were not saved." line when reached from a
   failed non-GET request (carried in the navigation `info`, not the URL).
6. **Role guard** unchanged (direct URL and menu already correct). Make it call the same `PlanGateService` so there is one
   builder of the URL.

### Plan freshness (how stale can the client be)

| Layer | Today | Proposed |
| --- | --- | --- |
| API plan cache (`TenantFeatureCache`) | 20 s per process; a plan edit or change forgets that tenant at once in the same process. Another API instance can take up to 20 s. Permissions (`RolePermissionCache`) also 20 s. | Unchanged. The refusal after a downgrade is therefore immediate on one instance and at most about 20 s on a scaled-out one. |
| Client plan (`PlanStore`) | Loaded at start, again on the first tick of each shop day, on the browser `online` event, and after any 402 or `not_in_plan` 403 | Add a refresh when the tab becomes visible again (debounced, at most once a minute). Everything else stays pull. |
| Client permission list | Saved at sign-in from `GET /api/auth/permissions` | Reload it in the same refresh, so a downgrade hides menus without a sign-out. Check whether this is already done; if not it is a small addition to `SubscriptionService.accept`. |

No push channel is proposed: a downgrade is rare, the user's own refused action is the right moment to explain, and a
focus refresh already hides menus. The existing SignalR hubs could carry a "plan changed" message later; listed as an open
question, not recommended now.

What the user sees on an open screen after a refresh that removed its feature: the menu entry disappears, the screen stays
until the user acts (recommended, matches what Pogi expected), then the first gated call redirects.

### Offline

- A gated 403 can only come from a live API answer, so offline there is nothing to redirect on; queued orders are core and
  sync as before (this is already tested: "offline sync stays open after a downgrade").
- A screen opened from cache while offline for a feature dropped meanwhile fails on the first online call and redirects then.
- The saved plan snapshot is per tenant in local storage (`wtf-plan-snapshot`), so the role guard keeps working offline from
  the last known plan. The refresh on `online` brings it up to date.
- Refused offline-sync of a gated record (none exist today: orders only) is out of scope.

### Multi-tenancy

- The plan, the cache, the 403 and the snapshot are all per tenant already; nothing here shares state across shops.
- `feature` in the 403 body is a catalog key, never tenant data.
- Platform admin and public order-link endpoints have no plan claims and are untouched. The customer-facing public order
  page (`public/order-links`) is gated separately by the shop's `orderlinks` feature on the server; its own friendly
  "unavailable" message is a separate question (open question 5).
- Impersonation: the redirect applies the same way, using the impersonated shop's plan.

### Test plan

**Unit (Angular, `npx ng test --watch=false`)**
- `subscription.interceptor`: user request redirects once with the feature; background request refreshes only; already on the
  page does nothing; a role 403 (not `not_in_plan`) is untouched; a second 403 during a redirect does not navigate twice.
- `unsavedChangesGuard`: dirty component and plan redirect leaves without asking; dirty component and ordinary navigation
  still asks.
- `NotInPlanComponent`: feature name, "Available in..." line, and the "not saved" line.
- Services that map errors (`role.service` and peers): no toast for the swallowed gated error.

**API (`dotnet test src/WTF.Tests`)**: the 403 body has `feature` for a permission gate and for a `RequireFeature` policy;
role 403 has no `code`; existing `PlanGatingTests` still green.

**Playwright (throwaway LocalDB database only, `src/wtf-e2e`, tag `@plans`, at least 3 workers, own port, tag and stop
file for this thread so it never overlaps another run; no skipped tests, no retries to hide flakiness)**
For each of the nine gated features, in one data-driven spec:
1. Sign in as the shop owner on a Pro-like plan, open the feature's editor or list, type into a form where there is one.
2. Through the platform API, move the shop to a plan without the feature (new idempotent seed data for the test plan, test
   accounts only, credentials never printed).
3. Press save, delete or reload.
4. Expect: URL is `/not-in-plan?feature=<key>`, the page names the feature, no "Discard changes?" dialog, no error toast,
   the menu entry is gone after the refresh; going to a core screen still works; upgrading the plan again reopens the feature.
Extra cases: a non-owner custom role sees "Ask the owner"; a background poll refused for chat does not move a cashier off
the register; two shops on different plans do not affect each other; a dirty editor and an ordinary menu click still show
the Discard dialog (the guard did not become too loose).
Viewports for every UI case: 375, 820 and 1440 (project rule), screenshots saved to the project folder.

### Phases

| Phase | What | Notes |
| --- | --- | --- |
| 0 | Audit: list every poll and background call that can hit a gated endpoint; confirm the permission list reload | No code, a table appended to this file |
| 1 | API `feature` in the 403 body + tests | Small, backwards compatible |
| 2 | `PlanGateService`, interceptor, `unsavedChangesGuard`, page line, specs | The actual fix for Pogi's report |
| 3 | Background-request token on the polling services; focus refresh of the plan | Closes the register-yank risk |
| 4 | Playwright spec for all nine features at three viewports | Needs a test plan with a removable feature |
| 5 | Logging fix below (independent, can ship first) | Not part of plan gating |

No SQL is proposed. If phase 4 needs a plan row only the test database has, it is a new idempotent script and is not run in
this planning thread.

### Open questions for Pogi

1. **Redirect or stay?** After the refusal, redirect to Not in your plan (recommended, as you asked), or keep the screen and
   show a banner? Recommendation: redirect.
2. **Typed input.** Lose it (recommended), or offer "Back" that restores the form for copy and paste?
3. **Background refusals.** Silent plus menu refresh (recommended), or also redirect when the user is on the screen that owns
   the poll (chat inbox on an order)?
4. **Refresh on focus.** Once a minute at most, OK? Or also every few minutes while the tab stays open?
5. **Customers on a public order link** when the shop drops Order links: leave to the existing page, or a friendlier "this
   shop is not taking link orders right now" message (separate small plan)?
6. **Wording.** Keep "[Feature] is not in your plan", with "Your changes were not saved." added only after a failed save?

### Logs in VS Code (technical)

Normal, and caused by the current setup, not by VS Code. `Program.cs` builds its own Serilog logger with **only a file
sink** (`WriteTo.File(... "private/logs/wtf-api-.log")`) and then `builder.Host.UseSerilog()`, which replaces .NET's default
console logging. Result: nothing prints in the integrated terminal when you launch `WTF.Api` from `.vscode/launch.json`.

- Where the logs are: `src/private/logs/wtf-api-YYYYMMDD.log` (seven days kept), relative to the API content root. Open or tail
  that file.
- A second surprise: Serilog does not read the `"Logging"` section in `appsettings.json` (that is the Microsoft provider's).
  It only reads a `"Serilog"` section, which does not exist, so its level is the Serilog default (Information) and the
  `"Microsoft.AspNetCore": "Warning"` line has no effect.
- Proposed fix (small, phase 5): add a console sink in Development (`.WriteTo.Console()`, already included through
  `Serilog.AspNetCore`) and a `"Serilog"` section with `MinimumLevel` and `Override` entries so noisy framework categories
  are quiet. Keep the file sink as is. Optionally log one Information line for each `not_in_plan` refusal (tenant, feature,
  path) so a gate failure is visible in both places.

### Trigger audit (what can send a gated request, and how)

Audited on 15 Nov 2026 from `Endpoints/*.cs` and the Angular services. "Gated" means the endpoint answers 403
`not_in_plan` once the feature leaves the plan. Items marked "to run" are checked by the Playwright plan, not just by reading.

| Trigger | Kind | Request | Gated by | Today after a downgrade |
| --- | --- | --- | --- | --- |
| Save, delete, duplicate in an editor (role, item, ingredient, supplier, purchase order, promotion, expense) | User action | POST/PUT/DELETE on the feature group | its feature | The reported bug: redirect blocked by the Discard dialog, plus toast |
| Open a list or editor (menu, link, direct URL) | Navigation | GET | its feature | Role guard sends straight to Not in your plan (already correct once the client plan is current) |
| Reports screen and exports (stock status, waste, gross profit, profit and loss, stock variance, promotions, order links, workbook) | User action | `reports/...` with `RequireFeature` | inventory, expenses, promotions, orderlinks, workbook | Same bug on a refused export |
| Order chat panel, send message, mark read | User action | `conversations`, order chat | chat (needs orderlinks) | Same bug, on a core screen (order details or editor) |
| Conversation inbox poll, every 60 s, plus SignalR nudges | **Background** | `GET conversations` | chat | Starts from the order editor, order details and the header envelope when the saved permission list holds chat read. A stale list lets it hit the gate and redirect the cashier off the register. **Highest risk, to run.** |
| Notification bell counts, every 60 s | Background | `GET notifications/counts` | core (not gated) | Safe |
| Stock attention badge, every 60 s | Background | `GET items/attention` | inventory | Already follows the permission list and stops itself, so only a stale list is a risk |
| Pending waste count, every 60 s | Background | `GET stock-waste/pending-count` | inventory | To run: confirm it starts only for waste review, and is stopped when the list narrows |
| Stock limits and waste item lists | Background on the register | `pos/stock-limits` (needs orders write), `pos/waste-items` (needs waste record) | stock-limits is core; waste-items is inventory | To run: waste items load only on the record waste screen |
| Catalog cache warm-up (POS bundles and discounted products) | Background | `pos/promotions/...` (needs orders write) | core | Safe, not behind the promotions gate |
| Dashboard widgets (stock and profit, order links, promotions) | Screen load | `GET dashboard` (core) | the widgets are hidden by `plans.hasFeature`, the endpoint itself is core | Safe: a stale plan hides, no 403 |
| Plan refresh, subscription, brand | Background | `GET subscription`, `settings/brand` | core | Safe |
| Offline order sync | Background | `orders/sync`, `orders/batch` | core | Never gated (tested) |
| Customer's public order page, chat and polling | Public, no staff login | `public/order-links/...` | orderlinks, on the server | Not a staff redirect; see open question 5 |
| SignalR hubs (dashboard, staff orders, notifications) | Push | `/hubs/...` | not plan-gated | Safe; the staff orders hub only nudges the inbox |

What this changes in the plan: the background-request token must cover the conversation inbox first (the real risk), then
the waste count and stock badge as a safety net; the Playwright plan adds "chat removed while the cashier sits on the order
editor" as a required case.
