# wtf-e2e

Playwright end-to-end tests for the WTF API and POS app (all workflows, including Inventory Phase 5 waste).

`fixtures/`, `pages/` and the specs in `tests/<area>/*.spec.ts` cover auth, orders and refunds, customer links, items and Stock In, stock alerts, waste and reports.

## Where the tests are

One folder per section of the app, one file per feature. `.\run.ps1 tests\<folder>` runs one area (or `npm run test:<area>`
against a stack that is already up).

```
tests/
  auth/            login-and-session, role-landing
  security/        api-access (who may call what), ui-access (pages and sidebar per role)
  dashboard/       dashboard, audit-log, notifications
  orders/
    register/      checkout, lifecycle (edit, void, override, input rules), details-and-refund
    offline/       sale-and-sync (sell without a connection, sync, held orders)
    customer-link/ ordering, edge-cases, chat
  promotions/      pricing
  inventory/
    items/         items-and-stock-in, lifecycle (delete, restore, stock rules on items), item-editor
    stock/         rules (deduction, void, override), sales-and-refunds, screens, alerts-and-bell
    waste/         recording, review, reasons, pos-sheet, edge-cases
  management/      products, customers, users, screens
  reports/         all-reports, waste-report-and-daily-close
  layout/          page-layout (phone, tablet, desktop, long names)
```

Shared code: `api/` (typed API helpers; `*-extra.ts` hold the helpers added per area), `pages/` (locators), `data/`
(ids, routes, roles), `utils/`, `fixtures/` (`api`, `signIn(role)`, `newContext()`).

## Rules

- Specs in `tests\<area>\*.spec.ts`; locators only in `pages\`; shared code in `api\`, `data\`, `utils\`, `fixtures\`.
- Descriptive test names with tags (for example `@waste`), no numbered prefixes.
- Each test seeds its own data through the API and does not depend on other tests.
- Web-first assertions, no fixed waits.

## Running

```powershell
.\run.ps1                    # everything
.\run.ps1 tests\waste        # arguments go to `playwright test`
.\run.ps1 -KeepDatabase      # keep the database afterwards (its name is printed)
```

Every run uses its own throwaway database, never the real `WTF` database:

1. `tools\E2eDb` creates `WTF_E2E_<time>_<id>` on its own LocalDB instance, `WtfE2E` (the script creates and starts it; `E2E_LOCALDB_INSTANCE` renames it, `E2E_SQL` points at another SQL Server) from the EF model, seeds
   the lookup rows, the waste reasons and the test accounts (`superadmin`, `admin`, `cashier`, `viewer`, `stockmgr`, `itemmgr`).
2. The API starts on port 5290 against it, and the app on 4300. A server already answering on a port is reused, except that
   the API port must be free (it could point at another database).
3. The tests run, then the processes it started are stopped and the database is dropped.

The name starts with `WTF_E2E_` (not `WTF_Test_`) so a .NET test run, which drops old `WTF_Test_*` databases, can never delete
it mid-run. The tool refuses to drop anything that does not start with `WTF_E2E_`.

If a run stops with an error, it is shown in red, saved in `.e2e-last-run.log`, and (when started by double-click) the window waits for Enter. If LocalDB cannot start in the Windows session (a broken instance registration gives "Unexpected error occurred inside a LocalDB instance API method call"), the script falls back to SQL Express (`Server=.\SQLEXPRESS`, Windows login) by itself. Only databases named `WTF_E2E_*` are ever created or dropped there; the real `WTF` database and the others on the instance are never touched. Set `E2E_SQL` yourself to use any other SQL Server.

**Test password.** The first run makes a random password and saves it in `.e2e-password` (git-ignored); every later run and
`npx playwright test` reuse it. `E2E_PASSWORD` overrides it.

| Variable | Default | Meaning |
| --- | --- | --- |
| `E2E_PASSWORD` | the saved `.e2e-password` | Password of the test accounts |
| `E2E_SQL` | LocalDB | SQL Server connection string used to create the throwaway database |
| `E2E_APP_ORIGIN` | `http://localhost:4300` | App under test |
| `E2E_API_ORIGIN` | `http://localhost:5290` | API used to seed data |
| `E2E_APP_API_ORIGIN` | `http://localhost:5290` | API address the app was built with. The app is served with its `e2e` configuration, which already points at 5290, so nothing is rerouted; set this only if you serve it differently |
| `E2E_USER_<ROLE>` | `superadmin`, `admin`, `cashier`, `viewer`, `stockmgr`, `itemmgr` | Test usernames |

First time on a machine: `npm install` and `npx playwright install chromium` here.

The browser runs in `Asia/Manila` because reports group by the shop's local day.

## CI

The `test-e2e` job in `.github/workflows/main.yml` runs the suite on every push and pull request, on a SQL Server container
like the one the API tests use. It does **not** block anything yet: no build or deploy job waits for it and a failure does not
fail the workflow (`continue-on-error`). The report and traces are uploaded as the `e2e-report` artifact. To make it a
requirement, add `test-e2e` to the `needs` of the build and deploy jobs and remove `continue-on-error`.

`run.sh` is the Linux/macOS twin of `run.ps1` (`E2E_SQL=<connection string> bash run.sh`); it is what CI runs. On CI
(`CI=true`) Playwright uses 4 workers (a runner for a public repository has 4 cores) and 1 retry, and writes an HTML report.
