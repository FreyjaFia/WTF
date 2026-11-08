## Automated Testing Plan [Mostly Completed]

Goal: cover both the API and the POS app with automated tests, run on every push.

**Scope decision:** API unit/handler tests (in-memory) and real SQL Server tests are done. Browser E2E tests are
deliberately deferred.

### Status (as of 13 Oct 2026)

| Area | State |
| --- | --- |
| API unit and handler tests (`src/WTF.Tests`) | **Done**: about 1,240 test methods covering validators, mappers, helpers, every handler area (customers, products, items, users, auth, orders, pricing, promotions, loyalty, reports, dashboard, audit, sync, order links, conversations), services, hubs and endpoints. |
| Angular unit tests (`src/wtf-pos`) | **Done**: 124 spec files, about 2,350 tests. |
| Tests that need a real database | **Done** (`src/WTF.Tests/Database`): orders, customers, items, products, promotions, users, order links and conversations run against SQL Server (LocalDB locally, a container in CI) and skip when none is reachable. |
| CI | **Done**: `test-api` (with a SQL Server container) and `test-frontend` run on every push and pull request; build and SQL deploy jobs depend on them. |
| Pricing math consolidation | **Done.** One shared class, `PromotionPricing`. |
| Calculation consolidation | **Done** (14 Oct 2026). `WTF.Calculations` holds order totals, pricing, sales rules and report periods; 1,779 API tests pass. |
| E2E (Playwright) | **Built** (`src/wtf-e2e`, about 570 tests in 34 files by section; runs on CI without blocking, see "CI" below). |

### Layout

```
src/
  WTF.Api/
  WTF.Calculations/ <- all business arithmetic (order totals, promotion pricing, sales rules, report periods); no EF or HTTP
  WTF.Domain/
  WTF.Tests/        <- API and calculation unit tests (Calculations/, Common/, Endpoints/, Features/, Services/), in WTF.slnx
  wtf-pos/          <- specs live beside their source files (*.spec.ts)
    src/app/testing/  <- shared test helpers (HTTP service setup, fake services, feature helpers)
    vitest.config.ts  <- turns on per-file isolation (see "Angular notes")
```

### Test Types

- **Unit**: one class/function in isolation, or a handler against an in-memory fake database.
- **Integration**: several parts together against a real SQL Server (deferred).
- **E2E** (later, optional): real browser driving the running app (Playwright), main flows only.

### API (`WTF.Tests`) - what exists

Stack: xUnit, NSubstitute, Shouldly. `WTF.Api` exposes its internals to the test project.

- Validators and mappers: customers, users, products, items, the three promotion types.
- Pure helpers: order total calculation, promotion labels, time zones, report date ranges, URL helper, claims helper.
- `JwtService`, local image and report file storage, options defaults, Excel and PDF builders.
- **Route table snapshot** (`Endpoints/RouteTableTests`): a reviewed list of every route and who may call it. Adding a route or changing its access rule fails the test, so security changes are deliberate. The only anonymous routes are `/api`, `/api/health`, login, logout, refresh, validate and the loyalty redirect link.
- **Role matrix** (`Endpoints/PolicyMatrixTests`): for each authorization policy, which roles are admitted, evaluated by the real authorization service.
- **Endpoint validation** (`Endpoints/EndpointValidationTests`): the checks inside endpoint delegates (ID mismatch, report date and month ranges, push token input, login) run against a fake `ISender`.
- **Audit paging** (`Endpoints/AuditPagingTests`): paging is forwarded for the screen and dropped for Excel and PDF exports.

To make the routes testable, the policies live in `AddAppAuthorization()` and the route mapping in `MapAppEndpoints()` (behavior-neutral extraction from `Program.cs`).

### Angular (`wtf-pos`) - what exists

Vitest via `ng test`. Shared helpers in `src/app/testing`.

- Guards, interceptors, pipes, constants, messages and models.
- Every service in `core/services`: HTTP services (request URL, verb, params, body and every error path), connectivity, offline order queue (with an in-memory stand-in for the Dexie table), catalog and image caches, update check, push, SignalR, file and image download.
- Every shared component, and every feature page (login, dashboard, orders, inventory, management, audit logs, reports).
- App-level checks: the route table (guards and role data), role groups vs the API policies (the UI may never grant a role the API denies), and button conventions.

**Angular notes**

- `vi.mock` works for package names but not for relative imports (the Angular builder blocks those).
- The Angular builder shares the module cache between spec files by default, which made specs that mock packages pass or fail depending on file order. `vitest.config.ts` sets `isolate: true` and `angular.json` points the test target at it. Keep it.
- The Dexie `db` is replaced with small in-memory fakes (see `offline-order.service.spec.ts`).

