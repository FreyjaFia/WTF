# Deploying to staging

Staging is deployed by the "Build and Deploy" workflow, in two ways:

- Automatically on every push to `main`.
- By hand for any branch: GitHub, Actions, **Build and Deploy**, **Run workflow**, pick the branch in "Use workflow from",
  run. There are no options.

Both do exactly the same steps, in this order:

1. Tests.
2. **Reset**: `tools/staging/reset_staging_data.sql` empties the staging database of all shop and platform data. The
   schema, the applied-scripts history and the fixed setup (statuses, payment methods, plans, system roles, the default
   shop) stay. Order numbers start again from 1.
3. **SQL scripts**: every script in `tools/sql` not yet recorded in `SchemaScriptHistory` is applied.
4. **Demo data**: `src/WTF.StagingSeed` adds accounts, a menu, stock, orders, promotions, expenses and a second shop.
5. Deploy of the web app and a staging Android APK (download it from the run page, under Artifacts:
   `android-apk-staging`).

Two staging deploys never run at once: the second waits for the first.

## Safety

- The reset refuses to run when the staging database secrets match the production ones, and when the
  `STAGING_SEED_PASSWORD` secret is missing (otherwise staging would be left without accounts).
- The reset only runs on the `*_STAGING` database. Production deploys (tags `v*`) never reset anything.
- The reset removes data, not schema. If a branch renamed or dropped something, a later deploy of another branch still
  sees that change. A manual run prints a warning when a branch has such SQL. If staging misbehaves, restore the
  staging database from the main-state backup (MonsterASP panel) and run again. Keep a fresh backup after each deploy
  from `main`.

## Demo data

All accounts use the GitHub secret `STAGING_SEED_PASSWORD`.

- Accounts: platform admin `platformadmin`, owner `admin`, and `manager`, `cashier`, `viewer`, `stockmgr`, `itemmgr`.
- Menu: categories, 9 products, add-ons (size, temperature, flavor, topping, extra), 3 promotions (one of each type).
- Stock: 3 items (one fine, one low, one near critical), recipes, 2 suppliers, a receipt, 2 waste entries (one to
  review), 2 purchase orders and an open count.
- Orders: completed (cash, GCash, tips, promo price), Senior and PWD discounts, held, cancelled, refunded, and a
  customer-link order waiting for approval.
- Enough rows to page through every paged list (page sizes 10, 25, 50, 100): about 140 orders (infinite scroll on the order
  list), 40 customers, 38 products, 35 stock items, 38 users, 30+ receipts, waste entries, purchase orders, stock counts
  and expenses, and 90 audit log rows. The extra stock activity uses its own items so the three original items keep their
  fine, low and near-critical states.
- Also customers (with addresses), expenses, and a second shop `Starter Demo Cafe` on the Starter plan (owner
  `starterowner`, open invoice). It also has 2 more staff, 4 customers and 45 orders for plan gating: sign in as `starterowner` to see the screens
  that are not in the Starter plan.

When you build a feature, update the seed so the feature has data on staging (see `CLAUDE.md`).