### Bugs the tests found (all fixed)

`GetUserIdFromToken` always returned null; the alert auto-dismiss timer was never cleared; bundle and item search never re-filtered; over-long product fields showed no error; a discounted item without a product got the wrong message; promotion `isEditMode` stayed false after a create; SignalR could not reconnect after stop/start or a failed start; the audit export swallowed save errors; header and sidebar avatars did not refresh; the add-on selector reordered the shared catalog cache; missing report dates got a bare framework 400.

### Handler tests (done)

Handlers run against EF Core InMemory (`Microsoft.EntityFrameworkCore.InMemory`) with fakes for audit, push, SignalR and
the current user, plus builders in `Features/*/*Seed.cs` and `Infrastructure/TestDb.cs`. The in-memory database does not
enforce keys or unique indexes, ignores transactions, does not apply SQL Server defaults and matches text
case-sensitively, so those behaviors are covered by the real-database tests below.

### Pricing math merged (done)

The discounted-product rules now live in one class, `PromotionPricing` in the `WTF.Calculations` project
(`src/WTF.Calculations/Orders/PromotionPricing.cs`, moved from `WTF.Api/Common/Orders`; see Sales Reporting Phase 3). Its methods are `IsPromotionActiveOnLocalDate`,
`GetDiscountedUnitPrice`, `CalculateDiscountedUnitPrice`, `SatisfiesExactAddOns`. `CreateOrderHandler`,
`UpdateOrderHandler`, `EvaluatePromotionsHandler` and the discounted-product handlers all call it, so the cart preview and
the saved order cannot drift apart. The cart-line overload of `SatisfiesExactAddOns` in `EvaluatePromotionsHandler` is a
thin wrapper. The pricing tests (`Features/Pricing`) now run against the shared class; the old "all copies agree" tests
were removed because there is one copy.

### Real-database tests (done)

`WTF_TEST_SQL` points the tests at a SQL Server; if unset they use LocalDB, and they skip with a clear message when
neither is reachable. Each test creates and drops its own throwaway `WTF_Test_*` database. Covered: transaction rollback
in batches, unique and foreign key constraints, case-insensitive search, database defaults, the order link re-check and
the full submit/approve/reject flows. Not covered: two users saving at the same moment (stock changes, order numbers).

### Known gaps in the existing tests

- `order-editor`: scroll-position tab syncing, real interaction with the add-on selector and checkout modal (both are spied), template checks beyond a smoke render.
- Debounced search in the product, customer and user lists: `SearchInputComponent` raises a change-detection error when rendered there, so those tests use a template-less version of the list.
- `push-notification`: the Huawei token success path (a relative import that cannot be mocked) and the web notification click handler.
- Real drag-and-drop in the swappers (tested by moving DOM nodes) and logo loading in the order receipt (jsdom has no images or canvas).
- Some specs combine several files (`guards.spec.ts`, `interceptors.spec.ts`, a few service specs) where the rules below say one `<name>.spec.ts` beside each file. Cosmetic.
- Private helpers inside handlers (for example the scheduler's `GetNextDelay`) and the Excel and PDF document builders in the endpoint files are not reachable from tests yet.
- API clients for Azure, FCM and Huawei, and `DashboardHub`, are untested.
- The `.NET` tests have only been run on Windows; the first run on the Linux CI runner may show differences (two time zone tests use Windows ids).

### Not started

- E2E tests (Playwright) for the main flows.
- A script or CI step that lists source files without a matching spec or test.
- Coverage thresholds (start low and raise gradually).

### Applying the Plan to New and Existing Files (Rules, Not a Snapshot)

The plan is partly implemented and files keep being added. The lists above describe the state on
the date shown; the **rules below are what to follow**, so the plan applies to any file that exists
when the work starts and to every file added afterwards.

**Step 0 - build the inventory when starting (do not rely on the lists above):**

- Angular: list every non-spec `.ts` under `src/wtf-pos/src/app` that has no sibling
  `*.spec.ts` (guards, interceptors, pipes, services, components, pages).
- API: list every handler, validator, service and endpoint group under `WTF.Api` that has no
  matching test in `WTF.Tests`.
- Work through the gaps in batches by area, in the API phase order above.

**Mapping rules (which test a new file needs):**

| New file                                  | Test required                                              |
| ----------------------------------------- | ---------------------------------------------------------- |
| Angular guard / interceptor / pipe / util | Unit spec beside the file                                  |
| Angular service                           | Spec with `HttpTestingController` for each public method   |
| Angular component / page                  | Smoke spec (renders) + key interactions; thorough if logic-heavy |
| API handler (`Features/<Area>/*Handler`)  | Integration test in `WTF.Tests/Features/<Area>/`           |
| API validator / pure helper in `Common/`  | Unit test in `WTF.Tests/Common/` or `Features/<Area>/`     |
| API endpoint group / auth rule            | Integration test covering status codes and role access     |
| Bug fix                                   | Regression test that fails before the fix                  |

**Conventions:**

- Angular: `<name>.spec.ts` next to `<name>.ts`; shared fakes and
  `provideTestingDefaults()` live in one testing folder.
- API: test class `<Handler>Tests` in the folder mirroring the source path; test names
  `Method_Scenario_ExpectedResult`.
- Every handler test covers: success, validation failure, not found, forbidden (wrong role),
  and any soft-delete/restore or audit-log side effect it has.

**Definition of done for new code:** a feature or fix is not complete until its files follow
the mapping above and `dotnet test` / `ng test` pass.

**Keeping it enforced:**

- CI fails the build when tests fail (done: see the CI section).
- A small script (or CI step) lists source files without a matching spec/test and reports
  them, so gaps from new files are visible.
- Optional coverage thresholds (start low and raise gradually) rather than a one-time big-bang.

### CI

Done. `.github/workflows/main.yml` has two jobs that run on every push and pull request:

- `test-api`: `dotnet test src/WTF.Tests/WTF.Tests.csproj --configuration Release`
- `test-frontend`: `npm ci` then `npm test -- --watch=false` in `src/wtf-pos`

The build jobs (API, frontend, Android, production and staging) and both SQL deploy jobs `need` both test jobs, so
a failing test blocks the build and the deploy. Pull requests run only the test jobs (the build and deploy jobs are
skipped for them). The API job also starts a SQL Server container for the real-database tests.

**Browser tests (added 30 Oct 2026, not blocking).** A third job, `test-e2e`, runs the Playwright suite in `src/wtf-e2e` on its own SQL
Server container (`run.sh`: a throwaway `WTF_E2E_*` database, the API on 5290, the app on 4300 served with its `e2e` configuration,
4 workers and 1 retry on CI, and now 1 retry on a PC too). No other job lists it in `needs` and `continue-on-error` is on, so it cannot hold up a build or a
deploy; its report is uploaded as the `e2e-report` artifact. Plan: watch it for about a week, fix flaky tests, then add it to the
`needs` of the build and deploy jobs (or only a small smoke subset, with the full suite nightly).

**Browser test suite, state on 30 Oct 2026.** `src/wtf-e2e`: 760 tests in 34 files (one folder per app section, see its README), all
passing in about 6 minutes on a developer PC with 5 workers (7 Nov 2026: now 927 tests, 3 workers by default, 30 s assertion timeout and 1 retry, about 9 minutes, because 5 workers on one busy PC made a different 2 to 20 tests time out each run; see `playwright.config.ts`). It runs on a throwaway `WTF_E2E_*` database (`src/WTF.E2E.Database`, started by
`run.ps1` or `run.sh`, which also drop the leftovers of an interrupted run), serves the app with its own Angular configuration (`e2e`,
API on 5290), and signs each role in once (`global-setup.ts`) and reuses the session, so a test does not type the login form. No test is
skipped. Started from the Claude Code Terminal panel it can fail to start LocalDB while another session holds the instance, so run it
from one place at a time.

Product bugs the suite found, all fixed with a regression test:
- **Nothing enforced the validation attributes** on commands (an empty product name, a negative price or a name over the column
  length was accepted, or gave a 500). A MediatR step (`ValidationBehavior`) now validates every request and answers 400 with the
  message. Customer and user names (50 characters), usernames and roles are checked too.
- **New product add-on links were saved inactive** (EF sent `false` although the column default is true), so add-ons never reached the
  POS. Both assign handlers now set `IsActive = true` (real-database test `ProductAddOnDatabaseTests`).
- **A stock change of 0.001 did not move the balance** (the raw SQL parameter was typed decimal(18,2)); it is decimal(18,3) now.
- **A size, flavor or sauce could be ordered twice** through the API (`PickOneAddOnRule`, create and update).
- **A completed cash sale with less cash than the total was saved** with change 0; a new sale is now refused (tips are left out of the
  check so orders queued by an older offline app still sync). **Not done:** the same check when an open order is completed later
  (`UpdateOrderHandler` saves before it works the change out, so it needs a rollback first).
- The sidebar showed a Dashboard link to roles that cannot open it.
- The public ordering and chat limits are per address; `RateLimiting:Multiplier` (default 1) lets the test API raise them.

---

